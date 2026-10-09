import { describe, expect, it } from "vitest";
import { createHumanInteractionHarness } from "../humanInteraction/fake";
import { validateAndNormalizeRequest } from "../intake/normalize";
import { semanticAcceptance } from "../planning/goalAcceptance";
import { createStructuredGoalReviewer, REVIEWER_SYSTEM } from "../planning/planners";
import type { GoalReviewer, GoalReviewInput, IntentPlanner } from "../planning/types";
import { createInMemoryAuditRepository } from "../store/memory";
import { createSimulation } from "./fake";
import { MAX_OWNER_ANSWER } from "../planning/normalize";

/**
 * Natural-language orchestration + structured safety, end to end:
 * the Worker reports everything in prose, the Manager reviews the OWNER'S
 * GOAL against trusted evidence (not every sentence), repairs only real core
 * gaps with a targeted follow-up, and writes the owner answer itself in the
 * same review call. The Manager's prose is NOT re-validated by another layer
 * (only output hygiene); the raw Worker report never reaches the owner, and a
 * Manager outage or malformed output is infrastructure: no Worker re-run, no
 * repair cycle, no answer.
 *
 * The scenario is deliberately a multi-file investigation with confirmed
 * findings, an inference, a recommendation, an unverified boundary and an
 * unsupported ancillary claim.
 */

const ASK = "幫我查一下登入後 session 多久會過期，前端會不會自動續期？只要查，不要改檔案。";
const REPO = {
  "server/_core/session.ts": "// Login session lifetime\nexport const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;\nexport function renewSession(id: string) { return touch(id, SESSION_TTL_MS); }\n",
  "client/src/hooks/useAuth.ts": "export function useAuth() {\n  const me = trpc.auth.me.useQuery();\n  trpc.auth.refresh.useQuery(undefined, { refetchInterval: 5 * 60 * 1000 });\n  return me;\n}\n",
};
/** The core fact the trusted source shows, and how a correct report states it. */
const CORE_SOURCE = "SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000";
const CORE_CLAIM = "7 天";
const ANCILLARY = "正式環境 Redis 平均延遲約 30ms";
const RAW_ONLY = "keyword-free raw engineering note";
/** A full engineer report: confirmed findings, inference, recommendation, unverified boundary, unsupported ancillary claim. */
const FULL_REPORT = [
  `確認：session 有效期是 ${CORE_CLAIM}，定義在 server/_core/session.ts:2 （SESSION_TTL_MS）。`,
  "確認：前端每 5 分鐘呼叫 auth.refresh，見 client/src/hooks/useAuth.ts:3 。",
  "推論：使用者持續開著頁面時，session 會一直被延長。",
  "建議：可考慮把 TTL 移到環境變數，方便不同環境調整。",
  "未驗證：正式站實際 cookie 設定沒有實機確認。",
  `另外，${ANCILLARY}；${RAW_ONLY}。`,
].join("\n");
const SYNTHESIS = `登入 session 的有效期是 ${CORE_CLAIM}（server/_core/session.ts:2）。前端每 5 分鐘自動續期（client/src/hooks/useAuth.ts:3），推論上頁面開著就會一直延長。這是依目前 repository 原始碼確認，未實機驗證正式站。`;
const VERIFIED_NOTE = `server/_core/session.ts:2 defines a ${CORE_CLAIM} TTL; client/src/hooks/useAuth.ts:3 renews it`;

const planner: IntentPlanner = {
  async interpret() {
    return {
      intent: "investigate_or_answer",
      taskId: null,
      title: "登入 session 有效期",
      interpretedObjective: "Find how long a login session lasts and whether the frontend renews it. No files will be changed.",
      criteria: ["The owner learns how long a login session lasts and whether the frontend renews it"],
      clarificationQuestion: "",
      riskObservations: [],
      workAreas: { programming: true, visual: false },
      programmingObjective: "",
      visualObjective: "",
    };
  },
};

type Verdict = "goal" | { gap: string } | "outage" | "malformed";
/**
 * Behaves like the prompted Manager reviewer: judges the CORE result against trusted
 * source only, and writes its own owner answer. `script` decides per review call.
 */
