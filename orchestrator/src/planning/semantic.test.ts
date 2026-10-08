import { describe, expect, it } from "vitest";
import { createHumanInteractionHarness } from "../humanInteraction/fake";
import { createSimulation, type WorkerScript } from "../scheduler/fake";
import { createInMemoryAuditRepository } from "../store/memory";
import { fakeEvidence } from "../manager/fake";
import { validateEvidence } from "../manager/validator";
import { createAnthropicGoalReviewer, createAnthropicIntentPlanner } from "./anthropic";
import { createAnthropicHttpTransport } from "./anthropicHttp";
import { citedLocations, citedPaths, semanticAcceptance } from "./goalAcceptance";
import { normalizeGoalReview, normalizeIntentDecision } from "./normalize";
import type { GoalReviewer, GoalReviewInput, IntentPlanner } from "./types";

const MSG = "幫我把搜尋 loading 做順一點，手機版一起處理";
const planner: IntentPlanner = {
  async interpret() {
    return {
      intent: "change_code",
      taskId: null,
      title: "搜尋 loading 體驗",
      interpretedObjective: "Make the AI search waiting state responsive on desktop and mobile.",
      criteria: ["Waiting state gives visible feedback immediately", "Mobile layout does not appear frozen during a long search"],
      clarificationQuestion: "",
    };
  },
};

type Verdict = "satisfied" | "not_satisfied" | "unsupported" | "omit";
function reviewer(script: (call: number, input: GoalReviewInput) => Record<string, Verdict>): GoalReviewer & { calls: GoalReviewInput[] } {
  const calls: GoalReviewInput[] = [];
  return {
    calls,
    async review(input) {
      calls.push(structuredClone(input));
      const verdicts = script(calls.length, input);
      return {
        criteria: input.criteria
          .filter((c) => verdicts[c.id] !== "omit")
          .map((c) => ({ id: c.id, status: verdicts[c.id] ?? "satisfied", evidence: verdicts[c.id] === "satisfied" || !verdicts[c.id] ? `diff shows ${c.id}` : "", reason: verdicts[c.id] && verdicts[c.id] !== "satisfied" ? `${c.id} not visible in the diff` : "" })),
      };
    },
  };
}

async function goalTask(r: GoalReviewer, worker?: readonly WorkerScript[]) {
  const sim = createSimulation({ autoApproveCommits: false, goalReviewer: r, ...(worker ? { worker: { "s-task-1": worker } } : {}) });
  const h = createHumanInteractionHarness({ loop: sim.loop, approvals: sim.approvals, audit: createInMemoryAuditRepository(() => "t"), now: sim.ports.now, planner, idPrefix: "s" });
  const res = await h.service.handleReply({ kind: "reply", idempotencyKey: "tg.msg.1", replyToDeliveryRef: null, text: MSG });
  expect(res.outcome).toBe("submitted");
  await sim.loop.settle();
  return { sim, ...h };
}

