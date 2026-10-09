import type { WorkerKind } from "../domain/types";
import type { OwnerLanguage } from "../executive/communication";
import { outcomeOf, terminalClass, type FailureClass, type RetryAssessment } from "../gateway/retry";
import type { GatewayTaskStatus } from "../gateway/types";
import type { FollowUpTopic } from "../planning/types";

/**
 * Owner-facing answers about one known task (presentation only).
 *
 * WHAT the owner asks (status / result / reason / remediation / retry
 * eligibility) comes from the GPT Manager's semantic interpretation; every
 * FACT in the answer comes from trusted state: the scheduler's terminal
 * reason (anchored shapes only, never raw), the Gateway's deterministic
 * retry assessment and the task status. Nothing is guessed: an unknown
 * reason is said to be unknown.
 */

const L = (lang: OwnerLanguage, zh: string, en: string) => (lang === "zh" ? zh : en);
const workerName = (w: WorkerKind | null | undefined, lang: OwnerLanguage) => (w === "claude" ? "Claude" : w === "codex" ? "Codex" : L(lang, "工程師", "the engineer"));

const REASON_TEXT: Record<FailureClass, { zh: (w: string) => string; en: (w: string) => string }> = {
  git_safety: {
    zh: (w) => `系統偵測到 Git 狀態在 ${w} 執行期間發生異常變更，為安全起見自動停止，沒有接受 ${w} 的修改結果`,
    en: (w) => `the system detected an unexpected Git state change while ${w} was working, so for safety it stopped automatically and did not accept ${w}'s changes`,
  },
  workspace_safety: {
    zh: () => "工作環境的 Git 狀態不符合安全要求，系統為安全起見停止，沒有接受這次的修改",
    en: () => "the workspace's Git state did not meet the safety requirements, so the system stopped and accepted no changes",
  },
  scope: {
    zh: (w) => `${w} 的修改超出了這個任務允許的範圍，系統為安全起見停止，沒有接受這次的修改`,
    en: (w) => `${w}'s changes went beyond what this task allowed, so the system stopped and accepted no changes`,
  },
  quota: { zh: (w) => `${w} 的使用額度用完，無法繼續執行`, en: (w) => `${w} ran out of usage quota and could not continue` },
  auth: { zh: (w) => `${w} 的登入授權失效，無法繼續執行`, en: (w) => `${w}'s sign-in was no longer valid, so it could not continue` },
  runtime: { zh: (w) => `${w} 的執行環境無法使用，任務無法繼續`, en: (w) => `${w}'s work environment was unavailable, so the task could not continue` },
  timeout: { zh: (w) => `${w} 執行超過時間上限，沒有完成`, en: (w) => `${w} ran past the time limit without finishing` },
  worker_error: { zh: (w) => `${w} 執行過程出錯，沒有產生可以信任的結果`, en: (w) => `${w} hit an error and produced no result that could be trusted` },
  budget: { zh: () => "已經用完允許的嘗試次數，仍沒有得到可接受的結果", en: () => "it used up the allowed attempts without an acceptable result" },
  cancelled: { zh: () => "任務被取消", en: () => "the task was cancelled" },
  approval_rejected: { zh: () => "批准請求被拒絕", en: () => "the approval request was rejected" },
  publish: { zh: () => "把結果提交或發布到 GitHub 時失敗", en: () => "submitting or publishing the result to GitHub failed" },
  persistence: { zh: () => "系統內部儲存任務狀態失敗，為安全起見停止", en: () => "the system failed to save the task state, so it stopped for safety" },
};

/** Plain-language reason a terminal task stopped, or null when no trusted reason is known. */
export function terminalReason(s: Pick<GatewayTaskStatus, "waitReason" | "assignedWorker">, lang: OwnerLanguage): string | null {
  const cls = terminalClass(s.waitReason);
  if (!cls) return null;
  const w = workerName(s.assignedWorker, lang);
  return lang === "zh" ? REASON_TEXT[cls].zh(w) : REASON_TEXT[cls].en(w);
}

/**
 * Whether a finished task was completed and, when it was not, the trusted reason. null for a task
 * that is still in progress.
 */
export function terminalFollowUp(s: GatewayTaskStatus, lang: OwnerLanguage): string | null {
  const outcome = outcomeOf(s);
  if (outcome === "completed") return L(lang, "這筆任務已完成。", "This task is complete.");
  if (outcome === "active") return null;
  const reason = terminalReason(s, lang);
  if (outcome === "cancelled")
    return reason && !/取消|cancelled/.test(reason)
      ? L(lang, `這筆任務沒有完成，已被取消：${reason}。`, `This task was not completed; it was cancelled: ${reason}.`)
      : L(lang, "這筆任務沒有完成，已被取消。", "This task was not completed; it was cancelled.");
  return reason
    ? L(lang, `這筆任務沒有完成。原因：${reason}。`, `This task was not completed. Reason: ${reason}.`)
    : L(lang, "這筆任務沒有完成，已停止執行。目前的紀錄不足以說明確切的停止原因，我不會用猜測回答。", "This task was not completed and has stopped. The current record is not enough to state the exact reason, so I will not guess.");
}

