/**
 * 部署後舊 chunk 載入失敗的自動復原（Vite `vite:preloadError`）。
 *
 * 情境：使用者開著舊版 HTML → 新版部署 → 舊 chunk hash 已不存在 → lazy route
 * 的動態 import 失敗。第一次發生時自動重新整理一次，拿到新版 HTML 與新 chunk；
 * 冷卻時間內再次失敗（例如重新整理後仍然失敗，或伺服器真的有問題）就不再
 * reload，讓錯誤照常往上拋給 ErrorBoundary 顯示錯誤畫面——絕不無限重新整理。
 */
export const CHUNK_RELOAD_STORAGE_KEY = "oxm_chunk_reload_at";
export const CHUNK_RELOAD_COOLDOWN_MS = 10 * 60 * 1000;

export interface ChunkReloadDeps {
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  reload: () => void;
  now: () => number;
}

/** 回傳 true 代表已觸發 reload（呼叫端應 preventDefault 吞掉這次錯誤）。 */
export function handleChunkPreloadError(deps: ChunkReloadDeps): boolean {
  const { storage, reload, now } = deps;
  // 無法記錄是否已重試過（例如 storage 被封鎖）時不自動 reload，避免迴圈。
  if (!storage) return false;
  try {
    const last = Number(storage.getItem(CHUNK_RELOAD_STORAGE_KEY) ?? "");
    if (Number.isFinite(last) && last > 0 && now() - last < CHUNK_RELOAD_COOLDOWN_MS) return false;
    storage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(now()));
  } catch {
    return false;
  }
  reload();
  return true;
}

function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function installChunkReloadHandler() {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    const reloaded = handleChunkPreloadError({
      storage: safeSessionStorage(),
      reload: () => window.location.reload(),
      now: () => Date.now(),
    });
    if (reloaded) event.preventDefault();
  });
}
