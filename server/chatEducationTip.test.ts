/**
 * 聊天室「建立訂單」功能教育提示：原始碼內容斷言。
 *
 * 同 server/chatAtomicFirstSend.test.ts 的做法——這個專案 vitest 只設定
 * environment: "node"，不應該在測試裡真的連線資料庫驗證 transaction／
 * FOR UPDATE 鎖定行為。這裡改用原始碼內容斷言，驗證：
 *   1. claimChatEducationTip 用同一個 db.transaction 包住「已顯示過」「已
 *      建立訂單」「訊息門檻／帳號 lifetime 上限」三層檢查與寫入，且用
 *      FOR UPDATE 鎖定 conversations／users 列。
 *   2. getHumanMessageCounts 只計算 shared/chatEducation.ts 定義的
 *      HUMAN_CHAT_MESSAGE_TYPES，排除系統訊息型別。
 *   3. routers.ts 的 claimChatEducationTip mutation 在呼叫 db 層之前，先
 *      做角色驗證：buyerTip 限買方本人，factorySpotlight／orderTipBubble
 *      限工廠端（owner／co-manager）。
 * 純函式門檻本身（20 則／雙方至少各 1 則／lifetime 5 次上限）已經在
 * shared/chatEducation.test.ts 用真正的函式呼叫驗證，這裡不重複。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const dbSource = fs.readFileSync(path.resolve(import.meta.dirname, "db.ts"), "utf-8");
const routersSource = fs.readFileSync(path.resolve(import.meta.dirname, "routers.ts"), "utf-8");

function extractFn(source: string, re: RegExp, label: string): string {
  const match = source.match(re);
  expect(match, `找不到：${label}`).not.toBeNull();
  return match![0];
}

describe("server/db.ts: getHumanMessageCounts 只計算真人聊天訊息型別", () => {
  const fn = extractFn(
    dbSource,
    /export async function getHumanMessageCounts\([\s\S]*?\n\}/,
    "getHumanMessageCounts",
  );

  it("用 inArray(messages.type, HUMAN_CHAT_MESSAGE_TYPES) 過濾，不是算 messages.length", () => {
    expect(fn).toMatch(/inArray\(messages\.type, HUMAN_CHAT_MESSAGE_TYPES\)/);
  });

  it("依 senderRole 分組計算，回傳 requesterCount／factoryCount 兩個獨立數字", () => {
    expect(fn).toMatch(/groupBy\(messages\.senderRole\)/);
    expect(fn).toMatch(/requesterCount/);
    expect(fn).toMatch(/factoryCount/);
  });
});

describe("server/db.ts: claimChatEducationTip 交易內完整規則", () => {
  const fn = extractFn(
    dbSource,
    /export async function claimChatEducationTip\([\s\S]*?\n\}/,
    "claimChatEducationTip",
  );

  it("用 db.transaction 包住整個認領流程", () => {
    expect(fn).toMatch(/return db\.transaction\(async \(tx\) => \{/);
  });

  it("用 FOR UPDATE 鎖定 conversation 列，避免併發重複認領", () => {
    expect(fn).toMatch(/\.where\(eq\(conversations\.id, conversationId\)\)\s*\n\s*\.limit\(1\)\s*\n\s*\.for\("update"\)/);
  });

  it("同一 conversation 已顯示過就直接回絕，不重複計數", () => {
    expect(fn).toMatch(/alreadyShown/);
    expect(fn).toMatch(/if \(alreadyShown\) return \{ allowed: false \}/);
  });

  it("conversation 已有任何 collaborationOrders 紀錄一律回絕（三種提示皆適用）", () => {
    expect(fn).toMatch(/existingOrders\.length > 0\) return \{ allowed: false \}/);
  });

  it("orderTipBubble 重新用 isOrderTipMessageThresholdMet 驗證訊息門檻，不只信任呼叫端", () => {
    const bubbleBranch = fn.match(/if \(kind === "orderTipBubble"\) \{([\s\S]*?)\n    \}/);
    expect(bubbleBranch, "找不到 orderTipBubble 分支").not.toBeNull();
    expect(bubbleBranch![1]).toMatch(/isOrderTipMessageThresholdMet\(counts\)/);
  });

  it("factorySpotlight／buyerTip 用 FOR UPDATE 鎖定 users 列後才檢查 lifetime 上限", () => {
    expect(fn).toMatch(/\.from\(users\)\.where\(eq\(users\.id, userId\)\)\.limit\(1\)\.for\("update"\)/);
    expect(fn).toMatch(/hasLifetimeChatEducationQuota\(lifetimeCount\)/);
  });

  it("認領成功時才遞增對應帳號的 lifetime 計數器", () => {
    expect(fn).toMatch(/chatFactorySpotlightTipCount: sql`\$\{users\.chatFactorySpotlightTipCount\} \+ 1`/);
    expect(fn).toMatch(/chatBuyerOrderTipCount: sql`\$\{users\.chatBuyerOrderTipCount\} \+ 1`/);
  });
});

describe("server/routers.ts: chat.claimChatEducationTip 呼叫 db 層前先做角色驗證", () => {
  const fn = extractFn(
    routersSource,
    /claimChatEducationTip: protectedProcedure\.input\(z\.object\(\{[\s\S]*?\n    \}\),/,
    "chat.claimChatEducationTip",
  );

  it("buyerTip 限買方本人", () => {
    expect(fn).toMatch(/if \(input\.kind === "buyerTip"\) \{\s*\n\s*if \(!isBuyer\) return \{ allowed: false \};/);
  });

  it("factorySpotlight／orderTipBubble 限工廠端（owner 或 co-manager）", () => {
    expect(fn).toMatch(/if \(!isFactorySide\) return \{ allowed: false \};/);
  });

  it("角色驗證通過才呼叫 db.claimChatEducationTip", () => {
    expect(fn).toMatch(/return db\.claimChatEducationTip\(input\.conversationId, ctx\.user\.id, input\.kind\);/);
  });
});
