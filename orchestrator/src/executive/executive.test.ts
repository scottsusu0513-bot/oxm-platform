import { describe, expect, it } from "vitest";
import { classifyAvailabilityFailure, parseTrustedResetTime } from "./availability";
import {
  blockerKindFor,
  decisionContent,
  decisionMessage,
  findInternalJargon,
  formatResetTime,
  ownerLanguage,
  progressMessage,
  taskReceivedMessage,
} from "./communication";
import { deriveEvidencePlan, excerptAround, gatherSourceEvidence, renderEvidenceInstruction } from "./evidencePlan";
import { applyGuidanceConstraints, deriveGuidanceConstraint } from "./guidance";
import { buildHandoffSummary, renderHandoffBlock } from "./handoff";
import { ALL_AVAILABLE, categoryForArea, decideExecutionWorker, decomposeWork, detectWorkAreas, resolveWorkAreas, workShape, type WorkerAvailabilityMap } from "./workAssignment";

const NOW = "2026-10-07T00:00:00.000Z";
const avail = (claude: WorkerAvailabilityMap["claude"]["status"], codex: WorkerAvailabilityMap["codex"]["status"], resetAt: string | null = null): WorkerAvailabilityMap => ({
  claude: { status: claude, resetAt: claude === "available" ? null : resetAt },
  codex: { status: codex, resetAt: codex === "available" ? null : resetAt },
});

describe("Worker assignment policy (fixed OXM rule)", () => {
  it.each([
    ["修正登入權限檢查的 bug", "programming"],
    ["optimize the search API query performance", "programming"],
    ["幫我看一下現在搜尋的邏輯是怎麼跑的", "programming"],
    ["add unit tests for the review router", "programming"],
    ["把首頁按鈕改成藍色，間距調大一點", "visual"],
    ["polish the factory card layout and typography", "visual"],
    ["手機版的排版跑掉了，幫我修好看一點", "visual"],
    ["Redesign the search page and change the search API", "mixed"],
    ["重新設計搜尋頁版面，並修改搜尋 API 的排序邏輯", "mixed"],
    ["幫我處理一下這個", "programming"],
  ])("%s -> %s", (text, shape) => {
    expect(workShape(detectWorkAreas(text))).toBe(shape);
  });

  it("the Manager may add an area but never drop one the policy detects", () => {
    // Manager claims "programming only" for a visual request: the visual part stays.
    expect(resolveWorkAreas({ programming: true, visual: false }, "Redesign the search page layout")).toEqual({ programming: true, visual: true });
    // Manager declares visual for a neutral request: accepted (it can only add).
    expect(resolveWorkAreas({ programming: false, visual: true }, "make it nicer")).toEqual({ programming: false, visual: true });
    expect(resolveWorkAreas(null, "調整首頁配色")).toEqual({ programming: false, visual: true });
  });

  it("maps areas to routing categories so visual never lands on Claude and programming never on Codex", () => {
    expect(categoryForArea("visual", "backend")).toBe("frontend_styling");
    expect(categoryForArea("visual", "css")).toBe("css");
    expect(categoryForArea("programming", "ui")).toBe("general_coding");
    expect(categoryForArea("programming", "auth")).toBe("auth");
  });

  it("decomposes a mixed task into a Claude programming part and a Codex visual part", () => {
    const parts = decomposeWork({ areas: { programming: true, visual: true }, objective: "Redesign search and change the API", programmingObjective: "Change the search API ranking", visualObjective: "Redesign the search page layout" });
    expect(parts.map((p) => [p.area, p.worker])).toEqual([
      ["programming", "claude"],
      ["visual", "codex"],
    ]);
    expect(parts[0].objective).toMatch(/^Change the search API ranking[\s\S]*You own ONLY the programming part/);
    expect(parts[1].objective).toMatch(/^Redesign the search page layout[\s\S]*You own ONLY the site-visual part/);
    expect(decomposeWork({ areas: { programming: false, visual: true }, objective: "x" })).toEqual([{ area: "visual", worker: "codex", objective: "x" }]);
  });

  it("availability decisions: takeover only on Claude quota; visual never to Claude; both down pauses; handback", () => {
    expect(decideExecutionWorker({ area: "programming", current: null, temporary: false, availability: ALL_AVAILABLE })).toMatchObject({ action: "run", worker: "claude" });
    expect(decideExecutionWorker({ area: "visual", current: null, temporary: false, availability: ALL_AVAILABLE })).toMatchObject({ action: "run", worker: "codex" });
    expect(decideExecutionWorker({ area: "programming", current: "claude", temporary: false, availability: avail("quota_exhausted", "available") })).toMatchObject({
      action: "takeover",
      from: "claude",
      worker: "codex",
      temporary: true,
    });
    expect(decideExecutionWorker({ area: "programming", current: "claude", temporary: false, availability: avail("unavailable", "available") })).toMatchObject({ action: "pause", waitingFor: ["claude"] });
    expect(decideExecutionWorker({ area: "visual", current: "codex", temporary: false, availability: avail("available", "quota_exhausted", "2026-10-07T18:00:00.000Z") })).toEqual({
      action: "pause",
      waitingFor: ["codex"],
      resetAt: "2026-10-07T18:00:00.000Z",
      reason: expect.stringContaining("never handed to Claude"),
    });
    expect(decideExecutionWorker({ area: "programming", current: "codex", temporary: true, availability: avail("quota_exhausted", "quota_exhausted") })).toMatchObject({ action: "pause", waitingFor: ["claude", "codex"] });
    expect(decideExecutionWorker({ area: "programming", current: "codex", temporary: true, availability: ALL_AVAILABLE })).toMatchObject({ action: "handback", from: "codex", worker: "claude" });
  });
});