describe("semantic goal acceptance (Manager-owned)", () => {
  it("all technical validations pass but the original goal is unmet -> not accepted; diagnosis names the unmet criterion", async () => {
    const r = reviewer(() => ({ "AC-2": "not_satisfied" }));
    const { sim } = await goalTask(r);
    const snap = sim.loop.task("s-task-1")!;
    expect(snap.status).toBe("needs_human_decision"); // two Manager-guided repairs did not fix the goal
    expect(sim.approvals.listByTask("s-task-1")).toHaveLength(0);
    expect(sim.commits).toHaveLength(0);
    const d = snap.repairCycles[0].diagnosis;
    expect(`${d.failingCheck} ${d.actual} ${d.requiredFix}`).toContain("AC-2");
    expect(snap.humanEscalation!.currentBlocker.failingCheck).toContain("AC-2");
    // Every validation actually passed: the failure is purely semantic.
    expect(r.calls.every((c) => c.validations.every((v) => v.status === "passed"))).toBe(true);
  });

  it("goal criteria satisfied by the reviewer and validations passing -> accepted (commit/publish approval)", async () => {
    const { sim } = await goalTask(reviewer(() => ({})));
    expect(sim.loop.task("s-task-1")).toMatchObject({ status: "needs_human_approval", approvalPhase: "commit_publish" });
  });

  it("an unsupported criterion is needs_repair, not acceptance", async () => {
    const { sim } = await goalTask(reviewer((n) => (n === 1 ? { "AC-1": "unsupported" } : {})));
    const snap = sim.loop.task("s-task-1")!;
    expect(snap.repairCycles).toHaveLength(1);
    expect(snap.repairCycles[0].diagnosis.failingCheck).toContain("AC-1");
    expect(snap.status).toBe("needs_human_approval"); // repaired, then accepted
  });

  it("goal acceptance survives repair cycles: the same original goal and criteria are re-judged", async () => {
    const r = reviewer((n) => (n < 3 ? { "AC-1": "not_satisfied" } : {}));
    const { sim } = await goalTask(r);
    expect(sim.loop.task("s-task-1")!.status).toBe("needs_human_approval");
    expect(r.calls).toHaveLength(3);
    const first = r.calls[0];
    for (const c of r.calls) {
      expect(c.criteria).toEqual(first.criteria);
      expect(c.originalRequest).toBe(MSG);
      expect(c.interpretedObjective).toBe(first.interpretedObjective);
    }
    expect(first.criteria.map((c) => c.id)).toEqual(["AC-1", "AC-2", "AC-3"]);
  });

  it("a human-decision resume keeps the original goal and criteria", async () => {
    const r = reviewer((n) => (n <= 3 ? { "AC-2": "not_satisfied" } : {}));
    const { sim, service, transport } = await goalTask(r);
    expect(sim.loop.task("s-task-1")!.status).toBe("needs_human_decision");
    await service.observe();
    const esc = transport.sent.find((s) => s.notice.kind === "human_decision")!;
    expect((await service.handleReply({ kind: "reply", idempotencyKey: "tg.msg.2", replyToDeliveryRef: esc.deliveryRef, text: "Show a skeleton list immediately on mobile too." })).outcome).toBe("resumed");
    await sim.loop.settle();
    const after = r.calls.at(-1)!;
    expect(after.criteria).toEqual(r.calls[0].criteria);
    expect(after.originalRequest).toBe(MSG);
    expect(sim.loop.task("s-task-1")!.status).toBe("needs_human_approval");
  });

  it("the Worker cannot weaken or self-certify the goal: omitted criteria and a missing reviewer never accept", async () => {
    // Reviewer silently drops AC-2 (as if a Worker report had argued it away).
    const { sim } = await goalTask(reviewer(() => ({ "AC-2": "omit" })));
    expect(sim.loop.task("s-task-1")!.status).toBe("needs_human_decision");
    // No reviewer at all: goal criteria stay unverified even though the Worker reports success.
    const { acceptance: ev, reviewUnavailable } = await semanticAcceptance({
      goal: { mode: "change", title: "t", objective: "o", goal: null, criteria: [{ id: "AC-1", text: "goal", kind: "goal" }, { id: "AC-2", text: "tests", kind: "technical" }] },
      validations: [{ name: "tests", requested: true, executed: true, status: "passed", trusted: true }],
      reviewer: null,
      reviewId: "run-1",
      diff: { text: "", truncated: false },
      answer: null,
      fileContent: () => null,
      timeoutMs: 100,
    });
    expect(reviewUnavailable).toBe(true);
    expect(ev).toEqual([
      expect.objectContaining({ criterionId: "AC-1", status: "unknown", evidenceType: "manager_review", reference: null }),
      { criterionId: "AC-2", status: "satisfied", evidenceType: "validation", reference: "tests" },
    ]);
  });

  it("a failing or hanging reviewer leaves goal criteria unverified (fail closed)", async () => {
    const base = {
      goal: { mode: "change" as const, title: "t", objective: "o", goal: null, criteria: [{ id: "AC-1", text: "goal", kind: "goal" as const }] },
      validations: [{ name: "tests", requested: true, executed: true, status: "passed" as const, trusted: true }],
      reviewId: "run-1",
      diff: { text: "x", truncated: false },
      answer: null,
      fileContent: () => null,
      timeoutMs: 20,
    };
    for (const r of [{ review: async () => Promise.reject(new Error("boom")) }, { review: () => new Promise<unknown>(() => {}) }, { review: async () => "not json" }]) {
      const out = await semanticAcceptance({ ...base, reviewer: r });
      expect(out.reviewUnavailable).toBe(true);
      expect(out.acceptance[0]).toMatchObject({ status: "unknown", reference: null });
    }
  });
});

