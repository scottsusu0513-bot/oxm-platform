import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";

/**
 * Exclusive ownership of one durable state directory by ONE Agent runtime.
 *
 * Two runtimes on the same state directory both consume the same owner update
 * queue (the Wake Gateway serves getUpdates semantics to every puller), both
 * answer every owner message and both append to the same durable log. The
 * supervisor's own flock only covers runtimes it started, so the runtime
 * itself takes this lock before it opens any durable state — whoever starts it
 * (supervisor, terminal, another agent session).
 *
 * The lock is a kernel flock held by a `flock` child whose stdin is a pipe
 * from this process: when this process exits for any reason (including
 * SIGKILL) the pipe closes, the holder exits and the kernel releases the lock.
 * It can never go stale and needs no pid files or timeouts.
 */
export type InstanceLockResult = { ok: true; release(): void } | { ok: false; code: "held" | "unavailable" };

const HELD_EXIT = 75;
const READY = "oxm-instance-lock-acquired";

export function acquireInstanceLock(lockPath: string, options: { waitSeconds?: number; spawn?: typeof nodeSpawn } = {}): Promise<InstanceLockResult> {
  const spawn = options.spawn ?? nodeSpawn;
  const waitSeconds = Math.max(0, Math.min(30, Math.floor(options.waitSeconds ?? 5)));
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      // -w: a bounded kernel wait, so a supervisor restart is not refused while the previous runtime's
      // holder is still exiting; -E: a distinct exit code when someone else keeps holding it. The holder
      // prints a marker once the lock is held, then blocks reading stdin until this process goes away.
      child = spawn("flock", ["-w", String(waitSeconds), "-E", String(HELD_EXIT), lockPath, "sh", "-c", `echo ${READY}; exec cat >/dev/null`], { stdio: ["pipe", "pipe", "ignore"] });
    } catch {
      return resolve({ ok: false, code: "unavailable" });
    }
    let settled = false;
    let out = "";
    const settle = (result: InstanceLockResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.on("error", () => settle({ ok: false, code: "unavailable" }));
    child.on("exit", (code) => settle({ ok: false, code: code === HELD_EXIT ? "held" : "unavailable" }));
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
      if (!out.includes(READY)) return;
      child.stdout?.removeAllListeners("data");
      child.stdout?.destroy();
      // The holder must not keep this process alive on its own, nor outlive it.
      child.unref();
      (child.stdin as unknown as { unref?: () => void } | null)?.unref?.();
      settle({
        ok: true,
        release() {
          child.stdin?.end();
          child.kill();
        },
      });
    });
  });
}
