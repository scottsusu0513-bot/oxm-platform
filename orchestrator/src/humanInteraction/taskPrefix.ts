/**
 * Formal-task gate for free-text owner messages. Pure and deterministic.
 *
 * Only a message that starts with 「任務:」 or 「任務：」 (surrounding
 * whitespace allowed) is a formal engineering task. Everything else is a
 * conversation with the Manager (questions, status, read-only lookups) and can
 * never create a task, a branch, or a file change — however the planner reads
 * it. The prefix is removed before the text reaches the planner or intake.
 */
const TASK_PREFIX = /^\s*任務\s*[:：]\s*/;

export type TaskCommand = { kind: "task"; body: string } | { kind: "empty" } | { kind: "conversation" };

export function parseTaskCommand(text: string): TaskCommand {
  const m = TASK_PREFIX.exec(text);
  if (!m) return { kind: "conversation" };
  const body = text.slice(m[0].length).trim();
  return body ? { kind: "task", body } : { kind: "empty" };
}

export const TASK_PREFIX_USAGE = "請在「任務：」後面寫上要做的事，例如：任務：把首頁搜尋框提示文字改成「搜尋工廠」。這次沒有建立任務。";
