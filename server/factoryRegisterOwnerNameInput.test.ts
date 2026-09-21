/**
 * 工廠「送審必填欄位」的前端 regression test（見任務定案「工廠上架／送審
 * 必填欄位 audit」／收斂輪「工廠上架／送審必填欄位 audit（收斂輪）」）。
 *
 * 同專案既有慣例（見 server/factoryRegisterTaxIdInput.test.ts）：vitest 只
 * 涵蓋 server/**\/*.test.ts、沒有 jsdom，改用原始碼內容斷言，確保
 * FactoryRegister.tsx／FactoryDashboard.tsx 的前端把關邏輯不會被日後改動
 * 悄悄拿掉——server 端驗證是最後防線，但不能只依賴後端擋、讓使用者填完
 * 整張表單才在送出時收到通用失敗訊息（見任務指示「不可以只依賴 HTML
 * required／不可以只修 UI」的相反面：也不可以只修後端、放著前端完全沒有
 * 對應提示）。
 *
 * 收斂輪重點：FactoryDashboard.tsx 的「送出審核」與「提交修改申請」原本各自
 * 只檢查 ownerName，收斂輪抽出共用的 getFactorySubmissionError()（同時涵蓋
 * ownerName／region／capitalLevel／mfgModes／address），這裡的斷言也跟著
 * 改成驗證這個共用函式的存在與呼叫方式，而不是各自分散的 if。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function readSource(relPath: string): string {
  return fs
    .readFileSync(path.resolve(import.meta.dirname, "..", ...relPath.split("/")), "utf-8")
    .replace(/\r\n/g, "\n");
}

describe("FactoryRegister.tsx：負責人必填的前端驗證（建立工廠）", () => {
  const source = readSource("client/src/pages/FactoryRegister.tsx");

  it("FormErrors 型別包含 ownerName", () => {
    expect(source).toMatch(/type FormErrors = \{[\s\S]*?ownerName\?: string;[\s\S]*?\};/);
  });

  it("validate() 會檢查 ownerName trim 後是否為空，訊息「請填寫負責人」", () => {
    expect(source).toMatch(/if \(!ownerName\.trim\(\)\) newErrors\.ownerName = "請填寫負責人";/);
  });

  it("負責人姓名欄位的 Label 標示為必填（* 記號），與其他必填欄位一致", () => {
    expect(source).toMatch(/<Label htmlFor="owner">負責人姓名 \*<\/Label>/);
  });

  it("負責人姓名欄位會顯示 errors.ownerName 的錯誤訊息", () => {
    expect(source).toMatch(/\{errors\.ownerName && <p className="text-xs text-red-500 mt-1">\{errors\.ownerName\}<\/p>\}/);
  });

  it("送出的 factory.create payload 直接帶 ownerName（不是 `ownerName || undefined`）——validate() 已保證非空，不能再讓必填欄位可能送出 undefined", () => {
    const submitMatch = source.match(/await createFactoryMut\.mutateAsync\(\{[\s\S]*?\n\s*\}\);/);
    expect(submitMatch, "找不到 createFactoryMut.mutateAsync 呼叫區塊").not.toBeNull();
    expect(submitMatch![0]).toMatch(/\bownerName,/);
  });
});

describe("FactoryDashboard.tsx：送審完整度共用驗證（getFactorySubmissionError）", () => {
  const source = readSource("client/src/pages/FactoryDashboard.tsx");

  it("負責人姓名 Label 標示為必填（* 記號）", () => {
    expect(source).toMatch(/<Label>負責人姓名 \*<\/Label>/);
  });

  it("存在共用的 getFactorySubmissionError()，依序檢查 ownerName／region／capitalLevel／mfgModes／address，不是分散的 if", () => {
    const fnMatch = source.match(/function getFactorySubmissionError\([\s\S]*?return null;\n\}/);
    expect(fnMatch, "找不到 getFactorySubmissionError 函式").not.toBeNull();
    const fn = fnMatch![0];
    expect(fn).toMatch(/if \(!data\.ownerName\.trim\(\)\) return "請填寫負責人";/);
    expect(fn).toMatch(/if \(!data\.region\.trim\(\)\) return "請選擇地區";/);
    expect(fn).toMatch(/if \(!data\.capitalLevel\.trim\(\)\) return "請選擇資本額";/);
    expect(fn).toMatch(/if \(!data\.mfgModes\.some\(m => m\.trim\(\)\.length > 0\)\) return "請至少選擇一種代工模式";/);
    expect(fn).toMatch(/if \(!data\.address\.trim\(\)\) return "請填寫地址";/);
  });

  it("「送出審核」按鈕點擊時（handleOpenSubmitForReview）會呼叫 getFactorySubmissionError，未通過不開啟確認 dialog", () => {
    expect(source).toMatch(
      /const handleOpenSubmitForReview = \(\) => \{[\s\S]*?const submissionError = getFactorySubmissionError\(\{ ownerName, region, capitalLevel, mfgModes, address \}\);[\s\S]*?if \(submissionError\) \{[\s\S]*?toast\.error\(submissionError\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?setSubmitReviewOpen\(true\);[\s\S]*?\};/,
    );
  });

  it("「送出審核」的 AlertDialog 改為受控狀態，並綁定 handleOpenSubmitForReview，而不是無條件的 AlertDialogTrigger", () => {
    expect(source).toMatch(/<AlertDialog open=\{submitReviewOpen\} onOpenChange=\{setSubmitReviewOpen\}>/);
    expect(source).toMatch(/onClick=\{handleOpenSubmitForReview\}/);
  });

  it("handleSubmitRevision（提交修改申請）會先呼叫 getFactorySubmissionError 才呼叫 submitRevisionMut", () => {
    const fnMatch = source.match(/const handleSubmitRevision = \(\) => \{[\s\S]*?\n  \};/);
    expect(fnMatch, "找不到 handleSubmitRevision 函式").not.toBeNull();
    const fn = fnMatch![0];
    expect(fn).toMatch(/const submissionError = getFactorySubmissionError\(\{ ownerName, region, capitalLevel, mfgModes, address \}\);/);
    expect(fn).toMatch(/if \(submissionError\) \{/);
    expect(fn).toMatch(/toast\.error\(submissionError\);/);
    // 完整度檢查必須排在真正呼叫 mutate 之前，不能只是檢查但沒有擋下送出。
    const checkIndex = fn.indexOf("getFactorySubmissionError({ ownerName, region, capitalLevel, mfgModes, address })");
    const mutateIndex = fn.indexOf("submitRevisionMut.mutate({");
    expect(checkIndex).toBeGreaterThan(-1);
    expect(mutateIndex).toBeGreaterThan(checkIndex);
  });
});
