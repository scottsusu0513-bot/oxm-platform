// @vitest-environment jsdom
/**
 * vite:preloadError 自動復原（Production Hardening Batch 1）：第一次舊 chunk
 * 載入失敗自動 reload 一次；冷卻時間內再失敗就不 reload，錯誤交給
 * ErrorBoundary，絕不無限重新整理。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHUNK_RELOAD_COOLDOWN_MS, CHUNK_RELOAD_STORAGE_KEY, handleChunkPreloadError, installChunkReloadHandler,
} from "./chunkReload";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
  };
}

describe("handleChunkPreloadError", () => {
  it("第一次觸發 → reload 並記錄時間", () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    expect(handleChunkPreloadError({ storage, reload, now: () => 1_000 })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem(CHUNK_RELOAD_STORAGE_KEY)).toBe("1000");
  });

  it("reload 後再次失敗（冷卻時間內）→ 不再 reload，不會無限重新整理", () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    let t = 1_000;
    const now = () => t;
    expect(handleChunkPreloadError({ storage, reload, now })).toBe(true);
    t += 5_000;
    expect(handleChunkPreloadError({ storage, reload, now })).toBe(false);
    t += 5_000;
    expect(handleChunkPreloadError({ storage, reload, now })).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("超過冷卻時間後的新部署失敗 → 可再自動 reload 一次", () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    let t = 1_000;
    handleChunkPreloadError({ storage, reload, now: () => t });
    t += CHUNK_RELOAD_COOLDOWN_MS + 1;
    expect(handleChunkPreloadError({ storage, reload, now: () => t })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("storage 不可用 → 不自動 reload（無法防止迴圈時寧可不 reload）", () => {
    const reload = vi.fn();
    expect(handleChunkPreloadError({ storage: null, reload, now: () => 1 })).toBe(false);
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(handleChunkPreloadError({ storage: throwing, reload, now: () => 1 })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("installChunkReloadHandler（真實 window 事件）", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("第一次 vite:preloadError → reload 一次並 preventDefault；第二次不 reload、不 preventDefault（錯誤交給 ErrorBoundary）", () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload } });
    installChunkReloadHandler();

    const first = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(first);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(first.defaultPrevented).toBe(true);

    const second = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(second);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(false);
  });
});
