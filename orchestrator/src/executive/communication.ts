import type { RiskLevel, TaskCreatingIntent, TaskMode, WorkerKind } from "../domain/types";

/**
 * Executive Human Communication. Pure and deterministic.
 *
 * Presentation only: it turns internal Manager state (failure codes,
 * repair counts, availability, approvals) into short managerial messages a
 * business owner can act on. Internal identifiers (criterion ids, failure
 * fingerprints, enum names, escalation ids, refs, SHAs) never appear here;
 * they stay in audit logs, checkpoints and scheduler records.
 *
 * Every message answers, conclusion first: what happened, what was tried,
 * what blocks progress, what the Manager recommends, what the owner must do.
 */

export type OwnerLanguage = "zh" | "en";

const CJK = /[㐀-鿿豈-﫿]/;

/** Traditional Chinese whenever the owner writes Chinese (and by default, for this owner). */
export function ownerLanguage(...samples: readonly (string | null | undefined)[]): OwnerLanguage {
  const text = samples.filter(Boolean).join(" ");
  if (!text.trim()) return "zh";
  return CJK.test(text) ? "zh" : /[A-Za-z]{3,}/.test(text) ? "en" : "zh";
}

const WORKER_NAME: Record<WorkerKind, string> = { claude: "Claude", codex: "Codex" };

/** "2026/10/07 18:00（台北時間）" — only ever from a trusted reset time; null -> explicit "unknown". */
export function formatResetTime(resetAt: string | null, lang: OwnerLanguage): string {
  const ms = resetAt ? Date.parse(resetAt) : NaN;
  if (!Number.isFinite(ms)) return lang === "zh" ? "目前無法確定確切的恢復時間" : "the exact reset time cannot be determined";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const stamp = `${get("year")}/${get("month")}/${get("day")} ${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`;
  return lang === "zh" ? `${stamp}（台北時間）` : `${stamp} (Taipei time)`;
}

// ---------------------------------------------------------------------------
// Task received

