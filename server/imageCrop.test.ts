/**
 * shared/imageCrop.ts 純運算函式測試——這是全站共用「圖片顯示範圍」功能的
 * 核心數學，前台顯示（CroppedImage）與編輯器預覽（ImageCropEditor）都直接
 * 呼叫這幾支函式，所以這裡測的就是「編輯器看到的跟前台顯示的是否一致」的
 * 保證本身，不是綁死 Tailwind class 字串的脆弱測試。
 */
import { describe, expect, it } from "vitest";
import {
  imageCropToStyle, computeCoverFitSize, applyDragDelta, clampImageCrop,
  normalizeImageEntry,
  DEFAULT_IMAGE_CROP, IMAGE_CROP_ZOOM_MIN, IMAGE_CROP_ZOOM_MAX,
} from "../shared/imageCrop";

describe("clampImageCrop", () => {
  it("null／undefined 一律 fallback 成置中、zoom=1（既有圖片沒有裁切資料時的行為）", () => {
    expect(clampImageCrop(null)).toEqual(DEFAULT_IMAGE_CROP);
    expect(clampImageCrop(undefined)).toEqual(DEFAULT_IMAGE_CROP);
  });

  it("夾住超出範圍的 zoom／posX／posY，避免存入不合理或惡意竄改的數值", () => {
    expect(clampImageCrop({ zoom: 999, posX: -50, posY: 500 })).toEqual({
      zoom: IMAGE_CROP_ZOOM_MAX, posX: 0, posY: 100,
    });
    expect(clampImageCrop({ zoom: -5, posX: 40, posY: 60 })).toEqual({
      zoom: IMAGE_CROP_ZOOM_MIN, posX: 40, posY: 60,
    });
  });

  it("非數字／NaN／Infinity 一律 fallback 成預設值，不會讓前台或編輯器收到壞資料", () => {
    expect(clampImageCrop({ zoom: NaN, posX: Infinity, posY: -Infinity })).toEqual(DEFAULT_IMAGE_CROP);
    expect(clampImageCrop({ zoom: "abc" as any, posX: null as any, posY: undefined })).toEqual(DEFAULT_IMAGE_CROP);
  });

  it("合法數值原樣保留", () => {
    expect(clampImageCrop({ zoom: 2, posX: 30, posY: 70 })).toEqual({ zoom: 2, posX: 30, posY: 70 });
  });
});

describe("imageCropToStyle：編輯器預覽與前台顯示呼叫同一支函式，保證呈現一致", () => {
  it("null 時回傳與 DEFAULT_IMAGE_CROP 等價的置中樣式", () => {
    const style = imageCropToStyle(null);
    expect(style.objectFit).toBe("cover");
    expect(style.objectPosition).toBe("50% 50%");
    expect(style.transform).toBe("scale(1)");
    expect(style.transformOrigin).toBe("50% 50%");
  });

  it("自訂 crop 值正確反映在 objectPosition／transform／transformOrigin", () => {
    const style = imageCropToStyle({ zoom: 1.8, posX: 25, posY: 75 });
    expect(style.objectPosition).toBe("25% 75%");
    expect(style.transform).toBe("scale(1.8)");
    expect(style.transformOrigin).toBe("25% 75%");
  });

  it("超出範圍的值在轉換前會先被夾住", () => {
    const style = imageCropToStyle({ zoom: 999, posX: -10, posY: 10 });
    expect(style.transform).toBe(`scale(${IMAGE_CROP_ZOOM_MAX})`);
    expect(style.objectPosition).toBe("0% 10%");
  });
});

describe("computeCoverFitSize：cover-fit 渲染尺寸計算", () => {
  it("直式圖片放進橫式容器，寬度撐滿、高度依比例縮放（以寬為準覆蓋）", () => {
    // natural 1000x2000（直式），容器 300x100（橫式，比例 3:1）
    const { renderedW, renderedH } = computeCoverFitSize(1000, 2000, 300, 100, 1);
    // baseScale = max(300/1000, 100/2000) = max(0.3, 0.05) = 0.3
    expect(renderedW).toBeCloseTo(300, 5);
    expect(renderedH).toBeCloseTo(600, 5);
  });

  it("zoom > 1 時渲染尺寸等比例放大", () => {
    const base = computeCoverFitSize(1000, 2000, 300, 100, 1);
    const zoomed = computeCoverFitSize(1000, 2000, 300, 100, 2);
    expect(zoomed.renderedW).toBeCloseTo(base.renderedW * 2, 5);
    expect(zoomed.renderedH).toBeCloseTo(base.renderedH * 2, 5);
  });

  it("natural 尺寸為 0 或負值時安全 fallback 回容器尺寸，不會產生 NaN／Infinity", () => {
    const result = computeCoverFitSize(0, 0, 300, 100, 1);
    expect(result).toEqual({ renderedW: 300, renderedH: 100 });
    expect(Number.isFinite(result.renderedW)).toBe(true);
  });
});

