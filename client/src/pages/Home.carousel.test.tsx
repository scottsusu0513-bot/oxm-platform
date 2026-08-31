// @vitest-environment jsdom
/**
 * 首頁跑馬燈（HeroImageCarousel）播放順序 regression 保護。
 *
 * 背景：舊版 carouselImages 陣列結尾接了
 * `.sort((a, b) => parseInt(b.id) - parseInt(a.id))`，讓實際播放順序整個
 * 反過來變成 06→05→...→01。這裡鎖住三件事，避免同一類問題再發生：
 * 1. 陣列本身（原始資料）是嚴格由小到大排列，且沒有任何會反轉順序的 sort。
 * 2. 元件實際渲染／互動時，播放順序確實由小到大、首張確實是最小 id。
 * 3. 某一張圖片探測失敗（等同資料夾缺號）時，不會卡住、不會出現空白
 *    slide，後面的圖片仍會照順序接續播放（不要求一定是 04 之後接 06——
 *    目前資料夾剛好沒有 05，但這裡刻意模擬「04」失敗，驗證的是「探測失敗
 *    的 id 會被跳過」這個通用行為，不綁定在特定哪個 id 缺號上，資料夾之後
 *    增減圖片也不會讓這個測試變成假斷言）。
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { carouselImages, HeroImageCarousel } from "./Home";

describe("carouselImages（原始資料）：嚴格由小到大排列，沒有反轉順序的 sort", () => {
  it("每一筆 id 都比前一筆大（數字比較，不是字串比較）", () => {
    const ids = carouselImages.map(c => parseInt(c.id, 10));
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBeGreaterThan(ids[i - 1]);
    }
  });

  it("第一筆是目前陣列裡數字最小的 id", () => {
    const ids = carouselImages.map(c => parseInt(c.id, 10));
    expect(parseInt(carouselImages[0].id, 10)).toBe(Math.min(...ids));
  });

  it("原始碼裡沒有會把順序反過來的 .sort((a,b) => parseInt(b.id) - parseInt(a.id))", () => {
    // .sort(...) 是接在 carouselImages 這個模組層級陣列後面，不在
    // HeroImageCarousel 函式本體內，所以要讀原始檔案文字，不能檢查
    // HeroImageCarousel.toString()（那個函式從來就沒包含過這段排序碼）。
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "Home.tsx"), "utf-8");
    expect(source).not.toContain("parseInt(b.id) - parseInt(a.id)");
  });
});

// 模擬瀏覽器 Image 探測：只有副檔名 .png 且 id 不在 FAILING_IDS 裡才算「載入成功」，
// 其餘（包含 .png 以外的副檔名、或 FAILING_IDS 裡的 id）一律 onerror，
// 對應 HeroImageCarousel 逐副檔名 fallback、全部失敗才視為「這張不存在」的邏輯。
const FAILING_IDS = new Set(["04"]);

class FakeProbeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = "";
  get src() {
    return this._src;
  }
  set src(value: string) {
    this._src = value;
    const match = value.match(/\/marquee\/(\d+)\.png$/);
    const ok = match !== null && !FAILING_IDS.has(match[1]);
    Promise.resolve().then(() => {
      if (ok) this.onload?.();
      else this.onerror?.();
    });
  }
}

describe("HeroImageCarousel（實際渲染／互動）：首張最小、順序遞增、缺號自動跳過", () => {
  beforeEach(() => {
    vi.stubGlobal("Image", FakeProbeImage as unknown as typeof Image);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("首張是最小 id；探測失敗的一張被跳過但不中斷；後續圖片仍照遞增順序播放；播完最後一張再按下一張會回到第一張", async () => {
    const expectedOrder = carouselImages.filter(c => c.id !== "04");
    const { container } = render(<HeroImageCarousel />);
    const getMainAlt = () => container.querySelector('img[loading="eager"]')?.getAttribute("alt");

    // 第一張（fast path，資料還沒全部探測完就先顯示第一張）必須是最小 id。
    await waitFor(() => expect(getMainAlt()).toBe(expectedOrder[0].alt));

    // 等全部探測完成：dot 數量應等於「扣掉探測失敗那一張」之後的真實張數，
    // 不是原始陣列長度（代表失敗的那張真的被濾掉、不是變成空白 slide）。
    await waitFor(() => {
      expect(container.querySelectorAll('button[aria-label^="切換到第"]').length).toBe(expectedOrder.length);
    });

    const clickNext = () => fireEvent.click(container.querySelector('button[aria-label="下一張"]')!);

    for (let i = 1; i < expectedOrder.length; i++) {
      clickNext();
      await waitFor(() => expect(getMainAlt()).toBe(expectedOrder[i].alt));
    }

    // 播完最後一張，下一張要回到第一張（不是停住、不是變成空白）。
    clickNext();
    await waitFor(() => expect(getMainAlt()).toBe(expectedOrder[0].alt));
  });

  it("完全沒有任何圖片可載入時，元件安全地不渲染任何 slide（不是 broken image、不是壞掉的容器）", async () => {
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_v: string) {
          Promise.resolve().then(() => this.onerror?.());
        }
      } as unknown as typeof Image
    );

    const { container } = render(<HeroImageCarousel />);
    await waitFor(() => {
      expect(container.querySelector(".animate-pulse")).toBeNull();
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});
