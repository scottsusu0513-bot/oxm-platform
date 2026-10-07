import type { AnthropicMessagesTransport } from "./anthropicHttp";
import { createStructuredGoalReviewer, createStructuredIntentPlanner, type StructuredPlanningBackend } from "./planners";
import type { GoalReviewer, IntentPlanner } from "./types";

/**
 * Optional Anthropic API planning backend (API billing; requires
 * ANTHROPIC_API_KEY). Selected only by OXM_AGENT_PLANNER_PROVIDER=anthropic_api;
 * the default backend is the Claude Code CLI (./claudeCli). Output is
 * constrained with structured outputs and still validated deterministically
 * by ./normalize; a refusal, a non-JSON answer or an API error throws, which
 * every caller treats as "unavailable" (fail closed — no task is created and
 * no criterion is accepted). Requests go through the native-HTTP transport in
 * ./anthropicHttp (no SDK dependency).
 */
export const DEFAULT_PLANNER_MODEL = "claude-opus-5-5";

export function createAnthropicPlanningBackend(client: AnthropicMessagesTransport, model: string = DEFAULT_PLANNER_MODEL): StructuredPlanningBackend {
  return {
    async structured({ system, user, schema, maxTokens }) {
      const response = await client.createMessage({
        betas: ["server-side-fallback-2026-07-01"],
        body: {
          model,
          max_tokens: maxTokens,
          fallbacks: "default",
          output_config: { effort: "high", format: { type: "json_schema", schema } },
          system,
          messages: [{ role: "user", content: user }],
        },
      });
      if (response.stopReason === "refusal" || response.stopReason === "max_tokens") throw new Error(`planning call stopped: ${response.stopReason}`);
      return JSON.parse(response.text) as unknown;
    },
  };
}

export function createAnthropicIntentPlanner(input: { client: AnthropicMessagesTransport; model?: string }): IntentPlanner {
  return createStructuredIntentPlanner(createAnthropicPlanningBackend(input.client, input.model));
}

export function createAnthropicGoalReviewer(input: { client: AnthropicMessagesTransport; model?: string }): GoalReviewer {
  return createStructuredGoalReviewer(createAnthropicPlanningBackend(input.client, input.model));
}
