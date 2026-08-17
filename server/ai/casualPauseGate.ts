import { getAiChatProvider, type AiChatMessage } from "./provider";

/**
 * 見對話中「非 OXM 純閒聊收斂機制」二階段設計：一旦對話進入 warned／paused，
 * 就不該再為了判斷「這一輪要不要恢復」而付出完整 Layer 1 診斷的成本（完整
 * 逐字稿 + 企業背景 + 跨對話記憶 + 一大段診斷規則，動輒上萬 token）。這裡是
 * 唯一、極輕量的替代判斷：只丟「這一輪使用者的最新一句話」本身，不帶歷史、
 * 不帶 Service Registry、不帶 Enterprise Memory，用最便宜的模型（見
 * provider.ts 的 "casualPauseGate" layer，預設回退到跟 Action
 * Planner／Composer 一樣的 AI_CHAT_MODEL，不會因為 local 端把 Layer 1/2 換成
 * 更貴的模型就跟著變貴）判斷「這句話有沒有可能」跟 OXM／企業／製造業相關。
 *
 * 刻意保守 fallback（parse 失敗或 API 本身出錯都當作 true）：這裡判斷錯誤的
 * 代價不對稱——錯誤判斷成「不相關」會讓使用者真正的需求被卡在 paused 出不
 * 來，錯誤判斷成「相關」頂多是多跑一次正常的完整 pipeline，代價小得多。
 */
const RESUME_GATE_SYSTEM_PROMPT = `
你只做一件事：判斷這句話是不是「有可能」跟 OXM（台灣的 B2B 製造業媒合平台）、找工廠／供應商、企業經營、製造業現況、政府補助、ERP、認證、品牌行銷、財務優化，或任何請求 OXM 協助的需求相關。

只要有可能相關就回傳 true；只有真的是完全無關的一般生活話題（例如天氣、美食、電影、寵物、心情抒發）才回傳 false。無法判斷、模稜兩可時一律回傳 true。

只回傳一個 JSON object，不要有任何其他文字：
{ "relevant": true/false }
`.trim();

export async function checkOutOfDomainResumeRelevance(latestMessage: string): Promise<boolean> {
  const messages: AiChatMessage[] = [
    { role: "system", content: RESUME_GATE_SYSTEM_PROMPT },
    { role: "user", content: latestMessage },
  ];
  const provider = getAiChatProvider("casualPauseGate");
  try {
    const raw = await provider.completeJson(messages, 30);
    const parsed = JSON.parse(raw);
    return typeof parsed.relevant === "boolean" ? parsed.relevant : true;
  } catch (error) {
    console.error("[casualPauseGate] resume relevance check failed, defaulting to relevant=true (保守 fallback，避免使用者卡在 paused 出不來):", error);
    return true;
  }
}
