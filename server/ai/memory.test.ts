/**
 * server/ai/memory.ts 驗證，對應「Enterprise Memory 必須採 merge / update，
 * 而不是 blind overwrite」修正後的必測案例：
 * 1. 有實質內容的對話 → 摘要成功 → Enterprise Memory 存在、原文刪除。
 * 2. 沒有有效資訊的對話（寒暄、隨便看看）→ 仍然要有摘要，固定文字，
 *    hasMeaningfulBusinessInfo=false，原文一樣刪除。
 * 3. LLM 摘要失敗 → conversation/messages 保留，不能刪除，可重試。
 * 4.（見 conversationService.test.ts 的 markConversationSummaryFailed 測試：
 *    DB 寫入失敗的保留/重試機制跟 LLM 失敗共用同一條 catch 路徑。）
 * 5. 摘要成功 → messages 明確／cascade 刪除，不殘留 orphan data。
 * CASE 1（新規格）：既有記憶有內容、這次對話沒有新資訊 → summaryText 完全不
 *    變，只更新 lastInteractionAt／lastInteractionHadMeaningfulInfo。
 * CASE 2（新規格）：既有記憶與新對話都有內容且互相更新（例如「ERP 已送，
 *    完成未知」→「ERP 已完成」）→ 呼叫模型合併，取代過時狀態，不得同時保留
 *    兩個互相矛盾的描述。
 *
 * provider（LLM）用 vi.mock 隔離，不打真實 API；DB 走真實本機測試資料庫。
 * 每個測試情境都用獨立的 test user，避免同一個 user 的 Enterprise Memory
 * row 在不同測試之間互相汙染、意外觸發或跳過 merge 分支。
 */
