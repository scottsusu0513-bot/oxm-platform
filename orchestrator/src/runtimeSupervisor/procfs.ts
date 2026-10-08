import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Linux process identity. A pid alone is never trusted: a recorded process is
 * the same process only if boot id and kernel start time both still match, so
 * a stale pid file (Codespace stop/resume = new boot) or a reused pid is never
 * signalled.
 */
export interface ProcessIdentity {
  pid: number;
  bootId: string;
  startTime: string;
}

export function currentBootId(): string {
  try {
    return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  } catch {
    return "unknown";
  }
}

/** Field 22 of /proc/<pid>/stat (clock ticks since boot), parsed past the parenthesised comm. */
export function parseStatStartTime(stat: string): string | null {
  const close = stat.lastIndexOf(")");
  if (close < 0) return null;
  const fields = stat.slice(close + 2).split(" ");
  return fields[19] && /^\d+$/.test(fields[19]) ? fields[19] : null;
}

export function processStartTime(pid: number): string | null {
  try {
    return parseStatStartTime(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return null;
  }
}

export function processArgv(pid: number): string[] | null {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

export function processCwd(pid: number): string | null {
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

export function identityOf(pid: number): ProcessIdentity | null {
  const startTime = processStartTime(pid);
  return startTime ? { pid, bootId: currentBootId(), startTime } : null;
}

/** True only when the recorded process is still the very same process and its argv passes `matches`. */
export function isSameLiveProcess(recorded: ProcessIdentity | null | undefined, matches: (argv: string[]) => boolean): boolean {
  if (!recorded || !Number.isInteger(recorded.pid) || recorded.pid <= 1) return false;
  if (recorded.bootId !== currentBootId()) return false;
  if (processStartTime(recorded.pid) !== recorded.startTime) return false;
  const argv = processArgv(recorded.pid);
  return argv !== null && matches(argv);
}

/** "held" while some process owns the flock; the kernel drops it when that process dies, so it can never go stale. */
export function lockState(lockPath: string): "held" | "free" | "unavailable" {
  const r = spawnSync("flock", ["-n", lockPath, "true"], { stdio: "ignore" });
  if (r.error) return "unavailable";
  return r.status === 0 ? "free" : r.status === 1 ? "held" : "unavailable";
}

/**
 * Agent runtimes for this repository that are not under supervision (e.g. a
 * manual `pnpm orchestrator:telegram` in a terminal). Bound to the entry script
 * as an exact argv element resolved against the process cwd, and to the repo
 * root, never a substring match on a command line.
 */
export function findRuntimeProcesses(repoRoot: string, entryRelative: string, exclude: ReadonlySet<number> = new Set()): number[] {
  const entry = resolve(repoRoot, entryRelative);
  const found: number[] = [];
  let pids: string[];
  try {
    pids = readdirSync("/proc").filter((p) => /^\d+$/.test(p));
  } catch {
    return found;
  }
  for (const p of pids) {
    const pid = Number(p);
    if (pid === process.pid || exclude.has(pid)) continue;
    const argv = processArgv(pid);
    const cwd = argv && processCwd(pid);
    if (!argv || !cwd || !/(^|\/)node$/.test(argv[0] ?? "")) continue;
    if (argv.slice(1).some((a) => !a.startsWith("-") && resolve(cwd, a) === entry)) found.push(pid);
  }
  return found;
}