/** A follow-up that only asks where a task is: the status card answers it best. */
export function isPureStatusQuestion(topics: readonly FollowUpTopic[] | undefined): boolean {
  return !topics || topics.length === 0 || topics.every((t) => t === "status");
}

const RETRY_HINT = { zh: "如果要重新執行，直接跟我說一聲就可以，不用重貼需求或任務編號。", en: "If you want it re-run, just tell me — no need to resend the request or the task id." };
const NEW_TASK = {
  zh: "原本的任務不會直接恢復；我會依照原本的需求、驗收條件和範圍建立一筆新任務，從目前最新的程式版本重新執行，原本那次的修改不會沿用",
  en: "the stopped task itself is not resumed; I would create a new task with the original request, acceptance criteria and scope, starting from the latest code, without reusing the earlier changes",
};

/** What can be done about the task, by trusted failure class and the deterministic retry assessment. */
function remediation(a: RetryAssessment, lang: OwnerLanguage, w: string, retryPhase: string | null): string {
  const e = a.eligibility;
  switch (e.kind) {
    case "in_progress":
      return e.waiting === "decision"
        ? L(lang, "這筆任務還沒結束，正在等你決定修正方向：不需要重新建立任務，直接告訴我你希望怎麼修正，它就會從目前的進度繼續修正。", "The task has not ended; it is waiting for your direction. No new task is needed: tell me how it should be fixed and it continues from where it is.")
        : e.waiting === "approval"
          ? L(lang, "這筆任務正在等你批准（請按批准或拒絕），不需要重新執行。", "The task is waiting for your approval (approve or reject); it does not need a re-run.")
          : e.waiting === "availability"
            ? L(lang, `進度已保存，等 ${w} 恢復可用後會從原位置繼續，不需要重新執行。`, `Progress is saved and it continues from the same point once ${w} is available again; no re-run is needed.`)
            : L(lang, "這筆任務還在進行中，不需要重新執行，完成後我會告訴你結果。", "The task is still in progress; no re-run is needed. I will report the result.");
    case "retry_in_progress":
      return L(lang, `已經有一筆依原需求重新執行的任務在進行中${retryPhase ? `（${retryPhase}）` : ""}，不會再重複建立。`, `A re-run of the original request is already in progress${retryPhase ? ` (${retryPhase})` : ""}; I will not start another one.`);
    case "not_supported":
      return L(lang, "這筆任務是一個拆分需求的其中一部分，沒辦法單獨重新執行；如果要重做，請用「任務：…」重新下達完整的需求。", "This task is one part of a split request and cannot be re-run alone; to redo it, send the whole request again as 「任務：…」.");
    case "wait_recovery": {
      const at = e.resetAt ? L(lang, `（系統紀錄的恢復時間：${e.resetAt}）`, ` (recorded reset time: ${e.resetAt})`) : "";
      return e.cause === "quota"
        ? L(lang, `目前 ${w} 的使用額度還沒恢復，現在重新執行也會失敗；等額度恢復後再重新執行${at}。`, `${w}'s usage quota has not recovered yet, so a re-run now would fail too; re-run it once the quota is back${at}.`)
        : e.cause === "auth"
          ? L(lang, `目前 ${w} 的登入還有問題，要先恢復登入才能重新執行。`, `${w}'s sign-in still has a problem; it has to be restored before a re-run.`)
          : L(lang, `目前 ${w} 的執行環境還無法使用，要先恢復才能重新執行。`, `${w}'s work environment is still unavailable; it has to be restored before a re-run.`);
    }
    case "allowed": {
      if (e.rerun) return L(lang, `如果要再做一次，${NEW_TASK.zh}（不是修正原任務）。`, `To run it again, ${NEW_TASK.en} (this is not a fix of the original).`);
      const lead =
        a.outcome === "cancelled"
          ? ""
          : a.failureClass === "git_safety" || a.failureClass === "workspace_safety"
            ? L(lang, "這是安全檢查造成的停止。", "This was a safety stop.")
            : a.failureClass === "scope"
              ? L(lang, "如果需求本身就需要改到更多地方，建議重新執行前先補充說明範圍，否則可能再次被擋下。", "If the request really needs to touch more places, clarify the scope before a re-run, or it may be stopped again.")
              : a.failureClass === "budget"
                ? L(lang, "同樣的做法可能再失敗，建議重新執行前告訴我你希望的修正方向。", "The same approach may fail again; tell me the direction you want before a re-run.")
                : a.failureClass === "approval_rejected"
                  ? L(lang, "這是因為批准被拒絕而停止；重新執行時，執行或發布前仍會再請你批准。", "It stopped because an approval was rejected; a re-run still asks for your approval before running or publishing.")
                  : a.failureClass === "publish"
                    ? L(lang, "修改有完成，但提交或發布到 GitHub 時失敗。", "The change was made, but submitting or publishing it to GitHub failed.")
                    : a.failureClass === "timeout" || a.failureClass === "worker_error" || a.failureClass === "persistence"
                      ? L(lang, "這類錯誤通常是暫時性的。", "This kind of error is usually temporary.")
                      : a.failureClass === "auth" || a.failureClass === "runtime"
                        ? L(lang, `我無法確認 ${w} 的問題是否已經排除；如果你已經處理好，可以重新執行，若仍未恢復，新任務會暫停等待，不會消耗修正次數。`, `I cannot confirm ${w}'s problem is fixed; if you have fixed it, it can be re-run, and if not, the new task pauses without using fix attempts.`)
                        : a.failureClass === null
                          ? L(lang, "目前紀錄不足以確認停止原因，重新執行無法保證不會再遇到同樣的問題。", "The record is not enough to confirm why it stopped, so a re-run may hit the same problem.")
                          : "";
      return L(lang, `${lead}${NEW_TASK.zh}。`, `${lead}${lead ? " " : ""}${NEW_TASK.en.charAt(0).toUpperCase()}${NEW_TASK.en.slice(1)}.`);
    }
  }
}

