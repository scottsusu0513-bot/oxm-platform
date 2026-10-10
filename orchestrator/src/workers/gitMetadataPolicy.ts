import { GIT_METADATA_COMPONENTS, type GitMetadataComponentId, type GitMetadataScope, type GitMetadataSnapshot, type GitMetadataTrust } from "./gitIntegrity";

/**
 * Git metadata change classification and attribution (pure).
 *
 * The integrity digest says THAT Git metadata changed; this module says WHAT changed (component,
 * entry labels, config key names — never values), WHO plausibly changed it, and what that means:
 *
 *   benign_integration_change   editor/IDE caches and Git housekeeping output Git never reads for
 *                               add/commit (vscode-merge-base, github-pr-base-branch, info/refs).
 *                               Never blocks anything.
 *   environment_change          global/system Git configuration outside the task's Git dir. Not the
 *                               Worker's to answer for; the implementation stands, publication needs
 *                               re-established trust when Git behaviour may differ.
 *   unattributed_change         a repository-level change that cannot be tied to the Worker (outside
 *                               its run window, config keys Git does not act on, a digest-only
 *                               inspector). Never called a Worker violation; the implementation
 *                               stands; publication may need re-established trust.
 *   worker_security_violation   a security-relevant repository component changed inside the Worker's
 *                               exclusive run window and no asynchronous integration writes it (HEAD,
 *                               hooks, replace refs, alternates, shallow, commondir, info/, index
 *                               flags, hooksPath-style targets, Git-behaviour config keys such as
 *                               remote/pushRemote/merge/hooksPath). Hard block.
 *
 * Attribution mirrors workers/attribution.ts: only the delta of THIS execution (before/after
 * snapshots around the Worker process, while the workspace lease is exclusively the Worker's) can be
 * the Worker's, and only for components that nothing but an explicit Git command writes. Anything
 * else is reported without blame.
 */

export const GIT_METADATA_CHANGE_CLASSES = ["benign_integration_change", "environment_change", "unattributed_change", "worker_security_violation"] as const;
export type GitMetadataChangeClass = (typeof GIT_METADATA_CHANGE_CLASSES)[number];

/** worker_run: between the snapshots taken right before the Worker started and right after it exited. */
export type GitMetadataWindow = "worker_run" | "before_worker_start" | "after_worker_run";

/**
 * trusted: integrity digest unchanged. rebind_allowed: changed, but only in ways Git does not act on
 * (the trusted layer may bind the owner's approval to the new state). refresh_required: publication
 * stays blocked until trusted Git evidence is re-established. blocked: a Worker security violation.
 */
export type GitPublicationTrust = "trusted" | "rebind_allowed" | "refresh_required" | "blocked";

export interface GitMetadataChange {
  component: GitMetadataComponentId;
  scope: GitMetadataScope;
  trust: GitMetadataTrust;
  change: "added" | "removed" | "modified";
  /** Changed entry labels (file/dir names, never content), capped. */
  entries: string[];
  /** Changed config key names (never values), capped. */
  keys: string[];
  classification: GitMetadataChangeClass;
  /** Git does not act on this change, so the trusted layer may re-bind publication to it. */
  rebindable: boolean;
  reason: string;
}

export interface GitMetadataEvidence {
  window: GitMetadataWindow;
  beforeDigest: string;
  afterDigest: string;
  /** Component digests after the window (lets later layers detect further drift by component). */
  components: Record<string, string>;
  changes: GitMetadataChange[];
  workerViolation: boolean;
  publicationTrust: GitPublicationTrust;
  /** One-line diagnostic: "component=classification[keys]; …" (ids and key names only). */
  summary: string;
}

const MAX_LISTED = 20;

/** branch.<name>.<key> keys Git itself reads (push/pull/merge targets, rebase policy). */
const GIT_READ_BRANCH_KEY = /^(?:remote|pushremote|merge|mergeoptions|rebase|description)$/;
const INTEGRATION_BRANCH_KEYS = new Set(["vscode-merge-base", "github-pr-base-branch"]);

/**
 * integration: an editor cache key Git never reads. inert: another `branch.<name>.<key>` Git never
 * reads (e.g. the PR extension's github-pr-owner-number). tool_managed: git-lfs's own cache
 * (lfs.*, rewritten by git-lfs during trusted fetch/push). git_behavior: everything else, including
 * anything unparseable.
 */
