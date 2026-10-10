import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sha256Hex } from "../src/config";
import { projectUpdate } from "../src/telegram";
import { AGENT_TOKEN, ALL_SECRETS, BOT_TOKEN, createGateway, createSqliteStorage, OWNER, ownerCallback, ownerText, STRANGER, WEBHOOK_PATH } from "./harness";

const tmp = mkdtempSync(join(tmpdir(), "wake-gateway-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("Telegram webhook intake", () => {
  it("1. a valid owner update is committed and served to the Agent with the original update_id", async () => {
    const g = await createGateway({ ghState: "Available" });
    const update = ownerText("/goal 修正搜尋頁", { updateId: 9001, messageId: 61 });
    expect((await g.webhook(update)).status).toBe(200);
    expect(g.store.rows()).toEqual([{ update_id: 9001, delivery_state: "pending", delivery_count: 0 }]);
    const [served] = await g.pull();
    expect(served).toEqual({
      update_id: 9001,
      message: { message_id: 61, chat: { id: OWNER, type: "private" }, from: { id: OWNER, is_bot: false }, text: "/goal 修正搜尋頁" },
    });
  });

  it("2. a missing or wrong Telegram secret, or a wrong path, is rejected before anything is stored", async () => {
    const g = await createGateway();
    expect((await g.webhook(ownerText("hi"), { secret: null })).status).toBe(401);
    expect((await g.webhook(ownerText("hi"), { secret: `whsec_${"x".repeat(40)}` })).status).toBe(401);
    expect((await g.webhook(ownerText("hi"), { path: `path_${"z".repeat(30)}` })).status).toBe(404);
    expect(g.store.rows()).toEqual([]);
    expect(g.store.alarm()).toBeNull();
    expect(g.gh.calls).toEqual([]);
  });

  it("3/4. strangers, non-private chats and bot senders are acknowledged but never stored or woken for", async () => {
    const g = await createGateway();
    const ignored = [
      ownerText("/goal x", { chatId: STRANGER, fromId: STRANGER }),
      ownerText("/goal x", { fromId: STRANGER }),
      ownerText("/goal x", { chatType: "group" }),
      ownerText("/goal x", { chatId: -100123, chatType: "supergroup" }),
      ownerText("/goal x", { isBot: true }),
      ownerCallback("a:abc", { fromId: STRANGER }),
      ownerCallback("a:abc", { chatId: STRANGER }),
      { update_id: 9100, edited_message: ownerText("x").message },
      { update_id: 9101, message: { ...ownerText("x").message, text: undefined, photo: [{}] } },
    ];
    for (const u of ignored) expect((await g.webhook(u)).status).toBe(200);
    expect(g.store.rows()).toEqual([]);
    expect(g.store.alarm()).toBeNull();
    expect(g.notices).toEqual([]);
  });

  it("bounds payload size and rejects malformed JSON without storing", async () => {
    const g = await createGateway();
    expect((await g.webhook(null, { raw: `{"update_id":1,"message":{"text":"${"x".repeat(70_000)}"}}` })).status).toBe(413);
    expect((await g.webhook(null, { raw: "{not json" })).status).toBe(400);
    expect((await g.webhook(ownerText("y".repeat(9000)))).status).toBe(200); // oversized text: ignored, never truncated into a different command
    expect(g.store.rows()).toEqual([]);
  });

  it("5. a duplicate update_id (Telegram retry) is acknowledged without a second queue entry, before and after ACK", async () => {
    const g = await createGateway({ ghState: "Available" });
    const update = ownerText("/goal once", { updateId: 9200 });
    expect((await g.webhook(update)).status).toBe(200);
    expect((await g.webhook(update)).status).toBe(200);
    expect(g.store.rows()).toHaveLength(1);
    await g.pull(); // delivered
    await g.pull(9201); // Agent confirmed it
    expect(g.store.rows()).toHaveLength(0);
    expect((await g.webhook(update)).status).toBe(200); // late replay
    expect(g.store.rows()).toHaveLength(0);
    expect(await g.pull(9201)).toEqual([]);
  });

  it("6. 2xx is returned only after the durable write; a failed write makes Telegram retry", async () => {
    const g = await createGateway({ ghState: "Available" });
    const update = ownerText("/goal durable", { updateId: 9300 });
    g.store.faults.failInsert = true;
    expect((await g.webhook(update)).status).toBe(500);
    expect(g.store.rows()).toEqual([]);
    g.store.faults.failInsert = false;
    const res = await g.webhook(update); // Telegram's retry
    expect(res.status).toBe(200);
    expect(g.store.rows().map((r) => r.update_id)).toEqual([9300]);
  });

  it("7. a restart (eviction / redeploy) over the same durable storage preserves the queue and the cursor", async () => {
    const path = join(tmp, "restart.sqlite");
    const g = await createGateway({ ghState: "Available", store: createSqliteStorage(path) });
    for (const id of [9401, 9402, 9403]) await g.webhook(ownerText(`/goal ${id}`, { updateId: id }));
    await g.pull();
    await g.pull(9402);
    g.store.close();
    const g2 = await createGateway({ ghState: "Available", store: createSqliteStorage(path) });
    expect((await g2.pull()).map((u) => u.update_id)).toEqual([9402, 9403]);
    await g2.webhook(ownerText("/goal old", { updateId: 9401 })); // below the persisted cursor
    expect(g2.store.rows().map((r) => r.update_id)).toEqual([9402, 9403]);
    g2.store.close();
  });

  it("8. the Agent can replay its offset after a crash; an older offset never resurrects confirmed updates", async () => {
    const g = await createGateway({ ghState: "Available" });
    for (const id of [9501, 9502]) await g.webhook(ownerText(`m${id}`, { updateId: id }));
    expect((await g.pull()).map((u) => u.update_id)).toEqual([9501, 9502]);
    expect((await g.pull()).map((u) => u.update_id)).toEqual([9501, 9502]); // not confirmed -> redelivered
    expect(g.store.rows().map((r) => [r.delivery_state, r.delivery_count])).toEqual([
      ["delivered", 2],
      ["delivered", 2],
    ]);
    expect((await g.pull(9502)).map((u) => u.update_id)).toEqual([9502]);
    expect((await g.pull(9400)).map((u) => u.update_id)).toEqual([9502]); // stale offset: cursor stays monotonic
  });

  it("9. offset acknowledges and removes; it can only confirm updates already delivered to the Agent", async () => {
    const g = await createGateway({ ghState: "Available" });
    await g.webhook(ownerText("a", { updateId: 9601 }));
    expect((await g.pull(1_000_000_000)).map((u) => u.update_id)).toEqual([9601]); // never delivered: not confirmable yet
    expect(await g.pull(1_000_000_000)).toEqual([]); // now delivered: confirmed, clamped to 9602
    expect(g.store.rows()).toEqual([]);
    await g.webhook(ownerText("b", { updateId: 9605 }));
    expect((await g.pull(1_000_000_000)).map((u) => u.update_id)).toEqual([9605]);
    expect((await g.pull(9606)).length).toBe(0);
    expect(g.store.rows()).toEqual([]);
  });

  it("Telegram restarting update ids at a lower random value (after a week idle) is neither dropped nor reordered", async () => {
    const g = await createGateway({ ghState: "Available" });
    await g.webhook(ownerText("old", { updateId: 9660 }));
    await g.pull();
    await g.pull(9661);
    await g.webhook(ownerText("after reset", { updateId: 120 })); // new random, lower id
    await g.webhook(ownerText("next", { updateId: 121 }));
    const served = await g.pull(9661);
    expect(served.map((u) => u.update_id)).toEqual([9661, 9662]); // rebased above the confirmed cursor, in order
    expect(served.map((u) => (u as { message: { text: string } }).message.text)).toEqual(["after reset", "next"]);
    for (const id of [120, 121, 9660]) await g.webhook(ownerText("retry", { updateId: id })); // Telegram retries stay duplicates
    expect(g.store.rows().map((r) => r.update_id)).toEqual([9661, 9662]);
    expect(g.logs.some((l) => l.includes('"rebased_seq":9661'))).toBe(true);
  });

  it("long-poll returns as soon as an update arrives", async () => {
    const g = await createGateway({ ghState: "Available", policy: { longPollMaxMs: 2_000 } });
    const pending = g.pull(null, 2);
    await new Promise((r) => setTimeout(r, 20));
    await g.webhook(ownerText("late", { updateId: 9650 }));
    expect((await pending).map((u) => u.update_id)).toEqual([9650]);
  });

  it("17. the queue is capped; overflow is not stored and the owner gets one rate-limited notice", async () => {
    const g = await createGateway({ ghState: "Available", policy: { queueCap: 2 } });
    await g.pull(); // Agent online: no wake involved
    for (const id of [9701, 9702, 9703, 9704]) expect((await g.webhook(ownerText(`q${id}`, { updateId: id }))).status).toBe(200);
    expect(g.store.rows().map((r) => r.update_id)).toEqual([9701, 9702]);
    await g.elapse(60_000);
    expect(g.notices.filter((n) => n.includes("佇列已滿"))).toHaveLength(1);
  });

  it("18. expired records are cleaned up and reported once by count only", async () => {
    const g = await createGateway({ ghState: "Available", policy: { ttlMs: 60_000, agentTimeoutMs: 600_000 } });
    await g.webhook(ownerText("/goal 不會被處理 SECRET-CONTENT", { updateId: 9801 }));
    await g.elapse(120_000);
    expect(g.store.rows()).toEqual([]);
    const expired = g.notices.filter((n) => n.includes("超過 7 天"));
    expect(expired).toEqual(["［連線狀態］有 1 則訊息排隊超過 7 天未被處理，已丟棄。"]);
    expect(g.notices.join("\n")).not.toContain("SECRET-CONTENT");
  });
});

