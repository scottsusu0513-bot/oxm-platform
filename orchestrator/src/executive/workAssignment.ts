import type { TaskCategory, WorkerKind } from "../domain/types";

/**
 * Fixed OXM Worker assignment policy. Pure and deterministic; the GPT
 * Manager's interpretation may ADD a work area but can never remove one the
 * policy detects, and can never pick a Worker directly.
 *
 *   programming (backend, frontend logic, DB, API, auth, security, infra,
 *                tests, architecture, performance, bug fixes) -> Claude
 *   visual      (UI appearance, layout, CSS/Tailwind, spacing, typography,
 *                hierarchy, responsive design, animation, polish) -> Codex
 *   mixed       -> decomposed: Claude does the programming part, Codex the
 *                  visual part; the Manager reviews both.
 *
 * Availability exceptions:
 *   - Claude programming task + Claude QUOTA exhausted -> Codex covers the
 *     SAME task temporarily; Claude takes it back at a safe boundary once it
 *     is available again.
 *   - Visual task + Codex unavailable -> pause and wait for Codex. Claude is
 *     never a fallback for pure site-visual work.
 *   - No eligible Worker -> pause; never another provider, never less safety.
 */

export const WORK_AREAS = ["programming", "visual"] as const;
export type WorkArea = (typeof WORK_AREAS)[number];

export const PRIMARY_WORKER: Readonly<Record<WorkArea, WorkerKind>> = Object.freeze({ programming: "claude", visual: "codex" });

export interface WorkAreas {
  programming: boolean;
  visual: boolean;
}

const VISUAL_RE =
  /\b(?:css|tailwind|styl(?:e|es|ing)|stylesheet|layout|spacing|padding|margin|typography|fonts?|colou?rs?|visual(?:ly)?|re-?design|design polish|animation|animate|transition effect|responsive|look(?:s)? (?:and feel|better)|appearance|polish|alignment|align|theme|hover effect|ui look|page composition|visual hierarchy)\b|樣式|版面|排版|間距|留白|字體|字型|字級|顏色|配色|色彩|視覺|外觀|美化|美觀|動畫|動效|改版|重新設計|響應式|對齊|好看|設計感|質感|風格|佈局|布局/i;
const PROGRAMMING_RE =
  /\b(?:api|apis|backend|back-end|server|database|db|sql|query|queries|schema|migration|auth|oauth|login|logout|session|permission|rbac|security|vulnerab\w*|unit tests?|test coverage|logic|bug|bugs|crash|error handling|performance|perf|latency|endpoint|trpc|router|drizzle|data consistency|cache|caching|infra(?:structure)?|architecture|refactor|typescript|node|express|validation logic|search logic|ranking)\b|邏輯|後端|伺服器|資料庫|資料表|查詢|權限|登入|登出|認證|安全|資安|效能|單元測試|測試覆蓋|錯誤處理|程式碼|程式邏輯|架構|搜尋結果|排序|演算法|快取|資料一致|串接|介接|接口|API/i;
const COLOUR_WORD_RE = /[紅橙黃綠藍紫黑白灰粉金銀]色/;

/** Raw signals only (no Claude default); used to slice criteria of a decomposed request. */
export function rawWorkAreas(text: string): WorkAreas {
  return { programming: PROGRAMMING_RE.test(text), visual: VISUAL_RE.test(text) || COLOUR_WORD_RE.test(text) };
}

/** Deterministic, multilingual detection of the work areas a request touches. */
export function detectWorkAreas(text: string): WorkAreas {
  const raw = rawWorkAreas(text);
  // Nothing recognisable: Claude is the default code engineer.
  return { programming: raw.programming || !raw.visual, visual: raw.visual };
}

/**
 * Final areas: the union of the Manager's declared areas and the
 * deterministic detection, so the Manager can never silently drop a visual
 * part to keep it with Claude (or a programming part to keep it with Codex).
 */
export function resolveWorkAreas(declared: Partial<WorkAreas> | null | undefined, text: string): WorkAreas {
  const raw = rawWorkAreas(text);
  const visual = declared?.visual === true || raw.visual;
  const programming = declared?.programming === true || raw.programming;
  return { programming: programming || !visual, visual };
}

export type WorkShape = "programming" | "visual" | "mixed";

export function workShape(areas: WorkAreas): WorkShape {
  if (areas.programming && areas.visual) return "mixed";
  return areas.visual ? "visual" : "programming";
}

const CODEX_CATEGORIES: ReadonlySet<TaskCategory> = new Set<TaskCategory>(["ui", "css", "layout", "visual_polish", "frontend_styling"]);

export function isVisualCategory(category: TaskCategory): boolean {
  return CODEX_CATEGORIES.has(category);
}

/**
 * Category the deterministic router sees for one work part. A visual part
 * always lands on a Codex-primary category; a programming part never does.
 */
export function categoryForArea(area: WorkArea, classified: TaskCategory): TaskCategory {
  if (area === "visual") return isVisualCategory(classified) ? classified : "frontend_styling";
  return isVisualCategory(classified) ? "general_coding" : classified;
}