function managerReviewer(opts: { ownerAnswer?: string; script?: Verdict[] } = {}) {
  const calls: GoalReviewInput[] = [];
  const reviewer: GoalReviewer & { calls: GoalReviewInput[] } = {
    calls,
    async review(input) {
      calls.push(input);
      const step = opts.script?.[Math.min(calls.length - 1, opts.script.length - 1)] ?? "goal";
      if (step === "outage") throw new Error("503 Manager provider unavailable");
      const sources = [...input.citedFiles, ...(input.sourceEvidence ?? [])];
      const shown = sources.some((f) => f.excerpt.includes(CORE_SOURCE));
      const core = shown && (input.answer ?? "").includes(CORE_CLAIM);
      const gap = typeof step === "object" ? step.gap : null;
      const ok = core && !gap;
      return {
        criteria: input.criteria.map((c) => ({
          id: c.id,
          status: ok ? "satisfied" : shown ? "not_satisfied" : "unsupported",
          evidence: ok ? VERIFIED_NOTE : "",
          reason: ok ? "" : gap ?? (shown ? "the stated session lifetime contradicts server/_core/session.ts:2" : "the session source was not provided"),
        })),
        constraints: [],
        ...(step === "malformed" ? {} : { ownerAnswer: ok ? (opts.ownerAnswer ?? SYNTHESIS) : "" }),
      };
    },
  };
  return reviewer;
}

async function start(reviewer: GoalReviewer, answer: string, extra: { repo?: Record<string, string>; worker?: Record<string, string[]> } = {}) {
  const audit = createInMemoryAuditRepository(() => "2026-10-08T00:00:00.000Z");
  const sim = createSimulation({
    autoApproveCommits: false,
    goalReviewer: reviewer,
    repoFiles: extra.repo ?? REPO,
    answers: { "m-task-1": answer },
    ...(extra.worker ? { worker: extra.worker } : {}),
  });
  const h = createHumanInteractionHarness({ loop: sim.loop, approvals: sim.approvals, audit, now: sim.ports.now, planner, idPrefix: "m" });
  await h.service.handleReply({ kind: "reply", idempotencyKey: "tg.msg.1", replyToDeliveryRef: null, text: `任務：${ASK}` });
  await sim.loop.settle();
  await h.service.observe();
  const answered = h.transport.sent.find((s) => s.notice.kind === "milestone" && /^查到了/.test((s.notice as { detail?: string }).detail ?? ""));
  const everything = JSON.stringify(h.transport.sent);
  return { sim, detail: answered ? (answered.notice as { detail: string }).detail : null, everything, ...h };
}

/** Nothing of the raw Worker prose beyond what the Manager wrote reached the owner. */
function expectNoRawWorkerProse(everything: string) {
  expect(everything).not.toContain(ANCILLARY);
  expect(everything).not.toContain(RAW_ONLY);
  expect(everything).not.toContain("可考慮把 TTL 移到環境變數");
}

