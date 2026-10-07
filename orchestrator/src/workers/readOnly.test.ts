import { describe, expect, it } from "vitest";
import { buildClaudeArgs, buildWorkerPrompt, redStartBindingId } from "./prompt";
import type { WorkerTaskContract } from "./types";

const contract: WorkerTaskContract = {
  taskId: "t1",
  runId: "t1-run-1",
  category: "general_coding",
  actions: [{ kind: "repo_read" }, { kind: "run_check" }],
  objective: "Explain the search flow",
  allowedScope: ["client/"],
  acceptanceCriteria: ["answered"],
  requiredValidations: ["typecheck"],
  branch: "agent/task-t1-x",
};

describe("read-only Worker contract", () => {
  it("Claude gets no Edit/Write tool for a read-only run; change runs are unchanged", () => {
    const ro = buildClaudeArgs("claude-sonnet-5-5", "read_only");
    const rw = buildClaudeArgs("claude-sonnet-5-5");
    const tools = (args: string[]) => args[args.indexOf("--tools") + 1];
    expect(tools(ro)).not.toMatch(/Edit|Write/);
    expect(ro).not.toContain("Edit");
    expect(ro).not.toContain("Write");
    expect(tools(rw)).toMatch(/Edit/);
    expect(ro).toContain("dontAsk");
  });

  it("the prompt forbids any file change and asks for an evidence-backed answer", () => {
    const prompt = buildWorkerPrompt({ ...contract, mode: "read_only" }, "green");
    expect(prompt).toContain("READ-ONLY TASK: do not create, edit, delete");
    expect(prompt).toContain("state any uncertainty");
    expect(buildWorkerPrompt(contract, "green")).not.toContain("READ-ONLY");
  });

  it("the red-risk start binding covers the mode, so a read-only approval cannot authorize a change run", () => {
    expect(redStartBindingId({ ...contract, mode: "read_only" })).not.toBe(redStartBindingId(contract));
    expect(redStartBindingId({ ...contract, mode: "change" })).toBe(redStartBindingId(contract));
  });
});
