// Test entry: the real supervisor with a fake runtime and an isolated state dir.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runSupervisorCli } from "../supervisor";

const repoRoot = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const runtimeEntry = "orchestrator/src/runtimeSupervisor/testFixtures/fakeRuntime.ts";
const secretsFile = process.env.OXM_TEST_SECRETS_FILE ?? "";
void runSupervisorCli(process.argv.slice(2), {
  repoRoot,
  selfScript: fileURLToPath(import.meta.url),
  runtimeArgv: [process.execPath, "--import", "tsx", runtimeEntry],
  runtimeEntry,
  env: process.env,
  stateDir: process.env.OXM_TEST_STATE_DIR ?? "",
  readPlatformSecrets: () => (secretsFile && existsSync(secretsFile) ? readFileSync(secretsFile, "utf8") : null),
  out: (line) => process.stdout.write(`${line}\n`),
  startWaitMs: 20_000,
  stopWaitMs: 5_000,
}).then((code) => process.exit(code));
