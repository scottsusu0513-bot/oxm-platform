import { describe, expect, it } from "vitest";
import { isSafeRepoPath, isValidBranchName, parseClaudeEnvelope, parseWorkerReport, redactSecrets, sanitizeText } from "./resultParser";

const valid = {
  status: "success",
  summary: "ok",
  filesChanged: ["server/db.ts"],
  testsRun: [{ command: "pnpm test", outcome: "passed" }],
  checkResult: "passed",
  branch: "agent/x",
  headSha: "a".repeat(40),
  prNumber: null,
  riskObserved: { level: "green", notes: [] },
  needsApproval: false,
  fallbackRecommended: false,
  errorType: null,
};
const parse = (o: unknown) => parseWorkerReport(JSON.stringify(o));

describe("parseWorkerReport", () => {
  it("accepts a valid report, plain or in a single json fence", () => {
    expect(parse(valid).ok).toBe(true);
    expect(parseWorkerReport("```json\n" + JSON.stringify(valid) + "\n```").ok).toBe(true);
  });

  it.each([
    ["prose around JSON", `Here you go: ${JSON.stringify(valid)}`],
    ["array", "[]"],
    ["empty", ""],
  ])("rejects %s", (_n, text) => expect(parseWorkerReport(text).ok).toBe(false));

  it.each([
    ["status", { status: "partial" }],
    ["status cancelled", { status: "cancelled" }],
    ["summary empty", { summary: " " }],
    ["absolute path", { filesChanged: ["/etc/passwd"] }],
    ["traversal", { filesChanged: ["../x"] }],
    ["test outcome", { testsRun: [{ command: "x", outcome: "ok" }] }],
    ["checkResult", { checkResult: "green" }],
    ["branch injection", { branch: "agent/x;rm" }],
    ["branch traversal", { branch: "agent/../main" }],
    ["sha", { headSha: "HEAD" }],
    ["prNumber", { prNumber: -1 }],
    ["prNumber string", { prNumber: "7" }],
    ["fabricated prNumber", { prNumber: 7 }],
    ["risk level", { riskObserved: { level: "purple", notes: [] } }],
    ["needsApproval", { needsApproval: "no" }],
    ["errorType", { errorType: "Bad Type!" }],
  ])("rejects invalid %s", (_n, over) => expect(parse({ ...valid, ...over }).ok).toBe(false));

  it("rejects missing fields", () => {
    const { headSha: _h, ...rest } = valid;
    expect(parse(rest)).toEqual({ ok: false, reason: "missing result field(s): headSha" });
  });

  it("sanitizes text: control chars removed, length capped, secrets redacted", () => {
    const r = parse({ ...valid, summary: "a\u0000b\u001b[31m " + "x".repeat(3000), testsRun: [{ command: "API_KEY=abc123 pnpm test", outcome: "passed" }] });
    if (!r.ok) throw new Error(r.reason);
    expect(r.value.summary.startsWith("ab[31m ")).toBe(true);
    expect(r.value.summary.length).toBe(2000);
    expect(r.value.testsRun[0].command).toBe("[REDACTED] pnpm test");
  });
});

describe("parseClaudeEnvelope", () => {
  it("extracts result; treats is_error / non-success subtype as error", () => {
    expect(parseClaudeEnvelope(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "x" }))).toEqual({
      ok: true,
      value: { isError: false, subtype: "success", result: "x" },
    });
    const e = parseClaudeEnvelope(JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "secret stuff" }));
    expect(e).toEqual({ ok: true, value: { isError: true, subtype: "success", result: "" } });
    expect(parseClaudeEnvelope(JSON.stringify({ type: "assistant" })).ok).toBe(false);
  });
});

describe("helpers", () => {
  it("redactSecrets covers common credential shapes", () => {
    const s = [
      "Bearer abcdefghijkl",
      "https://user:pass@db.example.com/x",
      "sk-ant-api03-abcdefghij",
      "github_pat_abcdefghij123",
      "AKIAABCDEFGHIJKLMNOP",
      "eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.abcdefghijkl",
      "password: hunter22",
      "DATABASE_URL=mysql://root:pw@localhost/oxm",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----",
    ];
    for (const x of s) expect(redactSecrets(`pre ${x} post`), x).not.toContain(x);
    expect(redactSecrets("plain summary of the fix")).toBe("plain summary of the fix");
  });

  it("sanitizeText keeps newlines and tabs", () => expect(sanitizeText("a\n\tb", 10)).toBe("a\n\tb"));

  it("branch and path validators", () => {
    expect(isValidBranchName("agent/phase2c-claude-worker")).toBe(true);
    for (const b of ["", "-x", "a..b", "a b", "a/", "a.lock", "a;b", "a$(b)"]) expect(isValidBranchName(b), b).toBe(false);
    expect(isSafeRepoPath("server/db.ts")).toBe(true);
    for (const p of ["/abs", "C:/x", "a/../b", "a//b", "a\\b", ""]) expect(isSafeRepoPath(p), p).toBe(false);
  });
});
