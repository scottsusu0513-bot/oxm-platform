// @vitest-environment jsdom
/**
 * ScrollRestorationManager 的 PUSH／POP 判斷整合測試（見任務定案「Library
 * scroll regression 修正」）。
 *
 * Root cause：舊版用「popstate 事件監聽器寫入 ref → pathname-effect 讀取這個
 * ref」判斷這次導航是不是瀏覽器原生上一頁／下一頁，這個設計假設監聽器一定會
 * 在 pathname 變化的 effect 之前、同一輪 event loop 內同步跑完。實測（見對話
 * 「Library scroll regression」audit 的瀏覽器操作重現）證實這個假設不成立：
 * wouter 更新 location 的時機可能搶在這個元件（掛載後才註冊）的 popstate
 * 監聽器之前，導致 popstate 觸發的那次 pathname-effect 讀到 ref 還是舊值（誤判
 * 成新導航），而姍姍來遲的 popstate 事件把 ref 設回 true 時，已經沒有對應的
 * pathname 變化可以消費——這個「延遲設真」的旗標會殘留到下一次真正的新導航，
 * 讓那次新導航被誤判成 popstate、錯誤地保留了舊 scroll（重現序列：/library
 * 往下滑 → 點文章 → 上一頁 → 再點另一篇「新」文章，新文章會繼承 /library 的
 * scrollY 而不是從頂端開始）。
 *
 * 修正後改用 history.state 標記（App.tsx 的
 * isCurrentHistoryEntryVisited／markCurrentHistoryEntryVisited）：不依賴任何
 * 事件時機，POP 一定會回到「先前已標記過」的 entry，PUSH 一定落在瀏覽器指派的
 * 全新、未標記 entry。這裡用 jsdom 真正的 history.pushState／history.back()
 * 搭配 wouter 真正的 <Link> 點擊，直接模擬使用者實際操作序列，斷言
 * window.scrollTo 有沒有被正確呼叫／沒有被誤呼叫。
 *
 * category filter persistence（返回 /library 時分類篩選是否保留）已經由
 * LibraryIndex.test.tsx 的既有測試涵蓋，這裡不重複；這份檔案只聚焦本輪修改的
 * 共用 ScrollRestorationManager 機制本身。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, Route, Switch, useRoute } from "wouter";
import { ScrollRestorationManager } from "./App";

function ArticleLeaf() {
  const [, params] = useRoute("/library/:slug");
  return (
    <div>
      <span data-testid="slug">{params?.slug}</span>
      <Link href="/library/what-is-bioplastics">相關館藏：生質塑膠</Link>
    </div>
  );
}

function IndexLeaf() {
  return (
    <div>
      <Link href="/library/what-is-cnc-machining">CNC 加工是什麼？</Link>
      <Link href="/library/what-is-sustainable-materials">永續材料是什麼？</Link>
    </div>
  );
}

function Harness() {
  return (
    <>
      <ScrollRestorationManager />
      <Switch>
        <Route path="/library" component={IndexLeaf} />
        <Route path="/library/:slug" component={ArticleLeaf} />
      </Switch>
    </>
  );
}

function resetHistoryTo(path: string) {
  window.history.replaceState(null, "", path);
}

describe("ScrollRestorationManager — PUSH／POP 判斷（見「Library scroll regression 修正」）", () => {
  let scrollToSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    scrollToSpy.mockRestore();
  });

  // 必須是檔案裡第一個測試：依賴模組級旗標 _scrollManagerMounted 還沒被其他
  // 測試設成 true，才能真正代表「直接輸入網址／整頁重新整理後的第一次掛載」。
  it("情境5：直接輸入文章網址（初次掛載）不會被強制捲頂，維持瀏覽器 reload 原生行為", () => {
    resetHistoryTo("/library/what-is-cnc-machining");
    render(<Harness />);
    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it("情境1：/library → 點文章卡片，新文章必須捲頂", async () => {
    resetHistoryTo("/library");
    render(<Harness />);
    scrollToSpy.mockClear();

    fireEvent.click(screen.getByText("CNC 加工是什麼？"));
    await waitFor(() => expect(window.location.pathname).toBe("/library/what-is-cnc-machining"));

    expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
  });

  it("情境2：article A → 點相關館藏連結進 article B，B 必須捲頂", async () => {
    resetHistoryTo("/library/what-is-cnc-machining");
    render(<Harness />);
    scrollToSpy.mockClear();

    fireEvent.click(screen.getByText("相關館藏：生質塑膠"));
    await waitFor(() => expect(window.location.pathname).toBe("/library/what-is-bioplastics"));

    expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
  });

  it("情境3／情境6：browser Back（POP）不會被強制捲頂，交給瀏覽器原生 scroll restoration", async () => {
    resetHistoryTo("/library");
    render(<Harness />);

    fireEvent.click(screen.getByText("CNC 加工是什麼？"));
    await waitFor(() => expect(window.location.pathname).toBe("/library/what-is-cnc-machining"));

    scrollToSpy.mockClear();
    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/library"));

    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it("本輪修正的核心迴歸：POP 回 /library 之後，緊接著點進另一篇「新」文章仍必須捲頂，不能繼承 /library 剛恢復的 scroll（見 root cause 說明）", async () => {
    resetHistoryTo("/library");
    render(<Harness />);

    fireEvent.click(screen.getByText("CNC 加工是什麼？"));
    await waitFor(() => expect(window.location.pathname).toBe("/library/what-is-cnc-machining"));

    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/library"));

    scrollToSpy.mockClear();
    fireEvent.click(screen.getByText("永續材料是什麼？"));
    await waitFor(() => expect(window.location.pathname).toBe("/library/what-is-sustainable-materials"));

    expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
  });
});
