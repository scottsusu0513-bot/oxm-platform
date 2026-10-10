import { consoleLog, DEFAULT_POLICY, loadGatewayConfig, type GatewayPolicy } from "./config";
import { createCodespaceWakeClient, type CodespaceWakeClient, type GitHubFailureKind, type GitHubResult } from "./github";
import { createOwnerNotifier, ONLINE_TRANSPORT_STATUS, projectUpdate, transportStatus, type OwnerNotifier, type TransportStatus, type WakeFailureReason } from "./telegram";
import type { DurableObjectStateLike, FetchFn, GatewayEnv, GatewayLog, ProjectedKind, ProjectedUpdate, SqlStorageLike } from "./types";

/**
 * OwnerQueue: the single durable queue of owner Telegram updates plus the
 * Codespace wake state machine.
 *
 * Queue: at-least-once transport. An update is committed (SQLite) before the
 * webhook is acknowledged. Each update gets a Gateway sequence number `seq`
 * (served to the Agent as update_id): normally equal to Telegram's update_id, but
 * never lower than the previous one, because Telegram may restart update ids at a
 * random (possibly lower) value after a week without updates. Telegram retries
 * are de-duplicated by Telegram's own update_id (`seen` table). The Agent pulls
 * with getUpdates semantics (`offset` confirms everything below it, monotonic,
 * and only what was already delivered) and consumes idempotently through its
 * existing ledger cursor + idempotency keys.
 *
 * Wake: at most one wake cycle at a time; a global cooldown, a per-cycle start
 * cap and a rolling daily cap bound start requests; non-retryable failures
 * (credential, repo binding, deleted Codespace...) block further attempts until
 * the binding changes or the block expires. It never interprets message content.
 */
const DAY_MS = 24 * 60 * 60_000;

export type WakeLastFailure = WakeFailureReason | "agent_offline";
export interface WakeState {
  phase: "idle" | "waking" | "failed";
  cycle: number;
  deadlineAt: number | null;
  nextActionAt: number | null;
  retries: number;
  startsThisCycle: number;
  lastStartAt: number | null;
  startHistory: number[];
  failedAt: number | null;
  lastFailure: WakeLastFailure | null;
  blockedUntil: number | null;
  blockFingerprint: string | null;
  failureNotified: boolean;
}

const INITIAL_WAKE: WakeState = Object.freeze({
  phase: "idle",
  cycle: 0,
  deadlineAt: null,
  nextActionAt: null,
  retries: 0,
  startsThisCycle: 0,
  lastStartAt: null,
  startHistory: [],
  failedAt: null,
  lastFailure: null,
  blockedUntil: null,
  blockFingerprint: null,
  failureNotified: false,
}) as WakeState;

export interface OwnerQueuePorts {
  storage: { sql: SqlStorageLike; transactionSync<T>(fn: () => T): T };
  github: CodespaceWakeClient;
  notifier: OwnerNotifier;
  log: GatewayLog;
  now: () => number;
  wakeBindingFingerprint: string;
  policy?: Partial<GatewayPolicy>;
}

export type EnqueueStatus = "enqueued" | "duplicate" | "queue_full";

export interface OwnerQueueCore {
  enqueue(update: ProjectedUpdate, kind: ProjectedKind): { status: EnqueueStatus; alarmAt: number | null };
  /** getUpdates semantics: `offset` acknowledges every update below it; returns the rest in update_id order. */
  pull(offset: number | null): ProjectedUpdate[];
  /** Agent liveness while it is busy handling an update (no pull for longer than the online window). */
  heartbeat(): void;
  tick(): Promise<{ nextAlarmAt: number | null }>;
  nextAlarmAt(): number | null;
  pendingCount(): number;
  ackedCursor(): number;
  agentOnline(): boolean;
  wakeState(): WakeState;
}

const NON_RETRYABLE: Partial<Record<GitHubFailureKind, WakeFailureReason>> = {
  credential: "credential",
  billing: "billing",
  not_found: "not_found",
  repo_mismatch: "repo_mismatch",
  rejected: "rejected",
  malformed: "malformed",
};

