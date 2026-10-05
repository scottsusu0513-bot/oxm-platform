import { assessPriority } from "../scheduler/priority";
import type { IntakeClassification, PreparedIntake } from "./types";

/** Adapter only: all ordering and no-downgrade semantics remain scheduler policy. */
export function seedPriority(
  input: PreparedIntake,
  classification: IntakeClassification
) {
  return assessPriority({
    signals: classification.prioritySignals,
    requested: input.requestedPriority,
  });
}
