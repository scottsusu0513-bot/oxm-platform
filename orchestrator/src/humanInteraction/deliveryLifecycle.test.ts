import { describe, expect, it } from "vitest";
import { createFakeDelivery, createFakePreview, deployed, type FakeDelivery } from "../delivery/fake";
import type { IntentPlanner, IntentPlannerInput } from "../planning/types";
import { createSimulation, driveQa, sha } from "../scheduler/fake";
import { createInMemoryAuditRepository } from "../store/memory";
import { formatNotice, noticeButtons } from "../telegram/format";
import { createHumanInteractionHarness, createRecordingTransport } from "./fake";
import type { CommitApprovalNotice, DeployApprovalNotice, HumanNotice, MilestoneNotice } from "./types";

/**
 * H — duplicate-reply regression over the full delivery lifecycle (PR #26 shape): every semantic step
 * produces at most ONE Owner-facing message; replays, repeated observation rounds, repeated button taps
 * and a restart of the human-interaction service never send a second one.
 */

const TITLE = "在管理員全站流量柱狀圖下方直接顯示每小時瀏覽人數";
const ACK = "我會在流量柱狀圖下方加上每小時瀏覽人數，完成後先確認數字和圖一致。";
const RESULT = "柱狀圖下方現在會顯示每小時的瀏覽人數，數字和圖表一致。";
const empty = { title: "", interpretedObjective: "", criteria: [] as string[], clarificationQuestion: "", followUpTopics: [] as string[], ownerReply: "", deliveryTarget: "production" };

function planner(extra: Record<string, (i: IntentPlannerInput) => unknown> = {}): IntentPlanner {
  const script: Record<string, (i: IntentPlannerInput) => unknown> = {
    做柱狀圖: () => ({ ...empty, intent: "change_code", taskId: null, title: TITLE, interpretedObjective: TITLE, criteria: ["管理員在柱狀圖下方看到每小時瀏覽人數"], workAreas: { programming: false, visual: true }, ownerReply: ACK }),
    ...extra,
  };
  return {
    async interpret(input) {
      const f = script[input.message];
      if (!f) throw new Error(`no script for ${input.message}`);
      return f(input);
    },
  };
}

function setup(opts: { observations?: FakeDelivery["observations"] } = {}) {
  const audit = createInMemoryAuditRepository(() => "2026-10-10T00:00:00.000Z");
  let delivery!: FakeDelivery;
  const preview = createFakePreview();
  const sim = createSimulation({
    autoApproveCommits: false,
    preview,
    delivery: ({ remote, now }) => {
      delivery = createFakeDelivery({ remote, now });
      if (opts.observations) delivery.observations = opts.observations;
      return delivery;
    },
    goalReviewer: {
      async review(input: { criteria: readonly { id: string }[] }) {
        return { criteria: input.criteria.map((c) => ({ id: c.id, status: "satisfied", evidence: "visible in the diff", reason: "" })), constraints: [], ownerAnswer: RESULT };
      },
    },
  });
  const transport = createRecordingTransport(500);
  const h = createHumanInteractionHarness({ loop: sim.loop, approvals: sim.approvals, audit, now: sim.ports.now, planner: planner(), idPrefix: "d", durableGateway: true, transport });
  let n = 0;
  const say = async (text: string, replyTo: string | null = null) => {
    const r = await h.service.handleReply({ kind: "reply", idempotencyKey: `tg.msg.${++n}`, replyToDeliveryRef: replyTo, text });
    await sim.loop.settle({ waitForWorkers: true });
    return r;
  };
  const rounds = async (k = 3) => {
    for (let i = 0; i < k; i++) await h.service.observe();
  };
  return { audit, sim, h, say, rounds, transport, delivery: () => delivery, preview };
}

const kinds = (sent: { notice: HumanNotice }[]) => sent.map((s) => (s.notice.kind === "milestone" ? `ms:${(s.notice as MilestoneNotice).milestone}` : s.notice.kind));

