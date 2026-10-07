import type { WorkerKind } from "../domain/types";
import { isPathInScope } from "./prompt";

/**
 * Worker permission model. Workers run unattended: there is no
 * "ask the human Yes/No" outcome anywhere on the Worker execution path.
 *
 *   ALLOW                           -> executes automatically, no confirmation
 *   DENY                            -> fails immediately (never prompted)
 *   ORCHESTRATOR_APPROVAL_REQUIRED  -> the Worker may not do it; the run returns
 *                                      a structured failure/observation to the
 *                                      Manager, which uses its own typed gates
 *                                      (needs_human_decision, commit/publish or
 *                                      red-risk approval). A CLI permission
 *                                      prompt is never an approval mechanism.
 *
 * The CLI configurations (Claude allow/deny lists, Codex exec policy and
 * sandbox) are checked against this module in tests.
 */

export const WORKER_INTERACTIVE_PROMPTS_ALLOWED = false as const;

export const WORKER_PERMISSION_DECISIONS = ["ALLOW", "DENY", "ORCHESTRATOR_APPROVAL_REQUIRED"] as const;
export type WorkerPermissionDecision = (typeof WORKER_PERMISSION_DECISIONS)[number];

export type WorkerAction =
  | { kind: "read"; path: string }
  | { kind: "search" }
  | { kind: "edit" | "write"; path: string }
  | { kind: "command"; argv: readonly string[] }
  | { kind: "change_permissions" };

export interface WorkerPermission {
  decision: WorkerPermissionDecision;
  reason: string;
}

/** Paths a Worker may never write: Git metadata and agent/runtime configuration (its own permissions). */
const PROTECTED_WRITE_PREFIXES = [".git/", ".claude/", ".codex/", ".agents/"];
const isProtectedWrite = (path: string) => path === ".git" || PROTECTED_WRITE_PREFIXES.some((p) => path === p.slice(0, -1) || path.startsWith(p));
const isSecretFile = (path: string) => /(^|\/)\.env(\.|$)/.test(path);
const isUnsafePath = (path: string) => path.startsWith("/") || path.split("/").includes("..") || path.includes("\0") || path.trim() === "";

const GIT_READ_ONLY = new Set(["status", "diff", "log", "rev-parse", "ls-files", "show", "blame"]);
const GIT_FORBIDDEN = new Set(
  (
    "add commit push switch checkout branch merge rebase reset config remote tag stash cherry-pick revert restore " +
    "clean fetch pull am apply update-ref update-index worktree gc replace notes submodule init clone filter-branch"
  ).split(" "),
);
const PACKAGE_MANAGERS = new Set(["pnpm", "npm", "yarn", "bun"]);
/** Package-manager subcommands that run trusted, repository-local validation. */
const PACKAGE_ALLOWED = new Set(["test", "check", "build", "lint", "vitest", "tsc"]);
const PACKAGE_FORBIDDEN = new Set(["deploy", "db:push", "migrate", "publish", "install", "add", "remove", "update", "upgrade", "link", "exec", "dlx", "x"]);
const DIAGNOSTIC = new Set(["ls", "pwd", "cat", "head", "tail", "wc", "grep", "rg", "find", "echo", "true", "diff", "sort", "uniq", "file", "stat"]);
const ALWAYS_DENY = new Set([
  "gh", "vercel", "netlify", "flyctl", "railway", "kubectl", "helm", "terraform", "aws", "gcloud", "az",
  "curl", "wget", "ssh", "scp", "rsync", "nc", "sudo", "su", "chmod", "chown", "mysql", "psql", "mongosh",
  "claude", "codex", "docker", "drizzle-kit", "prisma",
]);

export function decideWorkerAction(action: WorkerAction, allowedScope: readonly string[]): WorkerPermission {
  switch (action.kind) {
    case "search":
      return { decision: "ALLOW", reason: "search is read-only" };
    case "read":
      if (isUnsafePath(action.path)) return { decision: "DENY", reason: "path outside the repository" };
      if (isSecretFile(action.path)) return { decision: "DENY", reason: "secret files are never read into Worker output" };
      return { decision: "ALLOW", reason: "read-only access inside the repository" };
    case "edit":
    case "write":
      if (isUnsafePath(action.path)) return { decision: "DENY", reason: "path outside the repository" };
      if (isProtectedWrite(action.path)) return { decision: "DENY", reason: "Git metadata and agent permission configuration are read-only for Workers" };
      if (isSecretFile(action.path)) return { decision: "DENY", reason: "secret files are not Worker-writable" };
      if (isPathInScope(action.path, allowedScope)) return { decision: "ALLOW", reason: "write inside allowedScope" };
      return { decision: "ORCHESTRATOR_APPROVAL_REQUIRED", reason: "write outside allowedScope: scope belongs to the Manager (structured scope_violation)" };
    case "change_permissions":
      return { decision: "DENY", reason: "Workers cannot change their own permission mode or rules" };
    case "command":
      return decideCommand(action.argv);
  }
}

