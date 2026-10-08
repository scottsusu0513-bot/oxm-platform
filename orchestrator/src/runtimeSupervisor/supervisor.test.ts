import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAgentRuntimeConfig } from "../agentRuntime/config";
import { FIXED_AGENT_ENV, parsePlatformSecrets, repoFromRemoteUrl, resolveAgentEnv, secretValuesOf } from "./env";
import { decideAfterExit, redact, RESTART_BACKOFF_MS } from "./policy";
import { currentBootId, findRuntimeProcesses, isSameLiveProcess, lockState, parseStatStartTime, processStartTime } from "./procfs";
import { readState, supervisorPaths } from "./supervisor";

const repoRoot = resolve(__dirname, "../../..");
const TOKEN = "123456789:AAH-fake_fake_fake_fake_fake_fake_fake1";
const CHAT = "987654321";
const b64 = (s: string) => Buffer.from(s).toString("base64");
const baseEnv = { CODESPACE_NAME: "test-codespace-abc", TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_OWNER_CHAT_ID: CHAT };
const noFile = () => null;

function readDevcontainer(): Record<string, any> {
  const text = readFileSync(join(repoRoot, ".devcontainer/devcontainer.json"), "utf8");
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));
}

describe("fixed env persistence (devcontainer)", () => {
  it("containerEnv carries exactly the fixed non-secret binding", () => {
    expect(readDevcontainer().containerEnv).toEqual({ ...FIXED_AGENT_ENV });
  });

  it("never materializes secrets or a hard-coded Codespace name in committed config", () => {
    const dc = readDevcontainer();
    const keys = Object.keys({ ...dc.containerEnv, ...dc.remoteEnv });
    expect(keys.filter((k) => /TELEGRAM|TOKEN|SECRET|KEY|PASSWORD|CHAT/i.test(k))).toEqual([]);
    expect(keys).not.toContain("OXM_AGENT_CODESPACE_NAME");
    const committed = ["scripts/codespace-post-start.sh", "scripts/orchestrator-telegram-supervisor.ts", ".devcontainer/devcontainer.json"]
      .map((f) => readFileSync(join(repoRoot, f), "utf8"))
      .join("\n");
    expect(committed).not.toMatch(/[0-9]{5,16}:[A-Za-z0-9_-]{30,64}/);
    expect(committed).not.toMatch(/TELEGRAM_[A-Z_]+=/);
  });

  it("runs the post-start hook on every container start, not only on create", () => {
    const dc = readDevcontainer();
    expect(dc.postStartCommand).toBe("bash scripts/codespace-post-start.sh");
    expect(dc.postCreateCommand).toBeUndefined();
    expect(spawnSync("bash", ["-n", join(repoRoot, "scripts/codespace-post-start.sh")]).status).toBe(0);
  });

  it("post-start hook honours the opt-out and never fails the Codespace start", () => {
    const dir = mkdtempSync(join(tmpdir(), "oxm-poststart-"));
    try {
      const r = spawnSync("bash", [join(repoRoot, "scripts/codespace-post-start.sh")], { env: { PATH: process.env.PATH, HOME: dir, OXM_AGENT_AUTOSTART: "off" }, encoding: "utf8" });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("disabled");
      expect(readFileSync(join(dir, ".oxm-orchestrator/supervisor/runtime.log"), "utf8")).toContain("[autostart] disabled");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveAgentEnv", () => {
  it("applies the fixed binding and binds the Codespace name dynamically", () => {
    const r = resolveAgentEnv(baseEnv, { repoRoot, readPlatformSecrets: noFile });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.env).toMatchObject({ ...FIXED_AGENT_ENV, OXM_AGENT_CODESPACE_NAME: "test-codespace-abc" });
    const other = resolveAgentEnv({ ...baseEnv, CODESPACE_NAME: "another-space" }, { repoRoot, readPlatformSecrets: noFile });
    expect(other.ok && other.env.OXM_AGENT_CODESPACE_NAME).toBe("another-space");
  });

  it("keeps the existing runtime safety gate intact (validated by the runtime's own reader)", () => {
    const r = resolveAgentEnv(baseEnv, { repoRoot, readPlatformSecrets: noFile });
    if (!r.ok) throw new Error(r.reason);
    const cfg = readAgentRuntimeConfig(r.env, repoRoot);
    if (!cfg.ok) throw new Error(cfg.reason);
    expect(cfg.config.base).toMatchObject({ mergeEnabled: false, deployEnabled: false, forcePushEnabled: false, productionDbEnabled: false, codespaceName: "test-codespace-abc", expectedCodespaceName: "test-codespace-abc" });
    expect(Object.keys(r.env).filter((k) => k.startsWith("OXM_AGENT_")).sort()).toEqual([...Object.keys(FIXED_AGENT_ENV), "OXM_AGENT_CODESPACE_NAME"].sort());
  });

  it("refuses a pinned Codespace name, repo or confirmation that differs", () => {
    const codespace = resolveAgentEnv({ ...baseEnv, OXM_AGENT_CODESPACE_NAME: "stale-space" }, { repoRoot, readPlatformSecrets: noFile });
    expect(codespace).toMatchObject({ ok: false, code: "wrong_codespace" });
    expect(resolveAgentEnv({ ...baseEnv, OXM_AGENT_EXPECTED_REPO: "evil/fork" }, { repoRoot, readPlatformSecrets: noFile })).toMatchObject({ ok: false, code: "wrong_repo" });
    expect(resolveAgentEnv({ ...baseEnv, OXM_AGENT_CONFIRM: "yes" }, { repoRoot, readPlatformSecrets: noFile })).toMatchObject({ ok: false, code: "binding_mismatch" });
    expect(resolveAgentEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_OWNER_CHAT_ID: CHAT }, { repoRoot, readPlatformSecrets: noFile })).toMatchObject({ ok: false, code: "missing_codespace" });
  });

  it("fails clearly on a missing or malformed secret without echoing its value", () => {
    const missing = resolveAgentEnv({ CODESPACE_NAME: "x-space" }, { repoRoot, readPlatformSecrets: noFile });
    expect(missing).toEqual({ ok: false, code: "missing_secret", reason: "TELEGRAM_BOT_TOKEN is not set" });
    const malformed = resolveAgentEnv({ ...baseEnv, TELEGRAM_BOT_TOKEN: "not-a-real-token-value-xyz" }, { repoRoot, readPlatformSecrets: noFile });
    expect(malformed.ok).toBe(false);
    expect(JSON.stringify(malformed)).not.toContain("not-a-real-token-value-xyz");
  });

  it("reads only allowlisted keys from the platform secrets file, and only when missing", () => {
    const file = [`TELEGRAM_BOT_TOKEN=${b64(TOKEN)}`, `TELEGRAM_OWNER_CHAT_ID=${b64(CHAT)}`, `CODESPACE_NAME=${b64("file-space")}`, `GITHUB_TOKEN=${b64("ghp_should_not_be_read")}`].join("\n");
    expect(Object.keys(parsePlatformSecrets(file)).sort()).toEqual(["CODESPACE_NAME", "TELEGRAM_BOT_TOKEN", "TELEGRAM_OWNER_CHAT_ID"]);
    const r = resolveAgentEnv({}, { repoRoot, readPlatformSecrets: () => file });
    expect(r).toMatchObject({ ok: true, telegramSource: "codespaces_secrets_file" });
    if (r.ok) expect(r.env.GITHUB_TOKEN).toBeUndefined();
    const envWins = resolveAgentEnv(baseEnv, { repoRoot, readPlatformSecrets: () => file });
    expect(envWins.ok && envWins.env.CODESPACE_NAME).toBe("test-codespace-abc");
    expect(envWins).toMatchObject({ telegramSource: "environment" });
  });

  it("parses GitHub remotes", () => {
    expect(repoFromRemoteUrl("https://github.com/scottsusu0513-bot/oxm-platform.git")).toBe("scottsusu0513-bot/oxm-platform");
    expect(repoFromRemoteUrl("git@github.com:scottsusu0513-bot/oxm-platform")).toBe("scottsusu0513-bot/oxm-platform");
    expect(repoFromRemoteUrl("https://example.com/x/y")).toBeNull();
  });
});

