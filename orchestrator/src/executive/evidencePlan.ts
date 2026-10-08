import type { TaskCreatingIntent, TaskMode } from "../domain/types";
import { extractEvidenceTargets, type GuidanceConstraint } from "./guidance";

/**
 * Manager evidence planning. Pure except for the injected read/search ports
 * of gatherSourceEvidence.
 *
 * The Manager reasons from the GOAL about which evidence actually answers
 * it. For a factual code question ("what is the homepage search
 * placeholder?") that is the source file, the literal value and its
 * conditional variants, plus an unchanged workspace — never a typecheck run.
 * Technical validation stays secondary for read-only work.
 */

export const EVIDENCE_KINDS = ["factual_lookup", "behaviour_explanation", "audit", "change"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface EvidencePlan {
  kind: EvidenceKind;
  /** Internal requirement statements (English, for Worker/Reviewer instructions; never shown to the owner). */
  requirements: string[];
  /** Search hints: file names, components, identifiers (bounded). */
  targets: string[];
  /** Read-only work: validations never count as evidence for the goal. */
  validationIsEvidence: boolean;
}

const FACTUAL_RE =
  /是什麼|是甚麼|是多少|是哪|哪一個|哪個|哪裡|在哪|有沒有|有哪些|寫什麼|顯示什麼|叫什麼|目前.*(?:文字|字串|設定|值|數值|預設)|\bwhat (?:is|are|does)\b|\bwhich\b|\bwhere (?:is|are|does)\b|\bhow many\b|\bis there\b|\bcurrent(?:ly)? (?:value|text|label|string|setting)\b/i;
const VALUE_WORD_RE = /placeholder|label|text|string|value|title|copy|wording|default|文字|字串|標題|預設|數值|設定值|提示|名稱|網址|路徑/i;

export function deriveEvidencePlan(input: {
  mode: TaskMode;
  intent: TaskCreatingIntent | null;
  originalRequest: string;
  interpretedObjective?: string;
  constraints?: readonly GuidanceConstraint[];
}): EvidencePlan {
  const text = `${input.originalRequest}\n${input.interpretedObjective ?? ""}`;
  const targets: string[] = [];
  const add = (t: string) => {
    if (!targets.includes(t) && targets.length < 8) targets.push(t);
  };
  for (const c of input.constraints ?? []) for (const t of c.evidenceTargets) add(t);
  for (const t of extractEvidenceTargets(text)) add(t);
  if (input.mode !== "read_only") {
    return {
      kind: "change",
      requirements: [
        "The trusted Git diff shows the change that satisfies the owner's intent (passing validations alone never do).",
        "Changed paths stay within the allowed scope.",
      ],
      targets,
      validationIsEvidence: true,
    };
  }
  const workspace = "The authoritative workspace stays unchanged (verified by the orchestrator, not reported by the Worker).";
  const secondary = "Validation runs such as typecheck are secondary and are never evidence for the answer.";
  if (input.intent === "audit_or_review") {
    return {
      kind: "audit",
      requirements: ["Every requested area is inspected by reading its source files.", "Each finding cites the exact file path and a bounded excerpt.", workspace, secondary],
      targets,
      validationIsEvidence: false,
    };
  }
  if (FACTUAL_RE.test(text) && VALUE_WORD_RE.test(text)) {
    return {
      kind: "factual_lookup",
      requirements: [
        "Identify the actual source file/component that defines the value; give its exact repository path.",
        "Quote the exact literal value as written in source, with a path:line reference and a short excerpt.",
        "Report conditional variants (device, locale, state, props) or state explicitly that none exist.",
        workspace,
        secondary,
      ],
      targets,
      validationIsEvidence: false,
    };
  }
  return {
    kind: "behaviour_explanation",
    requirements: ["Explain the behaviour from the source files that implement it, citing exact paths and bounded excerpts.", "State uncertainty and unverified assumptions explicitly.", workspace, secondary],
    targets,
    validationIsEvidence: false,
  };
}

/** Worker-facing evidence instruction appended to a read-only objective (data, not authority). */
export function renderEvidenceInstruction(plan: EvidencePlan): string {
  if (plan.kind === "change") return "";
  const where = plan.targets.length ? ` Start from: ${plan.targets.join(", ")}.` : "";
  return `EVIDENCE THE MANAGER REQUIRES (${plan.kind}):${where}\n${plan.requirements.map((r) => `- ${r}`).join("\n")}`;
}

// ---------------------------------------------------------------------------
// Manager-side gathering of trusted source evidence for the reviewer

export interface SourceExcerpt {
  path: string;
  excerpt: string;
}

export interface SourceEvidencePorts {
  /** Trusted, bounded read of one repository file (null when absent/unsafe). */
  read(path: string): string | null;
  /** Tracked repository files (e.g. `git ls-files`); optional. */
  listFiles?: () => Promise<readonly string[]>;
  /** Tracked files whose content contains `keyword` (e.g. `git grep -l -F -i`); optional. */
  searchContent?: (keyword: string) => Promise<readonly string[]>;
}

const CODE_EXT = /\.(?:tsx?|jsx?|mjs|cjs|css|scss|html|json|md|sql)$/i;
const NOISE = /(?:^|\/)(?:node_modules|dist|build|coverage|\.git)\//;
const MAX_FILES = 6;
const MAX_EXCERPT = 4_000;
const CONTEXT_LINES = 3;

const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const stem = (p: string) => base(p).replace(/\.[^.]+$/, "");

/** Excerpt lines around keyword hits, numbered; falls back to the file head. */
export function excerptAround(content: string, keywords: readonly string[], max = MAX_EXCERPT): string {
  const lines = content.split("\n");
  const kws = keywords.map((k) => k.toLowerCase()).filter((k) => k.length >= 3);
  const keep = new Set<number>();
  lines.forEach((line, i) => {
    const l = line.toLowerCase();
    if (kws.some((k) => l.includes(k))) for (let j = Math.max(0, i - CONTEXT_LINES); j <= Math.min(lines.length - 1, i + CONTEXT_LINES); j++) keep.add(j);
  });
  const chosen = keep.size ? Array.from(keep).sort((a, b) => a - b) : lines.slice(0, 60).map((_, i) => i);
  let out = "";
  let prev = -2;
  for (const i of chosen) {
    const piece = `${i !== prev + 1 && out ? "…\n" : ""}${i + 1}: ${lines[i]}\n`;
    if (out.length + piece.length > max) break;
    out += piece;
    prev = i;
  }
  return out.trimEnd();
}

export interface LineRange {
  /** 1-based, inclusive. */
  start: number;
  end: number;
}

const MAX_LINE_CHARS = 400;

/**
 * Numbered excerpt of the given 1-based line ranges plus `context` lines
 * around each, bounded by `max` characters. The cited lines themselves are
 * kept before any context, so a large file or many ranges cannot crowd them
 * out. Returns null when no range falls inside the file.
 */
export function excerptLines(content: string, ranges: readonly LineRange[], context: number, max: number): { excerpt: string; lines: Set<number> } | null {
  const lines = content.split("\n");
  const inFile = ranges
    .map((r) => ({ start: Math.max(1, r.start), end: Math.min(lines.length, r.end) }))
    .filter((r) => r.start <= r.end);
  if (!inFile.length) return null;
  const cost = (n: number) => `${n}: ${lines[n - 1].slice(0, MAX_LINE_CHARS)}\n`.length + 2; // + room for a "…" gap marker
  const keep = new Set<number>();
  let used = 0;
  const tryAdd = (n: number) => {
    if (n < 1 || n > lines.length || keep.has(n)) return;
    const c = cost(n);
    if (used + c > max) return;
    keep.add(n);
    used += c;
  };
  for (const r of inFile) for (let n = r.start; n <= r.end; n++) tryAdd(n);
  for (let d = 1; d <= context; d++) for (const r of inFile) (tryAdd(r.start - d), tryAdd(r.end + d));
  let out = "";
  let prev = -2;
  for (const n of Array.from(keep).sort((a, b) => a - b)) {
    out += `${n !== prev + 1 && out ? "…\n" : ""}${n}: ${lines[n - 1].slice(0, MAX_LINE_CHARS)}\n`;
    prev = n;
  }
  return { excerpt: out.trimEnd().slice(0, max), lines: keep };
}

/** 1-based line numbers present in a numbered excerpt ("12: …" lines, as produced above). */
export function excerptLineNumbers(excerpt: string): Set<number> {
  const out = new Set<number>();
  for (const line of excerpt.split("\n")) {
    const m = /^(\d{1,7}): /.exec(line);
    if (m) out.add(Number(m[1]));
  }
  return out;
}

function rank(path: string, targets: readonly string[]): number {
  if (NOISE.test(path) || !CODE_EXT.test(path)) return -1;
  let score = 0;
  for (const t of targets) {
    const tl = t.toLowerCase();
    if (base(path).toLowerCase() === tl || stem(path).toLowerCase() === tl) score += 10;
    else if (path.toLowerCase().endsWith(`/${tl}`) || path.toLowerCase() === tl) score += 10;
    else if (stem(path).toLowerCase().includes(tl)) score += 3;
    else if (path.toLowerCase().includes(tl)) score += 1;
  }
  if (/\.(?:test|spec)\./.test(path)) score -= 2;
  if (/^client\/src\//.test(path)) score += 1;
  return score;
}

/**
 * Collects bounded, trusted excerpts: first the files the Worker cited, then
 * files the Manager's evidence plan points at (name match, then content
 * match for identifier keywords). The Worker cannot suppress this evidence by
 * not citing it, and nothing here executes or writes anything.
 */
export async function gatherSourceEvidence(input: { plan: EvidencePlan | null; cited: readonly string[]; ports: SourceEvidencePorts; keywords?: readonly string[] }): Promise<SourceExcerpt[]> {
  const out: SourceExcerpt[] = [];
  const seen = new Set<string>();
  const targets = input.plan?.targets ?? [];
  const keywords = Array.from(new Set([...(input.keywords ?? []), ...targets.filter((t) => !/[./]/.test(t))]));
  const take = (path: string) => {
    if (out.length >= MAX_FILES || seen.has(path)) return;
    const content = input.ports.read(path);
    if (content === null) return;
    seen.add(path);
    out.push({ path, excerpt: excerptAround(content, keywords) });
  };
  for (const p of input.cited) take(p);
  if (!input.plan || input.plan.kind === "change" || targets.length === 0) return out;
  let files: readonly string[] = [];
  try {
    files = input.ports.listFiles ? await input.ports.listFiles() : [];
  } catch {
    files = [];
  }
  const fileTargets = targets.filter((t) => /[./]/.test(t) || /^[A-Z]/.test(t));
  const ranked = files
    .map((p) => ({ p, s: rank(p, fileTargets) }))
    .filter((x) => x.s >= 3)
    .sort((a, b) => b.s - a.s || a.p.localeCompare(b.p));
  for (const { p } of ranked.slice(0, 3)) take(p);
  if (input.ports.searchContent) {
    for (const kw of keywords.filter((k) => k.length >= 4).slice(0, 3)) {
      let hits: readonly string[] = [];
      try {
        hits = await input.ports.searchContent(kw);
      } catch {
        hits = [];
      }
      const scored = hits
        .map((p) => ({ p, s: rank(p, [...fileTargets, kw]) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s || a.p.localeCompare(b.p));
      for (const { p } of scored.slice(0, 2)) take(p);
    }
  }
  return out;
}
