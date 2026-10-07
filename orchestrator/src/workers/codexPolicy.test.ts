import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFakeRunner } from "./fake";
import { buildCodexArgs } from "./prompt";
import type { ProcessSpec } from "./types";
import {
  assertCodexCommandPolicy,
  CODEX_POLICY_PROBES,
  CODEX_WORKER_RULES_PATH,
  CODEX_WORKER_RULES_SHA256,
  codexCommandPolicyHash,
  createNativeCodexPolicyRuntime,
  requiredCodexPolicyDecision,
} from "./workerAdapter";

// Regression: a pinned hash that drifted from the committed policy file made every
// live Codex run fail closed with policy_error before the worker started.
const REPO = resolve(__dirname, "../../..");

/** Simulates a capable Codex CLI whose native exec-policy answers like the required worker policy. */
function codexCli() {
  return createFakeRunner((spec: ProcessSpec) => {
    const [first, second] = spec.args;
    if (first === "--version") return { exit: { stdout: "codex-cli 0.160.0\n" } };
    if (first === "exec" && second === "--help") return { exit: { stdout: "--strict-config --ignore-user-config --ephemeral" } };
    if (first === "sandbox") return { exit: { stdout: "--permission-profile --sandbox-state-disable-network" } };
    if (first === "execpolicy" && second === "--help") return { exit: { stdout: "check" } };
    if (first === "execpolicy" && second === "check") {
      const command = spec.args.slice(spec.args.indexOf("--") + 1);
      const decision = requiredCodexPolicyDecision(command);
      return { exit: { stdout: JSON.stringify(decision === "forbidden" ? { decision, matchedRules: [{}] } : { matchedRules: [] }) } };
    }
    return { exit: { exitCode: 2 } };
  });
}

const tmpRoots: string[] = [];
afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function repoWithPolicy(rules: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codex-policy-"));
  tmpRoots.push(root);
  const path = join(root, CODEX_WORKER_RULES_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, rules, "utf8");
  return root;
}

describe("committed Codex worker policy", () => {
  const rules = readFileSync(join(REPO, CODEX_WORKER_RULES_PATH), "utf8");

  it("matches the pinned CODEX_WORKER_RULES_SHA256", () => {
    expect(codexCommandPolicyHash(rules)).toBe(CODEX_WORKER_RULES_SHA256);
    expect(() => assertCodexCommandPolicy(REPO)).not.toThrow();
  });

  it("forbids every Git operation the required policy forbids", () => {
    for (const op of "add commit switch checkout branch merge rebase reset push config remote".split(" ")) {
      expect(requiredCodexPolicyDecision(["git", op])).toBe("forbidden");
      expect(rules).toMatch(new RegExp(`"${op}"`));
    }
  });

  it("native runtime verifies the real repository policy", async () => {
    const runner = codexCli();
    const result = await createNativeCodexPolicyRuntime(runner).verify({ command: "codex", repoRoot: REPO, args: buildCodexArgs(undefined, REPO) });
    expect(result).toEqual({ ok: true });
    const checks = runner.specs.filter((s) => s.args[0] === "execpolicy" && s.args[1] === "check");
    expect(checks).toHaveLength(CODEX_POLICY_PROBES.length);
    expect(checks.every((s) => s.args.includes(join(REPO, CODEX_WORKER_RULES_PATH)))).toBe(true);
  });

  it("native runtime still verifies a CRLF checkout of the same policy", async () => {
    const root = await repoWithPolicy(rules.replace(/\r?\n/g, "\r\n"));
    const result = await createNativeCodexPolicyRuntime(codexCli()).verify({ command: "codex", repoRoot: root, args: buildCodexArgs(undefined, root) });
    expect(result).toEqual({ ok: true });
  });

  it("native runtime fails closed with policy_error for a tampered or missing policy", async () => {
    const tampered = rules.replace('"add", "commit", ', "");
    expect(tampered).not.toBe(rules);
    for (const root of [await repoWithPolicy(tampered), await repoWithPolicy(`${rules}\n# extra\n`)]) {
      const runner = codexCli();
      const result = await createNativeCodexPolicyRuntime(runner).verify({ command: "codex", repoRoot: root, args: buildCodexArgs(undefined, root) });
      expect(result).toEqual({ ok: false, errorType: "policy_error", reason: "Codex worker command policy is missing or altered" });
      expect(runner.specs).toHaveLength(0);
      expect(await readFile(join(root, CODEX_WORKER_RULES_PATH), "utf8")).not.toBe(rules);
    }
    const empty = await mkdtemp(join(tmpdir(), "codex-policy-"));
    tmpRoots.push(empty);
    const missing = await createNativeCodexPolicyRuntime(codexCli()).verify({ command: "codex", repoRoot: empty, args: buildCodexArgs(undefined, empty) });
    expect(missing).toMatchObject({ ok: false, errorType: "policy_error" });
  });
});
