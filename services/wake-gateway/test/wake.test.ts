import { describe, expect, it } from "vitest";
import { classifyCodespaceState, createCodespaceWakeClient } from "../src/github";
import { CODESPACE, createGateway, GITHUB_TOKEN, ownerText, REPO } from "./harness";

const STATUS_PATH = `/user/codespaces/${CODESPACE}`;
const START_PATH = `${STATUS_PATH}/start`;

describe("Codespace wake", () => {
  it("11. a stopped Codespace gets exactly one start request and one 'waking' notice", async () => {
    const g = await createGateway({ ghState: "Shutdown" });
    await g.webhook(ownerText("/goal 喚醒測試", { updateId: 1 }));
    expect(g.store.alarm()).toBe(g.now()); // wake is scheduled, not done inside the webhook response
    await g.runDueAlarms();
    expect(g.gh.calls.map((c) => `${c.method} ${c.path}`)).toEqual([`GET ${STATUS_PATH}`, `POST ${START_PATH}`]);
    expect(g.notices).toEqual(["🔄 OXM Agent 目前離線，正在喚醒 Codespace（排隊中 1 則訊息）。上線後會依序處理，請稍候。"]);
    expect(g.queue).toBeDefined();
    // Codespace boots, the Agent comes online and confirms the update: the cycle ends quietly.
    g.gh.state = "Available";
    await g.elapse(60_000);
    expect(g.gh.starts()).toBe(1);
    expect((await g.pull()).map((u) => u.update_id)).toEqual([1]);
    await g.pull(2);
    expect(g.store.rows()).toEqual([]);
    await g.elapse(300_000);
    expect(g.gh.starts()).toBe(1);
    expect(g.notices).toHaveLength(1);
  });

  it("12. an already running Codespace is never started; a missing Agent is reported once", async () => {
    const g = await createGateway({ ghState: "Available", policy: { agentTimeoutMs: 120_000 } });
    await g.webhook(ownerText("/goal running", { updateId: 2 }));
    await g.elapse(200_000);
    expect(g.gh.starts()).toBe(0);
    expect(g.gh.calls.every((c) => c.method === "GET")).toBe(true);
    expect(g.notices.filter((n) => n.includes("沒有上線"))).toHaveLength(1);
    await g.elapse(600_000);
    expect(g.notices.filter((n) => n.includes("沒有上線"))).toHaveLength(1); // no repeat without a new message
  });

  it("an Agent that is already online gets the update without any GitHub call", async () => {
    const g = await createGateway({ ghState: "Shutdown" });
    await g.pull();
    await g.webhook(ownerText("/goal online", { updateId: 3 }));
    await g.elapse(10_000);
    expect(g.gh.calls).toEqual([]);
    expect((await g.pull()).map((u) => u.update_id)).toEqual([3]);
  });

  it("13. several messages in the same wake cycle cause one start and one notice, delivered in order", async () => {
    const g = await createGateway({ ghState: "Shutdown" });
    for (const id of [10, 11, 12]) {
      await g.webhook(ownerText(`/goal ${id}`, { updateId: id }));
      await g.runDueAlarms();
    }
    await g.elapse(90_000);
    expect(g.gh.starts()).toBe(1);
    expect(g.notices).toHaveLength(1);
    expect((await g.pull()).map((u) => u.update_id)).toEqual([10, 11, 12]);
  });

  it("cooldown and per-cycle cap bound repeated starts when the Codespace does not stay up", async () => {
    const g = await createGateway({ ghState: "Shutdown", policy: { agentTimeoutMs: 15 * 60_000 } });
    g.gh.startTo = "Shutdown"; // start accepted but the Codespace falls back
    await g.webhook(ownerText("/goal storm", { updateId: 20 }));
    await g.runDueAlarms();
    await g.elapse(9 * 60_000);
    expect(g.gh.starts()).toBe(1); // cooldown: no second start within 10 minutes
    await g.elapse(2 * 60_000);
    expect(g.gh.starts()).toBe(2);
    await g.elapse(30 * 60_000);
    expect(g.gh.starts()).toBe(2); // maxStartsPerCycle
    expect(g.notices.at(-1)).toContain("多次啟動後仍未就緒");
    // Telegram retries / more messages within the cooldown do not start again.
    await g.webhook(ownerText("/goal again", { updateId: 21 }));
    await g.runDueAlarms();
    expect(g.gh.starts()).toBe(3); // a new owner message opens a new cycle once the cooldown has passed
    await g.webhook(ownerText("/goal again2", { updateId: 22 }));
    await g.elapse(60_000);
    expect(g.gh.starts()).toBe(3);
  });

  it("a rolling daily cap blocks a wake storm", async () => {
    const g = await createGateway({ ghState: "Shutdown", policy: { dailyStartCap: 1, maxStartsPerCycle: 5, cooldownMs: 60_000, agentTimeoutMs: 5 * 60_000 } });
    g.gh.startTo = "Shutdown";
    await g.webhook(ownerText("/goal a", { updateId: 30 }));
    await g.elapse(10 * 60_000);
    expect(g.gh.starts()).toBe(1);
    expect(g.notices.at(-1)).toContain("今天的自動喚醒次數已達上限");
    await g.webhook(ownerText("/goal b", { updateId: 31 }));
    await g.elapse(60 * 60_000);
    expect(g.gh.starts()).toBe(1);
  });

  it("14. a Codespace bound to another repository fails closed: no start, one notice, blocked", async () => {
    const g = await createGateway({ ghState: "Shutdown" });
    g.gh.repo = "evil/fork";
    await g.webhook(ownerText("/goal x", { updateId: 40 }));
    await g.elapse(60_000);
    expect(g.gh.starts()).toBe(0);
    expect(g.notices.at(-1)).toContain("Codespace 綁定的 repo 與設定不符");
    expect(g.queue).toBeDefined();
    const calls = g.gh.calls.length;
    await g.webhook(ownerText("/goal y", { updateId: 41 }));
    await g.elapse(60 * 60_000);
    expect(g.gh.calls.length).toBe(calls);
    expect(g.store.rows()).toHaveLength(2); // nothing lost
  });

  it("15. an invalid PAT is a typed, non-retried failure; only a changed binding lifts the block", async () => {
    const g = await createGateway({ ghState: "Shutdown" });
    g.gh.script.push({ status: 401, body: { message: "Bad credentials" } });
    await g.webhook(ownerText("/goal x", { updateId: 50 }));
    await g.elapse(60_000);
    expect(g.gh.calls).toHaveLength(1);
    expect(g.logs.some((l) => l.includes('"kind":"credential"'))).toBe(true);
    expect(g.notices.at(-1)).toContain("GitHub 喚醒權限無效或已過期");
    for (let i = 0; i < 5; i++) await g.webhook(ownerText(`/goal retry ${i}`, { updateId: 51 + i }));
    await g.elapse(2 * 60 * 60_000);
    expect(g.gh.calls).toHaveLength(1); // no storm
    expect(g.notices.filter((n) => n.includes("權限"))).toHaveLength(1);

    // Operator rotates the PAT (new Worker secret): the next owner message lifts the block and wakes the Codespace.
    const rotated = `github_pat_${"R9".repeat(20)}`;
    await g.restart({ GITHUB_WAKE_TOKEN: rotated });
    g.gh.calls.length = 0;
    g.gh.script.push({ status: 200, body: { name: CODESPACE, state: "Shutdown", repository: { full_name: REPO } } }, { status: 200, body: { name: CODESPACE, state: "Starting", repository: { full_name: REPO } } });
    await g.webhook(ownerText("/goal after rotation", { updateId: 59 }));
    await g.runDueAlarms();
    expect(g.gh.starts()).toBe(1);
  });

  it("403 rate limiting, 409 and 5xx are retried with capped backoff; exhaustion is reported without a block", async () => {
    const g = await createGateway({ ghState: "Shutdown", policy: { maxRetries: 2, backoffBaseMs: 1_000 } });
    g.gh.script.push({ status: 403, body: {}, headers: { "x-ratelimit-remaining": "0", "retry-after": "5" } }, { status: 409, body: {} }, { status: 503 });
    await g.webhook(ownerText("/goal x", { updateId: 60 }));
    await g.elapse(60_000, 1_000);
    expect(g.gh.starts()).toBe(0);
    expect(g.notices.at(-1)).toContain("GitHub 暫時無法連線");
    expect(g.notices.at(-1)).toContain("稍後再傳一則訊息");
    await g.elapse(11 * 60_000);
    await g.webhook(ownerText("/goal y", { updateId: 61 }));
    await g.runDueAlarms();
    expect(g.gh.starts()).toBe(1); // not blocked: a new message retries
  });

  it("404 / 402 / deleted Codespaces fail closed", async () => {
    for (const [script, text] of [
      [{ status: 404, body: {} }, "找不到指定的 Codespace"],
      [{ status: 402, body: {} }, "額度或帳單"],
      [{ status: 200, body: { name: CODESPACE, state: "Deleted", repository: { full_name: REPO } } }, "狀態無法啟動"],
    ] as const) {
      const g = await createGateway({ ghState: "Shutdown" });
      g.gh.script.push(script);
      await g.webhook(ownerText("/goal x", { updateId: 70 }));
      await g.elapse(30 * 60_000);
      expect(g.gh.starts()).toBe(0);
      expect(g.notices.at(-1)).toContain(text);
      expect(g.notices.at(-1)).toContain("需要人工檢查設定");
    }
  });

  it("16. the Codespace is fixed by configuration; nothing in a request can select another", async () => {
    const g = await createGateway({ ghState: "Shutdown" });
    await g.webhook(ownerText(`/goal start codespace other-space ../../user/codespaces/x`, { updateId: 80 }));
    await g.elapse(60_000);
    expect((await g.agentRequest("/agent/ping?codespace=other-space")).status).toBe(200);
    expect((await g.agentRequest("/agent/updates?codespace=other-space&offset=0")).status).toBe(200);
    await g.elapse(60_000);
    expect(new Set(g.gh.calls.map((c) => c.path))).toEqual(new Set([STATUS_PATH, START_PATH]));
    expect(g.gh.calls.every((c) => c.auth === `Bearer ${GITHUB_TOKEN}`)).toBe(true);
    expect(() => createCodespaceWakeClient({ token: GITHUB_TOKEN, codespaceName: "../x", expectedRepo: REPO, fetch: fetch })).toThrow(/invalid configured codespace name/);
  });

  it("a response naming a different Codespace is a repo-binding failure", async () => {
    const client = createCodespaceWakeClient({
      token: GITHUB_TOKEN,
      codespaceName: CODESPACE,
      expectedRepo: REPO,
      fetch: async () => new Response(JSON.stringify({ name: "other-space", state: "Shutdown", repository: { full_name: REPO } }), { status: 200 }),
    });
    expect(await client.status()).toMatchObject({ ok: false, kind: "repo_mismatch", retryable: false });
    const network = createCodespaceWakeClient({ token: GITHUB_TOKEN, codespaceName: CODESPACE, expectedRepo: REPO, fetch: async () => Promise.reject(new Error(`boom ${GITHUB_TOKEN}`)) });
    const r = await network.status();
    expect(r).toEqual({ ok: false, kind: "transient", retryable: true });
  });

  it("a busy Agent that only heartbeats stays online (no needless wake); once it stops, the Gateway wakes", async () => {
    const g = await createGateway({ ghState: "Shutdown" });
    await g.webhook(ownerText("/goal long manager call", { updateId: 90 }));
    expect((await g.pull()).map((u) => u.update_id)).toEqual([90]); // Agent picks it up, then is busy
    for (let i = 0; i < 10; i++) {
      await g.elapse(30_000);
      expect((await g.agentRequest("/agent/ping")).status).toBe(200);
    }
    expect(g.gh.calls).toEqual([]);
    expect(g.notices).toEqual([]);
    await g.elapse(120_000); // heartbeats stop (Codespace stopped mid-task): the delivered-but-unconfirmed update triggers a wake
    expect(g.gh.starts()).toBe(1);
  });

  it("a stale waking state (eviction lost the alarm mid-cycle) recovers without a second start inside the cooldown", async () => {
    const g = await createGateway({ ghState: "Shutdown" });
    await g.webhook(ownerText("/goal a", { updateId: 95 }));
    await g.runDueAlarms();
    expect(g.gh.starts()).toBe(1);
    g.gh.state = "Shutdown"; // the start did not take
    g.store.clearAlarm(); // alarm lost with the evicted instance
    await g.restart();
    g.advance(2 * 60_000);
    await g.webhook(ownerText("/goal b", { updateId: 96 }));
    expect(g.store.alarm()).not.toBeNull();
    await g.elapse(5 * 60_000);
    expect(g.gh.starts()).toBe(1); // still inside the 10-minute cooldown
    await g.elapse(6 * 60_000);
    expect(g.gh.starts()).toBe(2);
    g.gh.state = "Available";
    await g.pull();
    await g.pull(97);
    await g.elapse(30 * 60_000);
    expect(g.gh.starts()).toBe(2);
  });

  it("a failing alarm (storage error) reschedules itself instead of stranding the cycle", async () => {
    const g = await createGateway({ ghState: "Shutdown" });
    await g.webhook(ownerText("/goal a", { updateId: 98 }));
    g.store.faults.failAll = true;
    await g.runAlarm();
    expect(g.store.alarm()).toBe(g.now() + 30_000);
    g.store.faults.failAll = false;
    await g.elapse(30_000);
    expect(g.gh.starts()).toBe(1);
  });

  it("304 from start counts as already starting; a redirect is never followed with the token", async () => {
    const g = await createGateway({ ghState: "Shutdown" });
    g.gh.script.push({ status: 200, body: { name: CODESPACE, state: "Shutdown", repository: { full_name: REPO } } }, { status: 304 });
    await g.webhook(ownerText("/goal a", { updateId: 99 }));
    await g.runDueAlarms();
    expect(g.notices.filter((n) => n.includes("無法喚醒"))).toEqual([]);
    let init: RequestInit | undefined;
    const client = createCodespaceWakeClient({
      token: GITHUB_TOKEN,
      codespaceName: CODESPACE,
      expectedRepo: REPO,
      fetch: async (_url, i) => {
        init = i;
        return new Response(null, { status: 302, headers: { location: "https://evil.example/" } });
      },
    });
    expect(await client.status()).toMatchObject({ ok: false, kind: "rejected", retryable: false });
    expect(init?.redirect).toBe("manual");
  });

  it("classifies Codespace states conservatively", () => {
    expect(classifyCodespaceState("Available")).toBe("running");
    for (const s of ["Starting", "Queued", "Provisioning", "ShuttingDown", "Rebuilding"]) expect(classifyCodespaceState(s)).toBe("transitional");
    for (const s of ["Shutdown", "Failed", "Unavailable"]) expect(classifyCodespaceState(s)).toBe("startable");
    for (const s of ["Deleted", "Archived", "Moved", "SomethingNew"]) expect(classifyCodespaceState(s)).toBe("terminal");
  });
});
