/**
 * OXM Factory taxId — Registration + Editable Revision Flow Audit / Fix：
 * Admin Review 的修改申請 diff 畫面（原值紅色／新值綠色，未變更維持一般
 * 顏色）本來就是通用、依欄位清單驅動的渲染邏輯（見 FactoryReviewDetail.tsx
 * 的 FIELD_LABELS／revision-mode 欄位陣列），taxId 只需要加入既有清單，不
 * 需要另外做一套 UI。這裡釘住這個結論。同專案既有慣例：沒有 jsdom，改用
 * 原始碼內容斷言。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function readSource(): string {
  return fs
    .readFileSync(
      path.resolve(import.meta.dirname, "..", "client", "src", "pages", "FactoryReviewDetail.tsx"),
      "utf-8",
    )
    .replace(/\r\n/g, "\n");
}

describe("FactoryReviewDetail.tsx：taxId 已加入既有的修改申請 diff 顯示（不是另外做一套 UI）", () => {
  const source = readSource();

  it("FIELD_LABELS 有 taxId 的中文標籤", () => {
    expect(source).toMatch(/taxId: "統一編號"/);
  });

  it("revision-mode 欄位清單（原值紅色／新值綠色渲染）包含 taxId", () => {
    const fieldListMatch = source.match(/\{\(\["name", "taxId",[\s\S]*?\] as const\)\.map\(field => \{/);
    expect(fieldListMatch, "找不到 revision-mode 欄位清單").not.toBeNull();
  });

  it("非修改申請模式（一般審核）仍照舊顯示 factory.taxId，未被本輪動到", () => {
    expect(source).toMatch(/\(factory as any\)\.taxId \|\| "未填寫"/);
  });
});