export function taskReceivedMessage(input: {
  lang: OwnerLanguage;
  label: string;
  mode: TaskMode;
  intent: TaskCreatingIntent | null;
  workers: readonly WorkerKind[];
  mixed: boolean;
  needsStartApproval: boolean;
}): string {
  const zh = input.lang === "zh";
  const lines: string[] = [];
  if (input.mode === "read_only") {
    lines.push(zh ? "收到，我會用唯讀方式檢查，不修改任何檔案。查完直接回你。" : "Got it. I will look into this read-only, without changing any file, and reply with the answer.");
  } else if (input.mixed) {
    lines.push(
      zh
        ? "收到。這個需求包含程式和畫面兩部分：程式邏輯交給 Claude，畫面設計交給 Codex，兩邊完成後我會一起檢查。"
        : "Got it. This request has a programming part and a visual part: Claude takes the logic, Codex takes the visual design, and I will review both together.",
    );
  } else {
    const who = input.workers[0] ? WORKER_NAME[input.workers[0]] : zh ? "工程師" : "the engineer";
    const what = input.workers[0] === "codex" ? (zh ? "畫面設計" : "the visual design") : zh ? "程式修改" : "the code change";
    lines.push(zh ? `收到，我會交給 ${who} 處理${what}，完成後我先檢查結果。` : `Got it. ${who} will handle ${what}; I will check the result first.`);
  }
  if (input.label) lines.push(zh ? `任務：${input.label}` : `Task: ${input.label}`);
  if (input.needsStartApproval) lines.push(zh ? "這個任務風險較高，開始執行前我會先請你批准。" : "This task is high-risk, so I will ask for your approval before starting.");
  else if (input.mode !== "read_only")
    lines.push(zh ? "過程中只有需要你決定、或最後要發布時才會打擾你。" : "I will only interrupt you for a decision or the final publish approval.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Decision request (escalation after unresolved repair)

export const BLOCKER_KINDS = ["parts_dont_fit", "evidence_missing", "goal_not_met", "checks_failing", "checks_not_run", "worker_stuck", "ci_failing", "unknown"] as const;
export type BlockerKind = (typeof BLOCKER_KINDS)[number];

/** Internal failure code -> plain blocker kind (the code itself never reaches the owner). */
export function blockerKindFor(failureCode: string): BlockerKind {
  if (failureCode === "acceptance_unverified") return "evidence_missing";
  if (failureCode === "combined_review_failed") return "parts_dont_fit";
  if (failureCode === "acceptance_failed") return "goal_not_met";
  if (failureCode === "ci_failed") return "ci_failing";
  if (failureCode === "validation_failed") return "checks_failing";
  if (failureCode === "validation_missing" || failureCode === "worker_validation_incomplete") return "checks_not_run";
  if (failureCode.startsWith("worker_")) return "worker_stuck";
  return "unknown";
}

export interface PlainDecision {
  headline: string;
  tried: string;
  blocker: string;
  recommendation: string;
  ask: string;
}

export function decisionContent(input: { lang: OwnerLanguage; label: string; mode: TaskMode; failureCode: string; attempts: number; stagnated: boolean }): PlainDecision {
  const zh = input.lang === "zh";
  const kind = blockerKindFor(input.failureCode);
  const n = Math.max(1, input.attempts);
  const subject = input.label || (zh ? "這個任務" : "this task");
  const readOnly = input.mode === "read_only";
  const T = {
    parts_dont_fit: {
      headline: zh ? `「${subject}」的程式和畫面兩部分合在一起，還沒達到你要的效果。` : `The programming and visual parts of "${subject}" still do not fit together the way you asked.`,
      blocker: zh ? "我已經安排兩邊修正過，但兩部分還是對不起來。" : "I had both sides repaired, but they still do not line up.",
      recommendation: zh ? "我建議你說明最在意的效果，或指定要以哪一邊為準，我再安排修正。" : "I recommend telling me which outcome matters most, or which side is right, and I will plan the next fix.",
    },
    evidence_missing: {
      headline: zh ? `我目前還不能確認「${subject}」的結果。` : `I cannot confirm the result of "${subject}" yet.`,
      blocker: zh ? "工程師沒有把我需要的程式碼證據帶回來，所以我沒辦法確認答案是對的。" : "The engineer did not bring back the code evidence I need, so I cannot verify the answer.",
      recommendation: readOnly
        ? zh
          ? "我建議讓它直接讀相關的程式檔案，把實際內容帶回來確認。"
          : "I recommend having it read the relevant source files directly and bring back the actual content."
        : zh
          ? "我建議讓它針對你要的效果，直接帶回改動的實際內容讓我確認。"
          : "I recommend having it bring back the actual change for the outcome you asked for, so I can verify it.",
    },
    goal_not_met: {
      headline: zh ? `「${subject}」目前的結果還沒有達到你要的效果。` : `The result of "${subject}" does not meet what you asked for yet.`,
      blocker: zh ? "我比對你的原始需求後，發現結果還有落差。" : "Compared with your original request, the result still falls short.",
      recommendation: zh ? "我建議你補充一下想要的具體效果，我再讓工程師照著修正。" : "I recommend you clarify the exact outcome you want; I will have the engineer adjust accordingly.",
    },
    checks_failing: {
      headline: zh ? `「${subject}」改完之後，自動檢查還沒有通過。` : `After the change, the automatic checks for "${subject}" still fail.`,
      blocker: zh ? "修改後的程式有地方沒通過檢查，工程師修了還是沒解決。" : "Part of the change still fails the checks, and the fixes so far did not resolve it.",
      recommendation: zh ? "我建議你看一下是否有限制或背景資訊我們不知道，告訴我後我再安排修正。" : "I recommend telling me any constraint or background we may be missing; I will plan the next fix with it.",
    },
    ci_failing: {
      headline: zh ? `「${subject}」的 PR 自動檢查沒有通過。` : `The PR checks for "${subject}" do not pass.`,
      blocker: zh ? "本機檢查通過了，但 GitHub 上的自動檢查失敗。" : "Local checks passed, but the GitHub checks fail.",
      recommendation: zh ? "我建議先確認 GitHub 檢查的環境或規則是否有特別要求。" : "I recommend checking whether the GitHub check environment has special requirements.",
    },
    checks_not_run: {
      headline: zh ? `「${subject}」還沒有完成必要的檢查。` : `The required checks for "${subject}" have not completed.`,
      blocker: zh ? "工程師沒有把必要的檢查跑完，所以我無法確認修改是安全的。" : "The engineer did not complete the required checks, so I cannot confirm the change is safe.",
      recommendation: zh ? "我建議再讓工程師完整跑一次檢查。" : "I recommend having the engineer run the checks completely once more.",
    },
    worker_stuck: {
      headline: zh ? `「${subject}」工程師沒有順利完成。` : `The engineer could not finish "${subject}".`,
      blocker: zh ? "工程師這幾次都沒有順利完成工作。" : "The engineer did not complete the work in these attempts.",
      recommendation: zh ? "我建議你補充更明確的方向或範圍，我再讓它繼續。" : "I recommend giving a clearer direction or scope; I will have it continue.",
    },
    unknown: {
      headline: zh ? `「${subject}」卡住了，需要你的判斷。` : `"${subject}" is stuck and needs your judgement.`,
      blocker: zh ? "目前的問題我還沒辦法自動解決。" : "I cannot resolve the current problem automatically.",
      recommendation: zh ? "我建議你補充方向，我再安排下一步。" : "I recommend giving a direction; I will plan the next step.",
    },
  }[kind];
  const tried = zh
    ? `我已經讓工程師處理了 ${n} 次${input.stagnated ? "，但每次卡在同一個地方" : "，問題有變化但還沒解決"}。`
    : `I had the engineer work on it ${n} time${n > 1 ? "s" : ""}${input.stagnated ? ", but it got stuck at the same point each time" : "; the problem changed but is not solved"}.`;
  const ask = zh
    ? "要我照這個方向繼續嗎？直接傳訊息告訴我你的想法即可（例如該看哪個檔案、或補充說明）。這只是方向指示，不代表批准發布；要停止這個任務請按「取消任務」。"
    : "Shall I continue this way? Just send me your thoughts (for example which file to look at, or more context). This is guidance only, not a publish approval; press \"Cancel task\" to stop.";
  return { headline: T.headline, tried, blocker: T.blocker, recommendation: T.recommendation, ask };
}

export function decisionMessage(d: PlainDecision): string {
  return [d.headline, d.tried, d.blocker, d.recommendation, "", d.ask].join("\n");
}

/**
 * Decision request when the GPT Manager itself asked the owner to choose: its question and options
 * (already in the owner's language) replace the generic blocker text. Options are labelled 1..n so a
 * reply like "照第二個方案" resolves against them.
 */
export function managerDecisionContent(input: { lang: OwnerLanguage; label: string; question: string; options: readonly { id: string; summary: string }[]; recommended: string | null }): PlainDecision {
  const zh = input.lang === "zh";
  const list = input.options.map((o, i) => `${i + 1}. ${o.summary}`).join("\n");
  const rec = input.recommended ? input.options.findIndex((o) => o.id === input.recommended) : -1;
  return {
    headline: zh ? `「${input.label}」有一個地方需要你決定。` : `"${input.label}" needs a decision from you.`,
    tried: input.question,
    blocker: list,
    recommendation: rec >= 0 ? (zh ? `我建議第 ${rec + 1} 個方案。` : `I recommend option ${rec + 1}.`) : "",
    ask: zh
      ? "你要選哪一個？直接傳訊息告訴我即可（例如「照第二個方案」）。這只是方向指示，不代表批准發布；要停止這個任務請按「取消任務」。"
      : 'Which one? Just tell me (e.g. "go with option 2"). This is guidance only, not a publish approval; press "Cancel task" to stop.',
  };
}

/** Plain explanation of why an owner message could not be used (never the raw internal reason). */
export function inputRejection(code: "empty" | "too_long" | "credential" | "invalid" | "manager_unavailable", lang: OwnerLanguage, kind: "guidance" | "request"): string {
  const zh = lang === "zh";
  switch (code) {
    case "empty":
      return zh ? "我沒有收到內容，請再傳一次。沒有做任何變更。" : "I received no text; please send it again. Nothing was changed.";
    case "too_long":
      return zh ? `這段${kind === "guidance" ? "指示" : "需求"}太長了，請精簡一點再傳。沒有做任何變更。` : `That ${kind} is too long; please shorten it. Nothing was changed.`;
    case "credential":
      return zh
        ? "這段內容看起來包含密碼或金鑰之類的機密資料，為了安全我沒有使用它。請移除機密後再傳一次。沒有做任何變更。"
        : "That text looks like it contains a password or secret key, so I did not use it. Please remove it and resend. Nothing was changed.";
    case "manager_unavailable":
      return zh ? "我現在暫時無法理解這段指示（理解服務暫時無法使用）。任務會繼續等你決定，請稍後再傳一次。" : "I cannot interpret that guidance right now (my interpretation service is unavailable). The task keeps waiting for you; please resend shortly.";
    default:
      return zh ? "這個請求不符合規則，所以我沒有執行，也沒有做任何變更。" : "That request does not meet the rules, so I did not run it. Nothing was changed.";
  }
}

// ---------------------------------------------------------------------------
// Approvals

const RISK_ZH: Record<RiskLevel, string> = { green: "低", yellow: "中", red: "高" };
const RISK_EN: Record<RiskLevel, string> = { green: "low", yellow: "medium", red: "high" };

export function commitApprovalMessage(input: { lang: OwnerLanguage; label: string; files: readonly string[]; checksPassed: number; checksNotPassed: readonly string[]; risk: RiskLevel; expiresAt: string }): string {
  const zh = input.lang === "zh";
  const files = input.files.slice(0, 15);
  const more = input.files.length - files.length;
  return [
    zh ? `「${input.label}」已完成，也通過我的檢查，等待你批准發布。` : `"${input.label}" is done and passed my review. Waiting for your approval to publish.`,
    zh ? `這次改了 ${input.files.length} 個檔案：` : `Files changed (${input.files.length}):`,
    ...files.map((f) => `• ${f}`),
    ...(more > 0 ? [zh ? `…另外 ${more} 個` : `…and ${more} more`] : []),
    input.checksNotPassed.length
      ? zh
        ? `自動檢查：${input.checksPassed} 項通過，${input.checksNotPassed.length} 項未通過。`
        : `Checks: ${input.checksPassed} passed, ${input.checksNotPassed.length} not passed.`
      : zh
        ? "自動檢查：全部通過。"
        : "Checks: all passed.",
    zh ? `風險：${RISK_ZH[input.risk]}` : `Risk: ${RISK_EN[input.risk]}`,
    "",
    zh
      ? "按「批准發布」後，我會建立一次 commit、推送到這個任務的工作分支並開 PR。不會合併，也不會部署。"
      : 'Pressing "Approve publish" creates one commit, pushes the task branch and opens a PR. It never merges or deploys.',
    zh ? `此批准在 ${formatResetTime(input.expiresAt, "zh").replace("（台北時間）", "")} 前有效。` : `Valid until ${formatResetTime(input.expiresAt, "en").replace(" (Taipei time)", "")}.`,
  ].join("\n");
}

/** Plain-language risk reasons; internal rule names are never shown. */
export function plainRiskReasons(reasons: readonly string[], lang: OwnerLanguage): string[] {
  const zh = lang === "zh";
  const out: string[] = [];
  const add = (v: string) => {
    if (!out.includes(v)) out.push(v);
  };
  for (const r of reasons) {
    const l = r.toLowerCase();
    if (/prod|production|正式/.test(l)) add(zh ? "可能影響正式環境或正式資料" : "may affect production or production data");
    if (/delete|destructive|刪除/.test(l)) add(zh ? "可能刪除資料" : "may delete data");
    if (/deploy|部署/.test(l)) add(zh ? "涉及部署" : "involves deployment");
    if (/secret|credential|token|密鑰|金鑰/.test(l)) add(zh ? "涉及密鑰或機密設定" : "involves secrets or credentials");
    if (/auth|permission|security|權限|登入|安全/.test(l)) add(zh ? "涉及登入、權限或安全設定" : "involves login, permissions or security settings");
    if (/migration|schema|資料庫/.test(l)) add(zh ? "涉及資料庫結構" : "involves the database structure");
    if (/force|merge|main/.test(l)) add(zh ? "涉及主分支或強制推送" : "involves the main branch or a force push");
  }
  if (out.length === 0) add(zh ? "系統判定為高風險操作" : "classified as a high-risk operation");
  return out.slice(0, 4);
}

export function startApprovalMessage(input: { lang: OwnerLanguage; label: string; objective: string; reasons: readonly string[]; readOnly: boolean; repair: boolean; expiresAt: string; handback?: boolean }): string {
  const zh = input.lang === "zh";
  return [
    ...(input.handback
      ? [
          zh
            ? `Claude 的額度已恢復。「${input.label}」是高風險任務，要把它從 Codex 交回 Claude、從目前的進度繼續，需要你再批准一次這次執行。`
            : `Claude's quota is back. "${input.label}" is high-risk, so handing it back from Codex to Claude (continuing from the current progress) needs your approval for this run.`,
        ]
      : [zh ? `「${input.label}」風險較高，開始執行前需要你批准。` : `"${input.label}" is high-risk and needs your approval before it runs.`]),
    zh ? `要做的事：${input.objective}` : `What will run: ${input.objective}`,
    zh ? `為什麼需要批准：${plainRiskReasons(input.reasons, "zh").join("、")}` : `Why approval is needed: ${plainRiskReasons(input.reasons, "en").join("; ")}`,
    ...(input.repair ? [zh ? "這是修正後的新執行內容，所以要重新批准。" : "This is a revised run after a fix, so it needs a fresh approval."] : []),
    input.readOnly
      ? zh
        ? "這是唯讀檢查：在隔離的副本裡執行，不會修改任何檔案。"
        : "This is read-only: it runs in an isolated copy and changes no file."
      : zh
        ? "批准只代表允許執行這一次；之後要發布時還會另外請你批准。不會合併，也不會部署。"
        : "Approval only allows this one run; publishing needs a separate approval later. It never merges or deploys.",
    zh ? `此批准在 ${formatResetTime(input.expiresAt, "zh").replace("（台北時間）", "")} 前有效。` : `Valid until ${formatResetTime(input.expiresAt, "en").replace(" (Taipei time)", "")}.`,
  ].join("\n");
}

export function cancelConfirmationMessage(input: { lang: OwnerLanguage; label: string; expiresAt: string }): string {
  const zh = input.lang === "zh";
  return zh
    ? `確定要取消「${input.label}」嗎？\n取消後不會再做任何修改、commit 或發布。\n此確認在 ${formatResetTime(input.expiresAt, "zh").replace("（台北時間）", "")} 前有效。`
    : `Cancel "${input.label}"?\nAfter cancelling there are no further changes, commits or publishing.\nThis confirmation is valid until ${formatResetTime(input.expiresAt, "en").replace(" (Taipei time)", "")}.`;
}

// ---------------------------------------------------------------------------
// Progress milestones

export const PROGRESS_EVENTS = [
  "worker_assigned",
  "repairing",
  "reviewing_infrastructure_wait",
  "quota_takeover",
  "quota_handback",
  "quota_paused",
  "availability_paused",
  "part_completed",
  "combined_accepted",
  "combined_not_accepted",
  "combined_review_waiting",
  "combined_repairing",
  "guidance_accepted",
  "guidance_rejected",
  "pr_opened",
  "answered",
  "completed",
  "blocked",
  "cancelled",
  "awaiting_other_approval",
] as const;
export type ProgressEvent = (typeof PROGRESS_EVENTS)[number];

export function progressMessage(
  event: ProgressEvent,
  input: {
    lang: OwnerLanguage;
    worker?: WorkerKind | null;
    area?: "programming" | "visual";
    attempt?: number;
    answer?: string | null;
    prNumber?: number | null;
    waitingFor?: readonly WorkerKind[];
    resetAt?: string | null;
    reason?: string | null;
    cause?: "quota" | "authentication" | "executable" | "service";
    summary?: string | null;
    targets?: readonly ("programming" | "visual")[];
    /** blocked without a failure (non-terminal stop): paused for the owner, not failed. */
    paused?: boolean;
  },
): string {
  const zh = input.lang === "zh";
  const w = input.worker ? WORKER_NAME[input.worker] : zh ? "工程師" : "the engineer";
  switch (event) {
    case "worker_assigned":
      return zh
        ? `已交給 ${w} 處理${input.area === "visual" ? "畫面設計" : "程式部分"}。`
        : `Handed to ${w} for the ${input.area === "visual" ? "visual design" : "programming part"}.`;
    case "repairing":
      return zh
        ? `檢查後發現還有問題，正在請工程師修正（第 ${input.attempt ?? 1} 次）。`
        : `My review found a remaining problem; the engineer is fixing it (attempt ${input.attempt ?? 1}).`;
    case "reviewing_infrastructure_wait":
      return zh
        ? "工程師已經做完，但我的檢查服務暫時無法使用，所以還不能確認結果。任務沒有失敗，也沒有消耗修正次數；服務恢復後我會繼續。"
        : "The engineer finished, but my review service is temporarily unavailable, so I cannot confirm the result yet. The task has not failed and no fix attempt was used; I will continue when it is back.";
    case "quota_takeover":
      return zh
        ? "Claude 的本期使用額度已用完。我已保存目前進度，暫時交由 Codex 繼續這個程式任務。Claude 額度恢復後，我會在安全的交接點切回 Claude。"
        : "Claude's usage quota for this period is used up. I saved the progress and Codex is temporarily continuing this programming task. When Claude's quota is back, I will hand it back to Claude at a safe point.";
    case "quota_handback":
      return zh
        ? "Claude 的額度已恢復。我已在安全的交接點把這個程式任務交回 Claude，從 Codex 目前的進度繼續。"
        : "Claude's quota is back. At a safe point I handed this programming task back to Claude, continuing from Codex's progress.";
    case "quota_paused": {
      const when = zh ? `預計恢復時間：${formatResetTime(input.resetAt ?? null, "zh")}。` : `Expected reset: ${formatResetTime(input.resetAt ?? null, "en")}.`;
      const waiting = input.waitingFor ?? [];
      if (waiting.length === 1 && waiting[0] === "codex" && input.area === "visual")
        return zh
          ? `Codex 的使用額度已用完。這是視覺設計任務，我不會交給 Claude。進度已保存，額度恢復後會由 Codex 繼續。${when}`
          : `Codex's usage quota is used up. This is visual design work, so I will not hand it to Claude. Progress is saved; Codex continues when its quota is back. ${when}`;
      if (waiting.length > 1)
        return zh
          ? `Claude 和 Codex 的使用額度目前都用完了。我已保存進度並暫停這個任務，等可以接手的工程師恢復後，就從目前進度繼續。${when}`
          : `Claude and Codex are both out of usage quota. I saved the progress and paused this task; it continues from here as soon as an eligible engineer is available. ${when}`;
      return zh
        ? `${waiting[0] ? WORKER_NAME[waiting[0]] : "工程師"} 目前無法使用。我已保存進度並暫停這個任務，恢復後會從目前進度繼續。${when}`
        : `${waiting[0] ? WORKER_NAME[waiting[0]] : "The engineer"} is unavailable right now. I saved the progress and paused this task; it continues from here once available. ${when}`;
    }
    case "guidance_accepted":
      return zh ? "收到你的指示，我已經照新的方向繼續同一個任務，下一步有結果會再告訴你。" : "Got your guidance. I resumed the same task in the new direction and will report the next result.";
    case "guidance_rejected":
      if (input.reason && /manager_unavailable/.test(input.reason)) return inputRejection("manager_unavailable", input.lang, "guidance");
      return zh ? "這次的指示沒辦法套用（任務狀態已經改變），所以沒有繼續執行。可以用 /status 看目前狀態。" : "I could not apply that guidance (the task state changed), so nothing resumed. Use /status for the current state.";
    case "availability_paused": {
      const who = input.worker ? WORKER_NAME[input.worker] : zh ? "工程師" : "The engineer";
      if (input.cause === "authentication")
        return zh ? `${who} 目前需要重新登入，我已保存進度。登入恢復後可以從原位置繼續。` : `${who} needs to sign in again. I saved the progress; it continues from the same point once signed in.`;
      if (input.cause === "executable")
        return zh ? `目前找不到 ${who} 執行環境，任務已暫停，沒有遺失進度。` : `The ${who} runtime cannot be found. The task is paused and no progress was lost.`;
      return zh
        ? `${who} 的服務暫時無法使用，我重試了幾次還是不行，所以先暫停任務並保存進度。服務恢復後會從原位置繼續。`
        : `${who}'s service is unavailable; after a few retries I paused the task and saved the progress. It continues from the same point when the service is back.`;
    }
    case "part_completed":
      return zh
        ? "這部分已完成。另一部分完成後，我會把兩邊合在一起做最後檢查，確認整體符合你原本的需求。"
        : "This part is done. When the other part is done I will review both together against your original request.";
    case "combined_accepted":
      return zh
        ? `程式和畫面兩部分都完成了，我也把它們合在一起檢查過，整體符合你原本的需求。${input.summary ? `\n${input.summary}` : ""}\n要不要合併、部署由你決定。`
        : `Both the programming and the visual parts are done, and together they meet your original request.${input.summary ? `\n${input.summary}` : ""}\nMerging and deploying are up to you.`;
    case "combined_not_accepted":
      return zh
        ? `程式和畫面兩部分各自都通過檢查，但合在一起還沒達到你原本要的效果。${input.summary ? `\n${input.summary}` : ""}\n我建議先不要合併這兩個 PR。告訴我你想怎麼調整，我再安排修正。`
        : `Each part passed its own review, but together they do not yet meet your original request.${input.summary ? `\n${input.summary}` : ""}\nI recommend not merging the two PRs yet. Tell me how you want it adjusted.`;
    case "combined_repairing": {
      const t = input.targets ?? [];
      const who = zh
        ? t.length > 1
          ? "Claude 修正程式部分、Codex 修正畫面部分"
          : t[0] === "visual"
            ? "Codex 修正畫面部分"
            : "Claude 修正程式部分"
        : t.length > 1
          ? "Claude to fix the programming part and Codex the visual part"
          : t[0] === "visual"
            ? "Codex to fix the visual part"
            : "Claude to fix the programming part";
      return zh
        ? `程式和畫面兩部分各自都完成了，但合在一起還沒達到你原本要的效果。${input.summary ? `\n${input.summary}` : ""}\n我已經安排 ${who}，修好後會再整體檢查一次。`
        : `Each part is done, but together they do not yet meet your original request.${input.summary ? `\n${input.summary}` : ""}\nI have asked ${who}; I will review the whole again afterwards.`;
    }
    case "combined_review_waiting":
      return zh
        ? "兩部分都完成了，但我的整體檢查服務暫時無法使用，還不能確認合在一起是否符合需求；恢復後我會自動再檢查。"
        : "Both parts are done, but my combined review service is unavailable, so I cannot confirm the whole yet; I will review it automatically when it is back.";
    case "pr_opened":
      return zh
        ? `已開 PR${input.prNumber ? ` #${input.prNumber}` : ""}，正在等 GitHub 的自動檢查。我不會合併或部署。`
        : `PR${input.prNumber ? ` #${input.prNumber}` : ""} is open and waiting for the GitHub checks. I will not merge or deploy.`;
    case "answered":
      return zh
        ? `查到了。\n\n${input.answer ?? "（沒有記錄到答案）"}\n\n這次沒有修改任何檔案，答案已對照實際程式碼確認。`
        : `Here is the answer.\n\n${input.answer ?? "(no answer recorded)"}\n\nNo file was changed; I checked the answer against the actual source.`;
    case "completed":
      return zh
        ? `已完成${input.prNumber ? `，PR #${input.prNumber} 已通過自動檢查` : ""}。要不要合併、部署由你決定。`
        : `Done${input.prNumber ? `; PR #${input.prNumber} passed the checks` : ""}. Merging and deploying are up to you.`;
    case "blocked":
      if (input.paused)
        return zh
          ? "任務暫停，正在等待你的決定。我沒有再做任何修改或發布；可以用 /status 看細節。"
          : "The task is paused, waiting for your decision. I made no further change or publication; use /status for details.";
      return zh
        ? "任務執行失敗，我沒有再做任何修改或發布。需要的話可以用「任務：…」重新交代，或用 /status 看細節。"
        : "The task failed; I made no further change or publication. You can restate it as 「任務：…」, or use /status for details.";
    case "cancelled":
      return zh ? "任務已取消。不會再有任何修改、commit 或發布。" : "The task was cancelled. There will be no further change, commit or publication.";
    case "awaiting_other_approval":
      return zh
        ? "這個任務需要另一種批准（發布後的高風險確認），要在管理後台處理，Telegram 這裡無法批准。"
        : "This task needs another kind of approval (post-publish high-risk confirmation). It is handled in the operator console, not here.";
  }
}

// ---------------------------------------------------------------------------
// Technical details (only on the owner's explicit request)

/** Natural owner requests for the technical view, in Chinese or English. */
export const DETAILS_REQUEST = /詳細原因|技術細節|工程細節|細節給我|給我細節|看細節|技術資訊|為什麼(?:會)?失敗|為什麼(?:會)?卡住|失敗原因|錯誤細節|\b(?:show|give)\b.*\b(?:technical )?details\b|\btechnical details\b|\bwhy did it fail\b/i;

export interface TechnicalDetailsView {
  taskId: string;
  label: string;
  phase: string;
  worker: WorkerKind | null;
  workArea: "programming" | "visual" | null;
  temporaryCover: boolean;
  risk: RiskLevel;
  approvalPhase: string | null;
  validations: readonly { name: string; status: string }[];
  unmetCriteria: readonly { text: string; status: string; summary: string | null }[];
  ownerConstraints: readonly { kind: string; status: string; evidence: string }[];
  managerRootCause: string | null;
  repairAttempts: readonly { round: number; cycle: number; strategy: string | null; outcome: string }[];
  changedPaths: readonly string[];
  citedFiles: readonly string[];
  prNumber: number | null;
}

const STATUS_ZH: Record<string, string> = { passed: "通過", failed: "失敗", skipped: "略過", missing: "沒有執行", unknown: "無法確認", satisfied: "已遵守", violated: "未遵守", unsupported: "無法確認" };
const OUTCOME_ZH: Record<string, string> = { accepted: "通過", needs_repair: "仍需修正", needs_human_decision: "需要你決定", blocked: "失敗", needs_human_approval: "等待批准", running: "進行中" };

/** Readable technical view: structured facts only (no model reasoning, secrets or hashes). */
export function technicalDetailsMessage(v: TechnicalDetailsView, lang: OwnerLanguage): string {
  const zh = lang === "zh";
  const st = (s: string) => (zh ? (STATUS_ZH[s] ?? s) : s);
  const who = v.worker ? `${WORKER_NAME[v.worker]}${v.workArea ? (zh ? (v.workArea === "visual" ? "（畫面）" : "（程式）") : ` (${v.workArea})`) : ""}${v.temporaryCover ? (zh ? "，暫代 Claude" : ", covering for Claude") : ""}` : zh ? "尚未指派" : "not assigned";
  const lines = [
    zh ? `技術細節：${v.label}` : `Technical details: ${v.label}`,
    zh ? `任務編號：${v.taskId}` : `Task id: ${v.taskId}`,
    zh ? `目前狀態：${v.phase}` : `Status: ${v.phase}`,
    zh ? `負責：${who}` : `Assigned: ${who}`,
    zh ? `風險：${RISK_ZH[v.risk]}${v.approvalPhase ? `；等待批准（${v.approvalPhase === "commit_publish" ? "發布" : v.approvalPhase === "pre_execution" ? "執行前" : "其他"}）` : ""}` : `Risk: ${RISK_EN[v.risk]}${v.approvalPhase ? `; waiting for approval (${v.approvalPhase})` : ""}`,
    ...(v.prNumber ? [`PR: #${v.prNumber}`] : []),
    zh
      ? `自動檢查：${v.validations.map((x) => `${x.name} ${st(x.status)}`).join("、") || "還沒有"}`
      : `Checks: ${v.validations.map((x) => `${x.name} ${x.status}`).join(", ") || "none yet"}`,
  ];
  if (v.unmetCriteria.length) {
    lines.push(zh ? "還沒達成的驗收項目：" : "Unmet acceptance items:");
    for (const c of v.unmetCriteria) lines.push(`• ${c.text}（${st(c.status)}${c.summary ? `：${c.summary}` : ""}）`);
  }
  if (v.ownerConstraints.length) {
    lines.push(zh ? "你的指示檢查結果：" : "Your guidance, as verified:");
    for (const c of v.ownerConstraints) lines.push(`• ${st(c.status)}（${c.kind === "mechanically_verifiable" ? (zh ? "系統實際檢查" : "trusted check") : zh ? "Manager 對照實際成果判斷" : "Manager review"}）：${c.evidence}`);
  }
  if (v.managerRootCause) lines.push(zh ? `Manager 判斷的原因：${v.managerRootCause}` : `Manager root cause: ${v.managerRootCause}`);
  if (v.repairAttempts.length) {
    lines.push(zh ? "修正紀錄：" : "Repair attempts:");
    for (const a of v.repairAttempts) lines.push(zh ? `• 第 ${a.round} 輪第 ${a.cycle} 次：${a.strategy ?? "依檢查結果修正"}（結果：${OUTCOME_ZH[a.outcome] ?? a.outcome}）` : `• round ${a.round} attempt ${a.cycle}: ${a.strategy ?? "fix per review"} (result: ${a.outcome})`);
  }
  if (v.changedPaths.length) lines.push(zh ? `修改的檔案：${v.changedPaths.slice(0, 15).join("、")}` : `Changed files: ${v.changedPaths.slice(0, 15).join(", ")}`);
  if (v.citedFiles.length) lines.push(zh ? `引用的檔案：${v.citedFiles.slice(0, 10).join("、")}` : `Cited files: ${v.citedFiles.slice(0, 10).join(", ")}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Jargon guard

const JARGON: readonly RegExp[] = [
  /\bAC-\d+\b/,
  /\bacceptance_(?:unverified|failed)\b/,
  /fingerprint/i,
  /\bworker_[a-z_]+\b/,
  /\.hd\.\d+\b/,
  /\bhd\.\d+\b/,
  /\bGateway\b/,
  /\bRef:\s*[0-9a-f]{8,}/,
  /\b[0-9a-f]{16,}\b/,
  /\bescalation(?:Id)?\b/i,
  /\blineage\b/i,
  /\b(?:needs_human_decision|needs_repair|repair_requested|waiting_infrastructure|qa_pending|needs_human_approval|waiting_worker_quota|quota_exhausted|rate_limited_transient)\b/,
];

/**
 * Internal jargon found in an owner-facing message. Snake_case words are
 * flagged unless they are part of a file path or a quoted answer.
 */
export function findInternalJargon(text: string, options: { allowAnswerBody?: string | null } = {}): string[] {
  const body = options.allowAnswerBody ? text.replace(options.allowAnswerBody, "") : text;
  const hits = new Set<string>();
  for (const re of JARGON) {
    const m = re.exec(body);
    if (m) hits.add(m[0]);
  }
  for (const token of body.split(/[\s，。、：:；;（）()「」"'`]+/)) {
    if (/[/.]/.test(token)) continue;
    if (/^[a-z]+(?:_[a-z0-9]+)+$/.test(token)) hits.add(token);
  }
  return Array.from(hits);
}
