import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findExecutable, FIXED_AGENT_ENV, repoFromRemoteUrl, requiredExecutables, resolveAgentEnv } from "./env";
import { decideAfterExit, redact, RESTART_WINDOW_MS } from "./policy";
import { findRuntimeProcesses, identityOf, isSameLiveProcess, lockState, type ProcessIdentity } from "./procfs";

/**
 * Single-instance supervisor for the long-lived OXM Agent Telegram runtime.
 *
 *   start   spawn the detached supervisor unless one already holds the lock
 *   run     (internal) the supervisor itself: preflight, run + log the runtime
 *   stop    signal a verified supervisor, which stops the runtime
 *   status  state, last error and recent (redacted) log lines
 *
 * Exclusivity is a kernel flock held for the supervisor's lifetime, so it never
 * goes stale across crashes or Codespace stop/resume; pids are only signalled
 * after boot id + start time + argv verification. State and logs live under the
 * Agent state dir (outside the repository) and never contain secret values.
 */
export interface SupervisorOptions {
  repoRoot: string;
  /** Absolute path of the CLI entry that dispatches to this module. */
  selfScript: string;
  /** Runtime command; argv[0] is the executable. */
  runtimeArgv: string[];
  /** Runtime entry relative to repoRoot, for duplicate detection. */
  runtimeEntry: string;
  env: NodeJS.ProcessEnv;
  stateDir: string;
  readPlatformSecrets: () => string | null;
  out: (line: string) => void;
  startWaitMs?: number;
  stopWaitMs?: number;
}

export type SupervisorStatus = "starting" | "running" | "restarting" | "stopping" | "stopped" | "startup_failed" | "crashed";

export interface SupervisorState {
  schema: 1;
  instanceId: string;
  status: SupervisorStatus;
  repoRoot: string;
  expectedRepo: string;
  codespaceName: string | null;
  supervisor: ProcessIdentity | null;
  runtime: ProcessIdentity | null;
  startedAt: string;
  pollingStartedAt: string | null;
  updatedAt: string;
  failureCode: string | null;
  lastError: string | null;
  lastExit: { code: number | null; signal: string | null; at: string } | null;
  restarts: number[];
  nextRestartAt: string | null;
  stoppedBy: string | null;
}

const LOG_MAX_BYTES = 5 * 1024 * 1024;
const POLLING_MARKER = "[oxm-agent] polling started";
const FAILED_MARKER = "[oxm-agent] FAILED: ";
const ACTIVE: readonly SupervisorStatus[] = ["starting", "running", "restarting", "stopping"];

export function supervisorPaths(stateDir: string) {
  const dir = join(stateDir, "supervisor");
  return { dir, lock: join(dir, "runtime.lock"), state: join(dir, "state.json"), log: join(dir, "runtime.log") };
}