export function eligibilityVerdict(a: RetryAssessment, lang: OwnerLanguage): string {
  const e = a.eligibility;
  switch (e.kind) {
    case "allowed":
      return e.caution === "recovery_unverified" ? L(lang, "可以重新執行，但有前提。", "It can be re-run, with a condition.") : L(lang, "可以重新執行。", "Yes, it can be re-run.");
    case "in_progress":
      return L(lang, "不需要重新執行。", "It does not need a re-run.");
    case "retry_in_progress":
      return L(lang, "現在不會再重新執行一次。", "I will not re-run it again right now.");
    case "wait_recovery":
      return L(lang, "現在還不能重新執行。", "It cannot be re-run yet.");
    case "not_supported":
      return L(lang, "這筆沒辦法單獨重新執行。", "This one cannot be re-run on its own.");
  }
}

/**
 * One integrated answer to a follow-up that asks more than "where is it" (reason, remediation,
 * retry eligibility, result). Conclusion first; the status card is not repeated.
 */
export function composeFollowUp(input: {
  status: GatewayTaskStatus;
  topics: readonly FollowUpTopic[];
  assessment: RetryAssessment | null;
  label: string;
  phase: string;
  /** Plain phase of an active re-run, when one exists. */
  retryPhase: string | null;
  lang: OwnerLanguage;
}): string {
  const { status: s, topics, assessment: a, lang } = input;
  const w = workerName(s.assignedWorker, lang);
  const asks = new Set(topics);
  const parts: string[] = [];
  const wantsRetry = asks.has("retry_eligibility");
  const wantsFix = asks.has("remediation");
  if (wantsRetry && a) parts.push(eligibilityVerdict(a, lang));
  const outcome = outcomeOf(s);
  // State and reason: always when the owner asks why / whether / what now about a finished task.
  if (outcome === "active") {
    if (asks.has("status") || asks.has("result") || asks.has("reason") || wantsFix || wantsRetry) parts.push(L(lang, `「${input.label}」目前：${input.phase}。`, `"${input.label}" now: ${input.phase}.`));
  } else {
    const lead = terminalFollowUp(s, lang)!;
    parts.push(lead.replace(/^這筆任務/, `「${input.label}」`).replace(/^This task/, `"${input.label}"`));
  }
  if ((wantsFix || wantsRetry) && a) {
    const fix = remediation(a, lang, w, input.retryPhase);
    if (fix) parts.push(fix);
    if (a.eligibility.kind === "allowed") parts.push(L(lang, RETRY_HINT.zh, RETRY_HINT.en));
  }
  return parts.join(lang === "zh" ? "" : " ").replace(/。。/g, "。");
}

/** Owner message when a requested re-run was refused by the deterministic policy (nothing created). */
export function retryRefusedMessage(a: RetryAssessment, input: { label: string; phase: string; retryPhase: string | null; worker: WorkerKind | null; lang: OwnerLanguage }): string {
  const { lang } = input;
  const w = workerName(input.worker, lang);
  const head =
    a.eligibility.kind === "in_progress"
      ? L(lang, `「${input.label}」還沒結束（${input.phase}），所以我沒有重新建立任務。`, `"${input.label}" has not ended (${input.phase}), so I did not create a new task.`)
      : L(lang, `我沒有重新執行「${input.label}」。`, `I did not re-run "${input.label}".`);
  return `${head}${remediation(a, lang, w, input.retryPhase)}${L(lang, "（這次沒有建立任何新任務。）", " (No new task was created.)")}`;
}