describe("typed availability failures", () => {
  it.each([
    ["Claude AI usage limit reached|1791403200", "quota_exhausted"],
    ["ERROR: You've hit your usage limit. Upgrade to Pro or try again later.", "quota_exhausted"],
    ['{"type":"usage_limit_reached","resets_in_seconds":3600}', "quota_exhausted"],
    ["429 Too Many Requests: rate limit exceeded", "rate_limited_transient"],
    ["API Error: 529 overloaded", "service_unavailable"],
    ["Not logged in. Please run `codex login`.", "authentication_unavailable"],
    ["segfault", "process_failure"],
  ])("%s -> %s", (stderr, kind) => {
    expect(classifyAvailabilityFailure({ stderr, exitCode: 1, now: NOW }).kind).toBe(kind);
  });

  it("a missing executable is typed", () => {
    expect(classifyAvailabilityFailure({ spawnError: "ENOENT", now: NOW })).toEqual({ kind: "executable_unavailable", resetAt: null });
  });

  it("reset times are taken only from trustworthy formats, never guessed", () => {
    expect(parseTrustedResetTime("Claude AI usage limit reached|1791403200", NOW)).toBe(new Date(1791403200 * 1000).toISOString());
    expect(parseTrustedResetTime('{"resets_at":"2026-10-07T18:00:00Z"}', NOW)).toBe("2026-10-07T18:00:00.000Z");
    expect(parseTrustedResetTime('{"resets_in_seconds": 3600}', NOW)).toBe("2026-10-07T01:00:00.000Z");
    expect(parseTrustedResetTime("You've hit your usage limit. Try again at 3:45 PM.", NOW)).toBeNull();
    expect(parseTrustedResetTime("5-hour limit reached ∙ resets 2am", NOW)).toBeNull();
  });
});

describe("durable human guidance constraints", () => {
  it("derives rejected validations and evidence targets from Chinese and English guidance", () => {
    const zh = deriveGuidanceConstraint({ decisionId: "d1", round: 2, guidance: "不要再把 typecheck 當主要驗收，直接讀 Home.tsx 和搜尋元件取得 evidence" });
    expect(zh).toMatchObject({ rejectedValidations: ["typecheck"], wantsDirectEvidence: true });
    expect(zh.evidenceTargets).toEqual(["Home.tsx", "Search"]);
    const en = deriveGuidanceConstraint({ decisionId: "d2", round: 2, guidance: "Stop rerunning tests; read `SearchBar` in client/src/components/SearchBar.tsx instead." });
    expect(en.rejectedValidations).toEqual(["tests"]);
    expect(en.evidenceTargets).toEqual(expect.arrayContaining(["client/src/components/SearchBar.tsx", "SearchBar"]));
    expect(deriveGuidanceConstraint({ decisionId: "d3", round: 2, guidance: "The fixture expects UTC timestamps." }).rejectedValidations).toEqual([]);
  });

  it("read-only plans drop a rejected validation; change plans keep it only as an explained safety gate", () => {
    const c = [deriveGuidanceConstraint({ decisionId: "d1", round: 2, guidance: "不要再跑 typecheck，直接看 Home.tsx" })];
    const ro = applyGuidanceConstraints({ mode: "read_only", rerunValidations: ["typecheck"], constraints: c });
    expect(ro).toMatchObject({ rerunValidations: [], deferredValidations: ["typecheck"], justification: null, evidenceTargets: ["Home.tsx"] });
    expect(ro.constraintLines[0]).toContain("still binding");
    const ch = applyGuidanceConstraints({ mode: "change", rerunValidations: ["tests", "typecheck"], constraints: c });
    expect(ch.rerunValidations).toEqual(["tests", "typecheck"]);
    expect(ch.justification).toMatch(/mandatory pre-commit safety gate AFTER/);
  });
});

