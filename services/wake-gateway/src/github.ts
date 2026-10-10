import { CODESPACE_NAME, REPO } from "./config";
import type { FetchFn } from "./types";

/**
 * GitHub Codespaces client bound to ONE configured Codespace. It can only read
 * that Codespace's state and request a start; there is no create, delete, stop
 * or arbitrary-name path. Every response is checked against the expected repo.
 */
export type CodespaceRuntime = "running" | "transitional" | "startable" | "terminal";
export type GitHubFailureKind = "credential" | "billing" | "not_found" | "repo_mismatch" | "conflict" | "rejected" | "rate_limited" | "transient" | "malformed";

export interface CodespaceStatus {
  state: string;
  runtime: CodespaceRuntime;
}
export type GitHubResult =
  | { ok: true; value: CodespaceStatus }
  | { ok: false; kind: GitHubFailureKind; retryable: boolean; retryAfterMs?: number; status?: number };

export interface CodespaceWakeClient {
  status(): Promise<GitHubResult>;
  start(): Promise<GitHubResult>;
}

const RUNNING = new Set(["Available"]);
const TRANSITIONAL = new Set(["Queued", "Provisioning", "Awaiting", "Starting", "ShuttingDown", "Created", "Exporting", "Updating", "Rebuilding", "Unknown"]);
/** Only a Codespace that is down / unusable for the runtime is ever started. */
const STARTABLE = new Set(["Shutdown", "Failed", "Unavailable"]);

export function classifyCodespaceState(state: string): CodespaceRuntime {
  if (RUNNING.has(state)) return "running";
  if (TRANSITIONAL.has(state)) return "transitional";
  if (STARTABLE.has(state)) return "startable";
  return "terminal"; // Deleted, Archived, Moved, anything unrecognised: fail closed
}

const MAX_BODY = 512 * 1024;

export function createCodespaceWakeClient(input: { token: string; codespaceName: string; expectedRepo: string; fetch: FetchFn; apiBase?: string; timeoutMs?: number }): CodespaceWakeClient {
  if (!CODESPACE_NAME.test(input.codespaceName)) throw new Error("[wake-gateway] invalid configured codespace name");
  if (!REPO.test(input.expectedRepo)) throw new Error("[wake-gateway] invalid expected repository");
  const url = `${input.apiBase ?? "https://api.github.com"}/user/codespaces/${encodeURIComponent(input.codespaceName)}`;
  const expectedRepo = input.expectedRepo.toLowerCase();

  async function call(method: "GET" | "POST", suffix: "" | "/start"): Promise<GitHubResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 15_000);
    let status: number;
    let headers: Headers;
    let body: string;
    try {
      const res = await input.fetch(url + suffix, {
        method,
        headers: {
          authorization: `Bearer ${input.token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "oxm-wake-gateway",
        },
        // Never follow a redirect: the Authorization header must only ever reach api.github.com.
        redirect: "manual",
        signal: controller.signal,
      });
      status = res.status;
      headers = res.headers;
      body = await res.text();
    } catch {
      return { ok: false, kind: "transient", retryable: true }; // never forward the error (it may carry request details)
    } finally {
      clearTimeout(timer);
    }
    const retryAfter = Number(headers.get("retry-after"));
    const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 3600) * 1000 : undefined;
    const fail = (kind: GitHubFailureKind, retryable: boolean): GitHubResult => ({ ok: false, kind, retryable, status, ...(retryAfterMs ? { retryAfterMs } : {}) });

    if (status === 401) return fail("credential", false);
    if (status === 403) return headers.get("x-ratelimit-remaining") === "0" || retryAfterMs ? fail("rate_limited", true) : fail("credential", false);
    if (status === 402) return fail("billing", false);
    if (status === 404) return fail("not_found", false);
    if (status === 409) return fail("conflict", true); // Codespace mid-transition
    if (status === 429) return fail("rate_limited", true);
    if (status >= 500) return fail("transient", true);
    // 304 on start = already starting / started (documented "Not modified"); the next status read decides.
    if (status === 304) return suffix === "/start" ? { ok: true, value: { state: "Unknown", runtime: "transitional" } } : fail("transient", true);
    if (status < 200 || status >= 300) return fail("rejected", false); // 400/422/3xx redirect/...: not recoverable by retrying

    if (body.length > MAX_BODY) return fail("malformed", false);
    let raw: { name?: unknown; state?: unknown; repository?: { full_name?: unknown } };
    try {
      raw = JSON.parse(body);
    } catch {
      // An accepted start without a readable body: the next status read decides.
      return suffix === "/start" ? { ok: true, value: { state: "Unknown", runtime: "transitional" } } : fail("malformed", false);
    }
    if (!raw || typeof raw !== "object" || typeof raw.state !== "string") return fail("malformed", false);
    if (raw.name !== input.codespaceName || String(raw.repository?.full_name ?? "").toLowerCase() !== expectedRepo) return fail("repo_mismatch", false);
    const state = raw.state.replace(/[^A-Za-z]/g, "").slice(0, 32);
    return { ok: true, value: { state, runtime: classifyCodespaceState(state) } };
  }

  return Object.freeze({
    status: () => call("GET", ""),
    start: () => call("POST", "/start"),
  });
}