export function createOwnerQueueCore(ports: OwnerQueuePorts): OwnerQueueCore {
  const policy: GatewayPolicy = { ...DEFAULT_POLICY, ...ports.policy };
  const { sql } = ports.storage;
  sql.exec(
    "CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY, telegram_update_id INTEGER NOT NULL UNIQUE, kind TEXT NOT NULL, payload TEXT NOT NULL, received_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, delivery_state TEXT NOT NULL DEFAULT 'pending', delivery_count INTEGER NOT NULL DEFAULT 0, last_delivered_at INTEGER)",
  );
  sql.exec("CREATE INDEX IF NOT EXISTS updates_expires_at ON updates (expires_at)");
  sql.exec("CREATE TABLE IF NOT EXISTS seen (telegram_update_id INTEGER PRIMARY KEY, seen_at INTEGER NOT NULL)");
  sql.exec("CREATE INDEX IF NOT EXISTS seen_seen_at ON seen (seen_at)");
  sql.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  // Which transport_status the owner already received while this update waited: served with the update
  // as context for the Manager (never content, never a reply).
  sql.exec("CREATE TABLE IF NOT EXISTS transport_context (seq INTEGER NOT NULL, status TEXT NOT NULL, PRIMARY KEY (seq, status))");

  const getMeta = (key: string): string | null => {
    const row = sql.exec("SELECT value FROM meta WHERE key = ?", key).toArray()[0];
    return row ? String(row.value) : null;
  };
  const setMeta = (key: string, value: string | number) =>
    sql.exec("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, String(value));
  const num = (key: string): number | null => {
    const v = getMeta(key);
    return v === null || !Number.isFinite(Number(v)) ? null : Number(v);
  };
  const scalar = (query: string, ...bindings: (number | string)[]) => sql.exec(query, ...bindings).toArray()[0];
  const count = () => Number(scalar("SELECT COUNT(*) AS n FROM updates")?.n ?? 0);
  const acked = () => num("acked_cursor") ?? 0;
  const isOnline = (now: number) => {
    const last = num("last_agent_seen_at");
    return last !== null && now - last < policy.onlineWindowMs;
  };
  const loadWake = (): WakeState => {
    const raw = getMeta("wake");
    if (!raw) return structuredClone(INITIAL_WAKE);
    try {
      return { ...structuredClone(INITIAL_WAKE), ...(JSON.parse(raw) as Partial<WakeState>) };
    } catch {
      return structuredClone(INITIAL_WAKE);
    }
  };
  const saveWake = (s: WakeState) => setMeta("wake", JSON.stringify(s));
  /**
   * Transport status only, and never while the Agent is online (then the Manager is the only voice),
   * except an allowlisted online status (queue_full). Every queued update the status was about is tagged,
   * so the Manager knows what the owner was already told.
   */
  const notify = async (status: TransportStatus): Promise<boolean> => {
    if (isOnline(ports.now()) && !ONLINE_TRANSPORT_STATUS.has(status.status)) {
      ports.log("transport_status_suppressed_online", { status: status.status });
      return false;
    }
    let sent = false;
    try {
      sent = await ports.notifier.send(status);
    } catch {
      ports.log("notice_failed");
    }
    if (sent) {
      ports.log("transport_status_sent", { status: status.status, voice: "system_status" });
      if (status.status !== "queue_full" && status.status !== "expired") sql.exec("INSERT OR IGNORE INTO transport_context (seq, status) SELECT seq, ? FROM updates", status.status);
    }
    return sent;
  };
  const pruneContext = () => sql.exec("DELETE FROM transport_context WHERE seq NOT IN (SELECT seq FROM updates)");

  function expire(now: number) {
    const n = Number(scalar("SELECT COUNT(*) AS n FROM updates WHERE expires_at <= ?", now)?.n ?? 0);
    if (n === 0) return;
    sql.exec("DELETE FROM updates WHERE expires_at <= ?", now);
    pruneContext();
    setMeta("expired_unnotified", (num("expired_unnotified") ?? 0) + n);
    ports.log("expired", { count: n });
  }

  /** A fail-closed block holds only until it expires or the wake binding (PAT / Codespace / repo) changes. */
  const blockActive = (s: WakeState, now: number) => s.blockedUntil !== null && now < s.blockedUntil && s.blockFingerprint === ports.wakeBindingFingerprint;

  function computeNextAlarm(now: number, s: WakeState): number | null {
    const at: number[] = [];
    const earliest = scalar("SELECT MIN(expires_at) AS t FROM updates")?.t;
    if (typeof earliest === "number") at.push(earliest);
    if (s.phase === "waking" && s.nextActionAt !== null) at.push(s.nextActionAt);
    if (s.blockedUntil !== null) at.push(s.blockedUntil);
    if (count() > 0) {
      const last = num("last_agent_seen_at");
      // Online: a watchdog that notices the Agent disappearing with work pending. Offline + idle: wake now.
      if (last !== null && isOnline(now)) at.push(last + policy.onlineWindowMs + 1_000);
      else if (!blockActive(s, now) && (s.phase === "idle" || s.blockedUntil !== null || (s.phase === "failed" && (num("last_enqueue_at") ?? 0) > (s.failedAt ?? 0)))) at.push(now);
    }
    if ((num("expired_unnotified") ?? 0) > 0 || (num("rejected_unnotified") ?? 0) > 0) at.push(Math.max(now, (num("ops_notice_at") ?? -Infinity) + policy.noticeIntervalMs));
    return at.length ? Math.min(...at) : null;
  }

  function toIdle(s: WakeState): WakeState {
    return { ...s, phase: "idle", deadlineAt: null, nextActionAt: null, retries: 0, startsThisCycle: 0, failedAt: null, failureNotified: false };
  }

  async function fail(s: WakeState, now: number, reason: WakeLastFailure, block: boolean, blockUntil?: number): Promise<WakeState> {
    s.phase = "failed";
    s.failedAt = now;
    s.lastFailure = reason;
    s.nextActionAt = null;
    if (block) {
      s.blockedUntil = blockUntil ?? now + policy.blockMs;
      s.blockFingerprint = ports.wakeBindingFingerprint;
    }
    ports.log("wake_failed", { reason, blocked: block, cycle: s.cycle });
    if (!s.failureNotified) {
      s.failureNotified = true;
      saveWake(s); // at most one failure notice per cycle, even across a crash
      await notify(
        reason === "agent_offline"
          ? transportStatus("agent_offline", { minutes: Math.round(policy.agentTimeoutMs / 60_000) })
          : transportStatus("wake_failed", { reason, blocked: block }),
      );
    }
    return s;
  }

  async function onGitHubFailure(s: WakeState, now: number, r: Extract<GitHubResult, { ok: false }>): Promise<WakeState> {
    ports.log("github_failure", { kind: r.kind, status: r.status ?? 0, retryable: r.retryable });
    if (!r.retryable) return fail(s, now, NON_RETRYABLE[r.kind] ?? "rejected", true);
    s.retries += 1;
    if (s.retries > policy.maxRetries) return fail(s, now, "github_unavailable", false);
    const backoff = Math.min(policy.backoffCapMs, policy.backoffBaseMs * 2 ** (s.retries - 1));
    s.nextActionAt = now + Math.max(backoff, r.retryAfterMs ?? 0);
    return s;
  }

  async function step(s: WakeState, now: number): Promise<WakeState> {
    const observed = await ports.github.status();
    if (!observed.ok) return onGitHubFailure(s, now, observed);
    s.retries = 0;
    const { runtime, state } = observed.value;
    ports.log("codespace_status", { state, runtime, cycle: s.cycle });
    if (runtime === "terminal") return fail(s, now, "terminal_state", true);
    if (runtime === "running" || runtime === "transitional") {
      // Never start a running / starting Codespace: wait for the Agent until the cycle deadline.
      if (now >= (s.deadlineAt ?? now)) return fail(s, now, runtime === "running" ? "agent_offline" : "start_timeout", false);
      s.nextActionAt = Math.min(s.deadlineAt!, now + policy.pollMs);
      return s;
    }
    if (s.startsThisCycle >= policy.maxStartsPerCycle) return fail(s, now, "start_exhausted", false);
    const cooldownEnd = s.lastStartAt === null ? -Infinity : s.lastStartAt + policy.cooldownMs;
    if (now < cooldownEnd) {
      s.nextActionAt = cooldownEnd;
      return s;
    }
    s.startHistory = s.startHistory.filter((t) => now - t < DAY_MS);
    if (s.startHistory.length >= policy.dailyStartCap) return fail(s, now, "daily_cap", true, s.startHistory[0] + DAY_MS);
    s.lastStartAt = now;
    s.startsThisCycle += 1;
    s.startHistory.push(now);
    s.deadlineAt = now + policy.agentTimeoutMs;
    s.nextActionAt = now + policy.pollMs;
    saveWake(s); // intent precedes the API mutation: a crash here cannot cause a second immediate start
    ports.log("codespace_start_requested", { cycle: s.cycle, attempt: s.startsThisCycle });
    const started = await ports.github.start();
    if (!started.ok) return onGitHubFailure(s, now, started);
    ports.log("codespace_start_accepted", { state: started.value.state, cycle: s.cycle });
    return s;
  }

  async function opsNotices(now: number) {
    // Expiry is reported only while the Agent is offline; an online Agent's Manager is the only voice.
    const expired = isOnline(now) ? 0 : (num("expired_unnotified") ?? 0);
    const rejected = num("rejected_unnotified") ?? 0;
    if (expired === 0 && rejected === 0) return;
    const last = num("ops_notice_at");
    if (last !== null && now - last < policy.noticeIntervalMs) return;
    ports.storage.transactionSync(() => {
      setMeta("ops_notice_at", now);
      if (expired > 0) setMeta("expired_unnotified", 0);
      setMeta("rejected_unnotified", 0);
    });
    // queue_full: once per overflow episode; the next accepted message carries it as Manager context.
    if (rejected > 0 && (await notify(transportStatus("queue_full")))) setMeta("queue_full_context_pending", 1);
    if (expired > 0) await notify(transportStatus("expired", { pending: expired }));
  }

  async function tickOnce(): Promise<{ nextAlarmAt: number | null }> {
    const now = ports.now();
    ports.storage.transactionSync(() => expire(now));
    await opsNotices(now);
    let s = loadWake();
    const done = () => {
      saveWake(s);
      return { nextAlarmAt: computeNextAlarm(now, s) };
    };
    if (s.blockedUntil !== null && !blockActive(s, now)) {
      ports.log("wake_block_lifted", { cycle: s.cycle });
      s = toIdle({ ...s, blockedUntil: null, blockFingerprint: null });
    }
    const pending = count();
    if (isOnline(now) || pending === 0) {
      if (s.phase !== "idle") s = toIdle(s);
      return done();
    }
    if (s.blockedUntil !== null) return done(); // fail closed: no start, no repeated notices
    if (s.phase === "failed") {
      // A failed cycle is retried only for a NEW owner message (bounded by cooldown / daily cap).
      if ((num("last_enqueue_at") ?? 0) <= (s.failedAt ?? 0)) return done();
      s = toIdle(s);
    }
    if (s.phase === "idle") {
      s = { ...toIdle(s), phase: "waking", cycle: s.cycle + 1, deadlineAt: now + policy.agentTimeoutMs };
      saveWake(s);
      ports.log("wake_cycle_started", { cycle: s.cycle, pending });
      await notify(transportStatus("waking", { pending }));
    }
    if (s.nextActionAt !== null && now < s.nextActionAt) return done(); // same cycle: no extra GitHub calls
    s = await step(s, now);
    return done();
  }

  let serial: Promise<unknown> = Promise.resolve();
  return {
    enqueue(update, kind) {
      const now = ports.now();
      const telegramId = update.update_id;
      let seq = telegramId;
      const status = ports.storage.transactionSync((): EnqueueStatus => {
        expire(now);
        sql.exec("DELETE FROM seen WHERE seen_at <= ?", now - policy.seenRetentionMs);
        if (sql.exec("SELECT telegram_update_id FROM seen WHERE telegram_update_id = ?", telegramId).toArray().length > 0) return "duplicate";
        if (count() >= policy.queueCap) {
          // One notice per overflow episode (until a message is accepted again), never one per dropped message.
          if (!num("queue_full_episode")) {
            setMeta("queue_full_episode", 1);
            setMeta("rejected_unnotified", 1);
          }
          return "queue_full";
        }
        seq = Math.max((num("last_seq") ?? 0) + 1, telegramId);
        sql.exec(
          "INSERT INTO updates (seq, telegram_update_id, kind, payload, received_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
          seq,
          telegramId,
          kind,
          JSON.stringify({ ...update, update_id: seq }),
          now,
          now + policy.ttlMs,
        );
        sql.exec("INSERT INTO seen (telegram_update_id, seen_at) VALUES (?, ?)", telegramId, now);
        setMeta("last_seq", seq);
        setMeta("last_enqueue_at", now);
        if (num("queue_full_episode")) setMeta("queue_full_episode", 0);
        if (num("queue_full_context_pending")) {
          sql.exec("INSERT OR IGNORE INTO transport_context (seq, status) VALUES (?, 'queue_full')", seq);
          setMeta("queue_full_context_pending", 0);
        }
        return "enqueued";
      });
      ports.log(`webhook_${status}`, { update_id: telegramId, kind, ...(status === "enqueued" && seq !== telegramId ? { rebased_seq: seq } : {}) });
      return { status, alarmAt: computeNextAlarm(now, loadWake()) };
    },
    pull(offset) {
      const now = ports.now();
      const rows = ports.storage.transactionSync(() => {
        expire(now);
        if (offset !== null) {
          // Monotonic, and only for updates already delivered to the Agent: an offset can never
          // confirm an update the Agent has not seen (no pre-acknowledging of queued or future updates).
          const maxDelivered = num("max_delivered");
          const next = Math.max(acked(), maxDelivered === null ? 0 : Math.min(offset, maxDelivered + 1));
          if (next > acked()) {
            sql.exec("DELETE FROM updates WHERE seq < ?", next);
            pruneContext();
            setMeta("acked_cursor", next);
            ports.log("acked", { cursor: next });
          }
        }
        setMeta("last_agent_seen_at", now);
        const selected = sql.exec("SELECT seq, payload FROM updates WHERE seq >= ? ORDER BY seq ASC LIMIT ?", acked(), policy.pullLimit).toArray();
        if (selected.length > 0) {
          setMeta("max_delivered", Math.max(num("max_delivered") ?? 0, Number(selected[selected.length - 1].seq)));
          sql.exec(
            "UPDATE updates SET delivery_state = 'delivered', delivery_count = delivery_count + 1, last_delivered_at = ? WHERE seq >= ? AND seq <= ?",
            now,
            Number(selected[0].seq),
            Number(selected[selected.length - 1].seq),
          );
        }
        return selected;
      });
      ports.log("pulled", { count: rows.length });
      return rows.map((r) => {
        const update = JSON.parse(String(r.payload)) as ProjectedUpdate;
        const told = sql.exec("SELECT status FROM transport_context WHERE seq = ? ORDER BY status", Number(r.seq)).toArray().map((c) => String(c.status));
        return told.length ? { ...update, oxm_transport_status: told } : update;
      });
    },
    heartbeat() {
      setMeta("last_agent_seen_at", ports.now());
    },
    tick() {
      const run = serial.then(tickOnce);
      serial = run.catch(() => undefined);
      return run;
    },
    nextAlarmAt: () => computeNextAlarm(ports.now(), loadWake()),
    pendingCount: count,
    ackedCursor: acked,
    agentOnline: () => isOnline(ports.now()),
    wakeState: loadWake,
  };
}

export interface OwnerQueueDeps {
  fetch?: FetchFn;
  now?: () => number;
  log?: GatewayLog;
  policy?: Partial<GatewayPolicy>;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** The Durable Object. Reachable only through the Worker (index.ts), which authenticates every caller. */
export class OwnerQueue {
  private ready: Promise<{ core: OwnerQueueCore; ownerChatId: number; policy: GatewayPolicy } | null> | null = null;
  private readonly waiters = new Set<() => void>();

  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly env: GatewayEnv,
    private readonly deps: OwnerQueueDeps = {},
  ) {}

  private init() {
    this.ready ??= loadGatewayConfig(this.env).then((loaded) => {
      const log = this.deps.log ?? consoleLog;
      if (!loaded.ok) {
        log("config_invalid");
        this.ready = null;
        return null;
      }
      const c = loaded.config;
      const doFetch: FetchFn = this.deps.fetch ?? ((url, init) => fetch(url, init));
      const policy = { ...DEFAULT_POLICY, ...this.deps.policy };
      const core = createOwnerQueueCore({
        storage: this.state.storage,
        github: createCodespaceWakeClient({ token: c.githubToken, codespaceName: c.codespaceName, expectedRepo: c.expectedRepo, fetch: doFetch }),
        notifier: createOwnerNotifier({ botToken: c.botToken, ownerChatId: c.ownerChatId, fetch: doFetch, log }),
        log,
        now: this.deps.now ?? Date.now,
        wakeBindingFingerprint: c.wakeBindingFingerprint,
        policy,
      });
      return { core, ownerChatId: c.ownerChatId, policy };
    });
    return this.ready;
  }

  private async schedule(at: number | null) {
    if (at === null) return;
    const current = await this.state.storage.getAlarm();
    if (current === null || at < current) await this.state.storage.setAlarm(at);
  }

  private waitForUpdate(ms: number) {
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.waiters.add(done);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const ready = await this.init();
    if (!ready) return new Response(null, { status: 503 });
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/enqueue") {
        // Defense in depth: re-project even though the Worker already did.
        const projection = projectUpdate(await request.json(), ready.ownerChatId);
        if (projection.kind !== "accepted") return json({ status: "ignored" });
        const result = ready.core.enqueue(projection.update, projection.updateKind);
        if (result.status === "enqueued") for (const w of Array.from(this.waiters)) w();
        await this.schedule(result.alarmAt);
        return json({ status: result.status });
      }
      if (request.method === "POST" && url.pathname === "/heartbeat") {
        ready.core.heartbeat();
        return json({ ok: true });
      }
      if (request.method === "GET" && url.pathname === "/pull") {
        const rawOffset = url.searchParams.get("offset");
        const offset = rawOffset === null ? null : Number(rawOffset);
        if (offset !== null && (!Number.isSafeInteger(offset) || offset < 0)) return json({ ok: false }, 400);
        const timeoutSeconds = Number(url.searchParams.get("timeout") ?? "0");
        const waitMs = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? Math.min(Math.floor(timeoutSeconds) * 1000, ready.policy.longPollMaxMs) : 0;
        let result = ready.core.pull(offset);
        if (result.length === 0 && waitMs > 0) {
          await this.waitForUpdate(waitMs);
          result = ready.core.pull(offset);
        }
        await this.schedule(ready.core.nextAlarmAt());
        return json({ ok: true, result });
      }
      return new Response(null, { status: 404 });
    } catch {
      (this.deps.log ?? consoleLog)("queue_request_failed");
      return new Response(null, { status: 500 });
    }
  }

  async alarm(): Promise<void> {
    const ready = await this.init();
    if (!ready) return; // invalid / removed configuration: the Gateway goes quiet (also the rollback kill switch)
    let next: number | null;
    try {
      await ready.core.tick();
      // Recomputed after the tick, so an alarm requested by a concurrent enqueue is never overwritten by a later one.
      next = ready.core.nextAlarmAt();
    } catch {
      (this.deps.log ?? consoleLog)("alarm_failed");
      next = (this.deps.now ?? Date.now)() + ready.policy.pollMs; // never strand a waking cycle without an alarm
    }
    if (next !== null) await this.state.storage.setAlarm(next);
  }
}