describe("policy", () => {
  it("redacts secret values and secret-shaped tokens", () => {
    expect(redact(`token=${TOKEN} chat=${CHAT}`, [TOKEN, CHAT])).toBe("token=<redacted> chat=<redacted>");
    expect(redact(`leak ${TOKEN}`, [])).toBe("leak <redacted>");
    const values = secretValuesOf({ TELEGRAM_OWNER_CHAT_ID: CHAT, AWS_ACCESS_KEY_ID: "AKIAEXAMPLEKEY", DATABASE_URL: "mysql://u:pw@h/db", OXM_AGENT_WORKERS: "claude,codex", CODESPACE_NAME: "space-name" });
    expect(values.sort()).toEqual(["AKIAEXAMPLEKEY", CHAT, "mysql://u:pw@h/db"].sort());
  });

  it("never restarts a startup failure and bounds crash restarts", () => {
    expect(decideAfterExit({ stopping: true, reachedPolling: true, restarts: [], now: 0 })).toEqual({ action: "stopped" });
    expect(decideAfterExit({ stopping: false, reachedPolling: false, restarts: [], now: 0 })).toEqual({ action: "startup_failed" });
    expect(decideAfterExit({ stopping: false, reachedPolling: true, restarts: [], now: 0 })).toEqual({ action: "restart", delayMs: RESTART_BACKOFF_MS[0] });
    const now = 10 * 3_600_000;
    expect(decideAfterExit({ stopping: false, reachedPolling: true, restarts: [now - 1000, now - 2000, now - 3000], now })).toEqual({ action: "crashed" });
    expect(decideAfterExit({ stopping: false, reachedPolling: true, restarts: [now - 2 * 3_600_000], now })).toMatchObject({ action: "restart" });
  });
});

