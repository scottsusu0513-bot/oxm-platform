import { realpathSync, statSync } from "node:fs";
import { isSafeWorkspaceRoot } from "../codespace/policy";

/**
 * Resolves the trusted repository root injected by the entrypoint (never a
 * hard-coded host path). Fails closed — no fallback to "/" or the process
 * working directory — when the root is relative, unnormalized, missing, not a
 * directory, or resolves to an unsafe path.
 */
export function resolveRepoRoot(repoRoot: string): { ok: true; root: string } | { ok: false; reason: string } {
  if (!isSafeWorkspaceRoot(repoRoot)) return { ok: false, reason: "repository root must be an absolute, normalized path" };
  let real: string;
  try {
    real = realpathSync(repoRoot);
    if (!statSync(real).isDirectory()) return { ok: false, reason: "repository root is not a directory" };
  } catch {
    return { ok: false, reason: "repository root does not exist or is not readable" };
  }
  if (!isSafeWorkspaceRoot(real)) return { ok: false, reason: "repository root resolves to an unsafe path" };
  return { ok: true, root: real };
}
