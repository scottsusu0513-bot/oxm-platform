/**
 * 「顧問送出第一則訊息才建立對話」原子化：原始碼內容斷言。
 *
 * 同 server/advisorConversationAnonymizationSource.test.ts 的做法——此專案
 * vitest 只設定 environment: "node"，沒有 jsdom／React Testing Library，也不
 * 應該在測試裡真的連線資料庫驗證 transaction／rollback 行為（會連到本機或
 * 正式站 DB，任務要求禁止）。這裡改用原始碼內容斷言，驗證：
 *   1. 前端不再由 ChatPage / ConsultantCases 依序呼叫 getOrCreate 再 send。
 *   2. 後端新的原子 helper 真的把「建立/取得 conversation + 存訊息 +
 *      更新 lastMessageAt」全部包在同一個 db.transaction 內，且交易內只用
 *      tx.* 操作 DB（不會有漏出交易外、因而不會被 rollback 保護到的寫入）。
 *   3. 三個會列出對話的查詢都排除零訊息 conversation，且管理員分頁的
 *      total／items 套用同一個 where 條件。
 *   4. chat.getExisting 對零訊息舊 conversation 的判斷不受訊息數過濾影響。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const dbSource = fs.readFileSync(path.resolve(import.meta.dirname, "db.ts"), "utf-8");
const routersSource = fs.readFileSync(path.resolve(import.meta.dirname, "routers.ts"), "utf-8");
const consultantCasesSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "..", "client", "src", "pages", "ConsultantCases.tsx"),
  "utf-8",
);
const chatPageSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "..", "client", "src", "pages", "ChatPage.tsx"),
  "utf-8",
);

function extractFn(source: string, re: RegExp, label: string): string {
  const match = source.match(re);
  expect(match, `找不到：${label}`).not.toBeNull();
  return match![0];
}

describe("ConsultantCases.tsx: 顧問開草稿不呼叫 getOrCreate，不產生任何 DB write", () => {
  it("完全沒有 trpc.chat.getOrCreate 的呼叫", () => {
    expect(consultantCasesSource).not.toMatch(/trpc\.chat\.getOrCreate/);
  });

  it("openChatDraft 只 navigate 到 /chat/new 草稿頁，不呼叫任何 mutation", () => {
    const fn = extractFn(
      consultantCasesSource,
      /const openChatDraft = \(\) => \{[\s\S]*?\n  \};/,
      "openChatDraft",
    );
    expect(fn).toMatch(/navigate\(`\/chat\/new\?factoryId=\$\{item\.factoryId\}`/);
    expect(fn).not.toMatch(/\.mutate/);
  });
});

describe("ChatPage.tsx: 開新對話第一次送出只呼叫原子 mutation chat.sendFirstMessage", () => {
  it("完全沒有 trpc.chat.getOrCreate 的呼叫", () => {
    expect(chatPageSource).not.toMatch(/trpc\.chat\.getOrCreate/);
  });

  it("宣告 sendFirstMessageMut = trpc.chat.sendFirstMessage.useMutation()", () => {
    expect(chatPageSource).toMatch(/const sendFirstMessageMut = trpc\.chat\.sendFirstMessage\.useMutation\(\)/);
  });

  it("handleSend 的新對話分支只呼叫 sendFirstMessageMut，不再依序呼叫 getOrCreate 再 send", () => {
    const handleSend = extractFn(
      chatPageSource,
      /const handleSend = async \(\) => \{[\s\S]*?\n  \};/,
      "handleSend",
    );
    const newChatBranchMatch = handleSend.match(/if \(isNewChat && factoryId\) \{[\s\S]*?\n      \} else if \(conversationId\) \{([\s\S]*?)\n      \}/);
    expect(newChatBranchMatch, "找不到 handleSend 的 isNewChat / conversationId 分支").not.toBeNull();

    const newChatBranch = newChatBranchMatch![0].split("} else if")[0];
    expect(newChatBranch).toMatch(/sendFirstMessageMut\.mutateAsync\(\{ factoryId, productId, content: message\.trim\(\) \}\)/);
    expect(newChatBranch).not.toMatch(/getOrCreateMut/);
    expect(newChatBranch).not.toMatch(/sendMut\.mutateAsync/);

    const existingConvBranch = newChatBranchMatch![1];
    expect(existingConvBranch).toMatch(/sendMut\.mutate\(\{ conversationId, content: message\.trim\(\) \}\)/);
  });
});

describe("server/db.ts: createConversationAndSendFirstMessage 全部包在同一個 db.transaction 內", () => {
  const fn = extractFn(
    dbSource,
    /export async function createConversationAndSendFirstMessage\([\s\S]*?\n\}/,
    "createConversationAndSendFirstMessage",
  );

  it("用 db.transaction 包住整個流程", () => {
    expect(fn).toMatch(/return db\.transaction\(async \(tx\) => \{/);
  });

  it("先用 SELECT ... FOR UPDATE 鎖定 (userId, factoryId)，作為併發首次送出的 gap-lock 防護", () => {
    expect(fn).toMatch(/\.where\(and\(eq\(conversations\.userId, userId\), eq\(conversations\.factoryId, factoryId\)\)\)\s*\n\s*\.limit\(1\)\s*\n\s*\.for\("update"\)/);
  });

  it("conversation 建立、message 寫入、lastMessageAt 更新都用 tx（交易內操作），不使用交易外的 db.*", () => {
    expect(fn).toMatch(/tx\.insert\(conversations\)/);
    expect(fn).toMatch(/tx\.insert\(messages\)/);
    expect(fn).toMatch(/tx\.update\(conversations\)\.set\(\{ lastMessageAt: new Date\(\) \}\)/);
    // 交易 callback 內部除了取得 db handle 外不應該出現裸的 db.insert/db.update
    // （代表某個寫入漏在 transaction 外，rollback 時不會一併復原）。
    const txBodyMatch = fn.match(/return db\.transaction\(async \(tx\) => \{([\s\S]*)\n  \}\);/);
    expect(txBodyMatch, "找不到 transaction callback 內文").not.toBeNull();
    const txBody = txBodyMatch![1];
    expect(txBody).not.toMatch(/[^.]\bdb\.insert\(/);
    expect(txBody).not.toMatch(/[^.]\bdb\.update\(/);
  });
});

describe("server/db.ts: createCoManagerInvitationWithMessage 把 conversation + 邀請 + 邀請訊息包在同一個 transaction", () => {
  // 參數是多行 object type（data: { ... }): Promise<...> { ...），非貪婪 \n\}
  // 會在參數型別結尾就誤判為函式結束；用 negative lookahead 排除「} 後面
  // 直接接 ):」的情況。
  const fn = extractFn(
    dbSource,
    /export async function createCoManagerInvitationWithMessage\([\s\S]*?\n\}(?!\):)/,
    "createCoManagerInvitationWithMessage",
  );

  it("用 db.transaction 包住整個流程", () => {
    expect(fn).toMatch(/return db\.transaction\(async \(tx\) => \{/);
  });

  it("conversation、factoryCoManagerInvitations、messages 三張表的寫入都在交易內", () => {
    expect(fn).toMatch(/tx\.insert\(conversations\)/);
    expect(fn).toMatch(/tx\.insert\(factoryCoManagerInvitations\)/);
    expect(fn).toMatch(/tx\.insert\(messages\)/);
  });

  it("message 建立時直接帶入 invitationId，不需要事後再 update（原本 linkInvitationToMessage 的兩段式流程被交易取代）", () => {
    expect(fn).toMatch(/invitationId,\s*\n\s*\}\);/);
  });
});

describe("server/db.ts: createConversationSendMessageAndBatchItem 把 conversation + message + 批次項目包在同一個 transaction", () => {
  const fn = extractFn(
    dbSource,
    /export async function createConversationSendMessageAndBatchItem\([\s\S]*?\n\}/,
    "createConversationSendMessageAndBatchItem",
  );

  it("用 db.transaction 包住整個流程", () => {
    expect(fn).toMatch(/return db\.transaction\(async \(tx\) => \{/);
  });

  it("conversations、messages、inquiryBatchItems 三張表的寫入都在交易內", () => {
    expect(fn).toMatch(/tx\.insert\(conversations\)/);
    expect(fn).toMatch(/tx\.insert\(messages\)/);
    expect(fn).toMatch(/tx\.insert\(inquiryBatchItems\)/);
  });
});

describe("server/routers.ts: 三個原本先建 conversation 再另存 message 的流程都改呼叫對應的原子 helper", () => {
  it("chat.sendFirstMessage 呼叫 db.createConversationAndSendFirstMessage", () => {
    const fn = extractFn(
      routersSource,
      /sendFirstMessage: protectedProcedure\.input\(z\.object\(\{[\s\S]*?\n    \}\),/,
      "chat.sendFirstMessage",
    );
    expect(fn).toMatch(/db\.createConversationAndSendFirstMessage\(/);
  });

  it("factory.inviteCoManager 呼叫 db.createCoManagerInvitationWithMessage，不再各自呼叫 getOrCreateConversation/createCoManagerInvitation/sendCoManagerInviteMessage/linkInvitationToMessage", () => {
    const fn = extractFn(
      routersSource,
      /inviteCoManager: protectedProcedure\.input\(z\.object\(\{[\s\S]*?\n    \}\),/,
      "factory.inviteCoManager",
    );
    expect(fn).toMatch(/db\.createCoManagerInvitationWithMessage\(\{/);
    expect(fn).not.toMatch(/db\.getOrCreateConversation\(/);
    expect(fn).not.toMatch(/db\.createCoManagerInvitation\(/);
    expect(fn).not.toMatch(/db\.sendCoManagerInviteMessage\(/);
    expect(fn).not.toMatch(/db\.linkInvitationToMessage\(/);
  });

  it("inquiryBatch.createAndSend 呼叫 db.createConversationSendMessageAndBatchItem，不再各自呼叫 getOrCreateConversation/saveMessage/createInquiryBatchItem", () => {
    const fn = extractFn(
      routersSource,
      /createAndSend: protectedProcedure\.input\(z\.object\(\{[\s\S]*?\n    \}\),/,
      "inquiryBatch.createAndSend",
    );
    expect(fn).toMatch(/db\.createConversationSendMessageAndBatchItem\(/);
    expect(fn).not.toMatch(/db\.getOrCreateConversation\(/);
    expect(fn).not.toMatch(/db\.saveMessage\(/);
    expect(fn).not.toMatch(/db\.createInquiryBatchItem\(/);
  });

  it("chat.send（既有對話）維持不變，仍用 db.getConversationById 走原本的權限檢查與 db.saveMessage", () => {
    const fn = extractFn(
      routersSource,
      /send: protectedProcedure\.input\(z\.object\(\{\s*conversationId: z\.number\(\),\s*content:[\s\S]*?\n    \}\),/,
      "chat.send",
    );
    expect(fn).toMatch(/const conv = await db\.getConversationById\(input\.conversationId\)/);
    expect(fn).toMatch(/if \(!isFactoryOwner && !isCoMgr && !isUser\) throw new Error\("無權限"\)/);
    expect(fn).toMatch(/await db\.saveMessage\(input\.conversationId, ctx\.user\.id, senderRole, input\.content\)/);
  });
});

describe("server/db.ts: 會員／工廠端列表只顯示至少一則 message 的對話", () => {
  it("getConversationsByUserWithDetails 過濾掉 lastMsgMap 沒有紀錄的 conversation", () => {
    const fn = extractFn(
      dbSource,
      /export async function getConversationsByUserWithDetails\([\s\S]*?\n\}/,
      "getConversationsByUserWithDetails",
    );
    expect(fn).toMatch(/\.filter\(conv => lastMsgMap\.has\(conv\.id\)\)/);
  });

  it("getConversationsByFactoryWithDetails 過濾掉 lastMsgMap 沒有紀錄的 conversation", () => {
    const fn = extractFn(
      dbSource,
      /export async function getConversationsByFactoryWithDetails\([\s\S]*?\n\}/,
      "getConversationsByFactoryWithDetails",
    );
    expect(fn).toMatch(/\.filter\(conv => lastMsgMap\.has\(conv\.id\)\)/);
  });
});

describe("server/db.ts: getAdminConversations 分頁 total 與 items 套用完全相同的 where 條件", () => {
  const fn = extractFn(
    dbSource,
    /export async function getAdminConversations\([\s\S]*?\n\}/,
    "getAdminConversations",
  );

  it("conditions 一律包含至少一則 message 的 EXISTS 條件", () => {
    expect(fn).toMatch(/EXISTS \(SELECT 1 FROM messages m WHERE m\.conversationId = \$\{conversations\.id\}\)/);
  });

  it("count 與 items 查詢都使用同一個 whereClause 變數（避免其中一邊漏套用條件造成 total／items 不一致）", () => {
    expect(fn).toMatch(/const whereClause = and\(\.\.\.conditions\)/);
    const countMatch = fn.match(/db\.select\(\{ count: sql<number>`COUNT\(\*\)` \}\)\.from\(conversations\)\.where\((\w+)\)/);
    const itemsMatch = fn.match(/\.from\(conversations\)\s*\n\s*\.leftJoin\(users[\s\S]*?\.where\((\w+)\)/);
    expect(countMatch, "找不到 count 查詢的 where").not.toBeNull();
    expect(itemsMatch, "找不到 items 查詢的 where").not.toBeNull();
    expect(countMatch![1]).toBe("whereClause");
    expect(itemsMatch![1]).toBe("whereClause");
  });
});

describe("server/routers.ts: chat.getExisting 不受訊息數過濾影響，仍能找到零訊息舊 conversation", () => {
  it("getExisting 直接查 conversations 表本身，沒有套用 lastMsgMap／EXISTS 之類的訊息數過濾", () => {
    const fn = extractFn(
      routersSource,
      /getExisting: protectedProcedure\.input\(z\.object\(\{[\s\S]*?\n    \}\),/,
      "chat.getExisting",
    );
    expect(fn).toMatch(/db_\.select\(\)\.from\(conversations\)\.where\(and\(\.\.\.conditions\)\)\.limit\(1\)/);
    expect(fn).not.toMatch(/lastMsgMap|EXISTS/);
  });
});