describe("Worker full report → Manager goal review → Manager synthesis → owner", () => {
  it("A/B/E: the Manager receives the full report; a trusted core result with inference, recommendation, boundary and an unsupported ancillary claim is accepted without repair", async () => {
    const reviewer = managerReviewer();
    const { sim } = await start(reviewer, FULL_REPORT);
    const t = sim.loop.task("m-task-1")!;
    expect(t).toMatchObject({ mode: "read_only", status: "accepted", state: "complete" });
    expect(reviewer.calls[0].answer).toBe(FULL_REPORT);
    expect(t.repair.attempt).toBe(0);
    expect(t.repairCycles).toHaveLength(0);
    expect(sim.workerCalls).toHaveLength(1);
    expect(sim.trustedRecords[0].acceptance.every((a) => a.status === "satisfied")).toBe(true);
    // Goal-oriented: a short list of core conditions, not one criterion per reported sentence.
    expect(reviewer.calls[0].criteria.length).toBeLessThanOrEqual(3);
    expect(sim.commits).toHaveLength(0);
  });

  it("C/J: the owner receives the Manager's own synthesis; unsupported ancillary claims and raw Worker prose never reach the owner", async () => {
    const { sim, detail, everything } = await start(managerReviewer(), FULL_REPORT);
    expect(sim.loop.task("m-task-1")!.answer).toBe(SYNTHESIS);
    expect(detail).toContain(SYNTHESIS);
    expect(detail).not.toContain(FULL_REPORT);
    expectNoRawWorkerProse(everything);
  });

  it("D: an unsupported claim that changes the core answer still requires repair; nothing is answered", async () => {
    const wrong = FULL_REPORT.replace(CORE_CLAIM, "30 天");
    const { sim, detail } = await start(managerReviewer(), wrong);
    const t = sim.loop.task("m-task-1")!;
    expect(t.status).not.toBe("accepted");
    expect(t.repairCycles.length).toBeGreaterThan(0);
    expect(sim.trustedRecords[0].acceptance.some((a) => a.evidenceType === "manager_review" && a.status === "failed")).toBe(true);
    expect(sim.trustedRecords[0].managerAnswer).toBeUndefined();
    expect(detail).toBeNull();
  });

  it("F: a real core gap gets one targeted follow-up on the SAME task and branch, then the Manager answers", async () => {
    const gap = "Earlier findings stand; only check whether the renewal in client/src/hooks/useAuth.ts also runs after logout.";
    const reviewer = managerReviewer({ script: [{ gap }, "goal"] });
    const { sim } = await start(reviewer, FULL_REPORT);
    const t = sim.loop.task("m-task-1")!;
    expect(sim.workerCalls).toHaveLength(2);
    const [first, repair] = sim.workerCalls;
    expect(repair).toMatchObject({ repair: true, taskId: first.taskId, branch: first.branch });
    // The Manager's natural-language follow-up reaches the Worker, together with "keep verified work".
    expect(repair.objective).toContain(gap);
    expect(repair.objective).toMatch(/Keep work that is already verified/);
    expect(t).toMatchObject({ status: "accepted", answer: SYNTHESIS, repair: { attempt: 1 } });
    expect(t.repairCycles).toHaveLength(1);
  });

  it("J: the Manager's own prose is not re-validated by a second layer: no re-synthesis, no citation check, delivered as written", async () => {
    // The Manager mentions a path outside the gathered excerpts as its own judgement; nothing re-checks it.
    const own = `${SYNTHESIS}建議：續期邏輯若要調整，可一併檢查 server/_core/cookies.ts（判斷）。`;
    const reviewer = managerReviewer({ ownerAnswer: own });
    const { sim, detail } = await start(reviewer, FULL_REPORT);
    expect(sim.loop.task("m-task-1")).toMatchObject({ status: "accepted", answer: own, repair: { attempt: 0 } });
    expect(reviewer.calls).toHaveLength(1);
    expect(detail).toContain(own);
  });

  it.each([
    ["the Manager provider is down", ["outage"]],
    ["the Manager returns malformed output (no owner answer)", ["malformed"]],
  ] as const)("G/H: when %s it is infrastructure: no raw Worker report, no Worker re-run, no repair cycle", async (_label, script) => {
    const reviewer = managerReviewer({ script: [...script] });
    const { sim, detail, everything } = await start(reviewer, FULL_REPORT);
    const t = sim.loop.task("m-task-1")!;
    expect(t.status).toBe("waiting_infrastructure");
    expect(t.queueReason).toMatch(/goal reviewer unavailable/);
    expect(t.answer).toBeNull();
    expect(sim.workerCalls).toHaveLength(1);
    expect(t.repair.attempt).toBe(0);
    expect(t.repairCycles).toHaveLength(0);
    expect(sim.trustedRecords.every((r) => r.goalReviewUnavailable === true)).toBe(true);
    expect(detail).toBeNull();
    expect(everything).not.toContain(CORE_CLAIM);
    expectNoRawWorkerProse(everything);
  });

  it("G/H: once the Manager is back, the same run is judged and answered without re-running the Worker", async () => {
    const reviewer = managerReviewer({ script: ["outage", "goal"] });
    const { sim, service, transport } = await start(reviewer, FULL_REPORT);
    expect(sim.loop.task("m-task-1")!.status).toBe("waiting_infrastructure");
    await sim.send({ type: "review_retry", taskId: "m-task-1" });
    await service.observe();
    expect(sim.loop.task("m-task-1")).toMatchObject({ status: "accepted", answer: SYNTHESIS, repair: { attempt: 0 } });
    expect(sim.workerCalls).toHaveLength(1);
    expect(reviewer.calls).toHaveLength(2);
    expect(JSON.stringify(transport.sent)).toContain(SYNTHESIS);
    expectNoRawWorkerProse(JSON.stringify(transport.sent));
  });

  it("I: missing core evidence still fails closed: no reviewer call, nothing accepted, no answer", async () => {
    const reviewer = managerReviewer();
    const { sim, detail } = await start(reviewer, `應該是 ${CORE_CLAIM} 吧。`, { repo: {} });
    expect(reviewer.calls).toHaveLength(0);
    expect(sim.loop.task("m-task-1")!.status).not.toBe("accepted");
    expect(sim.trustedRecords[0].acceptance.find((a) => a.evidenceType === "manager_review")!.status).toBe("unknown");
    expect(detail).toBeNull();
  });

  it("I: a read-only run that modifies the workspace is blocked even with a satisfied review and synthesis", async () => {
    const { sim, detail } = await start(managerReviewer(), FULL_REPORT, { worker: { "m-task-1": ["mutate_readonly"] } });
    expect(sim.loop.task("m-task-1")).toMatchObject({ status: "blocked", blockingReason: "read-only task modified the workspace" });
    expect(sim.loop.task("m-task-1")!.answer).toBeNull();
    expect(sim.commits).toHaveLength(0);
    expect(detail).toBeNull();
  });
});

