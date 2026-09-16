// /industry/:slug 主產業頁「自然入口」——主產業列正下方的子產業快速導覽列
// 純資料／運算邏輯（見「自然入口」任務定案）。刻意抽成跟 React／DOM 無關的
// pure function，供 client（IndustryQuickNav.tsx）使用，並且可以在不需要
// DOM／React render 的情況下直接單元測試——跟 shared/industryPagination.ts
// 是同一種角色分工。
import { SUB_INDUSTRY_SEARCH_ENTRIES, type SubIndustrySearchEntry } from "./constants";

/**
 * 依 parentIndustrySlug 從唯一的 SUB_INDUSTRY_SEARCH_ENTRIES 過濾出該主產業
 * 底下的子產業，維持陣列原本宣告順序。不是第二套 mapping——
 * SUB_INDUSTRY_SEARCH_ENTRIES 本身已經不包含「其他」（見 shared/constants.ts
 * 該常數上方的說明：「涵蓋 INDUSTRIES 底下『除了其他』的每一筆」），這裡
 * 單純過濾 parentIndustrySlug，沒有額外排除邏輯需要維護。
 */
export function getQuickNavSubIndustries(parentIndustrySlug: string): SubIndustrySearchEntry[] {
  return SUB_INDUSTRY_SEARCH_ENTRIES.filter(e => e.parentIndustrySlug === parentIndustrySlug);
}

export interface SubNavAnchorInput {
  /** 主產業按鈕群實際的可視邊界寬度（第一個主產業按鈕左邊到最後一個主產業按鈕右邊，不是外層 block container 的寬度）。 */
  containerWidth: number;
  /** 目前選中主產業項目，相對主產業按鈕群左邊界的 offset。 */
  activeLeft: number;
  /** 目前選中主產業項目寬度。 */
  activeWidth: number;
  /** 子產業列在不受容器寬度限制時的自然寬度。 */
  innerWidth: number;
}

export type SubNavPlacement = "left" | "center" | "right";

export interface SubNavOffsetResult {
  /** 子產業列要套用的 marginLeft（相對主產業按鈕群左邊界）。 */
  offset: number;
  placement: SubNavPlacement;
}

/**
 * 三種狀態（見任務定案「alignment fallback 邏輯修正」，取代前一版「只要
 * 超界就一律靠左」的兩態版本）：
 *
 * 1. center：先嘗試讓子產業列以目前 active 主產業中心點置中
 *    （`centeredLeft = activeCenter - innerWidth / 2`）。如果這個結果左右
 *    都還在主產業按鈕群的可視邊界內，採用置中結果。
 *
 * 2. left：如果置中結果會超出主產業按鈕群的左邊界（`centeredLeft < 0`），
 *    子產業列改成整列靠左——第一項對齊按鈕群最左邊界（`offset = 0`）。
 *
 * 3. right：如果置中結果會超出主產業按鈕群的右邊界
 *    （`centeredLeft + innerWidth > containerWidth`），子產業列改成整列
 *    靠右——最後一項對齊按鈕群最右邊界（`offset = containerWidth -
 *    innerWidth`，讓 `offset + innerWidth === containerWidth`）。
 *
 * 判斷順序是先查左邊界、再查右邊界：子產業列本身比整個按鈕群還寬（兩邊都
 * 會超界）的極端情況下，優先回傳 left，避免子產業列的左邊界被推到按鈕群
 * 左邊界之外。
 *
 * `containerWidth`／`activeLeft` 一律是相對「主產業按鈕群本身的可視邊界」
 * （第一個主產業按鈕左邊到最後一個主產業按鈕右邊），不是外層 block
 * container 的邊界（見 IndustryQuickNav.tsx 的量測說明）。
 */
export function computeSubNavOffset({ containerWidth, activeLeft, activeWidth, innerWidth }: SubNavAnchorInput): SubNavOffsetResult {
  const activeCenter = activeLeft + activeWidth / 2;
  const centeredLeft = activeCenter - innerWidth / 2;

  if (centeredLeft < 0) {
    return { offset: 0, placement: "left" };
  }
  if (centeredLeft + innerWidth > containerWidth) {
    return { offset: containerWidth - innerWidth, placement: "right" };
  }
  return { offset: centeredLeft, placement: "center" };
}

/** 子產業快速導覽項目一律導向 canonical /factories/:slug（不是 /industry/:parent/:sub、不是 /search）。 */
export function buildSubIndustryQuickNavHref(entry: Pick<SubIndustrySearchEntry, "slug">): string {
  return `/factories/${entry.slug}`;
}
