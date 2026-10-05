import { classifyTask } from "../domain/risk";
import { routeTask } from "../domain/routing";
import type { RiskDecision, WorkerAvailability } from "../domain/types";
import type { IntakeClassification } from "./types";

/** User worker preference is advisory; the existing policy remains authoritative. */
export function seedRouting(
  taskId: string,
  classification: IntakeClassification,
  risk: RiskDecision,
  availability: WorkerAvailability
) {
  return routeTask(
    {
      ...classifyTask({
        id: taskId,
        category: classification.category,
        actions: classification.actions,
      }),
      risk,
    },
    availability
  );
}
