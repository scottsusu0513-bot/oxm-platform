import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAnthropicGoalReviewer, createAnthropicIntentPlanner } from "./anthropic";
import { AnthropicTransportError, createAnthropicHttpTransport, createAnthropicHttpTransportFromEnv } from "./anthropicHttp";
import { normalizeIntentDecision } from "./normalize";

const KEY = "sk-ant-test-SECRET-0123456789";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

type Reply = { status?: number; body?: unknown; raw?: string; headers?: Record<string, string> } | "network" | "hang";
function fakeFetch(replies: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (r === "network") throw new TypeError(`fetch failed: x-api-key=${KEY}`);
    if (r === "hang")
      return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    return new Response(r.raw ?? JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}
const message = (text: string, stop_reason = "end_turn") => ({ body: { type: "message", stop_reason, content: [{ type: "text", text }] } });
const transport = (replies: Reply[], extra: { maxRetries?: number; timeoutMs?: number } = {}) => {
  const f = fakeFetch(replies);
  const sleeps: number[] = [];
  const client = createAnthropicHttpTransport({ apiKey: KEY, fetch: f.fetch, sleep: async (ms) => void sleeps.push(ms), random: () => 0, maxRetries: extra.maxRetries ?? 2, timeoutMs: extra.timeoutMs ?? 1_000 });
  return { client, calls: f.calls, sleeps };
};
const plannerInput = { message: "搜尋頁 loading 太慢，幫我修", contextTaskId: null, tasks: [], requireTask: false };
const expectNoKey = (value: unknown) => {
  const text = value instanceof Error ? `${value.name} ${value.message} ${value.stack ?? ""} ${JSON.stringify(value)}` : JSON.stringify(value);
  expect(text).not.toContain(KEY);
  expect(text).not.toContain("SECRET");
};

describe("no Anthropic SDK dependency", () => {
  it("package.json declares no @anthropic-ai/sdk (application or Agent)", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) expect(pkg[field]?.["@anthropic-ai/sdk"], field).toBeUndefined();
    expect(readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8")).not.toContain("@anthropic-ai/sdk");
  });

  it("no orchestrator, script or server source imports @anthropic-ai/sdk", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name) && !name.endsWith(".test.ts") && /from\s+["']@anthropic-ai\/sdk|require\(["']@anthropic-ai\/sdk/.test(readFileSync(p, "utf8"))) offenders.push(p);
      }
    };
    for (const d of ["orchestrator", "scripts", "server", "shared", "client/src"]) walk(join(ROOT, d));
    expect(offenders).toEqual([]);
  });
});

