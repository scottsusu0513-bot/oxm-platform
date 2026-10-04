import { describe, expect, it } from "vitest";
import { EVIDENCE_KEYS, normalizeManagerEvidence, sanitizeSummary } from "./evidence";
import { fakeEvidence, fakePostCiEvidence } from "./fake";
import type { ManagerEvidence } from "./types";
import { validateEvidence } from "./validator";

const SOURCE_BLOB = 'import fs from "node:fs";\nexport function x() {\n  return fs.readFileSync("/etc/passwd", "utf8");\n}\n';

describe("evidence normalization", () => {
  it("accepts valid evidence and canonicalizes paths/ids", () => {
    const r = normalizeManagerEvidence({ ...fakeEvidence(), scope: { allowedScope: ["./server/search/"], changedPaths: ["server/search/b.ts", "server/search/a.ts", "server/search/a.ts"] } });
    expect(r.ok && r.evidence.scope).toEqual({ allowedScope: ["server/search/"], changedPaths: ["server/search/a.ts", "server/search/b.ts"] });
  });

  it("rejects arbitrary source-code / file-content / log fields anywhere", () => {
    const e = fakePostCiEvidence();
    const attempts: unknown[] = [
      { ...e, fileContents: SOURCE_BLOB },
      { ...e, sourceCode: SOURCE_BLOB },
      { ...e, diff: "--- a\n+++ b" },
      { ...e, scope: { ...e.scope, contents: { "a.ts": SOURCE_BLOB } } },
      { ...e, validations: [{ ...e.validations[0], stdout: "FAIL long log" }] },
      { ...e, ci: { ...e.ci!, logs: "raw ci log" } },
      { ...e, acceptance: [{ ...e.acceptance[0], patch: SOURCE_BLOB }] },
      { ...e, worker: { ...e.worker, prompt: "full prompt" } },
      { ...e, branch: { ...e.branch, gitShow: SOURCE_BLOB } },
    ];
    for (const a of attempts) {
      const r = normalizeManagerEvidence(a);
      expect(r.ok, JSON.stringify(a).slice(0, 80)).toBe(false);
      expect(validateEvidence(a as ManagerEvidence).decision).toBe("blocked");
    }
  });

  it("rejects source text smuggled into id/path/sha fields", () => {
    const e = fakeEvidence();
    expect(normalizeManagerEvidence({ ...e, taskId: SOURCE_BLOB }).ok).toBe(false);
    expect(normalizeManagerEvidence({ ...e, scope: { ...e.scope, changedPaths: [SOURCE_BLOB] } }).ok).toBe(false);
    expect(normalizeManagerEvidence({ ...e, acceptance: [{ ...e.acceptance[0], reference: SOURCE_BLOB }] }).ok).toBe(false);
    expect(normalizeManagerEvidence({ ...e, branch: { ...e.branch, verifiedHeadSha: "HEAD; cat src/*" } }).ok).toBe(false);
    expect(normalizeManagerEvidence({ ...e, validations: Array.from({ length: 500 }, () => e.validations[0]) }).ok).toBe(false);
  });

  it("free-text summaries are single-line, bounded, and secret-redacted", () => {
    const s = sanitizeSummary(SOURCE_BLOB.repeat(20));
    expect(s).not.toContain("\n");
    expect(s.length).toBeLessThanOrEqual(200);
    expect(sanitizeSummary("token ghp_abcdefghijklmnop123456")).toBe("[REDACTED]");
  });

  it("shell-injection strings remain inert data", () => {
    const evil = "$(rm -rf /); `curl evil` && echo pwned | sh";
    const e = fakeEvidence({
      validations: [
        { name: "tests", requested: true, executed: true, status: "failed", trusted: true, summary: evil },
        { name: "typecheck", requested: true, executed: true, status: "passed", trusted: true },
      ],
    });
    const v = validateEvidence(e);
    expect(v.decision).toBe("needs_repair");
    expect(v.findings.find((f) => f.evidenceId === "validation:tests")?.summary).toBe(evil);
    // As an identifier it is rejected outright.
    expect(normalizeManagerEvidence({ ...e, taskId: evil }).ok).toBe(false);
  });

  it("rejects class instances / non-plain objects", () => {
    class Sneaky {
      constructor(public taskId = "t1") {}
    }
    expect(normalizeManagerEvidence(new Sneaky()).ok).toBe(false);
    expect(normalizeManagerEvidence(null).ok).toBe(false);
  });

  it("type-level: ManagerEvidence does not accept source blobs", () => {
    const e = fakeEvidence();
    // @ts-expect-error — unknown field is not part of the evidence model
    const bad: ManagerEvidence = { ...e, fileContents: SOURCE_BLOB };
    // @ts-expect-error — scope carries paths, not contents
    const bad2: ManagerEvidence["scope"] = { allowedScope: [], changedPaths: [], contents: SOURCE_BLOB };
    expect(bad).toBeDefined();
    expect(bad2).toBeDefined();
  });

  it("the evidence shape whitelist has no content/log/prompt/code fields", () => {
    const all = Object.values(EVIDENCE_KEYS).flat();
    for (const k of all) expect(k, k).not.toMatch(/content|source|code|diff|patch|stdout|stderr|log|prompt|blob|body|text|file(?!s?Changed)/i);
  });
});
