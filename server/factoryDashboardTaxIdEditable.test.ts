/**
 * OXM Factory taxId — Registration + Editable Revision Flow Audit / Fix：
 * FactoryDashboard.tsx 的統一編號欄位不再對 approved 工廠特別鎖定，可編輯
 * 能力改為跟其他基本資料欄位共用同一個 isLocked（pending 審核中 or 有待審
 * 修改申請），approved 工廠儲存時走既有「修改申請」流程（見
 * server/factoryTaxId.test.ts 的 server 端 regression）。同專案既有慣例：
 * 沒有 jsdom，改用原始碼內容斷言。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function readSource(): string {
  return fs
    .readFileSync(
      path.resolve(import.meta.dirname, "..", "client", "src", "pages", "FactoryDashboard.tsx"),
      "utf-8",
    )
    .replace(/\r\n/g, "\n");
}

describe("FactoryDashboard.tsx 統一編號欄位：approved 工廠不再永久鎖定", () => {
  const source = readSource();

  it("taxId 的 <Input> 不再有 factory.status === \"approved\" 這條額外鎖定特例，disabled 只看 isLocked（跟其他欄位一致）", () => {
    const inputMatch = source.match(/<Input\s*\n\s*disabled=\{[^}]*\}\s*\n\s*inputMode="numeric"\s*\n\s*value=\{taxId\}[\s\S]*?\/>/);
    expect(inputMatch, "找不到 taxId 的 <Input> 區塊").not.toBeNull();
    const input = inputMatch![0];
    expect(input).toMatch(/disabled=\{isLocked\}/);
    expect(input).not.toMatch(/factory\.status === "approved"/);
    expect(input).toMatch(/placeholder=\{isLocked \? "未填寫" : "請輸入 8 碼統一編號"\}/);
  });

  it("buildProposedData()（approved 工廠送出修改申請的 payload）已納入 taxId，沿用 normalizeTaxId 正規化", () => {
    const buildMatch = source.match(/const buildProposedData = \(\) => \(\{[\s\S]*?\n {2}\}\);/);
    expect(buildMatch, "找不到 buildProposedData 定義").not.toBeNull();
    expect(buildMatch![0]).toMatch(/taxId: normalizeTaxId\(taxId\),/);
  });

  it("handleSave 的 taxId 格式驗證維持不變，仍在 approved 分流（開啟修改申請 Dialog）之前執行，不會讓格式錯誤的 taxId 混進修改申請", () => {
    const handleSaveMatch = source.match(/const handleSave = \(\) => \{[\s\S]*?\n {2}\};/);
    expect(handleSaveMatch, "找不到 handleSave 定義").not.toBeNull();
    const handleSave = handleSaveMatch![0];
    const validateIdx = handleSave.indexOf("統一編號須為 8 碼數字");
    const approvedBranchIdx = handleSave.indexOf("factory.status === 'approved'");
    expect(validateIdx).toBeGreaterThan(-1);
    expect(approvedBranchIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeLessThan(approvedBranchIdx);
  });

  it("draft／rejected 直接更新路徑（updateFactory.mutate）仍然包含 taxId，沒有被這次改動意外移除", () => {
    const handleSaveMatch = source.match(/const handleSave = \(\) => \{[\s\S]*?\n {2}\};/);
    expect(handleSaveMatch![0]).toMatch(/taxId: normalizedTaxId \|\| undefined,/);
  });
});