export function configKeyClass(key: string): "integration" | "inert" | "tool_managed" | "git_behavior" {
  const dot = key.indexOf(".");
  const last = key.lastIndexOf(".");
  const section = dot < 0 ? key : key.slice(0, dot);
  const name = key.slice(last + 1);
  if (name === "(unparsed)" || section === "(unparsed)") return "git_behavior";
  if (section === "branch" && last > dot) {
    if (INTEGRATION_BRANCH_KEYS.has(name)) return "integration";
    return GIT_READ_BRANCH_KEY.test(name) ? "git_behavior" : "inert";
  }
  if (section === "lfs") return "tool_managed";
  return "git_behavior";
}

const CONFIG_COMPONENTS = new Set<GitMetadataComponentId>(["repo.config", "repo.config_worktree", "repo.config_include"]);

function changedKeys(before: Readonly<Record<string, string>>, after: Readonly<Record<string, string>>): string[] {
  return Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    .filter((k) => before[k] !== after[k])
    .sort();
}

/** Structured diff of two snapshots, one change per component whose digest differs. */
export function diffGitMetadata(before: GitMetadataSnapshot, after: GitMetadataSnapshot): Omit<GitMetadataChange, "classification" | "rebindable" | "reason">[] {
  const b = new Map(before.components.map((c) => [c.id, c]));
  const a = new Map(after.components.map((c) => [c.id, c]));
  const ids = Array.from(new Set([...Array.from(b.keys()), ...Array.from(a.keys())]));
  const out: Omit<GitMetadataChange, "classification" | "rebindable" | "reason">[] = [];
  for (const id of ids) {
    const x = b.get(id);
    const y = a.get(id);
    if (x && y && x.digest === y.digest) continue;
    const meta = GIT_METADATA_COMPONENTS[id];
    out.push({
      component: id,
      scope: meta.scope,
      trust: meta.trust,
      change: !x ? "added" : !y ? "removed" : "modified",
      entries: changedKeys(x?.entries ?? {}, y?.entries ?? {}).slice(0, MAX_LISTED),
      keys: changedKeys(x?.keys ?? {}, y?.keys ?? {}).slice(0, MAX_LISTED),
    });
  }
  // A digest-only inspector cannot localize: an integrity-digest change with no component delta is opaque.
  if (out.length === 0 && before.digest !== after.digest) {
    out.push({ component: "opaque", scope: "repository", trust: "security", change: "modified", entries: [], keys: [] });
  }
  return out.sort((x, y) => (x.component < y.component ? -1 : 1));
}

/** Classifies one component change; see the module comment for the rules. */
export function classifyGitMetadataChange(change: Omit<GitMetadataChange, "classification" | "rebindable" | "reason">, window: GitMetadataWindow): GitMetadataChange {
  const done = (classification: GitMetadataChangeClass, rebindable: boolean, reason: string): GitMetadataChange => ({ ...change, classification, rebindable, reason });
  const keyClasses = change.keys.map(configKeyClass);
  const behaviorKeys = change.keys.filter((_, i) => keyClasses[i] === "git_behavior");
  const isConfig = CONFIG_COMPONENTS.has(change.component) || change.component === "env.global_config" || change.component === "env.system_config" || change.component === "env.config_include";
  // Git does not act on the change: only keys Git never reads changed (no file-level-only change).
  const gitInert = isConfig && change.keys.length > 0 && keyClasses.every((k) => k === "integration" || k === "inert");

  if (change.trust !== "security") return done("benign_integration_change", true, change.trust === "integration" ? "editor integration cache Git never reads" : "Git housekeeping output Git never reads for add/commit");
  if (change.component === "opaque") return done("unattributed_change", false, "Git metadata changed but the inspector cannot identify the component");
  if (change.scope === "environment") return done("environment_change", gitInert, "global/system Git configuration outside the task's Git directory changed");
  if (window !== "worker_run") return done("unattributed_change", gitInert, window === "before_worker_start" ? "changed before the Worker started" : "changed after the Worker exited");
  if (isConfig) {
    if (behaviorKeys.length) return done("worker_security_violation", false, `Git-behaviour config key(s) changed during the Worker run: ${behaviorKeys.slice(0, 5).join(", ")}`);
    if (gitInert) return done("unattributed_change", true, "only config keys Git never reads changed; not attributable to the Worker");
    if (change.keys.length) return done("unattributed_change", false, "only tool-managed config keys (git-lfs) changed; not attributable to the Worker");
    return done("unattributed_change", false, "config bytes changed without a key-level difference (formatting/comments); not attributable to the Worker");
  }
  return done("worker_security_violation", false, `${GIT_METADATA_COMPONENTS[change.component].what} changed during the Worker's exclusive run window; no integration writes it`);
}

