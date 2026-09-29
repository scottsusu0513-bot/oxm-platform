/**
 * App（Capacitor）帳號連結的不透明 state，只存在記憶體。
 *
 * 伺服器以 oxm://oauth/callback?link=<state> 交給 App；state 是伺服器簽章、
 * 只含 challengeId 的 token，目標帳號／信箱／LINE identity 都不在 App 端。
 * 刻意不寫 localStorage／sessionStorage：App 完全重啟後 state 消失，使用者
 * 重新以 LINE 登入即可重新進入連結流程（伺服器在冷卻時間內會沿用同一組
 * 驗證碼，不會重複寄信）。
 */
let currentState: string | null = null;

export function setAppAccountLinkState(state: string): void {
  currentState = state;
}

export function getAppAccountLinkState(): string | null {
  return currentState;
}

export function clearAppAccountLinkState(): void {
  currentState = null;
}