export function readState(stateDir: string): SupervisorState | null {
  try {
    const parsed = JSON.parse(readFileSync(supervisorPaths(stateDir).state, "utf8")) as SupervisorState;
    return parsed && parsed.schema === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function writeState(stateDir: string, state: SupervisorState) {
  const { state: path } = supervisorPaths(stateDir);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

function appendLog(stateDir: string, line: string) {
  const { log } = supervisorPaths(stateDir);
  try {
    if (existsSync(log) && statSync(log).size > LOG_MAX_BYTES) renameSync(log, `${log}.1`);
    appendFileSync(log, `${new Date().toISOString()} ${line}\n`, { mode: 0o600 });
  } catch {
    // logging must never take the supervisor down
  }
}

function tail(path: string, lines: number): string[] {
  try {
    return readFileSync(path, "utf8").split("\n").filter(Boolean).slice(-lines);
  } catch {
    return [];
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runSupervisorCli(argv: string[], options: SupervisorOptions): Promise<number> {
  const paths = supervisorPaths(options.stateDir);
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  const [command, ...rest] = argv;
  switch (command) {
    case "start":
      return start(options, rest.includes("--autostart"));
    case "run": {
      const i = rest.indexOf("--instance");
      return run(options, i >= 0 && rest[i + 1] ? rest[i + 1] : `manual-${randomBytes(4).toString("hex")}`);
    }
    case "stop":
      return stop(options);
    case "status":
      return status(options);
    default:
      options.out("usage: start [--autostart] | stop | status");
      return 2;
  }
}

const isSupervisor = (options: SupervisorOptions) => (argv: string[]) => argv.includes(options.selfScript) && argv.includes("run");
const isRuntime = (options: SupervisorOptions) => (argv: string[]) => argv.some((a) => a === options.runtimeArgv[options.runtimeArgv.length - 1]);

function blankState(options: SupervisorOptions, instanceId: string, status: SupervisorStatus): SupervisorState {
  const now = new Date().toISOString();
  return {
    schema: 1,
    instanceId,
    status,
    repoRoot: options.repoRoot,
    expectedRepo: FIXED_AGENT_ENV.OXM_AGENT_EXPECTED_REPO,
    codespaceName: options.env.CODESPACE_NAME?.trim() || null,
    supervisor: null,
    runtime: null,
    startedAt: now,
    pollingStartedAt: null,
    updatedAt: now,
    failureCode: null,
    lastError: null,
    lastExit: null,
    restarts: [],
    nextRestartAt: null,
    stoppedBy: null,
  };
}

async function start(options: SupervisorOptions, autostart: boolean): Promise<number> {
  const paths = supervisorPaths(options.stateDir);
  const say = (line: string) => options.out(`[oxm-agent-supervisor] ${line}`);
  appendLog(options.stateDir, `[supervisor] start requested${autostart ? " (Codespace autostart)" : ""}`);
  const lock = lockState(paths.lock);
  if (lock === "unavailable") {
    say("FAILED: flock is unavailable; cannot guarantee a single instance");
    return 1;
  }
  if (lock === "held") {
    const state = readState(options.stateDir);
    say(`already running (status ${state?.status ?? "unknown"}, supervisor pid ${state?.supervisor?.pid ?? "?"}); not starting a second instance`);
    return 0;
  }
  const strays = findRuntimeProcesses(options.repoRoot, options.runtimeEntry);
  if (strays.length > 0) {
    const reason = `an unsupervised Agent runtime is already running (pid ${strays.join(", ")}); stop it before starting the supervised one`;
    writeState(options.stateDir, { ...blankState(options, `refused-${Date.now().toString(36)}`, "startup_failed"), failureCode: "duplicate_runtime", lastError: reason });
    appendLog(options.stateDir, `[supervisor] FAILED: ${reason}`);
    say(`FAILED: ${reason}`);
    return 1;
  }

  const instanceId = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
  let spawnExit: number | null = null;
  const logFd = openSync(paths.log, "a", 0o600);
  try {
    // flock holds the lock for the supervisor's whole life; -E 75 marks "someone else holds it".
    // -w 2 (not -n) so a concurrent momentary lockState() probe cannot make a lone start fail.
    const child = spawn("flock", ["-w", "2", "-E", "75", paths.lock, process.execPath, "--import", "tsx", options.selfScript, "run", "--instance", instanceId], {
      cwd: options.repoRoot,
      env: options.env,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    child.on("error", () => (spawnExit = -1));
    child.on("exit", (code) => (spawnExit = code ?? -1));
    child.unref();
  } finally {
    closeSync(logFd);
  }

  const deadline = Date.now() + (options.startWaitMs ?? 45_000);
  while (Date.now() < deadline) {
    await sleep(250);
    if (spawnExit === 75) {
      const other = readState(options.stateDir);
      if (lockState(paths.lock) === "held") {
        say(`another supervisor holds the lock (status ${other?.status ?? "unknown"}); not starting a second instance`);
        return 0;
      }
      say("FAILED: lock contention while starting; run the start command again");
      return 1;
    }
    const state = readState(options.stateDir);
    if (state?.instanceId !== instanceId) {
      if (spawnExit !== null) {
        say(`FAILED: supervisor exited before reporting state (log: ${paths.log})`);
        return 1;
      }
      continue;
    }
    if (state.status === "running") {
      say(`running: Telegram polling started (supervisor pid ${state.supervisor?.pid}, runtime pid ${state.runtime?.pid})`);
      return 0;
    }
    if (state.status === "startup_failed" || state.status === "crashed" || state.status === "stopped") {
      say(`FAILED: ${state.failureCode ?? state.status}: ${state.lastError ?? "see log"}`);
      say(`log: ${paths.log}`);
      return 1;
    }
  }
  say(`still starting; check \`pnpm orchestrator:telegram:status\` (log: ${paths.log})`);
  return 0;
}

async function run(options: SupervisorOptions, instanceId: string): Promise<number> {
  const log = (line: string) => appendLog(options.stateDir, `[supervisor] ${line}`);
  let state: SupervisorState = { ...blankState(options, instanceId, "starting"), supervisor: identityOf(process.pid) };
  const save = (patch: Partial<SupervisorState>) => {
    state = { ...state, ...patch };
    writeState(options.stateDir, state);
  };
  const failStartup = (code: string, reason: string) => {
    log(`FAILED (${code}): ${reason}`);
    save({ status: "startup_failed", failureCode: code, lastError: reason });
    return 0;
  };
  save({});
  log(`supervisor ${instanceId} started (pid ${process.pid})`);

  // Preflight: every check names variables / executables, never values.
  const resolved = resolveAgentEnv(options.env, { repoRoot: options.repoRoot, readPlatformSecrets: options.readPlatformSecrets });
  if (!resolved.ok) return failStartup(resolved.code, resolved.reason);
  const env = resolved.env;
  save({ codespaceName: env.CODESPACE_NAME });
  log(`environment bound (repo ${env.OXM_AGENT_EXPECTED_REPO}, codespace ${env.OXM_AGENT_CODESPACE_NAME}, workers ${env.OXM_AGENT_WORKERS}, telegram secrets from ${resolved.telegramSource})`);
  const remote = spawnSync("git", ["remote", "get-url", "origin"], { cwd: options.repoRoot, encoding: "utf8", env });
  const actualRepo = remote.status === 0 ? repoFromRemoteUrl(remote.stdout) : null;
  if (!actualRepo || actualRepo.toLowerCase() !== env.OXM_AGENT_EXPECTED_REPO.toLowerCase())
    return failStartup("wrong_repo", "git remote origin does not match OXM_AGENT_EXPECTED_REPO");
  for (const exe of requiredExecutables(env))
    if (!findExecutable(exe.command, env.PATH)) return failStartup("missing_executable", `${exe.name} executable not found on PATH (install / authenticate the ${exe.name} CLI)`);
  const strays = findRuntimeProcesses(options.repoRoot, options.runtimeEntry);
  if (strays.length > 0) return failStartup("duplicate_runtime", `an unsupervised Agent runtime is already running (pid ${strays.join(", ")})`);

  let child: ChildProcess | null = null;
  let stopping = false;
  let restartTimer: NodeJS.Timeout | null = null;
  let finish!: (code: number) => void;
  const done = new Promise<number>((r) => (finish = r));

  const launch = () => {
    restartTimer = null;
    let reachedPolling = false;
    const [cmd, ...args] = options.runtimeArgv;
    const proc = spawn(cmd, args, { cwd: options.repoRoot, env, stdio: ["ignore", "pipe", "pipe"] });
    child = proc;
    save({ status: "starting", runtime: proc.pid ? identityOf(proc.pid) : null, nextRestartAt: null, pollingStartedAt: null });
    log(`runtime started (pid ${proc.pid ?? "?"})`);
    const onData = (prefix: string) => {
      let buffered = "";
      return (chunk: Buffer) => {
        buffered += chunk.toString("utf8");
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const raw of lines) {
          const line = redact(raw, resolved.secretValues);
          appendLog(options.stateDir, `${prefix}${line}`);
          if (!reachedPolling && line.includes(POLLING_MARKER)) {
            reachedPolling = true;
            save({ status: "running", pollingStartedAt: new Date().toISOString(), failureCode: null, lastError: null });
          }
          const failed = line.indexOf(FAILED_MARKER);
          if (failed >= 0) save({ lastError: line.slice(failed + FAILED_MARKER.length).slice(0, 500) });
        }
      };
    };
    proc.stdout?.on("data", onData(""));
    proc.stderr?.on("data", onData("[stderr] "));
    proc.on("error", () => log("runtime could not be spawned"));
    proc.on("close", (code, signal) => {
      child = null;
      const now = Date.now();
      const lastExit = { code, signal, at: new Date(now).toISOString() };
      log(`runtime exited (code ${code ?? "-"}, signal ${signal ?? "-"})`);
      const decision = decideAfterExit({ stopping, reachedPolling, restarts: state.restarts, now });
      if (decision.action === "stopped") {
        save({ status: "stopped", lastExit, runtime: null });
        finish(0);
      } else if (decision.action === "startup_failed") {
        save({ status: "startup_failed", lastExit, runtime: null, failureCode: "runtime_startup_failed", lastError: state.lastError ?? `runtime exited before polling started (code ${code ?? "-"})` });
        log("startup failure: not restarting (fix the cause, then `pnpm orchestrator:telegram:start`)");
        finish(0);
      } else if (decision.action === "crashed") {
        save({ status: "crashed", lastExit, runtime: null, failureCode: "runtime_crashed", lastError: state.lastError ?? `runtime exited (code ${code ?? "-"}) and the restart budget is exhausted` });
        log("restart budget exhausted: not restarting");
        finish(0);
      } else {
        save({ status: "restarting", lastExit, runtime: null, restarts: [...state.restarts.filter((t) => now - t < RESTART_WINDOW_MS), now], nextRestartAt: new Date(now + decision.delayMs).toISOString() });
        log(`restarting in ${Math.round(decision.delayMs / 1000)}s`);
        restartTimer = setTimeout(launch, decision.delayMs);
      }
    });
  };

  const onSignal = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    log(`${signal} received; stopping`);
    save({ status: "stopping", stoppedBy: "owner" });
    if (restartTimer) {
      clearTimeout(restartTimer);
      save({ status: "stopped", nextRestartAt: null });
      finish(0);
      return;
    }
    const running = child;
    if (!running) {
      save({ status: "stopped" });
      finish(0);
      return;
    }
    running.kill("SIGTERM");
    setTimeout(() => {
      if (child === running) {
        log("runtime did not stop in time; sending SIGKILL");
        running.kill("SIGKILL");
      }
    }, options.stopWaitMs ?? 15_000).unref();
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  process.on("SIGHUP", () => undefined);

  launch();
  return done;
}

async function stop(options: SupervisorOptions): Promise<number> {
  const paths = supervisorPaths(options.stateDir);
  const say = (line: string) => options.out(`[oxm-agent-supervisor] ${line}`);
  const state = readState(options.stateDir);
  const lock = lockState(paths.lock);
  if (lock === "free") {
    if (state && ACTIVE.includes(state.status)) {
      writeState(options.stateDir, { ...state, status: "stopped", runtime: null, stoppedBy: "stale-state-recovery" });
      appendLog(options.stateDir, "[supervisor] stale state cleared (no supervisor holds the lock)");
    }
    const strays = findRuntimeProcesses(options.repoRoot, options.runtimeEntry);
    say(strays.length ? `supervisor not running; an unsupervised runtime is running (pid ${strays.join(", ")}) — stop it in its own terminal (Ctrl+C)` : "not running");
    return 0;
  }
  if (lock === "unavailable") {
    say("FAILED: flock is unavailable");
    return 1;
  }
  if (!state || !isSameLiveProcess(state.supervisor, isSupervisor(options))) {
    say("FAILED: the lock is held by a process that cannot be verified as this supervisor; nothing was signalled");
    return 1;
  }
  appendLog(options.stateDir, "[supervisor] stop requested");
  process.kill(state.supervisor!.pid, "SIGTERM");
  const deadline = Date.now() + (options.stopWaitMs ?? 15_000) + 5_000;
  while (Date.now() < deadline) {
    await sleep(250);
    if (lockState(paths.lock) === "free") {
      say("stopped");
      return 0;
    }
  }
  const latest = readState(options.stateDir);
  if (latest && isSameLiveProcess(latest.runtime, isRuntime(options))) process.kill(latest.runtime!.pid, "SIGKILL");
  if (latest && isSameLiveProcess(latest.supervisor, isSupervisor(options))) process.kill(latest.supervisor!.pid, "SIGKILL");
  await sleep(500);
  if (lockState(paths.lock) === "free") {
    writeState(options.stateDir, { ...(latest ?? state), status: "stopped", runtime: null, stoppedBy: "owner (forced)" });
    say("stopped (forced)");
    return 0;
  }
  say("FAILED: supervisor did not release the lock");
  return 1;
}

function status(options: SupervisorOptions): number {
  const paths = supervisorPaths(options.stateDir);
  const say = (line: string) => options.out(line);
  const state = readState(options.stateDir);
  const lock = lockState(paths.lock);
  const verified = lock === "held" && !!state && isSameLiveProcess(state.supervisor, isSupervisor(options));
  const effective = lock === "free" && state && ACTIVE.includes(state.status) ? `${state.status} (stale: no supervisor holds the lock)` : (state?.status ?? "never started");
  say(`OXM Agent runtime: ${lock === "held" ? (verified ? "RUNNING (supervised)" : "LOCK HELD (unverified process)") : "NOT RUNNING"}`);
  say(`  status:           ${effective}`);
  if (state) {
    say(`  instance:         ${state.instanceId}`);
    say(`  supervisor pid:   ${state.supervisor?.pid ?? "-"}    runtime pid: ${state.runtime?.pid ?? "-"}`);
    say(`  repo / codespace: ${state.expectedRepo} / ${state.codespaceName ?? "-"}`);
    say(`  started:          ${state.startedAt}    polling since: ${state.pollingStartedAt ?? "-"}`);
    if (state.lastExit) say(`  last exit:        code ${state.lastExit.code ?? "-"}, signal ${state.lastExit.signal ?? "-"} at ${state.lastExit.at}`);
    if (state.lastError) say(`  last error:       ${state.failureCode ? `${state.failureCode}: ` : ""}${state.lastError}`);
    if (state.restarts.length) say(`  auto restarts:    ${state.restarts.length} in the last hour${state.nextRestartAt ? `, next at ${state.nextRestartAt}` : ""}`);
  }
  const strays = findRuntimeProcesses(options.repoRoot, options.runtimeEntry, new Set(verified && state?.runtime ? [state.runtime.pid] : []));
  if (strays.length) say(`  WARNING: unsupervised runtime process(es) for this repo: pid ${strays.join(", ")}`);
  say(`  log:              ${paths.log}`);
  const recent = tail(paths.log, 15);
  if (recent.length) {
    say("  recent log:");
    for (const line of recent) say(`    ${line}`);
  }
  return 0;
}
