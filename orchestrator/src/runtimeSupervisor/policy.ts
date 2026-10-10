/** Startup failures never restart; only a runtime that reached polling and then died is retried, boundedly. */
export const RESTART_BACKOFF_MS = [10_000, 60_000, 300_000] as const;
export const RESTART_WINDOW_MS = 60 * 60_000;

export type ExitDecision =
  | { action: "stopped" }
  | { action: "startup_failed" }
  | { action: "restart"; delayMs: number }
  | { action: "crashed" };

export function decideAfterExit(input: {
  stopping: boolean;
  reachedPolling: boolean;
  /** Epoch ms of earlier automatic restarts. */
  restarts: readonly number[];
  now: number;
}): ExitDecision {
  if (input.stopping) return { action: "stopped" };
  if (!input.reachedPolling) return { action: "startup_failed" };
  const recent = input.restarts.filter((t) => input.now - t < RESTART_WINDOW_MS).length;
  if (recent >= RESTART_BACKOFF_MS.length) return { action: "crashed" };
  return { action: "restart", delayMs: RESTART_BACKOFF_MS[recent] };
}

const TOKEN_SHAPES = [/\b[0-9]{5,16}:[A-Za-z0-9_-]{30,64}\b/g, /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b/g, /\bsk-[A-Za-z0-9_-]{20,}\b/g];

/** Removes known secret values and secret-shaped tokens from a log line. */
export function redact(line: string, secretValues: readonly string[]): string {
  let out = line;
  for (const value of secretValues) if (value) out = out.split(value).join("<redacted>");
  for (const shape of TOKEN_SHAPES) out = out.replace(shape, "<redacted>");
  return out;
}
