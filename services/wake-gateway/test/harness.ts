import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { sha256Hex, type GatewayPolicy } from "../src/config";
import { handleRequest } from "../src/index";
import { OwnerQueue } from "../src/ownerQueue";
import type { DurableStorageLike, FetchFn, GatewayEnv, SqlValue } from "../src/types";

export const OWNER = 777001;
export const STRANGER = 999002;
export const BOT_TOKEN = "123456789:AAFakeTokenForTestsOnly_abcdefghijklmnop";
export const WEBHOOK_SECRET = `whsec_${"a1".repeat(20)}`;
export const WEBHOOK_PATH = `path_${"b2".repeat(15)}`;
export const GITHUB_TOKEN = `github_pat_${"C3".repeat(20)}`;
export const AGENT_TOKEN = `agt_${"D4".repeat(24)}`;
export const CODESPACE = "orange-space-test-1234";
export const REPO = "scottsusu0513-bot/oxm-platform";
export const ALL_SECRETS = [BOT_TOKEN, WEBHOOK_SECRET, WEBHOOK_PATH, GITHUB_TOKEN, AGENT_TOKEN];

// Vite 5 does not resolve node:sqlite as a builtin import; load it through Node directly.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: typeof DatabaseSyncType };

/** node:sqlite stand-in for the Durable Object SQLite storage API (synchronous exec + transactionSync + alarm). */
export function createSqliteStorage(path = ":memory:") {
  const db = new DatabaseSync(path);
  let alarm: number | null = null;
  const faults = { failInsert: false, failAll: false };
  const storage: DurableStorageLike = {
    sql: {
      exec(query: string, ...bindings: SqlValue[]) {
        if (faults.failAll || (faults.failInsert && query.startsWith("INSERT INTO updates"))) throw new Error("simulated storage failure");
        const rows = db.prepare(query).all(...bindings) as Record<string, unknown>[];
        return { toArray: () => rows.map((r) => ({ ...r })) };
      },
    },
    transactionSync<T>(fn: () => T): T {
      db.exec("BEGIN");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    getAlarm: async () => alarm,
    setAlarm: async (t: number) => {
      alarm = t;
    },
  };
  return {
    storage,
    faults,
    db,
    alarm: () => alarm,
    clearAlarm: () => {
      alarm = null;
    },
    rows: () =>
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'updates'").all().length === 0
        ? []
        : (db.prepare("SELECT seq AS update_id, delivery_state, delivery_count FROM updates ORDER BY seq").all() as { update_id: number; delivery_state: string; delivery_count: number }[]),
    close: () => db.close(),
  };
}
export type SqliteStorage = ReturnType<typeof createSqliteStorage>;

type Scripted = { status: number; body?: unknown; headers?: Record<string, string> } | "network";

/** In-memory GitHub Codespaces API for exactly the configured user Codespace. */
export function createFakeGitHub(initialState = "Shutdown") {
  const gh = {
    state: initialState,
    name: CODESPACE,
    repo: REPO,
    /** State a successful start moves to. */
    startTo: "Starting",
    calls: [] as { method: string; path: string; auth: string }[],
    script: [] as Scripted[],
    starts: () => gh.calls.filter((c) => c.method === "POST").length,
    async handle(url: string, init: RequestInit): Promise<Response> {
      const u = new URL(url);
      const headers = new Headers(init.headers);
      gh.calls.push({ method: init.method ?? "GET", path: u.pathname, auth: headers.get("authorization") ?? "" });
      const scripted = gh.script.shift();
      if (scripted === "network") throw new Error(`connect ECONNREFUSED ${url}`);
      if (scripted) return new Response(scripted.body === undefined ? "" : JSON.stringify(scripted.body), { status: scripted.status, headers: scripted.headers });
      if (headers.get("authorization") !== `Bearer ${GITHUB_TOKEN}`) return new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 });
      const base = `/user/codespaces/${gh.name}`;
      const view = () => new Response(JSON.stringify({ name: gh.name, state: gh.state, repository: { full_name: gh.repo } }), { status: 200 });
      if (init.method === "GET" && u.pathname === base) return view();
      if (init.method === "POST" && u.pathname === `${base}/start`) {
        gh.state = gh.startTo;
        return view();
      }
      return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    },
  };
  return gh;
}

export async function makeEnv(namespace: GatewayEnv["OWNER_QUEUE"], overrides: Partial<GatewayEnv> = {}): Promise<GatewayEnv> {
  return {
    OWNER_QUEUE: namespace,
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
    TELEGRAM_WEBHOOK_PATH: WEBHOOK_PATH,
    TELEGRAM_OWNER_CHAT_ID: String(OWNER),
    GITHUB_WAKE_TOKEN: GITHUB_TOKEN,
    AGENT_TOKEN_SHA256: await sha256Hex(AGENT_TOKEN),
    CODESPACE_NAME: CODESPACE,
    EXPECTED_REPO: REPO,
    ...overrides,
  };
}

export const START = 1_800_000_000_000;

