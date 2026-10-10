import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProcessRunner, ProcessSpec } from "../workers/types";
import { createCodespacesPreviewController, detectDevServer, envFileRisk, previewEnvironment, type PreviewControllerDeps } from "./codespacesPreview";

const NAME = "orange-space-doodle-97pp7p5q6jpjfrxw";
const DOMAIN = "app.github.dev";
const PKG = readFileSync(join(import.meta.dirname, "../../../package.json"), "utf8");

function harness(opts: { listening?: boolean; ports?: unknown[]; portsAfterForward?: unknown[]; env?: Record<string, string>; dotenv?: string | null; dies?: boolean } = {}) {
  const specs: ProcessSpec[] = [];
  let forwarded = false;
  let listening = opts.listening ?? false;
  let owned: { pid: number; port: number; taskId: string } | null = null;
  const spawned: { env: Record<string, string>; command: string; args: string[] }[] = [];
  const killed: number[] = [];
  const alive = new Set<number>();
  const row = { sourcePort: 3000, browseUrl: `https://${NAME}-3000.${DOMAIN}`, visibility: "private" };
  const runner: ProcessRunner = {
    spawn(spec) {
      specs.push(spec);
      if (spec.args.includes("visibility")) forwarded = true;
      const rows = spec.args.includes("--json") ? (forwarded ? (opts.portsAfterForward ?? [row]) : (opts.ports ?? [row])) : [];
      return { exit: Promise.resolve({ exitCode: 0, signal: null, stdout: JSON.stringify(rows), stderr: "", truncated: false }), kill() {} };
    },
  };
  const deps: PreviewControllerDeps = {
    runner,
    repoRoot: "/w",
    codespaceName: NAME,
    forwardingDomain: DOMAIN,
    env: opts.env ?? { PATH: "/usr/bin", HOME: "/home/x", TELEGRAM_BOT_TOKEN: "123:abc", GITHUB_TOKEN: "ghs_x", RENDER_API_KEY: "rnd_x", OXM_WAKE_GATEWAY_AGENT_TOKEN: "tok", AWS_SECRET_ACCESS_KEY: "aws", DATABASE_URL: "mysql://u:p@prod.example.com:3306/oxm" },
    readTextFile: (p) => (p.endsWith("package.json") ? PKG : p.endsWith(".env") ? (opts.dotenv ?? null) : null),
    spawnDetached(spec) {
      spawned.push({ env: spec.env, command: spec.command, args: spec.args });
      const pid = 4000 + spawned.length;
      if (!opts.dies) {
        alive.add(pid);
        listening = true;
      }
      return pid;
    },
    isAlive: (pid) => alive.has(pid),
    killGroup: (pid) => {
      killed.push(pid);
      alive.delete(pid);
      listening = false;
    },
    probe: async () => (listening ? 200 : null),
    sleep: async () => undefined,
    ownership: { load: () => owned, save: (v) => (owned = v) },
    logPath: "/state/preview-server.log",
    startTimeoutMs: 50,
    forwardTimeoutMs: 50,
  };
  return { controller: createCodespacesPreviewController(deps), specs, spawned, killed, owned: () => owned };
}