function decideCommand(argv: readonly string[]): WorkerPermission {
  const exe = argv[0]?.split("/").at(-1) ?? "";
  const sub = argv[1] ?? "";
  if (!exe) return { decision: "DENY", reason: "empty command" };
  if (ALWAYS_DENY.has(exe)) return { decision: "DENY", reason: `${exe} is not a Worker capability` };
  if (exe === "git") {
    if (GIT_FORBIDDEN.has(sub)) return { decision: "DENY", reason: `git ${sub} is owned by the trusted Git layer` };
    if (GIT_READ_ONLY.has(sub)) return { decision: "ALLOW", reason: "read-only Git inspection" };
    return { decision: "DENY", reason: `git ${sub || "(none)"} is not on the read-only allowlist` };
  }
  if (PACKAGE_MANAGERS.has(exe)) {
    if (PACKAGE_FORBIDDEN.has(sub)) return { decision: "DENY", reason: `${exe} ${sub} is not a Worker capability` };
    if (PACKAGE_ALLOWED.has(sub)) return { decision: "ALLOW", reason: "approved validation/build command" };
    return { decision: "DENY", reason: `${exe} ${sub || "(none)"} is not an approved package-manager command` };
  }
  if (DIAGNOSTIC.has(exe)) {
    if (exe === "find" && argv.some((a) => a === "-delete" || a.startsWith("-exec") || a.startsWith("-ok"))) return { decision: "DENY", reason: "find actions are not diagnostics" };
    return { decision: "ALLOW", reason: "safe read-only diagnostic" };
  }
  return { decision: "DENY", reason: `${exe} is not on the Worker allowlist` };
}

// ---------------------------------------------------------------------------
// Non-interactive runtime invariants

/** CLI options that would surface or bypass permission UI; never allowed on the Worker path. */
const INTERACTIVE_OR_BYPASS_FLAGS = [
  "--dangerously-skip-permissions",
  "--allow-dangerously-skip-permissions",
  "--dangerously-bypass-approvals-and-sandbox",
  "--approve-for-me",
  "--permission-prompt-tool",
  "--full-auto",
  "--add-dir",
  "--worktree",
];

/**
 * Pre-spawn invariant: the argv must make the runtime fully non-interactive
 * (deny instead of prompt) without widening permissions. Returns a violation
 * reason, or null when the configuration is valid.
 */
export function nonInteractiveViolation(kind: WorkerKind, args: readonly string[]): string | null {
  if (WORKER_INTERACTIVE_PROMPTS_ALLOWED !== false) return "interactive worker prompts must be disabled";
  const flag = args.find((a) => INTERACTIVE_OR_BYPASS_FLAGS.some((f) => a === f || a.startsWith(`${f}=`)));
  if (flag) return `forbidden worker runtime option ${flag}`;
  const after = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (kind === "claude") {
    if (args[0] !== "-p") return "Claude worker must run headless (-p)";
    if (after("--permission-mode") !== "dontAsk") return "Claude worker must use --permission-mode dontAsk";
    if (after("--permission-prompts") !== "none") return "Claude worker must use --permission-prompts none";
    if (!args.includes("--setting-sources") || after("--setting-sources") !== "") return "Claude worker must not load user/project/local settings";
    if (!args.includes("--strict-mcp-config")) return "Claude worker must not load MCP servers";
    if (args.filter((a) => a === "--permission-mode").length !== 1) return "Claude worker permission mode must be set exactly once";
    return null;
  }
  if (kind === "codex") {
    if (args[0] !== "exec") return "Codex worker must run headless (exec)";
    if (!args.includes('approval_policy="never"')) return 'Codex worker must use approval_policy="never"';
    if (args.some((a) => /^approval_policy=/.test(a) && a !== 'approval_policy="never"')) return "Codex worker approval policy must be never";
    const sandbox = after("--sandbox") ?? after("-s");
    if (sandbox === "danger-full-access") return "Codex worker must stay sandboxed";
    return null;
  }
  return "worker kind is not executable";
}

/**
 * Patterns of an interactive confirmation prompt. If one appears in the
 * output of a run that timed out or failed, the runtime was misconfigured
 * (it waited for a human) — a configuration defect, not a transient failure.
 */
const INTERACTIVE_PROMPT_PATTERNS = [
  /\bdo you want to (?:proceed|continue|allow|make this edit|run)\b/i,
  /\((?:y\/n|yes\/no)\)|\[(?:y\/n|Y\/n|y\/N)\]/,
  /\bwaiting for (?:approval|confirmation|user input)\b/i,
  /\bapprove (?:this|the) (?:command|action|edit|request)\b/i,
  /\bpress enter to\b/i,
  /\ballow (?:once|always)\b/i,
];

export function looksLikeInteractivePrompt(output: string): boolean {
  const tail = output.slice(-8_000);
  return INTERACTIVE_PROMPT_PATTERNS.some((re) => re.test(tail));
}