describe("Manager evidence plan for read-only work", () => {
  const ASK = "幫我檢查 OXM 首頁目前搜尋框的 placeholder 是什麼，不要修改任何檔案";
  it("a factual question requires source file, literal value, variants and an unchanged workspace — not typecheck", () => {
    const plan = deriveEvidencePlan({ mode: "read_only", intent: "investigate_or_answer", originalRequest: ASK });
    expect(plan.kind).toBe("factual_lookup");
    expect(plan.validationIsEvidence).toBe(false);
    expect(plan.targets).toEqual(["Home", "search", "placeholder"]);
    expect(plan.requirements.join(" ")).toMatch(/exact repository path[\s\S]*exact literal value[\s\S]*conditional variants[\s\S]*unchanged[\s\S]*never evidence/);
    expect(renderEvidenceInstruction(plan)).toMatch(/^EVIDENCE THE MANAGER REQUIRES \(factual_lookup\): Start from: Home, search, placeholder\./);
    expect(deriveEvidencePlan({ mode: "read_only", intent: "audit_or_review", originalRequest: "審查付款流程" }).kind).toBe("audit");
    expect(deriveEvidencePlan({ mode: "change", intent: "change_code", originalRequest: "改首頁" }).kind).toBe("change");
  });

  it("gathers bounded excerpts of the actual source from the plan, independent of what the Worker cited", async () => {
    const plan = deriveEvidencePlan({ mode: "read_only", intent: "investigate_or_answer", originalRequest: ASK });
    const repo: Record<string, string> = {
      "client/src/pages/Home.tsx": 'import x from "y";\n\nexport function Home() {\n  return <Input placeholder="搜尋工廠" />;\n}\n',
      "client/src/pages/Home.test.tsx": "it('renders')\n",
      "node_modules/x/Home.js": "nope",
      "server/routers.ts": "export {}\n",
    };
    const ev = await gatherSourceEvidence({
      plan,
      cited: [],
      ports: { read: (p) => repo[p] ?? null, listFiles: async () => Object.keys(repo), searchContent: async (kw) => Object.keys(repo).filter((p) => repo[p].includes(kw)) },
    });
    expect(ev[0].path).toBe("client/src/pages/Home.tsx");
    expect(ev[0].excerpt).toContain('4:   return <Input placeholder="搜尋工廠" />;');
    expect(ev.some((e) => e.path.startsWith("node_modules/"))).toBe(false);
    expect(excerptAround("a\nb\nc", ["zzz"])).toBe("1: a\n2: b\n3: c");
  });
});

describe("structured handoff", () => {
  it("keeps the same task/branch/checkpoint/criteria, labels the Worker claim, and never restarts", () => {
    const h = buildHandoffSummary({
      taskId: "t1",
      lineageId: "t1",
      branch: "agent/task-t1-x",
      checkpointHeadSha: "a".repeat(40),
      from: "claude",
      to: "codex",
      reason: "claude_quota_exhausted",
      objective: "Fix the API",
      acceptanceCriteria: ["API returns 200"],
      changedPaths: ["server/a.ts"],
      validations: [{ name: "tests", requested: true, executed: true, status: "failed", trusted: true }],
      acceptance: [{ criterionId: "AC-1", status: "failed", evidenceType: "validation", reference: "tests" }],
      latestDiagnosis: null,
      lastRun: { runId: "t1-run-1", status: "success", errorType: null, claim: "I fixed it" },
      allowedScope: ["server/"],
      round: 1,
      repairAttempt: 0,
      cyclesRecorded: 0,
      previousHandoffs: 0,
      now: NOW,
    });
    expect(h).toMatchObject({ taskId: "t1", branch: "agent/task-t1-x", checkpointHeadSha: "a".repeat(40), restartFromScratch: false, filesInvolved: ["server/a.ts"], acceptanceCriteria: ["API returns 200"] });
    expect(h.completed.join("\n")).toContain("UNVERIFIED claim, not evidence");
    const block = renderHandoffBlock(h);
    expect(block).toMatch(/^WORKER HANDOFF \(claude_quota_exhausted\): claude -> codex\. Same task t1/);
    expect(block).toContain("do not restart from scratch");
    expect(block).toContain("do NOT revert or redo completed work");
  });
});