export interface WorkPart {
  area: WorkArea;
  worker: WorkerKind;
  objective: string;
}

/**
 * Splits a mixed request. Each part keeps the owner's whole objective as
 * context but states which half it owns, so neither Worker silently does the
 * other's half.
 */
export function decomposeWork(input: { areas: WorkAreas; objective: string; programmingObjective?: string | null; visualObjective?: string | null }): WorkPart[] {
  const shape = workShape(input.areas);
  if (shape !== "mixed") return [{ area: shape, worker: PRIMARY_WORKER[shape], objective: input.objective }];
  const part = (area: WorkArea, own: string | null | undefined, label: string) => ({
    area,
    worker: PRIMARY_WORKER[area],
    objective: `${own && own.trim() ? own.trim() : input.objective}\n\n[${label}] ${
      area === "programming"
        ? "You own ONLY the programming part (logic, data, API, tests). Do not change visual styling, layout, CSS or Tailwind classes; the visual part is assigned to another Worker."
        : "You own ONLY the site-visual part (layout, CSS/Tailwind, spacing, typography, visual hierarchy, responsive visuals). Do not change APIs, data or business logic; the programming part is assigned to another Worker."
    }`,
  });
  return [part("programming", input.programmingObjective, "Programming part"), part("visual", input.visualObjective, "Visual part")];
}

// ---------------------------------------------------------------------------
// Availability-driven execution decisions

export type WorkerAvailabilityStatus = "available" | "quota_exhausted" | "unavailable";

export interface WorkerAvailabilityState {
  status: WorkerAvailabilityStatus;
  /** Why it is not available (quota, login, missing executable, service outage). */
  cause?: "quota" | "authentication" | "executable" | "service";
  /** Trusted reset time when the provider exposed one; null otherwise (never invented). */
  resetAt: string | null;
}

export type WorkerAvailabilityMap = Readonly<Record<WorkerKind, WorkerAvailabilityState>>;

export const ALL_AVAILABLE: WorkerAvailabilityMap = Object.freeze({
  claude: Object.freeze({ status: "available", resetAt: null }),
  codex: Object.freeze({ status: "available", resetAt: null }),
});

export type ExecutionDecision =
  | { action: "run"; worker: WorkerKind; temporary: boolean; reason: string }
  /** Claude quota exhausted on a programming task: Codex continues the SAME task. */
  | { action: "takeover"; from: "claude"; worker: "codex"; temporary: true; reason: string }
  /** Claude available again: it resumes the SAME task from Codex's progress. */
  | { action: "handback"; from: "codex"; worker: "claude"; temporary: false; reason: string }
  | { action: "pause"; waitingFor: WorkerKind[]; resetAt: string | null; reason: string };

/**
 * Which Worker may execute the next run of a task. `current` is the Worker
 * that ran the task last (null before the first run); `temporary` marks a
 * Codex cover of a Claude programming task. Called only at safe boundaries
 * (before a run starts), never mid-run.
 */
export function decideExecutionWorker(input: { area: WorkArea; current: WorkerKind | null; temporary: boolean; availability: WorkerAvailabilityMap }): ExecutionDecision {
  const a = input.availability;
  if (input.area === "visual") {
    if (a.codex.status === "available") return { action: "run", worker: "codex", temporary: false, reason: "site-visual work runs on Codex" };
    return { action: "pause", waitingFor: ["codex"], resetAt: a.codex.resetAt, reason: `Codex ${a.codex.status}; visual work waits for Codex and is never handed to Claude` };
  }
  if (a.claude.status === "available") {
    if (input.current === "codex" && input.temporary) return { action: "handback", from: "codex", worker: "claude", temporary: false, reason: "Claude available again; programming task returns to its primary Worker" };
    return { action: "run", worker: "claude", temporary: false, reason: "programming work runs on Claude" };
  }
  // Only a Claude QUOTA exhaustion allows Codex to cover programming work.
  if (a.claude.status === "quota_exhausted" && a.codex.status === "available") {
    if (input.current === "claude" || input.current === null) return { action: "takeover", from: "claude", worker: "codex", temporary: true, reason: "Claude quota exhausted; Codex temporarily continues the same programming task" };
    return { action: "run", worker: "codex", temporary: true, reason: "Codex continues covering while Claude's quota is exhausted" };
  }
  const waitingFor: WorkerKind[] = a.claude.status === "quota_exhausted" ? ["claude", "codex"] : ["claude"];
  const resets = waitingFor.map((k) => a[k].resetAt).filter((r): r is string => r !== null).sort();
  return {
    action: "pause",
    waitingFor,
    resetAt: resets[0] ?? null,
    reason: a.claude.status === "quota_exhausted" ? "Claude and Codex are both unavailable; waiting for an eligible Worker" : `Claude ${a.claude.status}; Codex may only cover a Claude quota exhaustion`,
  };
}

/** Primary area of a single-area task from its routed category (used for tasks created without a Manager plan). */
export function areaForCategory(category: TaskCategory): WorkArea {
  return isVisualCategory(category) ? "visual" : "programming";
}