describe("read-only answers are judged against cited repository files", () => {
  it("passes the answer and the trusted contents of the files it cites to the reviewer", async () => {
    const r = reviewer(() => ({}));
    const { acceptance: [ev], reviewUnavailable } = await semanticAcceptance({
      goal: { mode: "read_only", title: "t", objective: "o", goal: { intent: "investigate_or_answer", originalRequest: "q", interpretedObjective: "o" }, criteria: [{ id: "AC-1", text: "answered", kind: "goal" }] },
      validations: [{ name: "typecheck", requested: true, executed: true, status: "passed", trusted: true }],
      reviewer: r,
      reviewId: "run-9",
      diff: { text: "", truncated: false },
      answer: "Search starts in client/src/pages/Search.tsx:40 and calls server/routers.ts. Not verified: caching.",
      fileContent: (p) => (p === "client/src/pages/Search.tsx" ? "export default function Search() {}" : null),
      timeoutMs: 1000,
    });
    expect(r.calls[0].citedFiles).toEqual([{ path: "client/src/pages/Search.tsx", excerpt: "export default function Search() {}" }]);
    expect(r.calls[0].answer).toContain("Search starts");
    expect(ev).toMatchObject({ status: "satisfied", evidenceType: "manager_review", reference: "review:run-9" });
    expect(reviewUnavailable).toBe(false);
  });

  it("citedPaths ignores absolute and traversal paths", () => {
    expect(citedPaths("see /etc/passwd and ../x/y.ts and client/a.ts and `server/b.ts:12`")).toEqual(["client/a.ts", "server/b.ts"]);
  });

  // A large Home.tsx whose placeholder sits far beyond the first 8 KB (as in the live E2E).
  const HOME_PATH = "client/src/pages/Home.tsx";
  const bigHome = Array.from({ length: 900 }, (_, i) => (i + 1 === 644 ? '      placeholder="搜尋工廠、產品或製程"' : `  const filler${i + 1} = "${"x".repeat(40)}";`)).join("\n");
  const readOnly = (answer: string, read: (p: string) => string | null, extra: Partial<Parameters<typeof semanticAcceptance>[0]> = {}) => {
    const r = reviewer(() => ({}));
    return {
      r,
      run: () =>
        semanticAcceptance({
          goal: { mode: "read_only", title: "t", objective: "o", goal: { intent: "investigate_or_answer", originalRequest: "q", interpretedObjective: "o" }, criteria: [{ id: "AC-1", text: "answered", kind: "goal" }] },
          validations: [],
          reviewer: r,
          reviewId: "run-1",
          diff: { text: "", truncated: false },
          answer,
          fileContent: read,
          timeoutMs: 1000,
          ...extra,
        }),
    };
  };

  it("citedLocations keeps :line and :line-range references, bounded and normalized", () => {
    expect(citedLocations("client/src/pages/Home.tsx:641-647, again `client/src/pages/Home.tsx:700` and server/b.ts and x/y.ts:9-3")).toEqual([
      { path: "client/src/pages/Home.tsx", ranges: [{ start: 641, end: 647 }, { start: 700, end: 700 }] },
      { path: "server/b.ts", ranges: [] },
      { path: "x/y.ts", ranges: [{ start: 3, end: 9 }] },
    ]);
    expect(citedLocations("a/b.ts:1-999999")[0].ranges).toEqual([{ start: 1, end: 60 }]);
    expect(citedLocations(Array.from({ length: 9 }, (_, i) => `a/b.ts:${i + 1}`).join(" "))[0].ranges).toHaveLength(4);
    expect(citedLocations("../etc/passwd:1 /etc/x.ts:3 ./a/b.ts:4")).toEqual([]);
  });

  it("a path:line citation gives the reviewer the cited lines of a large file, not its first 8 KB", async () => {
    const { r, run } = readOnly(`The placeholder is in ${HOME_PATH}:644.`, (p) => (p === HOME_PATH ? bigHome : null));
    await run();
    const [f] = r.calls[0].citedFiles;
    expect(f.path).toBe(HOME_PATH);
    expect(f.excerpt).toContain('644:       placeholder="搜尋工廠、產品或製程"');
    expect(f.excerpt).toContain("636: ");
    expect(f.excerpt).toContain("652: ");
    expect(f.excerpt).not.toMatch(/^1: /m);
    expect(f.excerpt.length).toBeLessThanOrEqual(8_000);
  });

  it("a path:line-range citation includes the whole range with context", async () => {
    const { r, run } = readOnly(`See ${HOME_PATH}:641-647`, (p) => (p === HOME_PATH ? bigHome : null));
    await run();
    const ex = r.calls[0].citedFiles[0].excerpt;
    for (let n = 633; n <= 655; n++) expect(ex).toContain(`${n}: `);
    expect(ex).toContain("placeholder=");
    expect(ex).not.toContain("632: ");
  });

  it("without a usable line reference the cited file falls back to the bounded head", async () => {
    for (const answer of [`See ${HOME_PATH}.`, `See ${HOME_PATH}:5000`]) {
      const { r, run } = readOnly(answer, (p) => (p === HOME_PATH ? bigHome : null));
      await run();
      const ex = r.calls[0].citedFiles[0].excerpt;
      expect(ex).toBe(bigHome.slice(0, 8_000));
      expect(ex).not.toContain("placeholder=");
    }
  });

  it("cited excerpts stay bounded for huge lines and many ranges", async () => {
    const huge = Array.from({ length: 400 }, (_, i) => `${i + 1}${"y".repeat(5_000)}`).join("\n");
    const { r, run } = readOnly("a/huge.ts:10-70 a/huge.ts:100-160 a/huge.ts:200 a/huge.ts:300", (p) => (p === "a/huge.ts" ? huge : null));
    await run();
    const ex = r.calls[0].citedFiles[0].excerpt;
    expect(ex.length).toBeLessThanOrEqual(8_000);
    expect(ex).toMatch(/^10: /); // the first cited line is kept before any context
  });

  it("unsafe cited paths are never read, whatever line they carry", async () => {
    const asked: string[] = [];
    const { r, run } = readOnly("see ../secrets/key.ts:1 and /etc/passwd.txt:2 and client/../x.ts:3", (p) => (asked.push(p), "SECRET"));
    await run();
    expect(asked).toEqual([]);
    expect(r.calls[0].citedFiles).toEqual([]);
  });

  it("Manager source evidence for a cited path is kept when it shows lines the cited excerpt lacks", async () => {
    const plan = { kind: "factual_lookup" as const, requirements: ["r"], targets: ["Home", "placeholder"], validationIsEvidence: false };
    const ports = { listFiles: async () => [HOME_PATH] };
    const goal = { mode: "read_only" as const, title: "t", objective: "o", goal: { intent: "investigate_or_answer" as const, originalRequest: "q", interpretedObjective: "o" }, criteria: [{ id: "AC-1", text: "answered", kind: "goal" as const }], evidencePlan: plan };
    // Cited without a line: the cited head misses line 644, the Manager's keyword excerpt has it.
    const a = readOnly(`It is in ${HOME_PATH}.`, (p) => (p === HOME_PATH ? bigHome : null), { goal, sourcePorts: ports });
    await a.run();
    expect(a.r.calls[0].citedFiles[0].excerpt).not.toContain("placeholder=");
    expect(a.r.calls[0].sourceEvidence?.find((f) => f.path === HOME_PATH)?.excerpt).toContain('644:       placeholder="搜尋工廠、產品或製程"');
    // Cited at the exact lines: the Manager excerpt adds nothing new and is not duplicated.
    const b = readOnly(`It is in ${HOME_PATH}:644.`, (p) => (p === HOME_PATH ? bigHome : null), { goal, sourcePorts: ports });
    await b.run();
    expect(b.r.calls[0].citedFiles[0].excerpt).toContain("644: ");
    expect(b.r.calls[0].sourceEvidence ?? []).toEqual([]);
  });
});

