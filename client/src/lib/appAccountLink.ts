/**
 * App（Capacitor）帳號連結的不透明 state，只存在記憶體。
 *
 * 伺服器以 oxm://oauth/callback?link=<state> 交給 App；state 是伺服器簽章、
 * 只含 challengeId 的 token，目標帳號／信箱／LINE identity 都不在 App 端。
 * 刻意不寫 localStorage／sessionStorage：App 完全重啟後 state 消失，使用者
 * 重新以 LINE 登入即可重新進入連結流程（伺服器在冷卻時間內會沿用同一組
 * 驗證碼，不會重複寄信）。
 *
 * 發起這次 LINE 登入時產生的 PKCE verifier 也一併只放記憶體：伺服器的連結
 * state 綁定同一個 challenge，驗證碼送出時必須附上 verifier。
 */
let currentState: string | null = null;
let currentVerifier: string | null = null;

/** verifier 未傳入時保留原本的值（重寄驗證碼只更新 state）。 */
export function setAppAccountLinkState(state: string, verifier?: string | null): void {
  currentState = state;
  if (verifier !== undefined) currentVerifier = verifier;
}

export function getAppAccountLinkState(): string | null {
  return currentState;
}

export function getAppAccountLinkVerifier(): string | undefined {
  return currentVerifier ?? undefined;
}

export function clearAppAccountLinkState(): void {
  currentState = null;
  currentVerifier = null;
}
