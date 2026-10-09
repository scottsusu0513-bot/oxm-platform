import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import type { IntentPlanner } from "../planning/types";
import { createSimulation, type SimulationOptions } from "../scheduler/fake";
import { createInMemoryAuditRepository } from "../store/memory";
import { createHumanInteractionHarness } from "./fake";
import { createAuditHumanInteractionLedger, HUMAN_NOTICE_SUPPRESSED_EVENT } from "./ledger";
import { decideTaskNotification, ownerRelevance, SILENT_LIFECYCLE_EVENTS, type EventCandidate } from "./notificationPolicy";
import type { CommitApprovalNotice, MilestoneNotice } from "./types";

/**
 * Single human-facing voice: internal lifecycle events are candidates; the Manager notification
 * policy decides what the Owner hears (relevance / actionability / novelty), merges what belongs
 * together, and everything else stays in the audit stream only.
 */

const CODE = "Fix the bug in the login permission check.";
const VISUAL = "Make the homepage buttons blue and increase their spacing.";

function plannerFor(areas: { programming: boolean; visual: boolean }, objective: string, title: string): IntentPlanner {
  return {
    async interpret() {
      return {
        intent: "change_code",
        taskId: null,
        title,
        interpretedObjective: objective,
        criteria: ["Works as requested"],
        clarificationQuestion: "",
        riskObservations: [],
        workAreas: areas,
        programmingObjective: "",
        visualObjective: "",
      };
    },
  };
}

function setup(planner: IntentPlanner, opts: SimulationOptions = {}) {
  const audit = createInMemoryAuditRepository(() => "2026-10-09T00:00:00.000Z");
  const sim = createSimulation({ autoApproveCommits: false, ...opts });
  const h = createHumanInteractionHarness({ loop: sim.loop, approvals: sim.approvals, audit, now: sim.ports.now, planner, idPrefix: "n" });
  const say = async (key: string, text: string) => {
    const r = await h.service.handleReply({ kind: "reply", idempotencyKey: key, replyToDeliveryRef: null, text: `任務：${text}` });
    await sim.loop.settle();
    return r;
  };
  const sentFor = (taskId: string) => h.transport.sent.filter((s) => s.notice.taskId === taskId).map((s) => s.notice);
  const milestones = () => h.transport.sent.filter((s) => s.notice.kind === "milestone").map((s) => s.notice as MilestoneNotice);
  const suppressedEvents = () => audit.list({ taskId: "human-interaction" }).filter((e) => e.event === HUMAN_NOTICE_SUPPRESSED_EVENT).map((e) => e.metadata as Record<string, string>);
  return { audit, sim, say, sentFor, milestones, suppressedEvents, ...h };
}

const cand = (key: string, kind: EventCandidate["kind"], detail = `${kind} text`): EventCandidate => ({ key, kind, detail });

describe("notification policy (pure decision)", () => {
  it("queued / dispatched / worker_started / ordinary processing / scheduler tick / internal repair are silent", () => {
    for (const kind of [...SILENT_LIFECYCLE_EVENTS, "worker_assigned", "repairing", "combined_repairing", "quota_handback", "part_completed"] as const)
      expect(ownerRelevance(kind), kind).toBe("none");
    const d = decideTaskNotification(SILENT_LIFECYCLE_EVENTS.map((k, i) => cand(`e${i}`, k)));
    expect(d.deliver).toBeNull();
    expect(d.suppressed).toHaveLength(SILENT_LIFECYCLE_EVENTS.length);
    expect(d.suppressed.every((s) => s.reason.startsWith("no_owner_value:"))).toBe(true);
  });

  it("blockers, approvals, auth/quota/runtime unavailability and final results are never silenced", () => {
    for (const kind of ["blocked", "awaiting_other_approval", "quota_paused", "availability_paused", "infrastructure_waiting", "combined_review_waiting", "guidance_rejected"] as const)
      expect(ownerRelevance(kind), kind).toBe("action_required");
    for (const kind of ["completed", "answered", "combined_accepted", "pr_opened", "guidance_accepted", "cancelled"] as const) expect(ownerRelevance(kind), kind).toBe("result");
  });

  it("worker_completed + validation_started + final accepted become ONE update (the result), not three", () => {
    const d = decideTaskNotification([cand("w", "worker_completed"), cand("v", "validation_started"), cand("terminal", "completed", "Done.")]);
    expect(d.deliver).toMatchObject({ lead: { key: "terminal" }, merged: [], detail: "Done." });
    expect(d.suppressed.map((s) => s.reason)).toEqual(["no_owner_value:worker_completed", "no_owner_value:validation_started"]);
  });

  it("several relevant events of one task are aggregated into one message led by the most important", () => {
    const d = decideTaskNotification([cand("pr:7", "pr_opened", "PR opened."), cand("terminal", "completed", "Finished.")]);
    expect(d.deliver!.lead.key).toBe("terminal");
    expect(d.deliver!.detail).toBe("Finished.\nPR opened.");
    expect(d.suppressed).toEqual([{ candidate: expect.objectContaining({ key: "pr:7" }), reason: "merged_into:terminal" }]);
  });

  it("news already out of date in the same observation is not told (takeover superseded by a full pause)", () => {
    const d = decideTaskNotification([cand("cover:1", "quota_takeover"), cand("quota:x", "quota_paused", "Paused.")]);
    expect(d.deliver).toMatchObject({ lead: { key: "quota:x" }, detail: "Paused." });
    expect(d.suppressed).toEqual([{ candidate: expect.objectContaining({ key: "cover:1" }), reason: "superseded_by:quota:x" }]);
  });

  it("decides by semantic event kind, never by text: identical words of a relevant event are still sent", () => {
    const d = decideTaskNotification([cand("terminal", "blocked", "same words")]);
    expect(d.deliver!.detail).toBe("same words");
    const silent = decideTaskNotification([cand("worker:codex", "worker_assigned", "something new and different")]);
    expect(silent.deliver).toBeNull();
  });
});

