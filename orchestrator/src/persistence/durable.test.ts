import { mkdtempSync, readFileSync, rmSync, statSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createInMemoryGatewayDecisionRepository } from "../gateway/fake";
import { createAuditCheckpointRepository } from "../scheduler/persistence";
import { createFileAuditRepository } from "./fileAudit";
import { createRepositoryJournal } from "./journal";
import { createInMemoryApprovalRepository } from "../store/memory";

const dirs: string[] = [];
const tempPath = () => {
  const dir = mkdtempSync(join(tmpdir(), "oxm-audit-"));
  dirs.push(dir);
  return join(dir, "state", "audit.jsonl");
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("durable file audit repository", () => {
  it("persists sanitized append-only events across reopen, owner-only", () => {
    const path = tempPath();
    const a = createFileAuditRepository({ path, now: () => "2026-10-07T00:00:00.000Z" });
    a.append({ id: "e1", taskId: "t", actor: "system", event: "x", metadata: { note: "ok", token: "should-not-persist", v: "Bearer abc.def" } });
    expect(() => a.append({ id: "e1", taskId: "t", actor: "system", event: "x" })).toThrow(/already exists/);
    a.close();
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8")).not.toContain("should-not-persist");
    const b = createFileAuditRepository({ path, now: () => "2026-10-07T00:00:01.000Z" });
    expect(b.list({ taskId: "t" })).toHaveLength(1);
    expect(b.list()[0].metadata).toEqual({ note: "ok", token: "[REDACTED]", v: "[REDACTED]" });
    expect(() => b.append({ id: "e1", taskId: "t", actor: "system", event: "x" })).toThrow(/already exists/);
    b.close();
  });

  it("refuses to load a corrupted log instead of silently dropping state", () => {
    const path = tempPath();
    createFileAuditRepository({ path, now: () => "t" }).close();
    appendFileSync(path, '{"id":"half"');
    expect(() => createFileAuditRepository({ path, now: () => "t" })).toThrow(/malformed; refusing to load/);
  });

  it("backs the existing audit checkpoint repository across a restart", () => {
    const path = tempPath();
    let id = 0;
    const first = createFileAuditRepository({ path, now: () => "t" });
    createAuditCheckpointRepository({ audit: first, nextId: () => `c-${++id}` }).save({ version: 1, sequence: 3, tasks: [] });
    first.close();
    const second = createFileAuditRepository({ path, now: () => "t" });
    expect(createAuditCheckpointRepository({ audit: second, nextId: () => `c-${++id}` }).load()).toEqual({ version: 1, sequence: 3, tasks: [] });
    second.close();
  });
});

describe("audit-journaled repositories", () => {
  it("replays recorded calls at their recorded time so state (incl. idempotency) survives restart", () => {
    const path = tempPath();
    let clock = "2026-10-07T00:00:00.000Z";
    let n = 0;
    const audit1 = createFileAuditRepository({ path, now: () => clock });
    const j1 = createRepositoryJournal({ audit: audit1, nextId: () => `j1-${++n}`, now: () => clock });
    const approvals1 = j1.wrap("approvals", createInMemoryApprovalRepository(j1.clock), ["create", "decide", "expire"]);
    const decisions1 = j1.wrap("decisions", createInMemoryGatewayDecisionRepository(), ["create", "markEventEmitted"]);
    expect(j1.replay()).toBe(0);
    approvals1.create({ id: "ap-1", taskId: "t1", kind: "commit_publish", requestedAction: "a", bindingShaOrActionId: "b", expiresAt: "2026-10-07T01:00:00.000Z" });
    clock = "2026-10-07T00:10:00.000Z";
    approvals1.decide("ap-1", { status: "approved", decidedBy: "telegram-owner", channel: "telegram" });
    decisions1.create({ idempotencyKey: "k", fingerprint: "f", approvalId: "ap-1", taskId: "t1", decision: "approved", eventEmitted: false, createdAt: clock });
    decisions1.markEventEmitted("k");
    const before = approvals1.get("ap-1");
    audit1.close();

    // Restart much later (after the approval expiry): replay still reproduces the decided row exactly.
    clock = "2026-10-08T00:00:00.000Z";
    const audit2 = createFileAuditRepository({ path, now: () => clock });
    const j2 = createRepositoryJournal({ audit: audit2, nextId: () => `j2-${++n}`, now: () => clock });
    const approvals2 = j2.wrap("approvals", createInMemoryApprovalRepository(j2.clock), ["create", "decide", "expire"]);
    const decisions2 = j2.wrap("decisions", createInMemoryGatewayDecisionRepository(), ["create", "markEventEmitted"]);
    expect(j2.replay()).toBe(4);
    expect(approvals2.get("ap-1")).toEqual(before);
    expect(decisions2.get("k")).toMatchObject({ eventEmitted: true });
    expect(() => decisions2.create({ idempotencyKey: "k", fingerprint: "f", approvalId: "ap-1", taskId: "t1", decision: "approved", eventEmitted: false, createdAt: clock })).toThrow();
    audit2.close();
  });

  it("fails closed on a journal record for an unknown repository", () => {
    const path = tempPath();
    const audit = createFileAuditRepository({ path, now: () => "t" });
    audit.append({ id: "x", taskId: "repository-journal", actor: "system", event: "repository_journal_op", metadata: { repository: "evil", method: "create", at: "2026-10-07T00:00:00.000Z", args: [] } });
    const j = createRepositoryJournal({ audit, nextId: () => "y", now: () => "t" });
    j.wrap("approvals", createInMemoryApprovalRepository(j.clock), ["create"]);
    expect(() => j.replay()).toThrow(/replay refused: category=unknown_repository index=0 event=x repository=evil/);
    audit.close();
  });
});
