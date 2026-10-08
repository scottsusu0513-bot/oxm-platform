import { deriveEvidencePlan, gatherSourceEvidence } from "../executive/evidencePlan";
import type { CombinedRepairDiagnoser, CombinedReviewer, GuidanceInterpreter, RepairDiagnoser } from "../planning/managerReasoning";
import type { ManagerReasoningPort } from "../scheduler/types";

/**
 * Runtime adapter from the GPT Manager reasoning backends to the loop's
 * ManagerReasoningPort. It only ATTACHES trusted, bounded evidence the loop
 * itself may not read (working-tree diff, commit-range diffs, source excerpts)
 * and bounds every call with a timeout. Outputs stay raw and untrusted; the
 * loop validates them with manager/managerPlan and fails closed.
 */

const MAX_DIFF = 120_000;

export interface ManagerReasoningBackends {
  diagnoser?: RepairDiagnoser | null;
  guidance?: GuidanceInterpreter | null;
  combined?: CombinedReviewer | null;
  combinedRepair?: CombinedRepairDiagnoser | null;
}

export function createManagerReasoningPort(
  backends: ManagerReasoningBackends,
  deps: {
    timeoutMs: number;
    workingTreeDiff?: (fromSha: string, paths: readonly string[]) => Promise<string>;
    commitRangeDiff?: (fromSha: string, toSha: string) => Promise<string>;
    readFile?: (path: string) => string | null;
    listFiles?: () => Promise<readonly string[]>;
    searchContent?: (keyword: string) => Promise<readonly string[]>;
  },
): ManagerReasoningPort {
  const bounded = (text: string) => (text.length > MAX_DIFF ? `${text.slice(0, MAX_DIFF)}\n…(diff truncated)` : text);
  const port: ManagerReasoningPort = {};
  if (backends.diagnoser) {
    const diagnoser = backends.diagnoser;
    port.diagnose = async (input) => {
      let diff: string | undefined;
      if (input.mode === "change" && deps.workingTreeDiff && input.changedPaths.length) diff = bounded(await deps.workingTreeDiff(input.headSha, input.changedPaths).catch(() => ""));
      let sourceExcerpts: { path: string; excerpt: string }[] | undefined;
      if (deps.readFile && input.sourceTargets.length) {
        const plan = { ...deriveEvidencePlan({ mode: "read_only", intent: null, originalRequest: input.originalRequest }), targets: [...input.sourceTargets] };
        sourceExcerpts = await gatherSourceEvidence({
          plan,
          cited: [],
          ports: { read: deps.readFile, ...(deps.listFiles ? { listFiles: deps.listFiles } : {}), ...(deps.searchContent ? { searchContent: deps.searchContent } : {}) },
        }).catch(() => []);
      }
      return withTimeout(diagnoser.diagnose({ ...input, ...(diff !== undefined ? { diff } : {}), ...(sourceExcerpts?.length ? { sourceExcerpts } : {}) }), deps.timeoutMs);
    };
  }
  if (backends.guidance) {
    const guidance = backends.guidance;
    port.interpretGuidance = (input) => withTimeout(guidance.interpret(input), deps.timeoutMs);
  }
  if (backends.combined) {
    const combined = backends.combined;
    port.reviewCombined = async (input) => {
      const parts = await Promise.all(
        input.parts.map(async (p) => {
          if (!deps.commitRangeDiff || !p.baseSha || !p.headSha) return p;
          return { ...p, diff: bounded(await deps.commitRangeDiff(p.baseSha, p.headSha).catch(() => "")) };
        }),
      );
      return withTimeout(combined.review({ ...input, parts }), deps.timeoutMs);
    };
  }
  if (backends.combinedRepair) {
    const combinedRepair = backends.combinedRepair;
    port.diagnoseCombined = (input) => withTimeout(combinedRepair.diagnose(input), deps.timeoutMs);
  }
  return port;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error("manager reasoning timeout")), ms);
    }),
  ]);
}