describe("Executive communication (plain owner language)", () => {
  it("detects the owner's language; Traditional Chinese by default", () => {
    expect(ownerLanguage("幫我看搜尋")).toBe("zh");
    expect(ownerLanguage("fix the search page")).toBe("en");
    expect(ownerLanguage(undefined)).toBe("zh");
  });

  it("task received: read-only, single Worker, mixed, high-risk — all jargon-free", () => {
    const ro = taskReceivedMessage({ lang: "zh", label: "首頁搜尋框", mode: "read_only", intent: "investigate_or_answer", workers: ["claude"], mixed: false, needsStartApproval: false });
    expect(ro).toBe("收到，我會用唯讀方式檢查，不修改任何檔案。查完直接回你。\n任務：首頁搜尋框");
    const mixed = taskReceivedMessage({ lang: "zh", label: "搜尋頁改版", mode: "change", intent: "change_code", workers: ["claude", "codex"], mixed: true, needsStartApproval: true });
    expect(mixed).toContain("程式邏輯交給 Claude，畫面設計交給 Codex");
    expect(mixed).toContain("開始執行前我會先請你批准");
    for (const t of [ro, mixed]) expect(findInternalJargon(t)).toEqual([]);
  });

  it("decision request answers what/tried/blocker/recommendation/ask, never internal codes", () => {
    expect(blockerKindFor("acceptance_unverified")).toBe("evidence_missing");
    expect(blockerKindFor("worker_worker_failure")).toBe("worker_stuck");
    const d = decisionContent({ lang: "zh", label: "首頁搜尋框的實際文字", mode: "read_only", failureCode: "acceptance_unverified", attempts: 2, stagnated: true });
    const text = decisionMessage(d);
    expect(text).toMatch(/^我目前還不能確認「首頁搜尋框的實際文字」的結果。\n我已經讓工程師處理了 2 次，但每次卡在同一個地方。\n工程師沒有把我需要的程式碼證據帶回來/);
    expect(text).toContain("我建議讓它直接讀相關的程式檔案，把實際內容帶回來確認。");
    expect(text).toContain("要我照這個方向繼續嗎？");
    expect(findInternalJargon(text)).toEqual([]);
    expect(text).not.toMatch(/AC-\d|acceptance_|fingerprint|hd\.\d|Gateway/);
  });

  it("quota messages: Claude takeover, Codex visual pause (never Claude), unknown reset stated honestly", () => {
    const takeover = progressMessage("quota_takeover", { lang: "zh" });
    expect(takeover).toBe("Claude 的本期使用額度已用完。我已保存目前進度，暫時交由 Codex 繼續這個程式任務。Claude 額度恢復後，我會在安全的交接點切回 Claude。");
    const visual = progressMessage("quota_paused", { lang: "zh", area: "visual", waitingFor: ["codex"], resetAt: null });
    expect(visual).toBe("Codex 的使用額度已用完。這是視覺設計任務，我不會交給 Claude。進度已保存，額度恢復後會由 Codex 繼續。預計恢復時間：目前無法確定確切的恢復時間。");
    const known = progressMessage("quota_paused", { lang: "zh", area: "visual", waitingFor: ["codex"], resetAt: "2026-10-07T10:00:00.000Z" });
    expect(known).toContain("預計恢復時間：2026/10/07 18:00（台北時間）");
    const both = progressMessage("quota_paused", { lang: "zh", area: "programming", waitingFor: ["claude", "codex"], resetAt: null });
    expect(both).toContain("Claude 和 Codex 的使用額度目前都用完了");
    expect(formatResetTime(null, "en")).toBe("the exact reset time cannot be determined");
    for (const t of [takeover, visual, known, both]) expect(findInternalJargon(t)).toEqual([]);
  });

  it("the jargon guard flags internal identifiers", () => {
    expect(findInternalJargon("acceptance:AC-1=acceptance_unverified fp=abc worker_worker_failure tg2.hd.1 via Gateway Ref: 0123456789abcdef")).toEqual(
      expect.arrayContaining(["AC-1", "acceptance_unverified", "worker_worker_failure", ".hd.1", "Gateway"]),
    );
    expect(findInternalJargon("已改 server/_core/rate_limit.ts")).toEqual([]);
  });
});