describe("Agent authentication", () => {
  it("requires the Agent bearer token; other credentials are not accepted as it", async () => {
    const g = await createGateway();
    expect((await g.agentRequest("/agent/updates", null)).status).toBe(401);
    expect((await g.agentRequest("/agent/updates", `${AGENT_TOKEN}x`)).status).toBe(401);
    expect((await g.agentRequest("/agent/updates", BOT_TOKEN.replace(":", "_"))).status).toBe(401);
    expect((await g.agentRequest("/agent/ping")).status).toBe(200);
    expect((await g.agentRequest("/agent/updates?offset=-1")).status).toBe(400);
    expect((await g.agentRequest("/nope")).status).toBe(404);
    expect((await g.agentRequest("/healthz", null)).status).toBe(200);
  });

  it("fails closed (503) on a missing secret or reused credentials", async () => {
    const missing = await createGateway({ env: { GITHUB_WAKE_TOKEN: "" } });
    expect((await missing.webhook(ownerText("x"))).status).toBe(503);
    const classic = await createGateway({ env: { GITHUB_WAKE_TOKEN: ["ghp", "FAKE".repeat(9)].join("_") /* classic-PAT shape, built at runtime so scanners do not flag it */ } });
    expect((await classic.webhook(ownerText("x"))).status).toBe(503);
    const reused = await createGateway({ env: { AGENT_TOKEN_SHA256: await sha256Hex(BOT_TOKEN) } });
    expect((await reused.agentRequest("/agent/ping")).status).toBe(503);
    const samePath = await createGateway({ env: { TELEGRAM_WEBHOOK_PATH: WEBHOOK_PATH, TELEGRAM_WEBHOOK_SECRET: WEBHOOK_PATH } });
    expect((await samePath.webhook(ownerText("x"))).status).toBe(503);
  });
});

