import { buildCodexArgs } from "../orchestrator/src/workers/prompt";
import { createNodeProcessRunner } from "../orchestrator/src/workers/processRunner";
import { createNativeCodexPolicyRuntime } from "../orchestrator/src/workers/workerAdapter";

const repoRoot = process.cwd();
const command = process.env.CODEX_COMMAND ?? "codex";
const result = await createNativeCodexPolicyRuntime(createNodeProcessRunner()).verify({
  command,
  repoRoot,
  args: buildCodexArgs(undefined, repoRoot),
});

if (!result.ok) {
  process.stderr.write(`Codex worker runtime smoke probe failed (${result.errorType}): ${result.reason}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Codex worker runtime smoke probe passed.\n");
}