describe("semanticAcceptance: one Manager call judges and answers", () => {
  const goal = {
    mode: "read_only" as const,
    title: "t",
    objective: ASK,
    criteria: [
      { id: "AC-1", text: "The owner learns the session lifetime", kind: "goal" as const },
      { id: "AC-2", text: "All required validations pass on the final working tree", kind: "technical" as const },
    ],
    goal: { intent: "investigate_or_answer" as const, originalRequest: ASK, interpretedObjective: ASK },
  };
  const base = {
    goal,
    validations: [{ name: "typecheck", requested: true, executed: true, status: "passed" as const, trusted: true }],
    reviewId: "r1",
    diff: { text: "", truncated: false },
    answer: FULL_REPORT,
    fileContent: (p: string) => (REPO as Record<string, string>)[p] ?? null,
    timeoutMs: 1_000,
  };
  const satisfied = { criteria: [{ id: "AC-1", status: "satisfied", evidence: VERIFIED_NOTE, reason: "" }], constraints: [] };

  it("the owner answer comes from the same review call, with output hygiene only (redaction, bounded length)", async () => {
    let calls = 0;
    const secret = "token=ghp_abcdefghijklmnop1234";
    const r = await semanticAcceptance({ ...base, reviewer: { review: async () => (calls++, { ...satisfied, ownerAnswer: `${SYNTHESIS}\r\n${secret}\n${"長".repeat(10_000)}` }) } });
    expect(calls).toBe(1);
    expect(r.acceptance[0].status).toBe("satisfied");
    expect(r.ownerAnswer!.startsWith(SYNTHESIS)).toBe(true);
    expect(r.ownerAnswer).not.toContain("ghp_");
    expect(r.ownerAnswer).not.toContain("\r");
    expect(r.ownerAnswer!.length).toBeLessThanOrEqual(MAX_OWNER_ANSWER);
  });

  it.each([
    ["missing", {}],
    ["empty", { ownerAnswer: "  " }],
    ["not a string", { ownerAnswer: 42 }],
  ])("a satisfied review whose owner answer is %s is malformed Manager output (infrastructure), never a fallback answer", async (_l, extra) => {
    const r = await semanticAcceptance({ ...base, reviewer: { review: async () => ({ ...satisfied, ...extra }) } });
    expect(r).toMatchObject({ reviewUnavailable: true, ownerAnswer: null });
    expect(r.acceptance[0].status).toBe("unknown");
  });

  it("a failed goal gets no owner answer and no extra Manager call", async () => {
    let reviewed = 0;
    const r = await semanticAcceptance({
      ...base,
      reviewer: { review: async () => (reviewed++, { criteria: [{ id: "AC-1", status: "not_satisfied", evidence: "", reason: "wrong" }], constraints: [], ownerAnswer: SYNTHESIS }) },
    });
    expect(r.acceptance[0].status).toBe("failed");
    expect(r).toMatchObject({ ownerAnswer: null, reviewUnavailable: false, reviewCalls: 1 });
    expect(reviewed).toBe(1);
  });

  it("reviewer unavailable: infrastructure outcome, no answer", async () => {
    const r = await semanticAcceptance({ ...base, reviewer: null });
    expect(r).toMatchObject({ reviewUnavailable: true, ownerAnswer: null });
  });

  it("a satisfied verdict without cited evidence is still unsupported and yields no answer", async () => {
    const r = await semanticAcceptance({ ...base, reviewer: { review: async () => ({ criteria: [{ id: "AC-1", status: "satisfied", evidence: "", reason: "" }], constraints: [], ownerAnswer: SYNTHESIS }) } });
    expect(r.acceptance[0].status).toBe("unknown");
    expect(r.ownerAnswer).toBeNull();
  });

  it("change tasks never get an owner synthesis", async () => {
    const r = await semanticAcceptance({ ...base, goal: { ...goal, mode: "change" as const }, reviewer: { review: async () => ({ ...satisfied, ownerAnswer: SYNTHESIS }) } });
    expect(r.acceptance[0].status).toBe("satisfied");
    expect(r.ownerAnswer).toBeNull();
  });
});