export async function createGateway(input: { ghState?: string; policy?: Partial<GatewayPolicy>; store?: SqliteStorage; env?: Partial<GatewayEnv> } = {}) {
  let now = START;
  const logs: string[] = [];
  const log = (event: string, fields: Record<string, unknown> = {}) => logs.push(JSON.stringify({ event, ...fields }));
  const store = input.store ?? createSqliteStorage();
  const gh = createFakeGitHub(input.ghState ?? "Shutdown");
  const notices: string[] = [];
  const telegramCalls: string[] = [];
  const outbound: FetchFn = async (url, init) => {
    if (url.startsWith("https://api.github.com/")) return gh.handle(url, init);
    if (url.startsWith("https://api.telegram.org/")) {
      const method = url.slice(url.lastIndexOf("/") + 1);
      telegramCalls.push(method);
      const body = JSON.parse(String(init.body)) as { chat_id: number; text: string };
      if (body.chat_id !== OWNER) throw new Error("notice to a non-owner chat");
      notices.push(body.text);
      return new Response(JSON.stringify({ ok: true, result: { message_id: notices.length } }), { status: 200 });
    }
    throw new Error(`unexpected outbound request to ${new URL(url).host}`);
  };
  const namespace: GatewayEnv["OWNER_QUEUE"] = { idFromName: (name) => name, get: () => ({ fetch: (req) => g.queue.fetch(req) }) };
  let env = await makeEnv(namespace, input.env);
  const newQueue = () => new OwnerQueue({ storage: store.storage }, env, { fetch: outbound, now: () => now, log, policy: input.policy });

  const g = {
    store,
    gh,
    notices,
    telegramCalls,
    logs,
    get env() {
      return env;
    },
    queue: undefined as unknown as OwnerQueue,
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
    /** Simulates a Durable Object eviction / Worker redeploy over the same durable storage. */
    restart(overrides: Partial<GatewayEnv> = {}) {
      return makeEnv(namespace, { ...input.env, ...overrides }).then((e) => {
        env = e;
        g.queue = newQueue();
      });
    },
    webhook(update: unknown, opts: { secret?: string | null; path?: string; raw?: string } = {}) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (opts.secret !== null) headers["x-telegram-bot-api-secret-token"] = opts.secret ?? WEBHOOK_SECRET;
      return handleRequest(new Request(`https://gw.example/tg/${opts.path ?? WEBHOOK_PATH}`, { method: "POST", headers, body: opts.raw ?? JSON.stringify(update) }), env, log);
    },
    agentRequest(path: string, token: string | null = AGENT_TOKEN) {
      return handleRequest(new Request(`https://gw.example${path}`, { headers: token === null ? {} : { authorization: `Bearer ${token}` } }), env, log);
    },
    async pull(offset: number | null = null, timeout = 0) {
      const q = new URLSearchParams({ timeout: String(timeout), ...(offset !== null ? { offset: String(offset) } : {}) });
      const res = await g.agentRequest(`/agent/updates?${q}`);
      if (res.status !== 200) throw new Error(`pull failed with ${res.status}`);
      return ((await res.json()) as { result: { update_id: number }[] }).result;
    },
    /** Runs the Durable Object alarm if it is due (as the runtime would). */
    async runAlarm() {
      const at = store.alarm();
      if (at === null || at > now) return false;
      store.clearAlarm();
      await g.queue.alarm();
      return true;
    },
    async runDueAlarms(max = 20) {
      let n = 0;
      while (n < max && (await g.runAlarm())) n++;
      return n;
    },
    /** Advances the clock in steps, running due alarms along the way. */
    async elapse(ms: number, stepMs = 5_000) {
      const end = now + ms;
      while (now < end) {
        now = Math.min(end, now + stepMs);
        await g.runDueAlarms();
      }
    },
  };
  g.queue = newQueue();
  return g;
}
export type Gateway = Awaited<ReturnType<typeof createGateway>>;

let nextUpdateId = 7000;
export function ownerText(text: string, input: { updateId?: number; messageId?: number; chatId?: number; fromId?: number; chatType?: string; isBot?: boolean } = {}) {
  const updateId = input.updateId ?? ++nextUpdateId;
  return {
    update_id: updateId,
    message: {
      message_id: input.messageId ?? updateId + 100,
      date: 1_790_000_000,
      chat: { id: input.chatId ?? OWNER, type: input.chatType ?? "private", first_name: "Owner" },
      from: { id: input.fromId ?? OWNER, is_bot: input.isBot ?? false, first_name: "Owner", language_code: "zh-hant" },
      text,
      entities: [{ type: "bot_command", offset: 0, length: 5 }],
    },
  };
}

export function ownerCallback(data: string, input: { updateId?: number; id?: string; fromId?: number; chatId?: number } = {}) {
  const updateId = input.updateId ?? ++nextUpdateId;
  return {
    update_id: updateId,
    callback_query: {
      id: input.id ?? `cbq-${updateId}`,
      from: { id: input.fromId ?? OWNER, is_bot: false, first_name: "Owner" },
      chat_instance: "-123",
      data,
      message: { message_id: 55, chat: { id: input.chatId ?? OWNER, type: "private" }, text: "notice" },
    },
  };
}
