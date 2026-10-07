/**
 * OXM Agent runtime with the Telegram Human Control Plane (long polling).
 *
 *   pnpm orchestrator:telegram -- --check         validate env + bot token (getMe), then exit
 *   pnpm orchestrator:telegram                    run the long-lived Agent runtime
 *   pnpm orchestrator:telegram -- --compact       compact the durable log, then exit
 *   pnpm orchestrator:telegram -- --reconcile     apply deterministic startup recoveries, then run
 *   pnpm orchestrator:telegram -- --submit-smoke  diagnostic: also submit the smoke fixture task once
 *
 * Tasks are created from Telegram with /goal. Reads TELEGRAM_BOT_TOKEN /
 * TELEGRAM_OWNER_CHAT_ID and the OXM_AGENT_* runtime configuration from the
 * environment and never prints secret values. Durable state lives outside the
 * repository (OXM_ORCHESTRATOR_STATE_DIR, default ~/.oxm-orchestrator).
 */
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { createAgentRuntime } from "../orchestrator/src/agentRuntime/compose";
import { createPlanningBackend } from "../orchestrator/src/agentRuntime/planningBackend";
import { readAgentRuntimeConfig } from "../orchestrator/src/agentRuntime/config";
import { smokeTaskDefinition } from "../orchestrator/src/e2e/harness";
import { createHumanOwnerSession } from "../orchestrator/src/humanInteraction/auth";
import { createAuditHumanInteractionLedger } from "../orchestrator/src/humanInteraction/ledger";
import { createHumanInteractionService } from "../orchestrator/src/humanInteraction/service";
import { compactAuditLog } from "../orchestrator/src/persistence/compact";
import { createFileAuditRepository, type FileAuditRepository } from "../orchestrator/src/persistence/fileAudit";
import { createTelegramBotClient } from "../orchestrator/src/telegram/client";
import { readTelegramConfig } from "../orchestrator/src/telegram/config";
import { createTelegramControlPlane, createTelegramTransport, TelegramStartupError } from "../orchestrator/src/telegram/controlPlane";

const args = new Set(process.argv.slice(2));
const now = () => new Date().toISOString();
const say = (line: string) => process.stdout.write(`[oxm-agent] ${line}\n`);
const fail = (line: string, details: string[] = []): never => {
  say(`FAILED: ${line}`);
  for (const d of details) say(`  - ${d}`);
  process.exit(1);
};

const telegram = readTelegramConfig(process.env, { expectedBotUsername: "OXM_Agent_bot" });
if (!telegram.ok) fail(telegram.reason);
const config = (telegram as Extract<typeof telegram, { ok: true }>).config;
const client = createTelegramBotClient({ token: config.botToken });

if (args.has("--check")) {
  try {
    const me = await client.getMe();
    if (config.expectedBotUsername && me.username?.toLowerCase() !== config.expectedBotUsername.toLowerCase()) fail("bot identity does not match the expected username");
    say(`Telegram bot connected (@${me.username ?? "unknown"})`);
    say("owner configured");
    process.exit(0);
  } catch {
    fail("Telegram getMe failed (token rejected or network error)");
  }
}

const stateDir = resolve(process.env.OXM_ORCHESTRATOR_STATE_DIR || join(homedir(), ".oxm-orchestrator"));
const rel = relative(process.cwd(), stateDir);
if (!rel.startsWith("..") && !isAbsolute(rel)) fail("OXM_ORCHESTRATOR_STATE_DIR must be outside the repository");
const logPath = join(stateDir, "control-plane-audit.jsonl");

// Bounded log growth: superseded checkpoints/cursors are compacted offline, before the log is opened.
const compactBytes = Number(process.env.OXM_ORCHESTRATOR_COMPACT_BYTES ?? 64 * 1024 * 1024);
if (args.has("--compact") || (existsSync(logPath) && Number.isFinite(compactBytes) && statSync(logPath).size > compactBytes)) {
  try {
    const r = compactAuditLog(logPath);
    say(r.compacted ? `durable log compacted: ${r.eventsBefore} -> ${r.eventsAfter} events (${r.bytesBefore} -> ${r.bytesAfter} bytes)` : "durable log: nothing to compact");
  } catch {
    fail("durable log compaction failed; the original log was left in place");
  }
  if (args.has("--compact")) process.exit(0);
}

let audit: FileAuditRepository;
try {
  audit = createFileAuditRepository({ path: logPath, now });
} catch {
  fail("durable state could not be opened (malformed or unreadable); refusing to start");
}
const owner = createHumanOwnerSession({ principalId: "telegram-owner", source: "telegram", now });

