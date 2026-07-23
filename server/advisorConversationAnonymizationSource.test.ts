/**
 * 政府補助顧問案件對話匿名化：原始碼內容斷言。
 *
 * 背景：完整整合測試（advisorConversationAnonymization.test.ts）需要
 * upgradeApplications.factoryId 等欄位（migration 0043+），但本機測試資料庫
 * 尚未套用這些既有 migration（與本次修改無關的既存環境落差，詳見任務報告），
 * 因此該整合測試目前在本機會因為 DB schema 落後而失敗。這裡改用專案既有慣例
 * （沿用 upgradeConsultantEmail.test.ts 的原始碼斷言手法）驗證關鍵邏輯確實
 * 寫在正確的地方、判斷條件正確，不需要真的連線到已migrate的資料庫。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const dbSource = fs.readFileSync(path.resolve(import.meta.dirname, "db.ts"), "utf-8");
const routersSource = fs.readFileSync(path.resolve(import.meta.dirname, "routers.ts"), "utf-8");

describe("server/db.ts: 政府補助顧問對話判斷", () => {
  it("isAdvisorConversation 以 upgradeConsultants.userId + upgradeApplications.assignedConsultantId/factoryId 動態判斷，不依賴額外欄位", () => {
    const fnMatch = dbSource.match(/export async function isAdvisorConversation\([\s\S]*?\n\}/);
    expect(fnMatch, "找不到 isAdvisorConversation 函式").not.toBeNull();
    const fn = fnMatch![0];
    expect(fn).toMatch(/eq\(upgradeApplications\.assignedConsultantId, upgradeConsultants\.id\)/);
    expect(fn).toMatch(/eq\(upgradeConsultants\.userId, userId\)/);
    expect(fn).toMatch(/eq\(upgradeApplications\.factoryId, factoryId\)/);
  });

  it("getConversationsByFactoryWithDetails 對顧問對話回傳 ADVISOR_DISPLAY_NAME，一般對話維持真實姓名", () => {
    const fnMatch = dbSource.match(/export async function getConversationsByFactoryWithDetails\([\s\S]*?\n\}/);
    expect(fnMatch, "找不到 getConversationsByFactoryWithDetails 函式").not.toBeNull();
    const fn = fnMatch![0];
    expect(fn).toMatch(/getAdvisorUserIdsForFactory\(factoryId, userIds\)/);
    expect(fn).toMatch(/isAdvisor \? ADVISOR_DISPLAY_NAME : \(userMap\.get\(conv\.userId\)\?\.name/);
    expect(fn).toMatch(/buyerAffiliation: isAdvisor \? null :/);
  });
});

describe("server/routers.ts: chat.getConversationMeta 只對工廠端匿名化", () => {
  function getFn() {
    const fnMatch = routersSource.match(/getConversationMeta: protectedProcedure[\s\S]*?\n    \}\),/);
    expect(fnMatch, "找不到 getConversationMeta procedure").not.toBeNull();
    return fnMatch![0];
  }

  it("匿名化條件同時要求『是顧問對話』且『目前查詢者是工廠端（owner 或 co-manager）』", () => {
    expect(getFn()).toMatch(/const anonymizeForViewer = isAdvisorConv && \(isFactoryOwner \|\| isCoMgr\)/);
  });

  it("buyerName／buyerAffiliation 只在 anonymizeForViewer 時被覆蓋為匿名值，其餘情況（顧問本人、管理員）維持真實資料", () => {
    const fn = getFn();
    expect(fn).toMatch(/buyerName: anonymizeForViewer \? ADVISOR_DISPLAY_NAME : \(buyer\?\.name \?\? null\)/);
    expect(fn).toMatch(/buyerAffiliation: anonymizeForViewer \? null :/);
  });
});

describe("server/routers.ts: chat.send 對工廠端的推播／站內通知同步匿名化", () => {
  function getFn() {
    const fnMatch = routersSource.match(/send: protectedProcedure\.input\(z\.object\(\{\s*conversationId: z\.number\(\),\s*content:[\s\S]*?\n    \}\),/);
    expect(fnMatch, "找不到 chat.send procedure").not.toBeNull();
    return fnMatch![0];
  }

  it("isAdvisorConv 只在 senderRole 為 user（買家／顧問）時才需要判斷，並用 db.isAdvisorConversation 動態判斷", () => {
    expect(getFn()).toMatch(/const isAdvisorConv = senderRole === "user" && await db\.isAdvisorConversation\(conv\.userId, conv\.factoryId\)/);
  });

  it("推播通知 body 在顧問對話時改用 ADVISOR_DISPLAY_NAME，不洩漏顧問真實姓名", () => {
    expect(getFn()).toMatch(/body: `\$\{isAdvisorConv \? ADVISOR_DISPLAY_NAME : \(ctx\.user\.name \?\? "客戶"\)\} 傳來一則新訊息`/);
  });

  it("站內通知 actorName／message 在顧問對話時改用 ADVISOR_DISPLAY_NAME，不洩漏顧問真實姓名", () => {
    const fn = getFn();
    expect(fn).toMatch(/actorName: isAdvisorConv \? ADVISOR_DISPLAY_NAME : \(ctx\.user\.name \?\? ctx\.user\.email \?\? ""\)/);
    expect(fn).toMatch(/message: `\$\{isAdvisorConv \? ADVISOR_DISPLAY_NAME : \(ctx\.user\.name \?\? "客戶"\)\} 傳了一則新詢問訊息`/);
  });

  it("管理員監控信（notifyOwner）不受影響，仍寫入客戶（顧問）真實姓名供內部稽核", () => {
    expect(getFn()).toMatch(/客戶名稱：\$\{ctx\.user\.name \?\? "匿名"\}/);
  });
});
