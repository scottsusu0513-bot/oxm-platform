/**
 * 「自然入口」——/industry/:industrySlug 主產業列正下方的子產業快速導覽列
 * 純運算邏輯（見任務定案「alignment fallback 邏輯修正」，取代前一版「只要
 * 置中超界就一律靠左」的兩態版本）。涵蓋：
 *   - 子產業資料來源直接 filter 既有 SUB_INDUSTRY_SEARCH_ENTRIES，不是
 *     第二套 taxonomy，且天然排除「其他」
 *   - 連結一律指向 /factories/:slug
 *   - 新版三種狀態的 anchor 公式（computeSubNavOffset）：
 *     center（置中且不超界）／left（置中會超左邊界，改整列靠左）／
 *     right（置中會超右邊界，改整列靠右——右側主產業不會被拉回左邊）——
 *     這部分無法在 jsdom render 測試裡驗證（getBoundingClientRect 在
 *     jsdom 下永遠回傳全 0），改在這裡直接對 pure function 灌入合成／
 *     真實量測到的數值驗證
 *
 * 4～8 題的數值取自本輪在 1440px 桌機寬度下的真實 DOM 量測結果（主產業
 * 按鈕群 containerWidth 固定 856.094px，各主產業 activeLeft／activeWidth／
 * 各自子產業列 innerWidth 皆為實測值，不是隨意編造），確保測試反映真實
 * 畫面會發生的狀態，不是巧合湊出來的數字。
 *
 * 元件層級的行為（切換 active 主產業後內容更新、render 出來的文字是
 * displayName 不是 SEO primary keyword、結構上只有一排、不 wrap）另外在
 * client/src/components/seo/IndustryQuickNav.test.tsx 用 React Testing
 * Library 驗證。
 */
import { describe, expect, it } from "vitest";
import {
  getQuickNavSubIndustries, computeSubNavOffset, buildSubIndustryQuickNavHref,
} from "@shared/subIndustryQuickNav";
import { SUB_INDUSTRY_SEARCH_ENTRIES, INDUSTRY_SLUGS } from "@shared/constants";