describe("logging", () => {
  it("19. logs never contain message content or any credential", async () => {
    const g = await createGateway({ ghState: "Shutdown" });
    await g.webhook(ownerText("/goal SECRET-CONTENT-XYZ https://evil.example", { updateId: 9901 }));
    await g.webhook(ownerCallback("a:REF-SECRET", { updateId: 9902 }));
    await g.webhook(ownerText("stranger SECRET-CONTENT-XYZ", { chatId: STRANGER, fromId: STRANGER }));
    await g.webhook(ownerText("x"), { secret: "wrong-secret-SECRET-CONTENT-XYZ-0000000000" });
    await g.agentRequest("/agent/updates", "WRONG-AGENT-TOKEN-SECRET-CONTENT");
    await g.runDueAlarms();
    await g.pull();
    const all = g.logs.join("\n");
    expect(all.length).toBeGreaterThan(0);
    for (const s of [...ALL_SECRETS, "SECRET-CONTENT", "REF-SECRET", "evil.example"]) expect(all).not.toContain(s);
    expect(g.notices.join("\n")).not.toContain("SECRET-CONTENT");
  });
});

describe("projection", () => {
  it("keeps only the fields the Agent reads, including reply correlation", () => {
    const raw = ownerText("繼續", { updateId: 5 });
    const withReply = { ...raw, message: { ...raw.message, reply_to_message: { message_id: 9, chat: { id: OWNER, type: "private" }, from: { id: 42, is_bot: true, first_name: "bot" }, text: "notice\nref: abc", photo: [] } } };
    const p = projectUpdate(withReply, OWNER);
    expect(p).toMatchObject({ kind: "accepted", updateKind: "message" });
    if (p.kind !== "accepted") return;
    expect(p.update).toEqual({
      update_id: 5,
      message: {
        message_id: 105,
        chat: { id: OWNER, type: "private" },
        from: { id: OWNER, is_bot: false },
        text: "繼續",
        reply_to_message: { message_id: 9, chat: { id: OWNER, type: "private" }, from: { id: 42, is_bot: true }, text: "notice\nref: abc" },
      },
    });
  });
});