describe("planning output validation", () => {
  it("derives the mode from the intent and never trusts unknown task ids or extra fields", () => {
    expect(normalizeIntentDecision({ intent: "investigate_or_answer", title: "t", interpretedObjective: "o", criteria: ["c"], mode: "change" }, { knownTaskIds: [], requireTask: false })).toMatchObject({ kind: "task", mode: "read_only" });
    expect(normalizeIntentDecision({ intent: "audit_and_fix", title: "t", interpretedObjective: "o", criteria: ["c"] }, { knownTaskIds: [], requireTask: false })).toMatchObject({ kind: "task", mode: "change" });
    expect(normalizeIntentDecision({ intent: "task_follow_up", taskId: "evil" }, { knownTaskIds: ["t1"], requireTask: false })).toEqual({ kind: "task_follow_up", intent: "task_follow_up", taskId: null });
    expect(normalizeIntentDecision({ intent: "status_query" }, { knownTaskIds: [], requireTask: true }).kind).toBe("clarify");
    expect(normalizeIntentDecision({ intent: "change_code", title: "t", interpretedObjective: "o", criteria: [] }, { knownTaskIds: [], requireTask: false }).kind).toBe("clarify");
    expect(normalizeIntentDecision({ intent: "deploy_prod" }, { knownTaskIds: [], requireTask: false }).kind).toBe("clarify");
    expect(normalizeIntentDecision("garbage", { knownTaskIds: [], requireTask: false }).kind).toBe("clarify");
  });

  it("a review verdict without evidence, a duplicate, or an unknown id is never 'satisfied'", () => {
    const out = normalizeGoalReview(
      { criteria: [{ id: "AC-1", status: "satisfied", evidence: "", reason: "" }, { id: "AC-2", status: "satisfied", evidence: "a" }, { id: "AC-2", status: "not_satisfied", evidence: "", reason: "b" }, { id: "AC-9", status: "satisfied", evidence: "x" }] },
      [{ id: "AC-1" }, { id: "AC-2" }, { id: "AC-3" }],
    );
    expect(out.map((r) => [r.id, r.status])).toEqual([["AC-1", "unsupported"], ["AC-2", "unsupported"], ["AC-3", "unsupported"]]);
  });

  it("the validator only accepts manager_review evidence carrying a reviewer reference; worker_report never backs a criterion", () => {
    const base = fakeEvidence();
    const ids = base.acceptanceCriteriaIds;
    const verdict = (evidenceType: "manager_review" | "worker_report", reference: string | null) =>
      validateEvidence({ ...base, acceptance: ids.map((criterionId) => ({ criterionId, status: "satisfied" as const, evidenceType, reference })) });
    expect(verdict("manager_review", "review:run-1").decision).toBe(validateEvidence(base).decision);
    for (const v of [verdict("manager_review", "run-1"), verdict("manager_review", null), verdict("worker_report", "review:run-1")]) {
      expect(v.decision).not.toBe("accepted");
      expect(v.reasonCodes).toContain("acceptance_unverified");
    }
  });
});

