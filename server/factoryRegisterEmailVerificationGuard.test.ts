/**
 * 建立工廠頁（client/src/pages/FactoryRegister.tsx）— 前端主信箱驗證攔截。
 *
 * 後端 requireVerifiedEmail 硬性防線本身的行為由
 * server/factoryCreateEmailVerificationGuard.test.ts 驗證（真的呼叫
 * appRouter.createCaller 觸發 tRPC mutation）。這裡驗證的是「前端在使用者
 * 看到表單之前就先攔截」這件事本身的原始碼結構——沿用本專案既有慣例
 * （readFileSync + 字串／正規表達式比對，見 server/certificationCenterNoPublicEntry.test.ts
 * 等檔案），因為「表單是否真的被提前攔截、頁面載入是否真的沒有自動寄信」
 * 這類「原始碼裡有沒有某段邏輯」的問題，用純 DOM 渲染測試不容易精準斷言，
 * 直接檢查原始碼結構更直接可靠。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

const source = readSource("client", "src", "pages", "FactoryRegister.tsx");

describe("FactoryRegister.tsx：未驗證主信箱的使用者無法進入表單", () => {
  it("沒有 primaryEmail 時，在 formStarted／表單渲染之前就先 return 導引畫面", () => {
    const noEmailGuardIndex = source.search(/if\s*\(!user\?\.primaryEmail\)\s*{/);
    const formStartedCheckIndex = source.indexOf("if (!formStarted)");
    expect(noEmailGuardIndex).toBeGreaterThan(-1);
    expect(formStartedCheckIndex).toBeGreaterThan(-1);
    // 攔截邏輯必須寫在 formStarted 判斷「之前」，確保表單渲染路徑一定會先
    // 經過這個 guard。
    expect(noEmailGuardIndex).toBeLessThan(formStartedCheckIndex);
  });

  it("有 primaryEmail 但 primaryEmailVerifiedAt 為空時，同樣在表單之前先 return 導引畫面", () => {
    const unverifiedGuardIndex = source.search(/if\s*\(!user\?\.primaryEmailVerifiedAt\)\s*{/);
    const formStartedCheckIndex = source.indexOf("if (!formStarted)");
    expect(unverifiedGuardIndex).toBeGreaterThan(-1);
    expect(formStartedCheckIndex).toBeGreaterThan(-1);
    expect(unverifiedGuardIndex).toBeLessThan(formStartedCheckIndex);
  });

  it("沒有 primaryEmail 與『有 primaryEmail 但未驗證』使用不同的導引文案", () => {
    expect(source).toMatch(/請先設定主要信箱/);
    expect(source).toMatch(/請先完成主信箱驗證，才能建立/);
  });

  it("未驗證導引畫面顯示目前設定的主信箱、重新寄送驗證信按鈕，及前往會員中心的入口", () => {
    expect(source).toMatch(/目前設定的主信箱/);
    expect(source).toMatch(/\{user\.primaryEmail\}/);
    expect(source).toMatch(/重新寄送驗證信/);
    expect(source).toMatch(/navigate\("\/member"\)/);
  });

  it("沿用既有的 trpc.auth.sendVerificationEmail（既有 cooldown／防重送機制），沒有另外新建寄信端點", () => {
    expect(source).toMatch(/trpc\.auth\.sendVerificationEmail\.useMutation/);
  });

  it("頁面載入不會自動寄送驗證信：sendVerifMut.mutate() 只出現在點擊處理函式內，不在任何 useEffect 裡直接呼叫", () => {
    // handleResendVerification 內才呼叫 sendVerifMut.mutate()
    expect(source).toMatch(/const handleResendVerification = \(\) => \{[\s\S]{0,80}sendVerifMut\.mutate\(\)/);
    // 除了這個函式定義本身，其餘任何 useEffect 區塊都不應該直接呼叫
    // sendVerifMut.mutate()（避免頁面一載入就自動寄信）。
    const useEffectBlocks = source.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/g) ?? [];
    for (const block of useEffectBlocks) {
      expect(block).not.toMatch(/sendVerifMut\.mutate\(\)/);
    }
  });

  it("重新寄送驗證信按鈕透過 onClick 觸發，不是渲染時直接呼叫", () => {
    expect(source).toMatch(/onClick=\{handleResendVerification\}/);
  });
});

describe("FactoryRegister.tsx：已驗證使用者不受影響（guard 條件本身是「否定」判斷，驗證後自然放行）", () => {
  it("兩個新 guard 都是 if(!條件) 提前 return，verified 為真時會自然略過、繼續往下渲染既有畫面", () => {
    // 確認兩個 guard 都是「否定 + 提前 return」的形狀，而不是反過來擋住已驗證的人
    expect(source).toMatch(/if\s*\(!user\?\.primaryEmail\)\s*\{\s*return/);
    expect(source).toMatch(/if\s*\(!user\?\.primaryEmailVerifiedAt\)\s*\{\s*return/);
  });
});

describe("FactoryRegister.tsx：送出階段的最後防線——後端拒絕時顯示正確訊息", () => {
  it("catch 區塊會特別判斷 UNVERIFIED_EMAIL，顯示「請先完成主信箱驗證」而不是通用失敗訊息", () => {
    const catchBlockMatch = source.match(/\} catch \(err: any\) \{[\s\S]*?\n {4}\}\s*\n {2}\};/);
    expect(catchBlockMatch).toBeTruthy();
    const catchBlock = catchBlockMatch![0];
    expect(catchBlock).toMatch(/UNVERIFIED_EMAIL/);
    expect(catchBlock).toMatch(/請先完成主信箱驗證/);
    // 通用失敗訊息仍要保留，但必須是 UNVERIFIED_EMAIL 分支「以外」的 fallback。
    // 用實際程式碼行（if 判斷式與 toast.error 呼叫）定位，避免被說明註解裡
    // 提到的字串誤導判斷順序。
    const ifCheckMatch = catchBlock.match(/if \(err\?\.message === "UNVERIFIED_EMAIL"\) \{/);
    const genericToastMatch = catchBlock.match(/toast\.error\("建立失敗，請稍後再試或聯繫客服"\);/);
    expect(ifCheckMatch).toBeTruthy();
    expect(genericToastMatch).toBeTruthy();
    const ifCheckIdx = catchBlock.indexOf(ifCheckMatch![0]);
    const genericToastIdx = catchBlock.indexOf(genericToastMatch![0]);
    // if 判斷式必須在通用 fallback 之前，且兩者之間要有 return，確保攔截到
    // 就提前結束，不會兩個 toast 都跳出來。
    expect(ifCheckIdx).toBeLessThan(genericToastIdx);
    expect(catchBlock.slice(ifCheckIdx, genericToastIdx)).toMatch(/return/);
  });
});

describe("FactoryRegister.tsx：直接輸入網址與一般入口套用相同攔截", () => {
  it("整個頁面只有單一 export default 元件與單一 route，攔截邏輯對所有進入方式一視同仁", () => {
    // 只要整個檔案只有一個 default export 的元件，不論使用者是點連結進來還是
    // 直接輸入網址，渲染的都是同一份 guard 邏輯，不需要另外針對「直接輸入網址」
    // 寫第二套判斷。
    const defaultExportMatches = source.match(/export default function/g) ?? [];
    expect(defaultExportMatches.length).toBe(1);
  });
});
