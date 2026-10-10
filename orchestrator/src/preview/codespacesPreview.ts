import type { PreviewPort, PreviewResult } from "../delivery/types";
import type { ProcessRunner } from "../workers/types";

/**
 * Codespaces live preview of the CURRENT workspace (UI tasks, before publish approval).
 *
 * - Uses the repository's own dev server (package.json "dev" script and the PORT it declares); never a
 *   separate preview app. The server already binds 0.0.0.0.
 * - One server per workspace: an already-listening dev server on that port is reused, never doubled.
 * - The child runs detached with a SCRUBBED environment (allowlist): no GitHub/Telegram/Render/Agent
 *   tokens, no production credentials; a DATABASE_URL is passed only when it points at loopback, and a
 *   repo .env that points the app at a non-loopback database refuses the preview.
 * - The HTTPS URL is read from the Codespaces port record (`gh codespace ports --json`), never
 *   constructed, and is validated against this Codespace's own forwarding host. Visibility stays
 *   least-privilege (private: the Owner opens it signed in to GitHub, phone or desktop); this controller
 *   never makes a port public.
 * - Lifecycle: the controller owns the process it started (pid file in the state directory) and stops it
 *   on release; a stopped Codespace ends it naturally. A restarted runtime re-validates and reuses or
 *   rebuilds it.
 * - Preview is not a deployment and carries no production or deploy authority.
 */
export interface PreviewControllerDeps {
  runner: ProcessRunner;
  repoRoot: string;
  codespaceName: string;
  /** GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN (e.g. app.github.dev). */
  forwardingDomain: string;
  /** The parent environment; only allowlisted names are passed on. */
  env: Readonly<Record<string, string | undefined>>;
  readTextFile(path: string): string | null;
  /** Starts a detached process group writing to `logPath`; returns its pid. */
  spawnDetached(spec: { command: string; args: string[]; cwd: string; env: Record<string, string>; logPath: string }): number;
  isAlive(pid: number): boolean;
  /** Terminates the process group of `pid`. */
  killGroup(pid: number): void;
  /** Loopback HTTP status (null: not listening / unreachable). */
  probe(url: string): Promise<number | null>;
  sleep(ms: number): Promise<void>;
  /** Persisted ownership of the started server (pid file). */
  ownership: { load(): { pid: number; port: number; taskId: string } | null; save(v: { pid: number; port: number; taskId: string } | null): void };
  logPath: string;
  startTimeoutMs?: number;
  forwardTimeoutMs?: number;
}

const ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TERM",
  "TMPDIR",
  "TZ",
  "PNPM_HOME",
  "COREPACK_HOME",
  "NVM_DIR",
  "NVM_BIN",
  "CODESPACES",
  "CODESPACE_NAME",
  "GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN",
] as const;

const isLoopbackDbUrl = (url: string) => {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
};

/** The repository's own dev command and port (fail closed when the port cannot be read). */
export function detectDevServer(packageJson: string | null): { ok: true; command: string; args: string[]; port: number } | { ok: false; reason: string } {
  if (!packageJson) return { ok: false, reason: "package_json_unreadable" };
  let pkg: { scripts?: Record<string, unknown>; packageManager?: unknown };
  try {
    pkg = JSON.parse(packageJson);
  } catch {
    return { ok: false, reason: "package_json_malformed" };
  }
  const dev = pkg.scripts?.dev;
  if (typeof dev !== "string" || !dev.trim()) return { ok: false, reason: "dev_script_missing" };
  const port = /\bPORT=(\d{2,5})\b/.exec(dev)?.[1];
  if (!port || Number(port) < 1024 || Number(port) > 65535) return { ok: false, reason: "dev_port_undetected" };
  const manager = typeof pkg.packageManager === "string" && pkg.packageManager.startsWith("pnpm@") ? "pnpm" : "npm";
  return { ok: true, command: manager, args: manager === "pnpm" ? ["dev"] : ["run", "dev"], port: Number(port) };
}

/** A repo .env that would point the preview at a non-loopback database (or production mode) refuses it. */
export function envFileRisk(dotenv: string | null): string | null {
  if (!dotenv) return null;
  for (const raw of dotenv.split(/\r?\n/)) {
    const line = raw.trim();
    const m = /^(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (m[1] === "DATABASE_URL" && value && !isLoopbackDbUrl(value)) return "env_file_uses_remote_database";
    if (m[1] === "NODE_ENV" && value === "production") return "env_file_sets_production";
  }
  return null;
}

/** Allowlisted child environment for the preview dev server. */
export function previewEnvironment(env: Readonly<Record<string, string | undefined>>, port: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ENV_ALLOWLIST) {
    const v = env[name];
    if (typeof v === "string" && v) out[name] = v;
  }
  const db = env.DATABASE_URL;
  if (db && isLoopbackDbUrl(db)) out.DATABASE_URL = db;
  out.NODE_ENV = "development";
  out.PORT = String(port);
  return out;
}

const unavailable = (reason: string): PreviewResult => ({ status: "unavailable", url: null, port: null, visibility: null, access: null, reason, reused: false });

