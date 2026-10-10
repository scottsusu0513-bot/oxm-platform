import { describe, expect, it } from "vitest";
import { attributeWorkspaceDelta } from "./attribution";
import type { PathContentIdentity } from "./gitIntegrity";

const id = (path: string, blob: string): PathContentIdentity => ({ path, mode: "100644", blob: blob.repeat(40) });

describe("task-owned delta attribution", () => {
  const base = { allowedScope: ["client/"], allowedDirtyPaths: [] as string[], reported: [] as string[] };

  it("only the Worker's own in-scope delta is task-owned; another actor's out-of-scope edits during the run are unattributed", () => {
    const d = attributeWorkspaceDelta({
      ...base,
      baseline: [],
      current: [id("client/Card.tsx", "a"), id("orchestrator/ledger.ts", "b")],
      changedNow: ["client/Card.tsx", "orchestrator/ledger.ts"],
      reported: ["client/Card.tsx"],
    });
    expect(d).toEqual({ taskOwned: ["client/Card.tsx"], workerOutOfScope: [], preExisting: [], unattributed: ["orchestrator/ledger.ts"] });
  });

  it("an out-of-scope change the Worker itself reports is a genuine scope violation", () => {
    const d = attributeWorkspaceDelta({ ...base, baseline: [], current: [id("server/db.ts", "a")], changedNow: ["server/db.ts"], reported: ["server/db.ts"] });
    expect(d.workerOutOfScope).toEqual(["server/db.ts"]);
  });

  it("pre-existing dirty paths unchanged by the run are not the Worker's; changed ones are attributed by the same rules", () => {
    const baseline = [id("notes/wip.md", "a"), id("server/x.ts", "a")];
    const d = attributeWorkspaceDelta({
      ...base,
      baseline,
      current: [id("notes/wip.md", "a"), id("server/x.ts", "c"), id("client/a.ts", "d")],
      changedNow: ["client/a.ts", "notes/wip.md", "server/x.ts"],
      reported: ["client/a.ts", "server/x.ts"],
    });
    expect(d).toEqual({ taskOwned: ["client/a.ts"], workerOutOfScope: ["server/x.ts"], preExisting: ["notes/wip.md"], unattributed: [] });
  });

  it("a baseline path whose current identity is unknown counts as changed (never silently unchanged)", () => {
    const d = attributeWorkspaceDelta({ ...base, baseline: [id("notes/wip.md", "a")], current: [], changedNow: ["notes/wip.md"] });
    expect(d.unattributed).toEqual(["notes/wip.md"]);
  });

  it("the task's own earlier edits stay task-owned even when this run did not touch them", () => {
    const d = attributeWorkspaceDelta({ ...base, allowedDirtyPaths: ["client/a.ts"], baseline: [id("client/a.ts", "a")], current: [id("client/a.ts", "a")], changedNow: ["client/a.ts"] });
    expect(d.taskOwned).toEqual(["client/a.ts"]);
  });

  it("an out-of-scope pre-existing change the Worker reverted is attributed like any change during the run", () => {
    const d = attributeWorkspaceDelta({ ...base, baseline: [id("server/x.ts", "a")], current: [id("server/x.ts", "z")], changedNow: [], reported: ["server/x.ts"] });
    expect(d.workerOutOfScope).toEqual(["server/x.ts"]);
  });
});
