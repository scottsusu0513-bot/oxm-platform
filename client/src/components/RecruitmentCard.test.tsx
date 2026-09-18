// @vitest-environment jsdom
/**
 * 「進駐招募卡」（見任務定案「相關工廠數量不足時用招募卡補位，不再整區
 * 隱藏」）。核心約束：招募卡不是假工廠——不偽造 rating／region／industry／
 * mfgModes／factory id，CTA 必須導向既有的 /register-factory 路由。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RecruitmentCard } from "./RecruitmentCard";

afterEach(() => {
  cleanup();
});

describe("RecruitmentCard", () => {
  it("一般模式渲染成真正的 <a href=\"/register-factory\">（既有工廠上架路由，不是新發明的 URL）", () => {
    render(<RecruitmentCard />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/register-factory");
  });

  it("顯示「待進駐」角標與「免費進駐 OXM」CTA 文案", () => {
    render(<RecruitmentCard />);
    expect(screen.getByText("待進駐")).toBeTruthy();
    expect(screen.getByText(/免費進駐 OXM/)).toBeTruthy();
  });

  it("不包含任何看起來像真實工廠資料的欄位：沒有星等符號、沒有「間」地區文字、沒有工廠 id 之類的資料", () => {
    render(<RecruitmentCard />);
    // 不應該出現星等常見格式（數字.數字（數字）），也不應該出現地區/mfgModes 常見文案。
    expect(screen.queryByText(/★|⭐/)).toBeNull();
    expect(screen.queryByText(/OEM|ODM|OBM/)).toBeNull();
  });

  it("variationIndex 依序輪替標題文案，避免同一批招募卡逐字重複", () => {
    render(
      <>
        <RecruitmentCard variationIndex={0} />
        <RecruitmentCard variationIndex={1} />
        <RecruitmentCard variationIndex={2} />
        <RecruitmentCard variationIndex={3} />
      </>
    );
    expect(screen.getByText("此產業等待更多工廠進駐")).toBeTruthy();
    expect(screen.getByText("你的工廠也提供這項服務嗎？")).toBeTruthy();
    expect(screen.getByText("讓更多企業找到你的製造能力")).toBeTruthy();
    expect(screen.getByText("加入 OXM，成為下一個合作夥伴")).toBeTruthy();
  });

  it("presentational 模式不渲染任何 <a>（供跑馬燈複製軌道使用）", () => {
    render(<RecruitmentCard presentational />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.querySelectorAll("a")).toHaveLength(0);
    expect(screen.getByText("待進駐")).toBeTruthy();
  });
});