describe("Manager ports and intake: natural-language collaboration, few core criteria", () => {
  it("the reviewer receives the Worker's full report unshortened and writes the owner answer in the same call", async () => {
    const seen: { system: string; user: string }[] = [];
    const reviewer = createStructuredGoalReviewer({ structured: async (req) => (seen.push(req), { criteria: [], constraints: [], ownerAnswer: "" }) });
    await reviewer.review({ mode: "read_only", intent: "investigate_or_answer", title: "t", originalRequest: ASK, interpretedObjective: ASK, criteria: [{ id: "AC-1", text: "x" }], validations: [], diff: "", diffTruncated: false, answer: FULL_REPORT, citedFiles: [] });
    expect(seen[0].user).toContain(FULL_REPORT);
    // Safety contract kept: Worker prose is never evidence.
    expect(REVIEWER_SYSTEM).toContain("The Worker's answer/summary is a CLAIM to verify, never evidence by itself.");
    expect(seen).toHaveLength(1);
    expect(REVIEWER_SYSTEM).toMatch(/ownerAnswer \(read-only tasks/);
    expect(REVIEWER_SYSTEM).toMatch(/never introduce an outside fact/);
    expect(REVIEWER_SYSTEM).toMatch(/unsupported ancillary claim is NEVER by itself a reason/);
  });

  it.each(["investigate_or_answer", "audit_or_review"] as const)("%s: planner criteria plus two fixed core conditions and the validation gate", (intent) => {
    const prepared = validateAndNormalizeRequest({
      idempotencyKey: `req-${intent}`,
      userInstruction: ASK,
      source: { type: "chat", requesterId: "owner-1" },
      submittedAt: "2026-10-08T00:00:00.000Z",
      goal: { intent, originalRequest: ASK, interpretedObjective: "Investigate. No files will be changed.", criteria: ["The owner learns the outcome"] },
    } as never);
    expect(prepared.ok).toBe(true);
    const criteria = (prepared as { value: { acceptanceCriteria: { text: string; kind: string }[] } }).value.acceptanceCriteria;
    expect(criteria.filter((c) => c.kind === "goal")).toHaveLength(3);
    expect(criteria.filter((c) => c.kind === "technical")).toHaveLength(1);
    expect(criteria[0].text).toBe("The owner learns the outcome");
  });
});