// Trusted planning layer (intent routing + semantic goal review). Default provider: the owner's
// authenticated Claude Code CLI session (no ANTHROPIC_API_KEY, no API billing). The Anthropic HTTP API
// is used only with OXM_AGENT_PLANNER_PROVIDER=anthropic_api. An unavailable configured provider fails
// closed; OXM_AGENT_PLANNER=off disables the planner explicitly. Secrets are never printed.
const planning = await createPlanningBackend(process.env, { repoRoot: process.cwd() });
if (!planning.ok) fail(`planner ${planning.code}: ${planning.reason}`);
const planned = planning as Extract<typeof planning, { ok: true }>;
for (const line of planned.diagnostics) say(line);
const planner = planned.planner;
const reviewer = planned.reviewer;

const runtimeConfig = readAgentRuntimeConfig(process.env, process.cwd());
if (!runtimeConfig.ok) fail(runtimeConfig.reason);
const created = await createAgentRuntime((runtimeConfig as Extract<typeof runtimeConfig, { ok: true }>).config, {
  audit: audit!,
  owner,
  reconcile: args.has("--reconcile"),
  planner,
  reviewer,
});
if (!created.ok) {
  const f = created as Extract<typeof created, { ok: false }>;
  fail(`${f.code}: ${f.reason}`, f.diagnostics);
}
const runtime = (created as Extract<typeof created, { ok: true }>).runtime;
for (const line of runtime.reconciled) say(`reconciled ${line}`);
say(runtime.checkpointRestored ? `Manager checkpoint restored (${runtime.restoredTaskIds.length} task(s), ${runtime.activeTaskIds().length} active)` : "no Manager checkpoint; starting fresh");

let hiSequence = 0;
const hiBoot = Date.now().toString(36);
const ledger = createAuditHumanInteractionLedger({ audit: audit!, nextId: () => `hi-${hiBoot}-${++hiSequence}`, now });
const service = createHumanInteractionService({
  gateway: runtime.gateway,
  authentication: owner.authentication,
  directory: { activeTaskIds: runtime.activeTaskIds, allTaskIds: runtime.allTaskIds },
  ledger,
  transport: createTelegramTransport(client, config.ownerChatId),
  now,
  log: (e) => say(`${e.event}: ${e.outcome}`),
});
const controlPlane = createTelegramControlPlane({ config, client, service, ledger, log: say });

try {
  const me = await controlPlane.start();
  say(`Telegram bot connected (@${me.botUsername ?? "unknown"})`);
  say("owner configured");
} catch (error) {
  fail(error instanceof TelegramStartupError ? error.message : "Telegram startup failed");
}

if (args.has("--submit-smoke")) {
  // Diagnostic only: the smoke fixture task through the same owner Gateway path as /goal.
  const runId = process.env.OXM_E2E_SMOKE_RUN_ID;
  if (!runId || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(runId)) fail("--submit-smoke requires OXM_E2E_SMOKE_RUN_ID (lowercase letters, digits, hyphens)");
  const task = smokeTaskDefinition(runId!);
  try {
    const submitted = await runtime.gateway.submitTask({
      authentication: owner.authentication(),
      request: {
        idempotencyKey: task.idempotencyKey,
        userInstruction: task.instruction,
        title: task.title,
        priority: task.requestedPriority,
        expectedScopeHint: [...task.expectedScope],
        acceptanceCriteria: [...task.acceptanceCriteria],
        requiredValidations: [...task.requiredValidations],
      },
    });
    ledger.track({ taskId: submitted.taskId, label: "diagnostic smoke task" });
    say(`smoke task ${submitted.duplicate ? "already submitted" : "submitted"} (${submitted.taskId})`);
  } catch {
    say("smoke task submission failed; the runtime keeps running");
  }
}

// QA observation driver: honours the Manager's own poll delay; reads are read-only.
const lastQaPoll = new Map<string, number>();
const qaTimer = setInterval(() => {
  for (const task of runtime.loop.tasks()) {
    if (task.status !== "qa_pending") continue;
    const due = (lastQaPoll.get(task.taskId) ?? 0) + Math.max(task.nextQaPollDelayMs ?? 30_000, 15_000);
    if (Date.now() < due) continue;
    lastQaPoll.set(task.taskId, Date.now());
    runtime.loop.post({ type: "qa_updated", taskId: task.taskId });
  }
}, 5_000);

// Goal-review retry driver: bounded by the Manager's maxReviewRetries; never re-runs a Worker.
const reviewTimer = setInterval(() => {
  for (const task of runtime.loop.tasks()) if (task.status === "waiting_infrastructure") runtime.loop.post({ type: "review_retry", taskId: task.taskId });
}, 60_000);

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  say(`${signal} received; stopping`);
  clearInterval(qaTimer);
  clearInterval(reviewTimer);
  await controlPlane.stop();
  audit!.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

say("polling started");
try {
  await controlPlane.run();
} catch (error) {
  clearInterval(qaTimer);
  clearInterval(reviewTimer);
  audit!.close();
  fail(error instanceof TelegramStartupError ? error.message : "control plane stopped unexpectedly");
}