describe("Manager notification decisions through the real Gateway path", () => {
  it("task submitted -> exactly one Manager acknowledgement; worker start adds no second, similar message", async () => {
    const x = setup(plannerFor({ programming: false, visual: true }, VISUAL, "首頁按鈕"), { holdWorkers: true });
    const r = await x.say("tg.reply.106", "把首頁按鈕改成藍色");
    expect(r.outcome).toBe("submitted");
    expect(r.message).toContain("Codex");
    for (let i = 0; i < 3; i++) await x.service.observe();
    expect(x.sim.loop.task("n-task-1")!.status).toBe("running");
    // The live incident: ms:<task>:worker:codex ~10 s after the acknowledgement. Now audited only.
    expect(x.sentFor("n-task-1")).toEqual([]);
    expect(x.ledger.byNotice("ms:n-task-1:worker:codex")).toBeNull();
    expect(x.suppressedEvents()).toEqual([expect.objectContaining({ noticeId: "ms:n-task-1:worker:codex", event: "worker_assigned", reason: "no_owner_value:worker_assigned" })]);
    x.sim.releaseWorker("n-task-1");
    await x.sim.loop.settle();
  });

  it("blocker -> one Manager message, however often the state is observed", async () => {
    const x = setup(plannerFor({ programming: true, visual: false }, CODE, "登入權限"), { worker: { "n-task-1": ["validation_failed"] } });
    await x.say("tg.msg.1", "修正登入權限檢查的 bug");
    for (let i = 0; i < 3; i++) await x.service.observe();
    expect(x.sim.loop.task("n-task-1")!.status).toBe("needs_human_decision");
    expect(x.sentFor("n-task-1").map((n) => n.kind)).toEqual(["human_decision"]);
  });

  it("approval required -> one Manager message; final accepted -> one Manager message; no lifecycle chatter in between", async () => {
    const x = setup(plannerFor({ programming: true, visual: false }, CODE, "登入權限"));
    await x.say("tg.msg.2", "修正登入權限檢查的 bug");
    for (let i = 0; i < 3; i++) await x.service.observe();
    expect(x.sentFor("n-task-1").map((n) => n.kind)).toEqual(["commit_publish_approval"]);
    const approval = x.sentFor("n-task-1")[0] as CommitApprovalNotice;
    expect((await x.service.handleAction({ kind: "action", idempotencyKey: "a1", ref: approval.ref, action: "approve" })).outcome).toBe("approved");
    await x.sim.loop.settle();
    await x.sim.send({ type: "qa_updated", taskId: "n-task-1" });
    for (let i = 0; i < 3; i++) await x.service.observe();
    const kinds = x.sentFor("n-task-1").map((n) => (n.kind === "milestone" ? n.milestone : n.kind));
    expect(kinds.filter((k) => k === "commit_publish_approval")).toHaveLength(1);
    expect(kinds.filter((k) => k === "completed")).toHaveLength(1);
    expect(kinds).not.toContain("worker_assigned");
    expect(kinds).not.toContain("repairing");
  });

  it("a milestone with real new information (quota pause) is still sent, once", async () => {
    const x = setup(plannerFor({ programming: false, visual: true }, VISUAL, "首頁按鈕"), { worker: { "n-task-1": ["quota_exhausted"] } });
    await x.say("tg.msg.3", "把首頁按鈕改成藍色");
    for (let i = 0; i < 3; i++) await x.service.observe();
    expect(x.milestones().map((m) => m.milestone)).toEqual(["quota_paused"]);
  });

  it("recoverable automatic repair is silent; the owner hears only the final outcome", async () => {
    const x = setup(plannerFor({ programming: true, visual: false }, CODE, "登入權限"), { worker: { "n-task-1": ["validation_failed", "success"] } });
    await x.say("tg.msg.4", "修正登入權限檢查的 bug");
    for (let i = 0; i < 3; i++) await x.service.observe();
    const kinds = x.sentFor("n-task-1").map((n) => (n.kind === "milestone" ? n.milestone : n.kind));
    // The repair happened (two Worker runs), yet the only message is the next decision point.
    expect(x.sim.workerCalls.filter((c) => c.taskId === "n-task-1")).toHaveLength(2);
    expect(kinds).toEqual(["commit_publish_approval"]);
  });

  it("replaying the same internal events (repeated observation, restart from audit) sends nothing again; audit stays complete", async () => {
    const x = setup(plannerFor({ programming: true, visual: false }, CODE, "登入權限"), { holdWorkers: true });
    await x.say("tg.msg.5", "修正登入權限檢查的 bug");
    for (let i = 0; i < 5; i++) await x.service.observe();
    const auditCount = x.audit.list({ taskId: "human-interaction" }).length;
    for (let i = 0; i < 5; i++) await x.service.observe();
    expect(x.transport.sent).toEqual([]);
    // The suppression is written once, not once per observation round.
    expect(x.suppressedEvents()).toHaveLength(1);
    expect(x.audit.list({ taskId: "human-interaction" })).toHaveLength(auditCount);
    // A restarted ledger knows the event was already decided.
    const reloaded = createAuditHumanInteractionLedger({ audit: x.audit, nextId: () => "unused" });
    expect(reloaded.suppressed("ms:n-task-1:worker:claude")).toMatchObject({ event: "worker_assigned" });
    // Internal lifecycle audit (scheduler/worker) is untouched by the policy.
    expect(x.sim.audit.length).toBeGreaterThan(0);
    x.sim.releaseWorker("n-task-1");
    await x.sim.loop.settle();
  });
});