describe("Claude-backed planning adapters", () => {
  function fakeClient(reply: { stop_reason: string; text: string }) {
    const requests: Record<string, unknown>[] = [];
    const headers: Record<string, string>[] = [];
    const fetch = (async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      headers.push(init.headers as Record<string, string>);
      return new Response(JSON.stringify({ stop_reason: reply.stop_reason, content: [{ type: "text", text: reply.text }] }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    return { requests, headers, client: createAnthropicHttpTransport({ apiKey: "test-key", fetch, maxRetries: 0 }) };
  }

  it("uses structured JSON output with server-side fallbacks and returns parsed data", async () => {
    const f = fakeClient({ stop_reason: "end_turn", text: JSON.stringify({ intent: "status_query" }) });
    const out = await createAnthropicIntentPlanner({ client: f.client }).interpret({ message: "x", contextTaskId: null, tasks: [], requireTask: false });
    expect(out).toEqual({ intent: "status_query" });
    expect(f.requests[0]).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", output_config: { effort: "high", format: { type: "json_schema" } } });
    expect(f.headers[0]).toMatchObject({ "anthropic-beta": "server-side-fallback-2026-07-01" });
  });

  it("a refusal or non-JSON reply throws (callers fail closed)", async () => {
    await expect(createAnthropicGoalReviewer({ client: fakeClient({ stop_reason: "refusal", text: "" }).client }).review({ mode: "change", intent: null, title: "t", originalRequest: "o", interpretedObjective: "o", criteria: [], validations: [], diff: "", diffTruncated: false, answer: null, citedFiles: [] })).rejects.toThrow(/refusal/);
    await expect(createAnthropicIntentPlanner({ client: fakeClient({ stop_reason: "end_turn", text: "hello" }).client }).interpret({ message: "x", contextTaskId: null, tasks: [], requireTask: false })).rejects.toThrow();
  });
});
