import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import type { ProcessExit, ProcessRunner, ProcessSpec, RunningProcess, Timer } from "./types";

/**
 * The only module that starts OS processes. Exec-file style: `shell: false`
 * and an argument array, so no argument is ever parsed as shell syntax. The
 * child runs in its own process group so kill() also stops its descendants
 * (tool subprocesses). Output is buffered up to a cap and returned to the
 * adapter for parsing only — it is never logged or persisted here.
 */

export const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
export const KILL_GRACE_MS = 5_000;

export function createNodeProcessRunner(opts: { maxOutputBytes?: number; killGraceMs?: number } = {}): ProcessRunner {
  const maxBytes = opts.maxOutputBytes ?? MAX_OUTPUT_BYTES;
  const graceMs = opts.killGraceMs ?? KILL_GRACE_MS;

  return {
    spawn(spec: ProcessSpec): RunningProcess {
      const child = spawn(spec.command, [...spec.args], {
        cwd: spec.cwd,
        shell: false,
        detached: true,
        windowsHide: true,
        stdio: [spec.stdinFile ? "pipe" : "ignore", "pipe", "pipe"],
      });

      let killed = false;
      let graceTimer: ReturnType<typeof setTimeout> | undefined;
      const signalGroup = (sig: NodeJS.Signals) => {
        if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
        try {
          process.kill(-child.pid, sig);
        } catch {
          try {
            child.kill(sig);
          } catch {
            // already gone
          }
        }
      };
      const kill = () => {
        if (killed) return;
        killed = true;
        signalGroup("SIGTERM");
        graceTimer = setTimeout(() => signalGroup("SIGKILL"), graceMs);
        graceTimer.unref?.();
      };

      const exit = new Promise<ProcessExit>((resolve) => {
        const out: Buffer[] = [];
        const err: Buffer[] = [];
        let size = 0;
        let truncated = false;
        const collect = (sink: Buffer[]) => (chunk: Buffer) => {
          if (truncated) return;
          size += chunk.length;
          if (size > maxBytes) {
            truncated = true;
            kill();
            return;
          }
          sink.push(chunk);
        };
        child.stdout?.on("data", collect(out));
        child.stderr?.on("data", collect(err));

        if (spec.stdinFile && child.stdin) {
          const input = createReadStream(spec.stdinFile);
          input.on("error", () => kill());
          child.stdin.on("error", () => {}); // EPIPE if the child exits early
          input.pipe(child.stdin);
        }

        let settled = false;
        const finish = (exitCode: number | null, signal: string | null) => {
          if (settled) return;
          settled = true;
          if (graceTimer) clearTimeout(graceTimer);
          resolve({
            exitCode,
            signal,
            stdout: Buffer.concat(out).toString("utf8"),
            stderr: Buffer.concat(err).toString("utf8"),
            truncated,
          });
        };
        child.on("error", () => finish(null, null));
        child.on("close", (code, signal) => finish(code, signal));
      });

      return { exit, kill };
    },
  };
}

export const realTimer: Timer = {
  schedule(ms, cb) {
    const t = setTimeout(cb, ms);
    return () => clearTimeout(t);
  },
};