describe("H. one Owner-facing message per semantic step (PR #26 lifecycle)", () => {
  it("ack → preview/publish → PR → deploy question → deploy ack → completion; nothing twice", async () => {
    const x = setup();
    // 1. New task → exactly one acknowledgement (the reply), 2. worker start → no extra message.
    const ack = await x.say("任務：做柱狀圖");
    expect(ack).toMatchObject({ outcome: "submitted" });
    const taskId = ack.taskId!;
    await x.rounds();
    const t = x.sim.loop.task(taskId)!;
    expect(t.lifecyclePhase).toBe("preview_ready");

    // 3. Implementation accepted → ONE message: result + preview URL + publish buttons.
    expect(kinds(x.transport.sent)).toEqual(["commit_publish_approval"]);
    const publish = x.transport.sent[0].notice as CommitApprovalNotice;
    const text = formatNotice(publish);
    expect(text.split("\n")[0]).toBe(RESULT);
    expect(text).toContain("修改已完成，我已開啟預覽。");
    expect(text).toContain("https://cs-name-3000.app.github.dev/");
    expect(text).toContain("這還沒有發布到正式站");
    expect(text).not.toMatch(/\b[0-9a-f]{40}\b|preview_ready|awaiting_publish_approval|deploy:/);
    expect(noticeButtons(publish)![0].map((b) => b.text)).toEqual(["批准發布", "不要發布"]);

    // 4. Owner taps "批准發布" → ONE reply; 5. publish start sends nothing else.
    const tap = await x.h.service.handleAction({ kind: "action", idempotencyKey: `tg.cb.${publish.ref}.approve`, ref: publish.ref, action: "approve" });
    expect(tap.outcome).toBe("approved");
    expect(tap.message).toContain("自動檢查通過後，我會再問你要不要部署正式站");
    await x.sim.loop.settle();
    // A replayed tap (same idempotency key / webhook re-delivery) → no new effect, no new message.
    const again = await x.h.service.handleAction({ kind: "action", idempotencyKey: `tg.cb.${publish.ref}.approve`, ref: publish.ref, action: "approve" });
    expect(again.outcome).toBe("duplicate");
    await x.rounds();
    // 6. PR opened → one notice with the new information (the PR number).
    expect(kinds(x.transport.sent)).toEqual(["commit_publish_approval", "ms:pr_opened"]);

    // 7. CI → (no separate "CI passed"); 8. the deploy question is ONE message with the two buttons.
    await driveQa(x.sim, taskId);
    await x.rounds();
    expect(kinds(x.transport.sent)).toEqual(["commit_publish_approval", "ms:pr_opened", "deploy_approval"]);
    const deploy = x.transport.sent[2].notice as DeployApprovalNotice;
    const dtext = formatNotice(deploy);
    expect(dtext).toContain(`PR #${deploy.prNumber} 自動檢查已完成`);
    expect(dtext).toContain("正式站尚未更新，所以這項任務還沒有完成。");
    expect(dtext).toContain(`是否批准合併 PR #${deploy.prNumber} 並部署正式站（www.oxmmatch.com）？`);
    expect(dtext).not.toMatch(/\b[0-9a-f]{40}\b|awaiting_deploy_approval|deploy:[0-9a-f]/);
    expect(noticeButtons(deploy)![0].map((b) => b.text)).toEqual(["批准部署", "暫不部署"]);
    expect(x.sim.loop.task(taskId)).toMatchObject({ state: "awaiting_approval", lifecyclePhase: "awaiting_deploy_approval" });
    expect(x.sim.loop.tasks()).toHaveLength(1);

    // 9. Owner taps "批准部署" → ONE reply (approval + start in the same sentence); deploy start sends nothing else.
    x.delivery().observations = [deployed("build_in_progress"), deployed("live")];
    const go = await x.h.service.handleAction({ kind: "action", idempotencyKey: `tg.cb.${deploy.ref}.approve`, ref: deploy.ref, action: "approve" });
    expect(go.outcome).toBe("approved");
    expect(go.message).toBe(`收到，已批准部署「${TITLE}」。我現在合併 PR #${deploy.prNumber} 並部署正式站；部署完成、正式站檢查通過後再告訴你結果。`);
    await x.sim.loop.settle();
    expect(x.sim.loop.task(taskId)!.state).toBe("deploying");
    await x.rounds();
    expect(kinds(x.transport.sent)).toEqual(["commit_publish_approval", "ms:pr_opened", "deploy_approval"]);

    // 10. Production verified → ONE terminal completion message.
    await x.sim.send({ type: "delivery_poll", taskId });
    await x.rounds();
    expect(kinds(x.transport.sent)).toEqual(["commit_publish_approval", "ms:pr_opened", "deploy_approval", "ms:completed"]);
    const done = x.transport.sent[3].notice as MilestoneNotice;
    expect(done.detail).toBe(`${RESULT}\nPR #${deploy.prNumber} 已合併，正式站部署完成，production smoke 通過。這項任務已完成。`);

    // 11. Re-entry: more observation rounds and a replayed deploy tap send nothing.
    const replay = await x.h.service.handleAction({ kind: "action", idempotencyKey: `tg.cb.${deploy.ref}.approve`, ref: deploy.ref, action: "approve" });
    expect(replay.outcome).toBe("duplicate");
    await x.rounds(5);
    expect(x.transport.sent).toHaveLength(4);

    // 12. Restart of the human-interaction service over the same durable ledger: nothing is re-delivered.
    const t2 = createRecordingTransport(900);
    const second = createHumanInteractionHarness({ loop: x.sim.loop, approvals: x.sim.approvals, audit: x.audit, now: x.sim.ports.now, transport: t2, durableGateway: true, idPrefix: "d2" });
    for (let i = 0; i < 3; i++) await second.service.observe();
    expect(t2.sent).toEqual([]);
  });

  it("Owner declines deployment → the reply IS the closing message (no second 'closed' notice)", async () => {
    const x = setup();
    const { taskId } = await x.say("任務：做柱狀圖");
    await x.rounds();
    const publish = x.transport.sent[0].notice;
    await x.h.service.handleAction({ kind: "action", idempotencyKey: "p", ref: publish.ref, action: "approve" });
    await x.sim.loop.settle();
    await driveQa(x.sim, taskId!);
    await x.rounds();
    const deploy = x.transport.sent.find((s) => s.notice.kind === "deploy_approval")!.notice as DeployApprovalNotice;
    const no = await x.h.service.handleAction({ kind: "action", idempotencyKey: "d", ref: deploy.ref, action: "reject" });
    expect(no.outcome).toBe("rejected");
    expect(no.message).toBe(`好，PR #${deploy.prNumber} 不部署，保持未合併，正式站沒有任何變更；這項任務以「未部署」結束。`);
    await x.sim.loop.settle();
    expect(x.sim.loop.task(taskId!)).toMatchObject({ state: "closed_without_deploy", lifecyclePhase: "closed_without_deploy" });
    const before = x.transport.sent.length;
    await x.rounds(4);
    expect(x.transport.sent).toHaveLength(before);
    expect(x.delivery().calls.filter((c) => c.startsWith("MERGE"))).toEqual([]);
  });

  it("merged but no Render observer → one 'cannot verify' notice, task stays open (never 'completed')", async () => {
    const x = setup({ observations: [() => ({ observer: "unconfigured", deploy: null })] });
    const { taskId } = await x.say("任務：做柱狀圖");
    await x.rounds();
    await x.h.service.handleAction({ kind: "action", idempotencyKey: "p", ref: x.transport.sent[0].notice.ref, action: "approve" });
    await x.sim.loop.settle();
    await driveQa(x.sim, taskId!);
    await x.rounds();
    const deploy = x.transport.sent.find((s) => s.notice.kind === "deploy_approval")!.notice;
    await x.h.service.handleAction({ kind: "action", idempotencyKey: "d", ref: deploy.ref, action: "approve" });
    await x.sim.loop.settle();
    for (let i = 0; i < 3; i++) await x.sim.send({ type: "delivery_poll", taskId: taskId! });
    await x.rounds(4);
    const waits = x.transport.sent.filter((s) => s.notice.kind === "milestone" && (s.notice as MilestoneNotice).milestone === "deploy_waiting");
    expect(waits).toHaveLength(1);
    expect((waits[0].notice as MilestoneNotice).detail).toContain("無法讀取 Render 的部署狀態");
    expect(x.transport.sent.some((s) => s.notice.kind === "milestone" && (s.notice as MilestoneNotice).milestone === "completed")).toBe(false);
    expect(x.sim.loop.task(taskId!)).toMatchObject({ state: "deploying", lifecyclePhase: "deploying" });
  });

  it("a reply to the preview message asking for changes revises the SAME task (one reply, no new task)", async () => {
    const x = setup();
    const { taskId } = await x.say("任務：做柱狀圖");
    await x.rounds();
    const publish = x.transport.sent[0];
    const interpreter = planner({ "數字請放大並加上單位": (i) => ({ ...empty, intent: "human_decision", taskId: i.contextTaskId, workAreas: { programming: false, visual: false } }) });
    const y = createHumanInteractionHarness({ loop: x.sim.loop, approvals: x.sim.approvals, audit: x.audit, now: x.sim.ports.now, planner: interpreter, idPrefix: "d3", durableGateway: true, transport: x.transport });
    const r = await y.service.handleReply({ kind: "reply", idempotencyKey: "tg.msg.rev", replyToDeliveryRef: publish.deliveryRef, text: "數字請放大並加上單位" });
    expect(r).toMatchObject({ outcome: "resumed", taskId });
    expect(r.message).toContain("不代表批准發布");
    await x.sim.loop.settle({ waitForWorkers: true });
    expect(x.sim.loop.tasks()).toHaveLength(1);
    expect(x.sim.workerCalls).toHaveLength(2);
    expect(x.sim.workerCalls[1]).toMatchObject({ taskId, repair: true });
    expect(x.sim.loop.task(taskId!)).toMatchObject({ lifecyclePhase: "preview_ready" });
    // The revised result gets ONE new publish message (new approval binding); the old one is not resent.
    await y.service.observe();
    await y.service.observe();
    expect(x.transport.sent.filter((s) => s.notice.kind === "commit_publish_approval")).toHaveLength(2);
    // The same reply delivered again is not a second revision.
    const dup = await y.service.handleReply({ kind: "reply", idempotencyKey: "tg.msg.rev", replyToDeliveryRef: publish.deliveryRef, text: "數字請放大並加上單位" });
    expect(dup.outcome).toBe("duplicate");
    await x.sim.loop.settle({ waitForWorkers: true });
    expect(x.sim.workerCalls).toHaveLength(2);
  });

  it("preview unavailable → the publish message says so and still offers the decision; it never waits forever", async () => {
    const x = setup();
    x.preview.result = { status: "unavailable", url: null, port: null, visibility: null, access: null, reason: "dev_server_start_timeout", reused: false };
    await x.say("任務：做柱狀圖");
    await x.rounds();
    expect(kinds(x.transport.sent)).toEqual(["commit_publish_approval"]);
    const text = formatNotice(x.transport.sent[0].notice);
    expect(text).toContain("這次的預覽暫時無法開啟");
    expect(text).not.toContain("app.github.dev");
  });

  it("legacy wording is not used for a production-verified completion (no 'merging is up to you')", async () => {
    const x = setup();
    const { taskId } = await x.say("任務：做柱狀圖");
    await x.rounds();
    await x.h.service.handleAction({ kind: "action", idempotencyKey: "p", ref: x.transport.sent[0].notice.ref, action: "approve" });
    await x.sim.loop.settle();
    await driveQa(x.sim, taskId!);
    await x.rounds();
    const deploy = x.transport.sent.find((s) => s.notice.kind === "deploy_approval")!.notice;
    await x.h.service.handleAction({ kind: "action", idempotencyKey: "d", ref: deploy.ref, action: "approve" });
    await x.sim.loop.settle();
    await x.rounds();
    const done = x.transport.sent.find((s) => s.notice.kind === "milestone" && (s.notice as MilestoneNotice).milestone === "completed")!.notice as MilestoneNotice;
    expect(done.detail).not.toContain("由你決定");
    expect(done.detail).toContain("這項任務已完成");
    expect(sha(1)).toHaveLength(40);
  });
});