describe("Codespaces preview (UI tasks)", () => {
  it("uses the repository's own dev script and port", () => {
    expect(detectDevServer(PKG)).toEqual({ ok: true, command: "pnpm", args: ["dev"], port: 3000 });
    expect(detectDevServer('{"scripts":{"dev":"vite"}}')).toEqual({ ok: false, reason: "dev_port_undetected" });
    expect(detectDevServer(null).ok).toBe(false);
  });

  it("starts one dev server with a scrubbed environment and returns the URL read from Codespaces", async () => {
    const h = harness();
    const r = await h.controller.ensure({ taskId: "t1", branch: "agent/task-t1" });
    expect(r).toEqual({ status: "ready", url: `https://${NAME}-3000.${DOMAIN}/`, port: 3000, visibility: "private", access: "github_sign_in", reason: null, reused: false });
    expect(h.spawned).toHaveLength(1);
    const env = h.spawned[0].env;
    expect(env).toMatchObject({ NODE_ENV: "development", PORT: "3000", PATH: "/usr/bin" });
    // No production / control-plane secret reaches the public-facing preview process.
    for (const k of ["TELEGRAM_BOT_TOKEN", "GITHUB_TOKEN", "RENDER_API_KEY", "OXM_WAKE_GATEWAY_AGENT_TOKEN", "AWS_SECRET_ACCESS_KEY", "DATABASE_URL"]) expect(env[k]).toBeUndefined();
    expect(h.owned()).toEqual({ pid: 4001, port: 3000, taskId: "t1" });
    // Never makes a port public.
    expect(h.specs.some((s) => s.args.some((a) => /public/.test(a)))).toBe(false);
  });

  it("a loopback DATABASE_URL is passed; a .env pointing at a remote database refuses the preview", async () => {
    expect(previewEnvironment({ DATABASE_URL: "mysql://root:x@127.0.0.1:3306/oxm" }, 3000).DATABASE_URL).toBe("mysql://root:x@127.0.0.1:3306/oxm");
    expect(envFileRisk("DATABASE_URL=mysql://u:p@db.prod.example:3306/oxm")).toBe("env_file_uses_remote_database");
    expect(envFileRisk("NODE_ENV=production")).toBe("env_file_sets_production");
    expect(envFileRisk("DATABASE_URL=mysql://u:p@localhost:3306/oxm")).toBeNull();
    const h = harness({ dotenv: "DATABASE_URL=mysql://u:p@db.prod.example:3306/oxm" });
    expect(await h.controller.ensure({ taskId: "t1", branch: "b" })).toMatchObject({ status: "unavailable", reason: "env_file_uses_remote_database" });
    expect(h.spawned).toEqual([]);
  });

  it("an already-serving dev server is reused (never a second one); concurrent requests share one start", async () => {
    const running = harness({ listening: true });
    expect(await running.controller.ensure({ taskId: "t1", branch: "b" })).toMatchObject({ status: "ready", reused: true });
    expect(running.spawned).toEqual([]);
    const fresh = harness();
    const [a, b] = await Promise.all([fresh.controller.ensure({ taskId: "t1", branch: "b" }), fresh.controller.ensure({ taskId: "t1", branch: "b" })]);
    expect(a).toEqual(b);
    expect(fresh.spawned).toHaveLength(1);
    // A runtime restart: the next ensure re-validates and reuses the still-running server.
    expect(await fresh.controller.ensure({ taskId: "t1", branch: "b" })).toMatchObject({ status: "ready", reused: true });
    expect(fresh.spawned).toHaveLength(1);
  });

  it("only a URL on this Codespace's own forwarding host for the port is trusted", async () => {
    const h = harness({ ports: [{ sourcePort: 3000, browseUrl: "https://evil.example.com/", visibility: "public" }], portsAfterForward: [{ sourcePort: 3000, browseUrl: "https://evil.example.com/", visibility: "public" }] });
    expect(await h.controller.ensure({ taskId: "t1", branch: "b" })).toMatchObject({ status: "unavailable", reason: "forwarded_url_unavailable", url: null });
  });

  it("not forwarded yet → requests least-privilege (private) forwarding, then reads the URL", async () => {
    const h = harness({ ports: [] });
    expect(await h.controller.ensure({ taskId: "t1", branch: "b" })).toMatchObject({ status: "ready", visibility: "private" });
    expect(h.specs.map((s) => s.args.join(" "))).toContain(`codespace ports visibility 3000:private -c ${NAME}`);
  });

  it("a dev server that exits is reported unavailable (the implementation is not failed)", async () => {
    const h = harness({ dies: true });
    expect(await h.controller.ensure({ taskId: "t1", branch: "b" })).toMatchObject({ status: "unavailable", reason: "dev_server_exited" });
    expect(h.owned()).toBeNull();
  });

  it("release stops only the server this task started", async () => {
    const h = harness();
    await h.controller.ensure({ taskId: "t1", branch: "b" });
    await h.controller.release("other");
    expect(h.killed).toEqual([]);
    await h.controller.release("t1");
    expect(h.killed).toEqual([4001]);
    expect(h.owned()).toBeNull();
    const reused = harness({ listening: true });
    await reused.controller.ensure({ taskId: "t1", branch: "b" });
    await reused.controller.release("t1");
    expect(reused.killed).toEqual([]); // someone else's dev server is never killed
  });

  it("outside a Codespace there is no preview", async () => {
    const h = harness();
    const c = createCodespacesPreviewController({ ...({} as PreviewControllerDeps), runner: { spawn: () => { throw new Error("no"); } }, repoRoot: "/w", codespaceName: "", forwardingDomain: "", env: {}, readTextFile: () => null, spawnDetached: () => 1, isAlive: () => false, killGroup: () => undefined, probe: async () => null, sleep: async () => undefined, ownership: { load: () => null, save: () => undefined }, logPath: "/x" });
    expect(await c.ensure({ taskId: "t", branch: "b" })).toMatchObject({ status: "unavailable", reason: "not_in_codespace" });
    expect(h.spawned).toEqual([]);
  });
});
