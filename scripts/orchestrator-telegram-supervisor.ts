/**
 * Single-instance supervisor for the OXM Agent Telegram runtime (`pnpm orchestrator:telegram`).
 *
 *   pnpm orchestrator:telegram:start    start in the background unless already running
 *   pnpm orchestrator:telegram:status   running?, last error, recent (redacted) log
 *   pnpm orchestrator:telegram:stop     stop the supervised runtime
 *
 * The Codespace postStartCommand (scripts/codespace-post-start.sh) calls `start --autostart`
 * on every create / restart / resume. Fixed non-secret OXM_AGENT_* values are applied, the
 * Codespace binding comes from CODESPACE_NAME, Telegram secrets stay platform-provided
 * (Codespaces Secrets), and nothing secret is printed or logged. State and logs live under
 * OXM_ORCHESTRATOR_STATE_DIR (default ~/.oxm-orchestrator)/supervisor, outside the repository.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CODESPACES_SECRETS_FILE } from "../orchestrator/src/runtimeSupervisor/env";
import { runSupervisorCli } from "../orchestrator/src/runtimeSupervisor/supervisor";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const stateDir = resolve(process.env.OXM_ORCHESTRATOR_STATE_DIR || join(homedir(), ".oxm-orchestrator"));
const rel = relative(repoRoot, stateDir);
if (!rel.startsWith("..") && !isAbsolute(rel)) {
  process.stdout.write("[oxm-agent-supervisor] FAILED: OXM_ORCHESTRATOR_STATE_DIR must be outside the repository\n");
  process.exit(1);
}

const code = await runSupervisorCli(process.argv.slice(2), {
  repoRoot,
  selfScript: fileURLToPath(import.meta.url),
  runtimeArgv: [process.execPath, "--import", "tsx", "scripts/orchestrator-telegram.ts"],
  runtimeEntry: "scripts/orchestrator-telegram.ts",
  env: process.env,
  stateDir,
  readPlatformSecrets: () => readFileSync(CODESPACES_SECRETS_FILE, "utf8"),
  out: (line) => process.stdout.write(`${line}\n`),
});
process.exit(code);