export function createCodespacesPreviewController(deps: PreviewControllerDeps): PreviewPort {
  const startTimeoutMs = deps.startTimeoutMs ?? 180_000;
  const forwardTimeoutMs = deps.forwardTimeoutMs ?? 30_000;
  const name = deps.codespaceName;
  const validName = /^[a-z0-9][a-z0-9-]{2,100}$/.test(name);
  const validDomain = /^[a-z0-9.-]{3,100}$/.test(deps.forwardingDomain);
  let inFlight: Promise<PreviewResult> | null = null;

  async function forwardedUrl(port: number): Promise<{ url: string; visibility: PreviewResult["visibility"] } | null> {
    const read = async () => {
      const res = await deps.runner.spawn({ command: "gh", args: ["codespace", "ports", "-c", name, "--json", "sourcePort,browseUrl,visibility"], cwd: deps.repoRoot }).exit;
      if (res.exitCode !== 0 || res.truncated) return null;
      let rows: unknown;
      try {
        rows = JSON.parse(res.stdout);
      } catch {
        return null;
      }
      if (!Array.isArray(rows)) return null;
      const row = rows.find((r) => (r as { sourcePort?: unknown })?.sourcePort === port) as { browseUrl?: unknown; visibility?: unknown } | undefined;
      if (!row || typeof row.browseUrl !== "string") return null;
      // Trust check (never construction): https, exactly this Codespace's forwarding host for this port.
      let u: URL;
      try {
        u = new URL(row.browseUrl);
      } catch {
        return null;
      }
      if (u.protocol !== "https:" || u.host !== `${name}-${port}.${deps.forwardingDomain}` || u.username || u.password) return null;
      const visibility: PreviewResult["visibility"] = row.visibility === "public" || row.visibility === "org" || row.visibility === "private" ? row.visibility : null;
      return { url: `${u.origin}/`, visibility };
    };
    let found = await read();
    if (found) return found;
    // Not auto-forwarded yet: ask Codespaces to forward it at the least-privilege visibility.
    await deps.runner.spawn({ command: "gh", args: ["codespace", "ports", "visibility", `${port}:private`, "-c", name], cwd: deps.repoRoot }).exit.catch(() => null);
    const deadline = Date.now() + forwardTimeoutMs;
    while (!found && Date.now() < deadline) {
      await deps.sleep(2_000);
      found = await read();
    }
    return found;
  }

  async function ensureOnce(taskId: string): Promise<PreviewResult> {
    if (!validName || !validDomain) return unavailable("not_in_codespace");
    const dev = detectDevServer(deps.readTextFile(`${deps.repoRoot}/package.json`));
    if (!dev.ok) return unavailable(dev.reason);
    const risk = envFileRisk(deps.readTextFile(`${deps.repoRoot}/.env`));
    if (risk) return unavailable(risk);
    const local = `http://127.0.0.1:${dev.port}/`;
    let reused = false;
    const owned = deps.ownership.load();
    if ((await deps.probe(local)) !== null) {
      reused = true; // a dev server already serves this workspace: never start a second one
    } else {
      if (owned && deps.isAlive(owned.pid)) deps.killGroup(owned.pid); // a stale, non-serving server we started
      let pid: number;
      try {
        pid = deps.spawnDetached({ command: dev.command, args: dev.args, cwd: deps.repoRoot, env: previewEnvironment(deps.env, dev.port), logPath: deps.logPath });
      } catch {
        return unavailable("dev_server_spawn_failed");
      }
      deps.ownership.save({ pid, port: dev.port, taskId });
      const deadline = Date.now() + startTimeoutMs;
      let status: number | null = null;
      while (status === null && Date.now() < deadline) {
        if (!deps.isAlive(pid)) {
          deps.ownership.save(null);
          return unavailable("dev_server_exited");
        }
        await deps.sleep(1_500);
        status = await deps.probe(local);
      }
      if (status === null) {
        deps.killGroup(pid);
        deps.ownership.save(null);
        return unavailable("dev_server_start_timeout");
      }
    }
    if (reused && owned && owned.port === dev.port) deps.ownership.save({ ...owned, taskId });
    const forwarded = await forwardedUrl(dev.port);
    if (!forwarded) return { ...unavailable("forwarded_url_unavailable"), port: dev.port, reused };
    return { status: "ready", url: forwarded.url, port: dev.port, visibility: forwarded.visibility, access: forwarded.visibility === "public" ? "public" : "github_sign_in", reason: null, reused };
  }

  return {
    ensure({ taskId }) {
      // Concurrent requests share one start (never two servers).
      if (!inFlight) inFlight = ensureOnce(taskId).catch(() => unavailable("preview_failed")).finally(() => (inFlight = null));
      return inFlight;
    },
    async release(taskId) {
      const owned = deps.ownership.load();
      if (!owned || owned.taskId !== taskId) return;
      if (deps.isAlive(owned.pid)) deps.killGroup(owned.pid);
      deps.ownership.save(null);
    },
  };
}