describe("applyDragDelta：拖曳像素位移轉換成 posX/posY 百分比", () => {
  it("往右拖曳（dx>0）會讓 posX 減少（看到圖片更左邊的內容），符合直覺拖曳方向", () => {
    // natural 4000x1000（比容器更寬的橫式圖），container 300x100：
    // cover-fit 由高度決定縮放，寬度渲染後大於容器寬度，水平方向才有拖曳餘裕。
    const result = applyDragDelta(DEFAULT_IMAGE_CROP, 50, 0, 4000, 1000, 300, 100);
    expect(result.posX).toBeLessThan(DEFAULT_IMAGE_CROP.posX);
    expect(result.posY).toBe(DEFAULT_IMAGE_CROP.posY);
  });

  it("往下拖曳（dy>0）會讓 posY 減少", () => {
    const result = applyDragDelta(DEFAULT_IMAGE_CROP, 0, 20, 1000, 2000, 300, 100);
    expect(result.posY).toBeLessThan(DEFAULT_IMAGE_CROP.posY);
  });

  it("沒有可拖曳餘裕的軸向（renderedSize <= containerSize）該軸不受拖曳影響", () => {
    // natural 3000x100，容器 300x100：寬度渲染後遠大於容器（有餘裕），
    // 高度渲染後剛好等於容器（沒有餘裕）。
    const result = applyDragDelta(DEFAULT_IMAGE_CROP, 0, 30, 3000, 100, 300, 100);
    expect(result.posY).toBe(DEFAULT_IMAGE_CROP.posY);
  });

  it("結果永遠落在 0~100 範圍內，即使拖曳量遠超過實際餘裕", () => {
    const result = applyDragDelta(DEFAULT_IMAGE_CROP, 100000, -100000, 1000, 2000, 300, 100);
    expect(result.posX).toBeGreaterThanOrEqual(0);
    expect(result.posX).toBeLessThanOrEqual(100);
    expect(result.posY).toBeGreaterThanOrEqual(0);
    expect(result.posY).toBeLessThanOrEqual(100);
  });

  it("zoom 影響拖曳靈敏度：zoom 越大，同樣像素位移造成的百分比變化越小（因為渲染尺寸變大、餘裕變大）", () => {
    const lowZoom = applyDragDelta({ zoom: 1, posX: 50, posY: 50 }, 50, 0, 4000, 1000, 300, 100);
    const highZoom = applyDragDelta({ zoom: 3, posX: 50, posY: 50 }, 50, 0, 4000, 1000, 300, 100);
    const lowZoomDelta = Math.abs(lowZoom.posX - 50);
    const highZoomDelta = Math.abs(highZoom.posX - 50);
    expect(highZoomDelta).toBeLessThan(lowZoomDelta);
  });
});

// Phase 6: Community post images upgraded in-place from string[] to
// { url, crop }[] in the same JSON column (no migration). These lock in the
// backward-compat contract that makes old posts keep rendering unchanged.
describe("normalizeImageEntry：communityPosts.images 從 string[] 升級成 {url,crop}[] 的相容層", () => {
  it("legacy 純字串（舊貼文，從未有 crop 概念）→ { url, crop: null }", () => {
    expect(normalizeImageEntry("https://cdn.example.com/a.jpg")).toEqual({
      url: "https://cdn.example.com/a.jpg",
      crop: null,
    });
  });

  it("新格式 { url, crop } 原樣保留（crop 會先經過 clampImageCrop 夾範圍）", () => {
    expect(normalizeImageEntry({ url: "https://cdn.example.com/b.jpg", crop: { zoom: 2, posX: 30, posY: 70 } }))
      .toEqual({ url: "https://cdn.example.com/b.jpg", crop: { zoom: 2, posX: 30, posY: 70 } });
  });

  it("新格式但 crop 為 null（使用者上傳時沒調整過，維持置中 fallback）→ crop: null", () => {
    expect(normalizeImageEntry({ url: "https://cdn.example.com/c.jpg", crop: null }))
      .toEqual({ url: "https://cdn.example.com/c.jpg", crop: null });
  });

  it("新格式但 crop 是被竄改過的不合理數值 → 仍會被 clampImageCrop 夾回合理範圍，不是原樣放行", () => {
    const result = normalizeImageEntry({ url: "https://cdn.example.com/d.jpg", crop: { zoom: 999, posX: -50, posY: 500 } });
    expect(result).toEqual({ url: "https://cdn.example.com/d.jpg", crop: { zoom: IMAGE_CROP_ZOOM_MAX, posX: 0, posY: 100 } });
  });

  it("null／undefined 條目 → null（呼叫端可以安全過濾掉，不會渲染壞圖）", () => {
    expect(normalizeImageEntry(null)).toBeNull();
    expect(normalizeImageEntry(undefined)).toBeNull();
  });

  it("格式不明的物件（沒有 url 欄位）→ null，不會丟出例外", () => {
    expect(normalizeImageEntry({} as any)).toBeNull();
    expect(normalizeImageEntry({ crop: null } as any)).toBeNull();
  });

  it("混合陣列（一部分舊字串、一部分新物件）逐筆正確轉換——模擬一則貼文編輯後新增圖片、舊圖片維持原狀的真實情境", () => {
    const raw = [
      "https://cdn.example.com/old1.jpg",
      { url: "https://cdn.example.com/new1.jpg", crop: { zoom: 1.5, posX: 20, posY: 80 } },
      "https://cdn.example.com/old2.jpg",
    ];
    const result = raw.map(normalizeImageEntry);
    expect(result).toEqual([
      { url: "https://cdn.example.com/old1.jpg", crop: null },
      { url: "https://cdn.example.com/new1.jpg", crop: { zoom: 1.5, posX: 20, posY: 80 } },
      { url: "https://cdn.example.com/old2.jpg", crop: null },
    ]);
  });
});
