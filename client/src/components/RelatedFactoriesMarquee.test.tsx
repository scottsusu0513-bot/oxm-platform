// @vitest-environment jsdom
/**
 * 「相關工廠」跑馬燈容器（見任務定案「工廠詳情頁底部同類型工廠推薦」／
 * 「相關工廠數量不足時用招募卡補位，不再整區隱藏」／「修正 desktop
 * 尾端空白」）。
 *
 * 動畫本身（方向／速度／CSS timing／viewport max-width 計算）刻意不測——見
 * 使用者指示「不要用脆弱的 CSS animation timing test，動畫方向與速度留給
 * 人工 QA」。這裡只測試「顯示清單怎麼組成」「要不要渲染複製軌道」這兩個
 * 結構性契約：
 *   0 家真實工廠 → 8 張招募卡補滿（目標 track 長度），沒有任何假工廠連結/資料
 *   1／3 家真實工廠 → 真實工廠優先，招募卡補到 8 張
 *   8 家（含）以上真實工廠 → 全部使用真實工廠，不需要招募卡
 *   真實卡與招募卡的複製軌道都用 presentational 模式渲染，aria-hidden，
 *   完全不包含任何 <a>，螢幕閱讀器與 Tab 不會重複讀取/選取同一批內容
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { RelatedFactoriesMarquee } from "./RelatedFactoriesMarquee";
import type { RelatedFactoryCardData } from "./RelatedFactoryCard";

afterEach(() => {
  cleanup();
});

// 真實軌道與複製軌道（存在時）都會渲染同一批 data-testid="recruitment-card"／
// 相同 name 的連結，用 screen.* 不加範圍限制會把兩條軌道的內容混在一起算，
// 這裡一律只在「真實（非複製）軌道」範圍內查找。
function realTrack(): HTMLElement {
  const el = document.querySelector(".related-marquee-track:not(.related-marquee-track-duplicate)");
  if (!el) throw new Error("real track not found");
  return el as HTMLElement;
}

function makeFactories(count: number): RelatedFactoryCardData[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `工廠 ${i + 1}`,
    industry: ["金屬加工"],
    subIndustry: [],
    region: "台中市",
    mfgModes: ["OEM"],
    avgRating: "4.0",
    reviewCount: 5,
  }));
}

describe("RelatedFactoriesMarquee — 顯示清單組成（真實工廠 + 招募卡補位）", () => {
  it("0 家真實工廠：用 8 張招募卡補滿，沒有任何真實工廠連結，招募卡不含假資料", () => {
    render(<RelatedFactoriesMarquee factories={[]} />);
    const track = within(realTrack());
    expect(track.queryByRole("link", { name: /工廠 \d/ })).toBeNull();
    const recruitmentCards = track.getAllByTestId("recruitment-card");
    expect(recruitmentCards).toHaveLength(8);
    // 招募卡本身也要是真正的連結（導向 /register-factory），不是假資料展示。
    for (const card of recruitmentCards) {
      expect(card.getAttribute("href")).toBe("/register-factory");
    }
  });

  it("1 家真實工廠：1 張真實卡 + 7 張招募卡補到 8 張", () => {
    render(<RelatedFactoriesMarquee factories={makeFactories(1)} />);
    const track = within(realTrack());
    expect(track.getAllByRole("link", { name: /工廠 \d/ })).toHaveLength(1);
    expect(track.getAllByTestId("recruitment-card")).toHaveLength(7);
  });

  it("3 家真實工廠：3 張真實卡 + 5 張招募卡補到 8 張", () => {
    render(<RelatedFactoriesMarquee factories={makeFactories(3)} />);
    const track = within(realTrack());
    expect(track.getAllByRole("link", { name: /工廠 \d/ })).toHaveLength(3);
    expect(track.getAllByTestId("recruitment-card")).toHaveLength(5);
  });

  it("8 家（達到目標 track 長度）以上真實工廠：全部使用真實工廠，不需要招募卡", () => {
    render(<RelatedFactoriesMarquee factories={makeFactories(8)} />);
    const track = within(realTrack());
    expect(track.getAllByRole("link", { name: /工廠 \d/ })).toHaveLength(8);
    expect(track.queryAllByTestId("recruitment-card")).toHaveLength(0);
  });

  it("12 家（後端上限）真實工廠：全部使用真實工廠，不需要招募卡", () => {
    render(<RelatedFactoriesMarquee factories={makeFactories(12)} />);
    const track = within(realTrack());
    expect(track.getAllByRole("link", { name: /工廠 \d/ })).toHaveLength(12);
    expect(track.queryAllByTestId("recruitment-card")).toHaveLength(0);
  });
});

describe("RelatedFactoriesMarquee — 複製軌道（duplicate track）", () => {
  it("總顯示數量（真實 + 招募卡）達到 eligible 門檻時，複製軌道存在於 DOM，容器帶上 eligible class", () => {
    // 0 家真實工廠也會被招募卡補到 8 張，達到門檻，同樣要有複製軌道。
    render(<RelatedFactoriesMarquee factories={[]} />);
    expect(document.querySelector(".related-marquee-eligible")).toBeTruthy();
    expect(document.querySelector(".related-marquee-track-duplicate")).toBeTruthy();
  });

  it("複製軌道用 presentational 模式渲染：aria-hidden，且真實卡與招募卡都完全不包含任何 <a>", () => {
    render(<RelatedFactoriesMarquee factories={makeFactories(3)} />);
    const duplicateTrack = document.querySelector(".related-marquee-track-duplicate");
    expect(duplicateTrack).toBeTruthy();
    expect(duplicateTrack!.getAttribute("aria-hidden")).toBe("true");
    expect(duplicateTrack!.querySelectorAll("a")).toHaveLength(0);
    // 複製軌道裡仍然有跟真實軌道一樣數量的卡片（只是不可互動）。
    expect(duplicateTrack!.querySelectorAll('[data-testid="recruitment-card"]').length).toBe(5);
  });

  it("複製軌道不會增加任何可互動的招募 CTA 或工廠連結（真實軌道 + 複製軌道的 <a> 總數只等於真實軌道本身）", () => {
    render(<RelatedFactoriesMarquee factories={makeFactories(3)} />);
    const allLinks = document.querySelectorAll("a");
    // 3 張真實工廠卡 + 5 張招募卡（都是 <a>）＝真實軌道 8 個連結，複製軌道 0 個。
    expect(allLinks).toHaveLength(8);
  });
});