describe("native HTTP Anthropic transport", () => {
  it("planner works end to end through the injected native transport (POST /v1/messages, typed output validated as before)", async () => {
    const decision = { intent: "change_code", taskId: null, title: "修正搜尋頁 loading", interpretedObjective: "改善搜尋頁 loading 體驗", criteria: ["搜尋時顯示 loading 狀態", "結果出現後 loading 消失"], clarificationQuestion: "", riskObservations: [] };
    const t = transport([message(JSON.stringify(decision))]);
    const raw = await createAnthropicIntentPlanner({ client: t.client, model: "claude-opus-5-5" }).interpret(plannerInput);
    expect(raw).toEqual(decision);
    expect(normalizeIntentDecision(raw, { knownTaskIds: [], requireTask: false } as never)).toMatchObject({ intent: "change_code" });
    expect(t.calls).toHaveLength(1);
    const { url, init } = t.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "x-api-key": KEY, "anthropic-version": "2023-06-01", "anthropic-beta": "server-side-fallback-2026-07-01", "content-type": "application/json" });
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: "claude-opus-5-5", max_tokens: 8000, fallbacks: "default", output_config: { effort: "high", format: { type: "json_schema" } }, messages: [{ role: "user" }] });
    expect(body).not.toHaveProperty("betas");
    expect(JSON.stringify(body)).not.toContain(KEY);
  });

  it("reviewer works through the same transport", async () => {
    const t = transport([message(JSON.stringify({ criteria: [{ id: "GC-1", status: "satisfied", evidence: "diff", reason: "" }] }))]);
    const out = await createAnthropicGoalReviewer({ client: t.client }).review({ mode: "change", intent: null, title: "t", originalRequest: "o", interpretedObjective: "o", criteria: [{ id: "GC-1", text: "x" }], validations: [], diff: "", diffTruncated: false, answer: null, citedFiles: [] });
    expect(out).toEqual({ criteria: [{ id: "GC-1", status: "satisfied", evidence: "diff", reason: "" }] });
    expect(JSON.parse(String(t.calls[0].init.body)).max_tokens).toBe(16000);
  });

  it.each([
    ["non-JSON body", { raw: "<html>oops</html>" }],
    ["not an object", { body: "hello" }],
    ["content missing", { body: { stop_reason: "end_turn" } }],
    ["content not an array", { body: { stop_reason: "end_turn", content: "text" } }],
    ["text block without string text", { body: { stop_reason: "end_turn", content: [{ type: "text", text: 42 }] } }],
    ["null block", { body: { stop_reason: "end_turn", content: [null] } }],
  ] as const)("malformed response fails closed without retry: %s", async (_, reply) => {
    const t = transport([reply as Reply]);
    const err = await t.client.createMessage({ body: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AnthropicTransportError);
    expect(err).toMatchObject({ kind: "malformed_response", transient: false });
    expect(t.calls).toHaveLength(1);
  });

  it("planner fails closed on a non-JSON model answer, refusal and truncation", async () => {
    await expect(createAnthropicIntentPlanner({ client: transport([message("not json")]).client }).interpret(plannerInput)).rejects.toThrow();
    await expect(createAnthropicIntentPlanner({ client: transport([message("", "refusal")]).client }).interpret(plannerInput)).rejects.toMatchObject({ kind: "refusal", transient: false });
    await expect(createAnthropicIntentPlanner({ client: transport([message("{", "max_tokens")]).client }).interpret(plannerInput)).rejects.toMatchObject({ kind: "truncated", transient: false });
  });

  it.each([
    [429, "rate_limited"],
    [500, "server_error"],
    [503, "server_error"],
    [529, "overloaded"],
    [408, "timeout"],
  ] as const)("HTTP %i is a typed transient failure, retried with bounded backoff", async (status, kind) => {
    const t = transport([{ status, body: { type: "error", error: { type: "api_error", message: `echo ${KEY}` } } }]);
    const err = (await t.client.createMessage({ body: {} }).catch((e: unknown) => e)) as AnthropicTransportError;
    expect(err).toBeInstanceOf(AnthropicTransportError);
    expect(err).toMatchObject({ kind, transient: true, status });
    expect(t.calls).toHaveLength(3); // 1 + maxRetries(2)
    expect(t.sleeps).toEqual([500, 1000]);
    expectNoKey(err);
  });

  it("a transient failure followed by success returns the result; retry-after is honoured and bounded", async () => {
    const t = transport([{ status: 429, body: {}, headers: { "retry-after": "3" } }, { status: 529, body: {}, headers: { "retry-after": "9999" } }, message('{"ok":true}')]);
    expect(await t.client.createMessage({ body: {} })).toEqual({ stopReason: "end_turn", text: '{"ok":true}' });
    expect(t.sleeps).toEqual([3000, 60_000]);
  });

  it("timeout is a typed transient failure (per-attempt abort), retried then surfaced", async () => {
    const t = transport(["hang"], { timeoutMs: 10, maxRetries: 1 });
    const err = await t.client.createMessage({ body: {} }).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: "timeout", transient: true });
    expect(t.calls).toHaveLength(2);
  });

  it("network errors are transient and never leak the underlying message (which may echo the key)", async () => {
    const t = transport(["network"], { maxRetries: 0 });
    const err = await t.client.createMessage({ body: {} }).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: "network", transient: true });
    expectNoKey(err);
  });

  it.each([
    [400, "invalid_request"],
    [401, "authentication"],
    [403, "permission"],
    [404, "not_found"],
  ] as const)("HTTP %i is permanent: no retry", async (status, kind) => {
    const t = transport([{ status, body: { type: "error", error: { type: "authentication_error", message: KEY } } }]);
    const err = await t.client.createMessage({ body: {} }).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind, transient: false, status });
    expect(t.calls).toHaveLength(1);
    expectNoKey(err);
  });

  it("x-should-retry overrides the default classification", async () => {
    const no = transport([{ status: 529, body: {}, headers: { "x-should-retry": "false" } }]);
    await expect(no.client.createMessage({ body: {} })).rejects.toMatchObject({ kind: "overloaded" });
    expect(no.calls).toHaveLength(1);
  });

  it("retries are bounded even if configured too high", async () => {
    const f = fakeFetch([{ status: 500, body: {} }]);
    const client = createAnthropicHttpTransport({ apiKey: KEY, fetch: f.fetch, sleep: async () => {}, maxRetries: 100 });
    await expect(client.createMessage({ body: {} })).rejects.toMatchObject({ kind: "server_error" });
    expect(f.calls).toHaveLength(6);
  });
});

describe("credential handling", () => {
  it("the key comes only from ANTHROPIC_API_KEY; absent or blank disables the planner", () => {
    expect(createAnthropicHttpTransportFromEnv({})).toBeNull();
    expect(createAnthropicHttpTransportFromEnv({ ANTHROPIC_API_KEY: "  " })).toBeNull();
    expect(createAnthropicHttpTransportFromEnv({ ANTHROPIC_AUTH_TOKEN: KEY })).toBeNull();
    expect(createAnthropicHttpTransportFromEnv({ ANTHROPIC_API_KEY: KEY })).not.toBeNull();
  });

  it("configuration errors never echo the key", () => {
    let err: unknown;
    try {
      createAnthropicHttpTransport({ apiKey: `${KEY}\ninjected: header` });
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ kind: "configuration" });
    expectNoKey(err);
  });

  it("the transport source never logs", () => {
    const src = readFileSync(join(ROOT, "orchestrator/src/planning/anthropicHttp.ts"), "utf8");
    expect(src).not.toMatch(/console\.|process\.stdout|process\.stderr/);
  });
});
