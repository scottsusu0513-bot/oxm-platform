/**
 * OXM Factory taxId — Registration + Editable Revision Flow Audit / Fix：
 * 這輪任務要求先確認「新註冊工廠」統編欄位到底能不能正常輸入，明確回報
 * FactoryRegister.tsx 原本是否真的有 bug，不能因為之前的猜測就直接改。
 *
 * Audit 結論：FactoryRegister.tsx 的 taxId 欄位本來就是正確的——不是
 * disabled、是 controlled input（value={taxId}）、type 維持預設 text（沒有
 * 傳 type="number"）、有 inputMode="numeric" 與 maxLength={8}、驗證邏輯與
 * server 端 factory.create 共用同一份 shared/taxId.ts、送出 payload 真的
 * 包含 taxId。這裡沒有程式改動，只是把「本來就正確」的狀態寫成 regression
 * test 釘住，避免以後被誤改壞。同專案既有慣例（見
 * server/navbarMobileAccordion.test.ts）：vitest 只涵蓋 server/**\/*.test.ts、
 * 沒有 jsdom，改用原始碼內容斷言。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function readSource(): string {
  return fs
    .readFileSync(
      path.resolve(import.meta.dirname, "..", "client", "src", "pages", "FactoryRegister.tsx"),
      "utf-8",
    )
    .replace(/\r\n/g, "\n");
}

describe("FactoryRegister.tsx 統一編號欄位：註冊當下就能正常輸入（audit 結論：本來就沒有 bug）", () => {
  const source = readSource();

  it("taxId input 區塊存在，且不是 disabled", () => {
    const inputMatch = source.match(/<Input\s*\n\s*id="taxId"[\s\S]*?\/>/);
    expect(inputMatch, "找不到 taxId 的 <Input> 區塊").not.toBeNull();
    expect(inputMatch![0]).not.toMatch(/disabled/);
  });

  it("是 controlled input：value 綁定 taxId state，onChange 呼叫 setTaxId", () => {
    const inputMatch = source.match(/<Input\s*\n\s*id="taxId"[\s\S]*?\/>/);
    const input = inputMatch![0];
    expect(input).toMatch(/value=\{taxId\}/);
    expect(input).toMatch(/setTaxId\(e\.target\.value\)/);
  });

  it("type 維持預設 text，沒有使用 type=\"number\"（避免前導零被吃掉）", () => {
    const inputMatch = source.match(/<Input\s*\n\s*id="taxId"[\s\S]*?\/>/);
    expect(inputMatch![0]).not.toMatch(/type=["']number["']/);
  });

  it("有 inputMode=\"numeric\" 與 maxLength={8}", () => {
    const inputMatch = source.match(/<Input\s*\n\s*id="taxId"[\s\S]*?\/>/);
    const input = inputMatch![0];
    expect(input).toMatch(/inputMode="numeric"/);
    expect(input).toMatch(/maxLength=\{8\}/);
  });

  it("驗證邏輯重用 shared/taxId.ts 的 normalizeTaxId／isValidTaiwanTaxId，沒有另外重造一套規則，三段錯誤訊息與 server 端 factory.create 完全一致", () => {
    expect(source).toMatch(/import \{ normalizeTaxId, isValidTaiwanTaxId \} from "@shared\/taxId";/);
    expect(source).toMatch(/if \(!normalizedTaxId\) newErrors\.taxId = "請輸入統一編號";/);
    expect(source).toMatch(/else if \(!\/\^\\d\{8\}\$\/\.test\(normalizedTaxId\)\) newErrors\.taxId = "統一編號須為 8 碼數字";/);
    expect(source).toMatch(/else if \(!isValidTaiwanTaxId\(normalizedTaxId\)\) newErrors\.taxId = "統一編號格式不正確，請確認輸入是否正確";/);
  });

  it("送出的 factory.create payload 真的包含 taxId（正規化後的值，不是原始未處理輸入）", () => {
    const submitMatch = source.match(/await createFactoryMut\.mutateAsync\(\{[\s\S]*?\n\s*\}\);/);
    expect(submitMatch, "找不到 createFactoryMut.mutateAsync 呼叫區塊").not.toBeNull();
    expect(submitMatch![0]).toMatch(/taxId: normalizeTaxId\(taxId\)/);
  });
});
