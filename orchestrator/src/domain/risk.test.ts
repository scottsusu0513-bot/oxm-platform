import { describe, expect, it } from "vitest";
import { assessRisk, classifyTask, isProtectedBranch } from "./risk";
import type { ActionKind, TaskAction, TaskCategory, TaskInput } from "./types";

const task = (actions: TaskAction[], extra: Partial<TaskInput> = {}): TaskInput => ({
  id: "t1",
  category: "general_coding" as TaskCategory,
  actions,
  ...extra,
});
const level = (actions: TaskAction[], extra?: Partial<TaskInput>) => assessRisk(task(actions, extra)).level;
const kinds = (...k: ActionKind[]) => k.map((kind) => ({ kind }));

describe("risk: green", () => {
  it.each<ActionKind>(["repo_read", "code_edit", "ui_edit", "run_tests", "run_check", "run_build", "open_pr", "update_pr"])(
    "%s is green",
    (kind) => expect(level([{ kind }])).toBe("green"),
  );

  it("commit and push to a non-main working branch are green", () => {
    expect(level([{ kind: "commit", branch: "agent/feature-x" }, { kind: "push", branch: "agent/feature-x" }])).toBe("green");
  });

  it("ordinary UI path changes stay green", () => {
    expect(level(kinds("ui_edit"), { changedPaths: ["client/src/pages/Home.tsx", "client/src/index.css"] })).toBe("green");
  });

  it("green does not require approval", () => {
    expect(assessRisk(task(kinds("code_edit"))).requiresApproval).toBe(false);
  });
});

describe("risk: yellow", () => {
  it.each<ActionKind>(["dependency_change", "ci_workflow_change", "migration_file_change", "auth_logic_change", "broad_refactor", "config_change"])(
    "%s is yellow",
    (kind) => expect(level([{ kind }, { kind: "code_edit" }])).toBe("yellow"),
  );

  it.each([
    "package.json",
    "pnpm-lock.yaml",
    ".github/workflows/ci.yml",
    "drizzle/0016_operation_status_certified.sql",
    "drizzle/schema.ts",
    "server/_core/context.ts",
    "server/_core/oauth.ts",
    "tsconfig.json",
    "vite.config.ts",
  ])("changed path %s escalates to yellow", (p) => {
    expect(level(kinds("code_edit"), { changedPaths: [p] })).toBe("yellow");
  });

  it("auth category is at least yellow", () => {
    expect(level(kinds("code_edit"), { category: "auth" })).toBe("yellow");
  });

  it("yellow does not require approval", () => {
    expect(assessRisk(task(kinds("dependency_change"))).requiresApproval).toBe(false);
  });
});

describe("risk: red", () => {
  it.each<ActionKind>(["prod_db_write", "prod_schema_change", "prod_deploy", "force_push", "destructive_data_delete", "secret_exposure", "irreversible_prod_op"])(
    "%s is red and requires approval",
    (kind) => {
      const r = assessRisk(task([{ kind }, { kind: "code_edit" }]));
      expect(r.level).toBe("red");
      expect(r.requiresApproval).toBe(true);
    },
  );

  it.each(["main", "master", "origin/main", "refs/heads/main", " main "])("direct push to %j is red", (branch) => {
    expect(level([{ kind: "push", branch }])).toBe("red");
  });

  it("push without a target branch fails closed to red", () => {
    expect(level([{ kind: "push" }])).toBe("red");
  });

  it("local commit on main is yellow, not green", () => {
    expect(level([{ kind: "commit", branch: "main" }])).toBe("yellow");
  });

  it("unknown action kinds fail closed to red", () => {
    expect(level([{ kind: "launch_missiles" as ActionKind }])).toBe("red");
  });

  it("committing a real .env file is red; .env.example is not", () => {
    expect(level(kinds("code_edit"), { changedPaths: [".env"] })).toBe("red");
    expect(level(kinds("code_edit"), { changedPaths: [".env.production"] })).toBe("red");
    expect(level(kinds("code_edit"), { changedPaths: [".env.example"] })).toBe("green");
  });

  it("red dominates yellow and green", () => {
    expect(level(kinds("repo_read", "dependency_change", "prod_deploy"))).toBe("red");
  });
});

describe("risk: secret read vs exposure", () => {
  it("an authorized worker reading a secret is green", () => {
    const r = assessRisk(task(kinds("secret_read", "code_edit", "run_tests")));
    expect(r.level).toBe("green");
    expect(r.requiresApproval).toBe(false);
  });

  it.each(["code", "git", "pr", "logs", "frontend_bundle", "internet"] as const)("exposing a secret to %s is red", (surface) => {
    const r = assessRisk(task([{ kind: "secret_read" }, { kind: "secret_exposure", surface }]));
    expect(r.level).toBe("red");
    expect(r.reasons).toContain(`secret exposure to ${surface}`);
  });
});

describe("risk: determinism", () => {
  it("same input yields identical output and does not mutate input", () => {
    const input = Object.freeze(task(Object.freeze(kinds("dependency_change", "config_change")) as TaskAction[], {
      changedPaths: Object.freeze(["package.json"]),
    }));
    const a = classifyTask(input);
    const b = classifyTask(input);
    expect(a).toEqual(b);
    expect(a.taskId).toBe("t1");
    expect(a.risk.reasons).toEqual(["dependency_change", "config_change", "dependency change: package.json"]);
  });

  it("isProtectedBranch only matches main/master", () => {
    expect(isProtectedBranch("main")).toBe(true);
    expect(isProtectedBranch("main-feature")).toBe(false);
    expect(isProtectedBranch("agent/main")).toBe(false);
  });
});
