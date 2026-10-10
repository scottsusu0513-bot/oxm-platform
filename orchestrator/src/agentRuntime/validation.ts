import type { AcceptanceEvidence, ValidationEvidence } from "../manager/types";
import { MAX_REVIEW_DIFF, semanticAcceptance, validationCriterionStatus } from "../planning/goalAcceptance";
import type { GoalReviewer, TrustedWorkspaceEvidence } from "../planning/types";
import { createEvidencePort, splitTaskOwnedDelta } from "../scheduler/adapters";
import type { EvidencePort } from "../scheduler/types";
import { VALIDATION_COMMANDS } from "../workers/prompt";
import type { GitInspector, ProcessRunner, RequiredValidation } from "../workers/types";
import { attributeValidationFailure, classifyValidationExit, type ValidationClassification } from "./validationOutcome";

const MAX_WORKSPACE_PATHS = 20;

/**
 * Trusted validation for general Agent tasks: after the existing git/result
 * checks, the orchestrator itself runs each required validation command
 * (never the Worker's own report) with a bound, then re-verifies that the
 * validation run did not change the workspace. Output is discarded; only the
 * exit status becomes evidence. Acceptance criteria are backed by these
 * trusted validations, exactly like the simulation's evidence policy.
 */
export function createTrustedValidationEvidencePort(input: {
  git: GitInspector;
  runner: ProcessRunner;
  repoRoot: string;
  timeoutMs: number;
  commands?: Readonly<Record<RequiredValidation, string>>;
  /** Manager's trusted goal reviewer; without it goal criteria stay unverified (fail closed). */
  reviewer?: GoalReviewer | null;
  reviewTimeoutMs?: number;
  /** Trusted unified diff of `paths` against `fromSha` (working tree, including new files). */
  diff?: (fromSha: string, paths: readonly string[]) => Promise<string>;
  /** Trusted read of a repository file for cited-file evidence; null when absent. */
  readFile?: (path: string) => string | null;
  /** Trusted read-only repository listing/search for the Manager's own source evidence (read-only tasks). */
  listFiles?: () => Promise<readonly string[]>;
  searchContent?: (keyword: string) => Promise<readonly string[]>;
}): EvidencePort {
  const commands = input.commands ?? VALIDATION_COMMANDS;
  const base = createEvidencePort({ git: input.git, validations: () => [], acceptance: () => [] });

  async function run(command: string): Promise<ValidationClassification> {
    const [exe, ...args] = command.split(" ");
    let handle: ReturnType<ProcessRunner["spawn"]>;
    try {
      handle = input.runner.spawn({ command: exe, args, cwd: input.repoRoot });
    } catch {
      return classifyValidationExit(null, false);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        handle.kill();
        resolve("timeout");
      }, input.timeoutMs);
    });
    try {
      const exit = await Promise.race([handle.exit, timedOut]);
      return exit === "timeout" ? classifyValidationExit(null, true) : classifyValidationExit(exit, false);
    } catch {
      return classifyValidationExit(null, false);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async record(req) {
      const recorded = await base.record(req);
      const before = { changed: [...recorded.changedPaths].sort(), identities: await input.git.contentIdentities(recorded.changedPaths) };
      const runs: { name: RequiredValidation; command: string | undefined; outcome: ValidationClassification }[] = [];
      for (const name of req.contract.requiredValidations) {
        const command = commands[name];
        runs.push({ name, command, outcome: command ? await run(command) : { status: "unverified" } });
      }
      // A validation run must not alter what the Manager is about to judge: the task-owned delta
      // (paths + exact bytes), branch, HEAD and Git metadata. Other actors' changes elsewhere in a
      // shared workspace are not the task's and only widen the excluded (foreign) set.
      const [status, changed, digest] = await Promise.all([input.git.status(), input.git.changedPathsSince(req.contract.expectedHeadSha!), input.git.metadataDigest()]);
      const identities = await input.git.contentIdentities(recorded.changedPaths);
      const split = splitTaskOwnedDelta(changed, req.contract, req.result);
      if (
        status.headSha !== recorded.verifiedHeadSha ||
        status.branch !== req.contract.branch ||
        digest !== req.contract.gitMetadataDigest ||
        JSON.stringify(split.owned) !== JSON.stringify(before.changed) ||
        JSON.stringify(identities) !== JSON.stringify(before.identities)
      )
        throw new Error("[agent-runtime] validation changed the workspace; refusing to judge it");
      const foreign = Array.from(new Set([...(recorded.foreignPaths ?? []), ...split.foreign])).sort();
      const record = { ...recorded, ...(foreign.length ? { foreignPaths: foreign } : {}) };
      // Only a run that executed and failed with no infrastructure sign and no unrelated workspace
      // state present is failed_due_to_task; everything else is reported as not verified.
      const validations: ValidationEvidence[] = runs.map(({ name, command, outcome }) => {
        const c = attributeValidationFailure(outcome, foreign.length);
        return {
          name,
          requested: true,
          executed: Boolean(command) && c.status !== "unavailable",
          status: command ? c.status : "missing",
          trusted: true,
          ...(c.summary ? { summary: c.summary } : {}),
        };
      });
      // Reached only after every check above passed (and base.record pinned HEAD to the start SHA).
      const workspace: TrustedWorkspaceEvidence = {
        branch: status.branch,
        headSha: status.headSha,
        changedPaths: before.changed.slice(0, MAX_WORKSPACE_PATHS),
        changedPathCount: before.changed.length,
        workspaceUnchanged: before.changed.length === 0 && status.headSha === req.contract.expectedHeadSha,
      };
      if (req.goal) {
        let diffText = "";
        if (req.goal.mode !== "read_only" && record.changedPaths.length > 0 && input.diff) {
          try {
            diffText = await input.diff(req.contract.expectedHeadSha!, record.changedPaths);
          } catch {
            diffText = "";
          }
        }
        const judged = await semanticAcceptance({
          goal: req.goal,
          validations,
          reviewer: input.reviewer ?? null,
          reviewId: req.runId,
          diff: { text: diffText.slice(0, MAX_REVIEW_DIFF), truncated: diffText.length > MAX_REVIEW_DIFF },
          answer: req.result.summary,
          fileContent: input.readFile ?? (() => null),
          workspace,
          sourcePorts: { ...(input.listFiles ? { listFiles: input.listFiles } : {}), ...(input.searchContent ? { searchContent: input.searchContent } : {}) },
          timeoutMs: input.reviewTimeoutMs ?? 180_000,
        });
        return {
          ...record,
          validations,
          acceptance: judged.acceptance,
          managerReviewCalls: judged.reviewCalls,
          citedFiles: judged.citedFiles,
          constraintVerdicts: judged.constraintVerdicts,
          ...(judged.ownerAnswer ? { managerAnswer: judged.ownerAnswer } : {}),
          ...(judged.reviewUnavailable ? { goalReviewUnavailable: true } : {}),
        };
      }
      // Validation-backed criteria: a confirmed failure fails them; validations that could not be
      // verified leave them unverified (reported to the owner, never repaired).
      const criterion = validationCriterionStatus(validations);
      const reference = (criterion === "unknown" ? validations.find((v) => v.status !== "passed")?.name : req.contract.requiredValidations[0]) ?? null;
      const acceptance: AcceptanceEvidence[] = req.contract.acceptanceCriteria.map((_, i) => ({
        criterionId: `AC-${i + 1}`,
        status: criterion,
        evidenceType: "validation",
        reference,
        ...(criterion === "unknown" ? { confirmedFailureOnly: true } : {}),
      }));
      return { ...record, validations, acceptance };
    },
  };
}