describe("single human-facing exit", () => {
  const SRC = join(import.meta.dirname, "..");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
    });
  const sources = walk(SRC).map((p) => ({ name: relative(SRC, p), text: readFileSync(p, "utf8") }));

  it("only the Owner delivery channel calls Telegram sendMessage (client definition and pass-throughs excepted)", () => {
    const callers = sources.filter((f) => /\.sendMessage\(/.test(f.text)).map((f) => f.name).sort();
    expect(callers).toEqual(["telegram/controlPlane.ts", "telegram/gatewaySource.ts"]);
    const cp = sources.find((f) => f.name === "telegram/controlPlane.ts")!.text;
    expect(cp.match(/\.sendMessage\(/g)).toHaveLength(1);
    expect(cp).toMatch(/export function createOwnerDeliveryChannel[\s\S]*?client\.sendMessage\(\{ chatId: ownerChatId/);
    // The pass-through only forwards the client method; it never composes a message.
    const gw = sources.find((f) => f.name === "telegram/gatewaySource.ts")!.text;
    expect(gw.match(/\.sendMessage\(/g)).toEqual([".sendMessage("]);
    expect(gw).toMatch(/sendMessage: \(args, signal\) => input\.telegram\.sendMessage\(args, signal\)/);
  });

  it("notices reach the transport only through the Manager notification decision (one deliver call)", () => {
    const deliverers = sources.filter((f) => /transport\.deliver\(/.test(f.text)).map((f) => f.name);
    expect(deliverers).toEqual(["humanInteraction/service.ts"]);
    expect(sources.find((f) => f.name === "humanInteraction/service.ts")!.text.match(/transport\.deliver\(/g)).toHaveLength(1);
  });

  it("no internal subsystem imports the Telegram layer or the human-facing transport", () => {
    for (const f of sources) {
      if (/^(telegram|humanInteraction)\//.test(f.name)) continue;
      const imports = Array.from(f.text.matchAll(/from\s+"([^"]+)"/g), (m) => m[1]);
      for (const spec of imports) {
        // The runtime supervisor only reads Telegram configuration (no client, no send).
        if (f.name.startsWith("runtimeSupervisor/") && spec === "../telegram/config") continue;
        expect(spec, f.name).not.toMatch(/telegram|humanInteraction\/(service|fake)/);
      }
      expect(f.text, f.name).not.toMatch(/api\.telegram\.org/);
    }
  });
});