describe("process identity", () => {
  it("parses start time past a comm containing spaces and parentheses", () => {
    const stat = `123 (we ird) name)) S 1 ${Array.from({ length: 17 }, (_, i) => i).join(" ")} 4242 99`;
    expect(parseStatStartTime(stat)).toBe("4242");
  });

  it("does not treat a reused pid or another boot as the recorded process", () => {
    const startTime = processStartTime(process.pid)!;
    const self = { pid: process.pid, bootId: currentBootId(), startTime };
    expect(isSameLiveProcess(self, () => true)).toBe(true);
    expect(isSameLiveProcess({ ...self, startTime: String(Number(startTime) + 1) }, () => true)).toBe(false);
    expect(isSameLiveProcess({ ...self, bootId: "previous-boot" }, () => true)).toBe(false);
    expect(isSameLiveProcess(self, () => false)).toBe(false);
  });
});

// ---- Integration: the real supervisor, a fake runtime, an isolated state dir. ----
const entry = join(repoRoot, "orchestrator/src/runtimeSupervisor/testFixtures/supervisorEntry.ts");
const fakeRuntime = "orchestrator/src/runtimeSupervisor/testFixtures/fakeRuntime.ts";
let stateDir = "";
const extra: ChildProcess[] = [];

function cli(command: string, env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, ["--import", "tsx", entry, command], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 40_000,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: stateDir,
      ...baseEnv,
      OXM_AGENT_CLAUDE_COMMAND: "/bin/true",
      OXM_AGENT_CODEX_COMMAND: "/bin/true",
      OXM_TEST_STATE_DIR: stateDir,
      ...env,
    },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}
const runtimes = () => findRuntimeProcesses(repoRoot, fakeRuntime);
const log = () => readFileSync(supervisorPaths(stateDir).log, "utf8");

