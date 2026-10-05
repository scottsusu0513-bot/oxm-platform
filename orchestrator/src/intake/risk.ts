import { assessRisk } from "../domain/risk";
import type { IntakeClassification } from "./types";

/** Adapter only: all risk semantics remain in domain/risk. */
export function seedRisk(
  taskId: string,
  classification: IntakeClassification,
  expectedPaths: readonly string[]
) {
  return assessRisk({
    id: taskId,
    category: classification.category,
    actions: classification.actions,
    changedPaths: expectedPaths,
  });
}