import { describe, expect, it, vi, beforeEach, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { aiEnterpriseMemories } from "../../drizzle/schema";

const mockCompleteJson = vi.fn();
vi.mock("./provider", () => ({
  getAiChatProvider: () => ({ completeJson: mockCompleteJson }),
}));

import {
  generateConversationSummary,
  upsertEnterpriseMemory,
  getEnterpriseMemory,
  mergeEnterpriseMemory,
  endConversationAndSummarize,
  NO_MEANINGFUL_INFO_SUMMARY,
} from "./memory";
import { createConversation, appendMessage, getAllMessages, getConversationForUser } from "./conversationService";
import type { AiEnterpriseMemory } from "../../drizzle/schema";

const runId = `ai-memory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: number[] = [];
let userSeq = 0;

async function createTestUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  userSeq += 1;
  const openId = `test-${runId}-${userSeq}`;
  await conn.execute(sql`INSERT INTO users (openId, name, email) VALUES (${openId}, ${`AI Memory ${runId}-${userSeq}`}, ${`${runId}-${userSeq}@example.test`})`);
  const [rows] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const id = rows[0]?.id;
  if (!id) throw new Error("failed to create test user");
  createdUserIds.push(id);
  return id;
}

afterAll(async () => {
  const conn = await getDb();
  if (!conn || createdUserIds.length === 0) return;
  await conn.execute(sql`DELETE FROM users WHERE id IN (${sql.join(createdUserIds, sql`, `)})`);
});

beforeEach(() => {
  mockCompleteJson.mockReset();
});

describe("generateConversationSummary", () => {
  it("空訊息陣列：不呼叫模型，直接回傳固定的無有效資訊摘要", async () => {
    const result = await generateConversationSummary([]);
    expect(result).toEqual({ summaryText: NO_MEANINGFUL_INFO_SUMMARY, hasMeaningfulBusinessInfo: false });
    expect(mockCompleteJson).not.toHaveBeenCalled();
  });

  it("有實質內容：回傳模型產生的短摘要，hasMeaningfulBusinessInfo=true", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      summaryText: "銘板製造；老客戶流失、價格競爭；主方向品牌內容；尚未轉交。",
      hasMeaningfulBusinessInfo: true,
    }));
    const result = await generateConversationSummary([
      { role: "user", content: "我是做銘板的，最近老客戶一直流失。" },
    ]);
    expect(result.summaryText).toBe("銘板製造；老客戶流失、價格競爭；主方向品牌內容；尚未轉交。");
    expect(result.hasMeaningfulBusinessInfo).toBe(true);
  });

  it("案例 2：只是寒暄的對話：模型應回傳固定文字，這裡驗證解析邏輯照原樣採用", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      summaryText: NO_MEANINGFUL_INFO_SUMMARY,
      hasMeaningfulBusinessInfo: false,
    }));
    const result = await generateConversationSummary([
      { role: "user", content: "你好" },
      { role: "assistant", content: "你好，有什麼可以幫你的嗎？" },
      { role: "user", content: "隨便看看" },
    ]);
    expect(result.summaryText).toBe(NO_MEANINGFUL_INFO_SUMMARY);
    expect(result.hasMeaningfulBusinessInfo).toBe(false);
  });
});

describe("mergeEnterpriseMemory — 決策樹的四個分支", () => {
  it("既有沒有內容、這次也沒有內容：維持固定的無有效資訊文字，不呼叫模型", async () => {
    const result = await mergeEnterpriseMemory(null, { summaryText: NO_MEANINGFUL_INFO_SUMMARY, hasMeaningfulBusinessInfo: false });
    expect(result).toEqual({ summaryText: NO_MEANINGFUL_INFO_SUMMARY, hasMeaningfulBusinessInfo: false });
    expect(mockCompleteJson).not.toHaveBeenCalled();
  });

  it("既有沒有內容、這次有內容：既有本來是空的，直接採用這次的內容，不呼叫模型", async () => {
    const result = await mergeEnterpriseMemory(null, {
      summaryText: "銘板製造；老客戶流失。",
      hasMeaningfulBusinessInfo: true,
    });
    expect(result).toEqual({ summaryText: "銘板製造；老客戶流失。", hasMeaningfulBusinessInfo: true });
    expect(mockCompleteJson).not.toHaveBeenCalled();
  });

  it("既有有內容、這次沒有內容（CASE 1）：既有內容完全不動，不呼叫模型", async () => {
    const existing = { summaryText: "銘板製造；老客戶流失、價格競爭；品牌內容方向。", hasMeaningfulBusinessInfo: true } as AiEnterpriseMemory;
    const result = await mergeEnterpriseMemory(existing, { summaryText: NO_MEANINGFUL_INFO_SUMMARY, hasMeaningfulBusinessInfo: false });
    expect(result).toEqual({ summaryText: "銘板製造；老客戶流失、價格競爭；品牌內容方向。", hasMeaningfulBusinessInfo: true });
    expect(mockCompleteJson).not.toHaveBeenCalled();
  });

  it("既有有內容、這次也有內容（CASE 2）：呼叫模型語意合併，用新狀態取代過時狀態", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ summaryText: "ERP 已完成。" }));
    const existing = { summaryText: "ERP 已送，完成未知。", hasMeaningfulBusinessInfo: true } as AiEnterpriseMemory;
    const result = await mergeEnterpriseMemory(existing, {
      summaryText: "ERP 已經導入完成。",
      hasMeaningfulBusinessInfo: true,
    });
    expect(mockCompleteJson).toHaveBeenCalledTimes(1);
    expect(result.summaryText).toBe("ERP 已完成。");
    expect(result.summaryText).not.toContain("完成未知"); // 不得同時保留過時、互相矛盾的狀態
    expect(result.hasMeaningfulBusinessInfo).toBe(true);
  });
});

describe("upsertEnterpriseMemory / getEnterpriseMemory", () => {
  it("第一次寫入後可以讀到；第二次寫入是覆寫（同一個 user 只有一筆），不是新增；lastInteractionAt／lastInteractionHadMeaningfulInfo 正確寫入", async () => {
    const userId = await createTestUser();
    await upsertEnterpriseMemory({
      userId, factoryId: null,
      summaryText: "第一版摘要", hasMeaningfulBusinessInfo: true,
      lastInteractionHadMeaningfulInfo: true, sourceConversationId: 1,
    });
    let memory = await getEnterpriseMemory(userId);
    expect(memory?.summaryText).toBe("第一版摘要");
    expect(memory?.lastInteractionHadMeaningfulInfo).toBe(true);
    expect(memory?.lastInteractionAt).toBeInstanceOf(Date);

    await upsertEnterpriseMemory({
      userId, factoryId: null,
      summaryText: "第二版摘要（覆寫）", hasMeaningfulBusinessInfo: true,
      lastInteractionHadMeaningfulInfo: false, sourceConversationId: 2,
    });
    memory = await getEnterpriseMemory(userId);
    expect(memory?.summaryText).toBe("第二版摘要（覆寫）");
    expect(memory?.lastInteractionHadMeaningfulInfo).toBe(false); // 最近一次沒有新資訊，但 summaryText 這裡是測試直接指定覆寫，不透過 merge

    const db = await getDb();
    const rows = await db!.select().from(aiEnterpriseMemories).where(eq(aiEnterpriseMemories.userId, userId));
    expect(rows).toHaveLength(1); // 覆寫，不是新增一筆
  });

  it("沒有任何記錄的 user：getEnterpriseMemory 回傳 null（不是空字串或假資料）", async () => {
    const userId = await createTestUser();
    const memory = await getEnterpriseMemory(userId);
    expect(memory).toBeNull();
  });
});

describe("endConversationAndSummarize — 基本案例 1/2/3/5", () => {
  it("案例 1：第一次使用、有實質內容 → 摘要成功 → Enterprise Memory 存在、原始 conversation/messages 刪除", async () => {
    const userId = await createTestUser();
    const conversation = await createConversation(userId, null);
    await appendMessage(conversation.id, "user", "我是做銘板的，最近老客戶一直流失。");
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      summaryText: "銘板製造；老客戶流失、價格競爭；主方向品牌內容；尚未轉交。",
      hasMeaningfulBusinessInfo: true,
    }));

    const result = await endConversationAndSummarize(conversation);

    expect(result.success).toBe(true);
    const memory = await getEnterpriseMemory(userId);
    expect(memory?.summaryText).toBe("銘板製造；老客戶流失、價格競爭；主方向品牌內容；尚未轉交。");
    expect(memory?.hasMeaningfulBusinessInfo).toBe(true);
    expect(memory?.lastInteractionHadMeaningfulInfo).toBe(true);

    // 案例 5：原文明確刪除，不殘留 orphan data。
    const owned = await getConversationForUser(conversation.id, userId);
    expect(owned).toBeUndefined();
    const messages = await getAllMessages(conversation.id);
    expect(messages).toHaveLength(0);
  });

  it("案例 2：從第一次都沒有透露任何資訊 → 固定文字、hasMeaningfulBusinessInfo=false，原文一樣刪除", async () => {
    const userId = await createTestUser();
    const conversation = await createConversation(userId, null);
    await appendMessage(conversation.id, "user", "你好");
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      summaryText: NO_MEANINGFUL_INFO_SUMMARY,
      hasMeaningfulBusinessInfo: false,
    }));

    const result = await endConversationAndSummarize(conversation);

    expect(result.success).toBe(true);
    const memory = await getEnterpriseMemory(userId);
    expect(memory?.summaryText).toBe(NO_MEANINGFUL_INFO_SUMMARY);
    expect(memory?.hasMeaningfulBusinessInfo).toBe(false);
    expect(memory?.lastInteractionHadMeaningfulInfo).toBe(false);
  });

  it("案例 3：LLM 摘要失敗 → conversation/messages 保留，不得刪除", async () => {
    const userId = await createTestUser();
    const conversation = await createConversation(userId, null);
    await appendMessage(conversation.id, "user", "測試摘要失敗情境");
    mockCompleteJson.mockRejectedValue(new Error("LLM summary boom"));

    const result = await endConversationAndSummarize(conversation);

    expect(result.success).toBe(false);
    const owned = await getConversationForUser(conversation.id, userId);
    expect(owned?.status).toBe("failed");
    const messages = await getAllMessages(conversation.id);
    expect(messages).toHaveLength(1); // 原文還在
  });
});

describe("endConversationAndSummarize — 跨對話 merge/update（新規格必測 CASE 1/2/5）", () => {
  it("CASE 1：既有 Enterprise Memory 有內容，這次對話沒有新資訊 → summaryText 完全不變，只有 lastInteraction* 更新", async () => {
    const userId = await createTestUser();

    // 第一次：真正有企業資訊。
    const first = await createConversation(userId, null);
    await appendMessage(first.id, "user", "我是做銘板的，最近老客戶流失。");
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      summaryText: "銘板製造；老客戶流失。",
      hasMeaningfulBusinessInfo: true,
    }));
    await endConversationAndSummarize(first);
    const afterFirst = await getEnterpriseMemory(userId);
    expect(afterFirst?.summaryText).toBe("銘板製造；老客戶流失。");

    // 第二次：只是打招呼，沒有新資訊。
    const second = await createConversation(userId, null);
    await appendMessage(second.id, "user", "你好，沒事，先這樣。");
    mockCompleteJson.mockReset();
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      summaryText: NO_MEANINGFUL_INFO_SUMMARY,
      hasMeaningfulBusinessInfo: false,
    }));
    const result = await endConversationAndSummarize(second);

    expect(result.success).toBe(true);
    // 既有沒內容分支不呼叫模型合併，這裡只會呼叫一次（產生「這次對話」的摘要）。
    expect(mockCompleteJson).toHaveBeenCalledTimes(1);

    const afterSecond = await getEnterpriseMemory(userId);
    // 核心斷言：真正重要的企業資訊沒有被這次「沒事」的對話洗掉。
    expect(afterSecond?.summaryText).toBe("銘板製造；老客戶流失。");
    expect(afterSecond?.hasMeaningfulBusinessInfo).toBe(true);
    // 但「最近一次互動」本身誠實記錄成沒有新資訊。
    expect(afterSecond?.lastInteractionHadMeaningfulInfo).toBe(false);
  });

  it("CASE 2：既有與新對話都有內容且互相更新 → 合併後只保留最新確定狀態，不留互相矛盾的舊描述", async () => {
    const userId = await createTestUser();

    const first = await createConversation(userId, null);
    await appendMessage(first.id, "user", "ERP 系統已經送出申請，但還不確定完成了沒。");
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      summaryText: "ERP 已送，完成未知。",
      hasMeaningfulBusinessInfo: true,
    }));
    await endConversationAndSummarize(first);

    const second = await createConversation(userId, null);
    await appendMessage(second.id, "user", "跟你說一下，ERP 已經導入完成了。");
    mockCompleteJson.mockReset();
    mockCompleteJson
      .mockResolvedValueOnce(JSON.stringify({ summaryText: "ERP 已完成。", hasMeaningfulBusinessInfo: true })) // generateConversationSummary
      .mockResolvedValueOnce(JSON.stringify({ summaryText: "ERP 已完成。" })); // mergeEnterpriseMemory
    const result = await endConversationAndSummarize(second);

    expect(result.success).toBe(true);
    expect(mockCompleteJson).toHaveBeenCalledTimes(2); // 兩邊都有內容，這次真的需要語意合併

    const memory = await getEnterpriseMemory(userId);
    expect(memory?.summaryText).toBe("ERP 已完成。");
    expect(memory?.summaryText).not.toContain("完成未知"); // 不得同時留下互相矛盾的兩個狀態
    expect(memory?.lastInteractionHadMeaningfulInfo).toBe(true);
  });

  it("CASE 5：最近一次沒有企業資訊，但更早以前的記憶仍然保留，可以被下次對話用來誠實回答", async () => {
    const userId = await createTestUser();

    const first = await createConversation(userId, null);
    await appendMessage(first.id, "user", "我們是做銘板的，主方向是品牌內容。");
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      summaryText: "銘板製造；品牌內容方向。",
      hasMeaningfulBusinessInfo: true,
    }));
    await endConversationAndSummarize(first);

    const second = await createConversation(userId, null);
    await appendMessage(second.id, "user", "隨便看看");
    mockCompleteJson.mockReset();
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      summaryText: NO_MEANINGFUL_INFO_SUMMARY,
      hasMeaningfulBusinessInfo: false,
    }));
    await endConversationAndSummarize(second);

    const memory = await getEnterpriseMemory(userId);
    // 兩層資訊都要能被讀到：最近一次沒有新資訊、但之前仍有銘板相關企業記憶。
    expect(memory?.lastInteractionHadMeaningfulInfo).toBe(false);
    expect(memory?.hasMeaningfulBusinessInfo).toBe(true);
    expect(memory?.summaryText).toBe("銘板製造；品牌內容方向。");
  });
});