describe.skipIf(process.platform !== "linux" || spawnSync("flock", ["-V"]).error)("supervisor lifecycle (integration)", () => {
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "oxm-supervisor-"));
  });
  afterEach(() => {
    cli("stop");
    for (const p of extra.splice(0)) p.kill("SIGKILL");
    rmSync(stateDir, { recursive: true, force: true });
  });
  afterAll(() => {
    for (const pid of runtimes()) process.kill(pid, "SIGKILL");
  });

  it("first start launches one instance; a second start does not duplicate it; stop and start again work", () => {
    const first = cli("start");
    expect(first.status).toBe(0);
    expect(first.out).toContain("running: Telegram polling started");
    const state = readState(stateDir)!;
    expect(state).toMatchObject({ status: "running", codespaceName: "test-codespace-abc" });
    expect(lockState(supervisorPaths(stateDir).lock)).toBe("held");
    expect(runtimes()).toHaveLength(1);
    // Only the supervisor side holds the flock: runtime / Worker descendants can never keep it alive.
    const fds = readdirSync(`/proc/${state.runtime!.pid}/fd`).map((fd) => {
      try {
        return readlinkSync(`/proc/${state.runtime!.pid}/fd/${fd}`);
      } catch {
        return "";
      }
    });
    expect(fds).not.toContain(supervisorPaths(stateDir).lock);

    const second = cli("start");
    expect(second.status).toBe(0);
    expect(second.out).toContain("already running");
    expect(readState(stateDir)!.supervisor!.pid).toBe(state.supervisor!.pid);
    expect(runtimes()).toHaveLength(1);

    // The runtime saw the fixed binding + dynamic Codespace name; secrets never reached the log.
    expect(log()).toContain("codespace binding test-codespace-abc confirm=run-oxm-agent-tasks-without-merge-or-deploy");
    expect(log()).not.toContain(TOKEN);
    expect(log()).not.toContain(CHAT);
    expect(log()).toContain("token=<redacted>");
    expect(cli("status").out).toContain("RUNNING (supervised)");

    const stopped = cli("stop");
    expect(stopped.out).toContain("stopped");
    expect(lockState(supervisorPaths(stateDir).lock)).toBe("free");
    expect(runtimes()).toHaveLength(0);
    expect(readState(stateDir)).toMatchObject({ status: "stopped", stoppedBy: "owner" });

    expect(cli("start").out).toContain("running");
    expect(runtimes()).toHaveLength(1);
  }, 90_000);

  it("recovers from stale state and never signals an unverified lock holder", () => {
    const paths = supervisorPaths(stateDir);
    cli("status"); // creates the dir
    const stale = { schema: 1, instanceId: "old", status: "running", repoRoot, expectedRepo: "x/y", codespaceName: "old", supervisor: { pid: process.pid, bootId: "previous-boot", startTime: "1" }, runtime: null, startedAt: "", pollingStartedAt: null, updatedAt: "", failureCode: null, lastError: null, lastExit: null, restarts: [], nextRestartAt: null, stoppedBy: null };
    writeFileSync(paths.state, JSON.stringify(stale));
    expect(cli("status").out).toContain("stale");
    expect(cli("start").out).toContain("running");
    expect(cli("stop").out).toContain("stopped");

    // A foreign process holds the lock and the state points at a reused pid: nothing is signalled.
    const holder = spawn("flock", [paths.lock, "sleep", "30"], { stdio: "ignore" });
    extra.push(holder);
    spawnSync("sleep", ["0.3"]);
    writeFileSync(paths.state, JSON.stringify({ ...stale, supervisor: { pid: holder.pid, bootId: currentBootId(), startTime: "1" } }));
    const refused = cli("stop");
    expect(refused.status).toBe(1);
    expect(refused.out).toContain("cannot be verified");
    expect(holder.exitCode).toBeNull();
    expect(cli("start").out).toContain("already running");
  }, 90_000);

  it("fails clearly on a missing secret and does not loop", () => {
    const r = cli("start", { TELEGRAM_BOT_TOKEN: "" });
    expect(r.status).toBe(1);
    expect(r.out).toContain("missing_secret: TELEGRAM_BOT_TOKEN is not set");
    expect(readState(stateDir)).toMatchObject({ status: "startup_failed", failureCode: "missing_secret", runtime: null });
    expect(lockState(supervisorPaths(stateDir).lock)).toBe("free");
    expect(runtimes()).toHaveLength(0);
  }, 60_000);

  it("takes Telegram secrets from the platform secrets file when the env lacks them", () => {
    const file = join(stateDir, "env-secrets");
    writeFileSync(file, `TELEGRAM_BOT_TOKEN=${b64(TOKEN)}\nTELEGRAM_OWNER_CHAT_ID=${b64(CHAT)}\n`);
    const r = cli("start", { TELEGRAM_BOT_TOKEN: "", TELEGRAM_OWNER_CHAT_ID: "", OXM_TEST_SECRETS_FILE: file });
    expect(r.out).toContain("running");
    expect(log()).toContain("telegram secrets from codespaces_secrets_file");
    expect(log()).not.toContain(TOKEN);
  }, 60_000);

  it("records a runtime startup failure once and does not restart it", () => {
    const r = cli("start", { FAKE_RUNTIME_FAIL: "1" });
    expect(r.status).toBe(1);
    expect(r.out).toContain("simulated startup failure");
    expect(readState(stateDir)).toMatchObject({ status: "startup_failed", failureCode: "runtime_startup_failed" });
    expect(log().match(/runtime started/g)).toHaveLength(1);
  }, 60_000);

  it("refuses to start next to an unsupervised runtime for this repo", () => {
    const manual = spawn(process.execPath, ["--import", "tsx", fakeRuntime], { cwd: repoRoot, env: { ...process.env, ...baseEnv }, stdio: "ignore" });
    extra.push(manual);
    spawnSync("sleep", ["1.5"]);
    const r = cli("start");
    expect(r.status).toBe(1);
    expect(r.out).toContain("unsupervised Agent runtime is already running");
    expect(readState(stateDir)).toMatchObject({ failureCode: "duplicate_runtime" });
  }, 60_000);
});
