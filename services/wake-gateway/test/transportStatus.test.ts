import { describe, expect, it } from "vitest";
import { createOwnerNotifier, TRANSPORT_STATUS_KINDS, transportStatus, type TransportStatus, type WakeFailureReason } from "../src/telegram";
import { createGateway, ownerText } from "./harness";

/**
 * The Gateway is a transport, not a second Agent: its only Owner-visible output is an allowlisted
 * transport_status (link / queue state while the Agent is offline). Task semantics, advice and any
 * reply to the Owner's content come only from the Manager once the Agent is online.
 */

const REASONS: WakeFailureReason[] = ["credential", "billing", "not_found", "repo_mismatch", "terminal_state", "rejected", "malformed", "github_unavailable", "start_timeout", "start_exhausted", "daily_cap"];
const every = (): TransportStatus[] => [
  transportStatus("waking", { pending: 3 }),
  ...REASONS.flatMap((reason) => [transportStatus("wake_failed", { reason, blocked: true }), transportStatus("wake_failed", { reason, blocked: false })]),
  transportStatus("agent_offline", { minutes: 15 }),
  transportStatus("queue_full"),
  transportStatus("expired", { pending: 2 }),
];

describe("transport_status allowlist", () => {
  it("every Gateway message is a typed, allowlisted transport_status, visibly marked as connection status", () => {
    for (const s of every()) {
      expect(s.kind).toBe("transport_status");
      expect(TRANSPORT_STATUS_KINDS).toContain(s.status);
      expect(s.text.startsWith("［連線狀態］")).toBe(true);
    }
  });

  it("no transport_status explains or judges a task, gives advice, or sounds like a Manager acknowledgement", () => {
    const SEMANTIC = /任務|修正|修改|程式|畫面|PR|批准|發布|合併|部署|建議|請|檢查|稍後再|pnpm|Claude|Codex|Manager|收到|了解|好的|Got it/i;
    for (const s of every()) expect(s.text, s.status).not.toMatch(SEMANTIC);
  });

  it("the notifier refuses anything that is not an allowlisted transport_status", async () => {
    const posted: string[] = [];
    const notifier = createOwnerNotifier({
      botToken: "t",
      ownerChatId: 1,
      log: () => {},
      fetch: async (_url, init) => (posted.push(String(init?.body)), new Response("{}", { status: 200 })),
    });
    expect(await notifier.send("收到，我會處理你的任務" as unknown as TransportStatus)).toBe(false);
    expect(await notifier.send({ kind: "manager_reply", status: "waking", text: "x" } as unknown as TransportStatus)).toBe(false);
    expect(await notifier.send({ kind: "transport_status", status: "task_done", text: "x" } as unknown as TransportStatus)).toBe(false);
    expect(posted).toEqual([]);
    expect(await notifier.send(transportStatus("queue_full"))).toBe(true);
    expect(posted).toHaveLength(1);
  });
});

describe("transport_status delivery rules", () => {
  it("waking is sent at most once for a wake cycle, however many updates arrive, and never echoes owner content", async () => {
    const g = await createGateway({ ghState: "Shutdown" });
    for (const id of [1, 2, 3]) {
      await g.webhook(ownerText(`任務：秘密內容 SECRET-${id}`, { updateId: id }));
      await g.runDueAlarms();
    }
    await g.elapse(30_000);
    const waking = g.notices.filter((n) => n.includes("正在喚醒"));
    expect(waking).toHaveLength(1);
    expect(g.notices.join("\n")).not.toMatch(/SECRET|秘密/);
  });

  it("while the Agent is online the Gateway sends nothing for messages the Agent receives (the Manager is the only voice)", async () => {
    const g = await createGateway({ ghState: "Available" });
    await g.pull(); // Agent online
    await g.webhook(ownerText("任務：把按鈕改成藍色", { updateId: 10 }));
    expect((await g.pull()).map((u) => u.update_id)).toEqual([10]);
    await g.pull(11);
    await g.elapse(120_000);
    expect(g.notices).toEqual([]);
  });

  it("expiry is reported only once the Agent is offline, never while it is online", async () => {
    const g = await createGateway({ ghState: "Available", policy: { ttlMs: 60_000, agentTimeoutMs: 6_000_000 } });
    await g.pull(); // Agent online
    await g.webhook(ownerText("任務：x", { updateId: 20 }));
    for (let i = 0; i < 6; i++) {
      await g.elapse(30_000);
      expect((await g.agentRequest("/agent/ping")).status).toBe(200);
    }
    expect(g.store.rows()).toEqual([]); // expired and cleaned up
    expect(g.notices).toEqual([]);
    await g.elapse(600_000); // heartbeats stop: the Agent is offline
    expect(g.notices.filter((n) => n.includes("超過 7 天"))).toHaveLength(1);
  });

  it("queue_full is the one status allowed while online: sent once per overflow episode, as system_status, and handed to the Manager as context", async () => {
    const g = await createGateway({ ghState: "Available", policy: { queueCap: 1 } });
    await g.pull();
    for (const id of [30, 31, 32, 33]) await g.webhook(ownerText(`q${id}`, { updateId: id }));
    for (let i = 0; i < 10; i++) {
      await g.elapse(30_000);
      expect((await g.agentRequest("/agent/ping")).status).toBe(200); // the Agent stays online
    }
    expect(g.notices).toEqual(["［連線狀態］訊息佇列已滿，最近的訊息沒有收件。"]);
    const sent = g.logs.map((l) => JSON.parse(l)).filter((l) => l.event === "transport_status_sent");
    expect(sent).toEqual([{ event: "transport_status_sent", status: "queue_full", voice: "system_status" }]);
    // The Agent drains the queue; the next accepted message tells the Manager what the owner was already told.
    expect((await g.pull()).map((u) => u.update_id)).toEqual([30]);
    await g.pull(31);
    await g.webhook(ownerText("後來的訊息", { updateId: 34 }));
    const [next] = await g.pull(31);
    expect(next).toMatchObject({ update_id: 34, oxm_transport_status: ["queue_full"] });
  });

  it("a waking status is attached to every update it covered, so the Manager knows the owner was already told", async () => {
    const g = await createGateway({ ghState: "Shutdown" });
    await g.webhook(ownerText("任務：a", { updateId: 40 }));
    await g.webhook(ownerText("任務：b", { updateId: 41 }));
    await g.runDueAlarms();
    expect(g.notices.filter((n) => n.includes("正在喚醒"))).toHaveLength(1);
    g.gh.state = "Available";
    const pulled = await g.pull();
    expect(pulled.map((u) => [u.update_id, (u as { oxm_transport_status?: string[] }).oxm_transport_status])).toEqual([
      [40, ["waking"]],
      [41, ["waking"]],
    ]);
    // Once confirmed, the context is gone with the update; a later message carries none.
    await g.pull(42);
    await g.webhook(ownerText("任務：c", { updateId: 42 }));
    const [later] = await g.pull(42);
    expect(later).not.toHaveProperty("oxm_transport_status");
  });
});