function publicationTrustOf(beforeDigest: string, afterDigest: string, changes: readonly GitMetadataChange[]): GitPublicationTrust {
  if (changes.some((c) => c.classification === "worker_security_violation")) return "blocked";
  if (beforeDigest === afterDigest) return "trusted";
  return changes.filter((c) => c.trust === "security").every((c) => c.rebindable) && changes.some((c) => c.trust === "security") ? "rebind_allowed" : "refresh_required";
}

export function summarizeGitMetadataChanges(changes: readonly GitMetadataChange[]): string {
  if (!changes.length) return "no Git metadata change";
  return changes
    .map((c) => `${c.component}=${c.classification}${c.keys.length ? `[${c.keys.slice(0, 5).join(",")}]` : c.entries.length ? `[${c.entries.slice(0, 3).join(",")}]` : ""}`)
    .join("; ")
    .slice(0, 600);
}

/** Before/after snapshots of one window -> classified, attributable evidence. */
export function gitMetadataEvidence(before: GitMetadataSnapshot, after: GitMetadataSnapshot, window: GitMetadataWindow): GitMetadataEvidence {
  const changes = diffGitMetadata(before, after).map((c) => classifyGitMetadataChange(c, window));
  return evidenceOf(window, before.digest, after.digest, Object.fromEntries(after.components.map((c) => [c.id, c.digest])), changes);
}

/**
 * Drift observed after a run's evidence was taken, from component digests only (the trusted layer
 * kept the run's after-component digests). Never attributed to the Worker.
 */
export function laterGitMetadataDrift(run: Pick<GitMetadataEvidence, "afterDigest" | "components">, now: GitMetadataSnapshot): GitMetadataEvidence {
  const before: GitMetadataSnapshot = {
    digest: run.afterDigest,
    components: Object.entries(run.components).map(([id, digest]) => ({ id: id as GitMetadataComponentId, digest, entries: {}, keys: {} })),
  };
  return gitMetadataEvidence(before, now, "after_worker_run");
}

/** Combines a run's evidence with later drift: changes of both, end digest of the later one. */
export function combineGitMetadataEvidence(run: GitMetadataEvidence, later: GitMetadataEvidence): GitMetadataEvidence {
  const byComponent = new Map(run.changes.map((c) => [c.component, c]));
  for (const c of later.changes) if (!byComponent.has(c.component)) byComponent.set(c.component, c);
  return evidenceOf(run.window, run.beforeDigest, later.afterDigest, later.components, Array.from(byComponent.values()));
}

function evidenceOf(window: GitMetadataWindow, beforeDigest: string, afterDigest: string, components: Record<string, string>, changes: GitMetadataChange[]): GitMetadataEvidence {
  return {
    window,
    beforeDigest,
    afterDigest,
    components,
    changes,
    workerViolation: changes.some((c) => c.classification === "worker_security_violation"),
    publicationTrust: publicationTrustOf(beforeDigest, afterDigest, changes),
    summary: summarizeGitMetadataChanges(changes),
  };
}

/**
 * Re-binding the Git integrity baseline before a follow-up run (repair, infrastructure retry,
 * availability continuation) of the same task. `prior` is the trusted component snapshot the
 * trusted Git layer holds for the current binding (`baselineDigest`); `now` is taken right before
 * the run starts.
 *
 * Allowed: benign/housekeeping, environment and Git-inert deltas (classified without blame,
 * window before_worker_start). Refused: any delta that would be a security violation had it
 * happened inside a Worker run (HEAD, hooks, replace refs, alternates, remote/pushRemote/merge or
 * other Git-behaviour config, ...), an unidentifiable (opaque) delta, or no trusted component
 * baseline (e.g. after a process restart) while the digest moved. Nothing here is a Worker verdict.
 */
export function assessGitMetadataRebind(
  prior: GitMetadataSnapshot | null,
  baselineDigest: string,
  now: GitMetadataSnapshot,
): { ok: true; evidence: GitMetadataEvidence | null } | { ok: false; reason: string; evidence: GitMetadataEvidence | null } {
  if (now.digest === baselineDigest) return { ok: true, evidence: null };
  if (!prior || prior.digest !== baselineDigest) return { ok: false, reason: "no trusted component baseline for the current binding; Git metadata changed", evidence: null };
  const evidence = gitMetadataEvidence(prior, now, "before_worker_start");
  const security = diffGitMetadata(prior, now).filter((c) => c.component === "opaque" || classifyGitMetadataChange(c, "worker_run").classification === "worker_security_violation");
  if (security.length) return { ok: false, reason: `security-relevant Git metadata changed: ${security.map((c) => c.component).join(", ")}`, evidence };
  return { ok: true, evidence };
}

