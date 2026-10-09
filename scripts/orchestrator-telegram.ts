/**
 * OXM Agent runtime with the Telegram Human Control Plane (long polling).
 *
 *   pnpm orchestrator:telegram -- --check         validate env + bot token (getMe), then exit
 *   pnpm orchestrator:telegram                    run the long-lived Agent runtime
 *   pnpm orchestrator:telegram -- --compact       compact the durable log, then exit
 *   pnpm orchestrator:telegram -- --reconcile     apply deterministic startup recoveries, then run
 *   pnpm orchestrator:telegram -- --submit-smoke  diagnostic: also submit the smoke fixture task once
 *
 * Update source: OXM_AGENT_TELEGRAM_SOURCE=telegram (default, direct getUpdates polling;
 * the rollback mode) or gateway (pull from the Wake Gateway queue with
 * OXM_WAKE_GATEWAY_URL + OXM_WAKE_GATEWAY_AGENT_TOKEN; getUpdates is never called).
 *
 * Tasks are created from Telegram with /goal. Reads TELEGRAM_BOT_TOKEN /
 * TELEGRAM_OWNER_CHAT_ID and the OXM_AGENT_* runtime configuration from the
 * environment and never prints secret values. Durable state lives outside the
 * repository (OXM_ORCHESTRATOR_STATE_DIR, default ~/.oxm-orchestrator).
 */
import { existsSync, mkdirSync, statSync } from "node:fs";
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
import { acquireInstanceLock } from "../orchestrator/src/runtimeSupervisor/instanceLock";
import { createFileAuditRepository, type FileAuditRepository } from "../orchestrator/src/persistence/fileAudit";
import { createTelegramBotClient, TelegramApiError } from "../orchestrator/src/telegram/client";
import { readTelegramConfig, readTelegramSourceConfig } from "../orchestrator/src/telegram/config";
import { checkGateway, createGatewayUpdatesClient } from "../orchestrator/src/telegram/gatewaySource";
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
const source = readTelegramSourceConfig(process.env);
if (!source.ok) fail(source.reason);
const sourceConfig = (source as Extract<typeof source, { ok: true }>).config;
const botClient = createTelegramBotClient({ token: config.botToken });
// Only getUpdates changes with the source; outbound messages always go to the Bot API directly.
const client =
  sourceConfig.source === "gateway" ? createGatewayUpdatesClient({ telegram: botClient, gatewayUrl: sourceConfig.gatewayUrl, agentToken: sourceConfig.agentToken }) : botClient;
say(`Telegram update source: ${sourceConfig.source}`);

if (sourceConfig.source === "gateway") {
  try {
    await checkGateway({ gatewayUrl: sourceConfig.gatewayUrl, agentToken: sourceConfig.agentToken });
    say("Wake Gateway reachable; Agent pull token accepted");
  } catch (error) {
    // A rejected pull token fails closed. An unreachable Gateway is transient: polling retries with backoff.
    if (args.has("--check") || (error instanceof TelegramApiError && error.kind === "unauthorized")) fail("Wake Gateway check failed (unreachable, or the Agent pull token was rejected)");
    say("Wake Gateway not reachable yet; polling will retry with backoff");
  }
}

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

// Exactly one runtime per state directory, however it was started: a second one would consume the same
// owner update queue, answer every message again and append to the same durable log.
try {
  mkdirSync(stateDir, { recursive: true });
} catch {
  fail("durable state directory could not be created; refusing to start");
}
const instanceLock = await acquireInstanceLock(join(stateDir, "runtime-instance.lock"));
if (!instanceLock.ok)
  fail(
    instanceLock.code === "held"
      ? "another Agent runtime already owns this state directory; refusing to start a second one (it would answer every owner message twice)"
      : "the runtime instance lock is unavailable (flock); refusing to start without single-instance protection",
  );

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
  manager: planned.manager,
  questionAnswerer: planned.questionAnswerer,
  noticeComposer: planned.noticeComposer,
  // Operator acknowledgement of specific historical conflicting journal records (comma-separated event ids).
  supersededJournalEvents: (process.env.OXM_AGENT_JOURNAL_SUPERSEDE ?? "").split(",").map((s) => s.trim()).filter(Boolean),
});
if (!created.ok) {
  const f = created as Extract<typeof created, { ok: false }>;
  fail(`${f.code}: ${f.reason}`, f.diagnostics);
}
const runtime = (created as Extract<typeof created, { ok: true }>).runtime;
for (const line of runtime.reconciled) say(`reconciled ${line}`);
say(`runtime baseline ${runtime.runtimeBaseline.branch}@${runtime.runtimeBaseline.sha.slice(0, 12)}`);
if (runtime.workspaceRestored) say(runtime.workspaceRestored);
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
  // Production never downgrades from the GPT Manager to a deterministic intake.
  managerRequired: true,
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

// Goal-review / GPT-diagnosis retry driver: bounded by the Manager's maxReviewRetries; never re-runs a Worker.
// Also retries a combined review of a decomposed request whose GPT review was unavailable.
const reviewTimer = setInterval(() => {
  for (const task of runtime.loop.tasks()) {
    if (task.status === "waiting_infrastructure") runtime.loop.post({ type: "review_retry", taskId: task.taskId });
    if (task.combinedReview?.status === "review_unavailable") runtime.loop.post({ type: "combined_review", groupId: task.combinedReview.groupId });
  }
}, 60_000);

// Worker availability driver: resumes tasks paused on a Worker usage quota once a trusted reset time has
// passed, and re-probes pauses without one hourly (a renewed quota error just pauses again). Never a repair.
const availabilityTimer = setInterval(() => {
  if (runtime.loop.tasks().some((task) => task.status === "waiting_worker_quota")) runtime.loop.post({ type: "availability_check", probeAfterMs: 60 * 60_000 });
}, 5 * 60_000);

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  say(`${signal} received; stopping`);
  clearInterval(qaTimer);
  clearInterval(reviewTimer);
  clearInterval(availabilityTimer);
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
  clearInterval(availabilityTimer);
  audit!.close();
  fail(error instanceof TelegramStartupError ? error.message : "control plane stopped unexpectedly");
}