describe("getQuickNavSubIndustries：資料來源正確性", () => {
  it("metal-processing 回傳的每一筆 parentIndustrySlug 都是 metal-processing，且筆數與直接 filter SUB_INDUSTRY_SEARCH_ENTRIES 一致", () => {
    const result = getQuickNavSubIndustries("metal-processing");
    const expected = SUB_INDUSTRY_SEARCH_ENTRIES.filter(e => e.parentIndustrySlug === "metal-processing");
    expect(result).toEqual(expected);
    expect(result.every(e => e.parentIndustrySlug === "metal-processing")).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("textile 只回傳 textile 底下的子產業，且維持 taxonomy 原順序（不重新排序）", () => {
    const result = getQuickNavSubIndustries("textile");
    expect(result.every(e => e.parentIndustrySlug === "textile")).toBe(true);
    expect(result.map(e => e.slug)).toEqual([
      "fabric-materials", "apparel-manufacturing", "webbing-yarn", "towel-home-textiles", "functional-textiles",
    ]);
  });

  it("sustainable-materials 只回傳 sustainable-materials 底下的子產業", () => {
    const result = getQuickNavSubIndustries("sustainable-materials");
    expect(result.every(e => e.parentIndustrySlug === "sustainable-materials")).toBe(true);
    expect(result.length).toBe(7);
  });

  it("industrial-machinery（工業設備／機械）只回傳自己的子產業", () => {
    const result = getQuickNavSubIndustries("industrial-machinery");
    expect(result.every(e => e.parentIndustrySlug === "industrial-machinery")).toBe(true);
    expect(result.length).toBe(5);
  });

  it("涵蓋全部 13 個主產業 slug，總筆數等於 SUB_INDUSTRY_SEARCH_ENTRIES 全部 74 筆（電子零件「線束 / 連接器」拆分為三類後淨增 2 筆），且不排除任何一個主產業", () => {
    const allSlugs = Object.values(INDUSTRY_SLUGS);
    expect(allSlugs.length).toBe(13);
    let total = 0;
    for (const slug of allSlugs) {
      total += getQuickNavSubIndustries(slug).length;
    }
    expect(total).toBe(74);
    expect(total).toBe(SUB_INDUSTRY_SEARCH_ENTRIES.length);
  });

  it("排除「其他」：任何主產業回傳的子產業裡都沒有 label 或 displayName 是「其他」的項目", () => {
    for (const slug of Object.values(INDUSTRY_SLUGS)) {
      const result = getQuickNavSubIndustries(slug);
      expect(result.some(e => e.label === "其他" || e.displayName === "其他")).toBe(false);
    }
  });

  it("不存在的 parentIndustrySlug 回傳空陣列，不拋錯", () => {
    expect(getQuickNavSubIndustries("not-a-real-industry")).toEqual([]);
  });
});

describe("buildSubIndustryQuickNavHref：連結一律指向 /factories/:slug", () => {
  it("cnc-machining → /factories/cnc-machining", () => {
    expect(buildSubIndustryQuickNavHref({ slug: "cnc-machining" })).toBe("/factories/cnc-machining");
  });

  it("不會產生 /industry/:parent/:sub 或 /search 這類字串", () => {
    const href = buildSubIndustryQuickNavHref({ slug: "mold-making" });
    expect(href).not.toContain("/industry/");
    expect(href).not.toContain("/search");
    expect(href).toBe("/factories/mold-making");
  });
});

describe("computeSubNavOffset：1) centered 完全不超界 → center", () => {
  it("active 在中間、子產業列寬度足夠：置中結果的中心點恰好對齊 active 中心點", () => {
    const containerWidth = 900, activeLeft = 400, activeWidth = 100, innerWidth = 200;
    const result = computeSubNavOffset({ containerWidth, activeLeft, activeWidth, innerWidth });
    const activeCenter = activeLeft + activeWidth / 2;
    expect(result.placement).toBe("center");
    expect(result.offset).toBe(350);
    expect(result.offset + innerWidth / 2).toBe(activeCenter);
  });

  it("剛好貼齊左邊界（centeredLeft === 0）仍視為 center，不是 left（邊界值含在合法範圍內）", () => {
    const result = computeSubNavOffset({ containerWidth: 900, activeLeft: 100, activeWidth: 0, innerWidth: 200 });
    expect(result.offset).toBe(0);
    expect(result.placement).toBe("center");
  });

  it("剛好貼齊右邊界（centeredLeft + innerWidth === containerWidth）仍視為 center", () => {
    const result = computeSubNavOffset({ containerWidth: 900, activeLeft: 800, activeWidth: 0, innerWidth: 200 });
    expect(result.offset).toBe(700);
    expect(result.placement).toBe("center");
  });
});

describe("computeSubNavOffset：2) centered 超左 → left", () => {
  it("active 偏左，置中會超出左邊界 → left，offset 固定是 0（第一項對齊按鈕群最左邊）", () => {
    const result = computeSubNavOffset({ containerWidth: 900, activeLeft: 20, activeWidth: 60, innerWidth: 400 });
    expect(result.placement).toBe("left");
    expect(result.offset).toBe(0);
  });
});

describe("computeSubNavOffset：3) centered 超右 → right", () => {
  it("active 偏右，置中會超出右邊界 → right，offset 讓子產業列右邊界恰好對齊按鈕群右邊界（不是退回左邊）", () => {
    const containerWidth = 900, activeLeft = 800, activeWidth = 60, innerWidth = 300;
    const result = computeSubNavOffset({ containerWidth, activeLeft, activeWidth, innerWidth });
    expect(result.placement).toBe("right");
    expect(result.offset).toBe(600);
    expect(result.offset + innerWidth).toBe(containerWidth);
  });
});

// 以下 4～8 題使用本輪在 1440px 桌機寬度下對 13 個主產業按鈕的真實 DOM
// 量測結果（containerWidth 固定 856.094px），以及各主產業頁子產業列的真實
// 自然寬度（innerWidth），驗證真實畫面會落在哪個狀態。
const REAL_CONTAINER_WIDTH = 856.094;

describe("computeSubNavOffset：4) textile → 預期 left（真實量測數值）", () => {
  it("textile 是按鈕群最左側第一個主產業，activeLeft=0，子產業列置中一定會超左邊界", () => {
    const result = computeSubNavOffset({
      containerWidth: REAL_CONTAINER_WIDTH, activeLeft: 0, activeWidth: 42, innerWidth: 288,
    });
    expect(result.placement).toBe("left");
    expect(result.offset).toBe(0);
  });
});

describe("computeSubNavOffset：5) metal-processing → 依實際寬度量測結果為 left", () => {
  it("metal-processing 是按鈕群第 2 個主產業（activeLeft=50），子產業列（6 筆，innerWidth=380）置中會超左邊界", () => {
    const result = computeSubNavOffset({
      containerWidth: REAL_CONTAINER_WIDTH, activeLeft: 50, activeWidth: 66, innerWidth: 380,
    });
    expect(result.placement).toBe("left");
    expect(result.offset).toBe(0);
  });
});

describe("computeSubNavOffset：6) packaging → 中間案例容得下 → center", () => {
  it("packaging 落在按鈕群中段（activeLeft=382.094），子產業列（5 筆，innerWidth=336）置中後左右都不超界", () => {
    const result = computeSubNavOffset({
      containerWidth: REAL_CONTAINER_WIDTH, activeLeft: 382.094, activeWidth: 42, innerWidth: 336,
    });
    const activeCenter = 382.094 + 21;
    expect(result.placement).toBe("center");
    expect(result.offset + 336 / 2).toBeCloseTo(activeCenter, 3);
  });
});

describe("computeSubNavOffset：7) industrial-machinery（工業設備／機械）若超右 → right", () => {
  it("industrial-machinery 落在按鈕群偏右段（activeLeft=680.094），子產業列（5 筆，innerWidth=468）置中會超右邊界，改整列靠右，不會退回靠左", () => {
    const result = computeSubNavOffset({
      containerWidth: REAL_CONTAINER_WIDTH, activeLeft: 680.094, activeWidth: 102, innerWidth: 468,
    });
    expect(result.placement).toBe("right");
    expect(result.offset).toBeCloseTo(388.094, 3);
    expect(result.offset + 468).toBeCloseTo(REAL_CONTAINER_WIDTH, 3);
  });
});

describe("computeSubNavOffset：8) sustainable-materials（永續材料）若超右 → right", () => {
  it("sustainable-materials 是按鈕群最右側主產業（activeLeft=790.094），子產業列（7 筆，innerWidth=592）置中一定超右邊界，改整列靠右，不會退回靠左", () => {
    const result = computeSubNavOffset({
      containerWidth: REAL_CONTAINER_WIDTH, activeLeft: 790.094, activeWidth: 66, innerWidth: 592,
    });
    expect(result.placement).toBe("right");
    expect(result.offset).toBeCloseTo(264.094, 3);
    expect(result.offset + 592).toBeCloseTo(REAL_CONTAINER_WIDTH, 3);
    // 明確驗證「不是」上一版的兩態邏輯結果（offset=0／left）。
    expect(result.offset).not.toBe(0);
    expect(result.placement).not.toBe("left");
  });
});

describe("computeSubNavOffset：9) right 狀態時 subNavRight ≈ mainIndustryGroupRight", () => {
  it("多組不同數值皆驗證 offset + innerWidth === containerWidth（子產業列右邊界緊貼按鈕群右邊界）", () => {
    const cases = [
      { containerWidth: 900, activeLeft: 800, activeWidth: 60, innerWidth: 300 },
      { containerWidth: REAL_CONTAINER_WIDTH, activeLeft: 680.094, activeWidth: 102, innerWidth: 468 },
      { containerWidth: REAL_CONTAINER_WIDTH, activeLeft: 790.094, activeWidth: 66, innerWidth: 592 },
    ];
    for (const c of cases) {
      const result = computeSubNavOffset(c);
      expect(result.placement).toBe("right");
      expect(result.offset + c.innerWidth).toBeCloseTo(c.containerWidth, 3);
    }
  });
});

describe("computeSubNavOffset：10) left 狀態時 subNavLeft ≈ mainIndustryGroupLeft", () => {
  it("多組不同數值皆驗證 offset === 0（子產業列左邊界緊貼按鈕群左邊界）", () => {
    const cases = [
      { containerWidth: 900, activeLeft: 20, activeWidth: 60, innerWidth: 400 },
      { containerWidth: REAL_CONTAINER_WIDTH, activeLeft: 0, activeWidth: 42, innerWidth: 288 },
      { containerWidth: REAL_CONTAINER_WIDTH, activeLeft: 50, activeWidth: 66, innerWidth: 380 },
    ];
    for (const c of cases) {
      const result = computeSubNavOffset(c);
      expect(result.placement).toBe("left");
      expect(result.offset).toBe(0);
    }
  });
});

describe("computeSubNavOffset：極端情況——子產業列比整個按鈕群還寬（兩邊都會超界）", () => {
  it("優先回傳 left（避免子產業列左邊界被推到按鈕群左邊界之外），不是 right、也不是 clamp 出中間值", () => {
    const result = computeSubNavOffset({ containerWidth: 900, activeLeft: 400, activeWidth: 100, innerWidth: 1200 });
    expect(result.placement).toBe("left");
    expect(result.offset).toBe(0);
  });
});

describe("computeSubNavOffset：不會因為子產業資料順序或項目數量而改變（子產業本身順序永遠維持 taxonomy 原順序，這裡只驗證位置公式跟資料順序無關）", () => {
  it("同一組 activeLeft／activeWidth，只有 innerWidth 改變時，state 會依 innerWidth 在 left/center/right 間切換，證明判斷完全基於寬度是否超界，不涉及任何資料排序邏輯", () => {
    const base = { containerWidth: 900, activeLeft: 750, activeWidth: 100 };
    expect(computeSubNavOffset({ ...base, innerWidth: 100 }).placement).toBe("center");
    expect(computeSubNavOffset({ ...base, innerWidth: 500 }).placement).toBe("right");
  });
});
