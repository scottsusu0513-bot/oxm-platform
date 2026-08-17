import OpenAI from "openai";
import { ENV } from "../_core/env";

/**
 * OXM AI（企業需求診斷與資源分流）用的最小 provider 介面。
 *
 * 刻意只定義「傳一串 role/content 訊息進去、拿一段文字回來」這件事——不影射
 * 任何特定廠商的 SDK 形狀，讓 chatService.ts 等呼叫端完全不需要知道底層是
 * OpenAI、Anthropic 或其他供應商。Phase 1 只實作 OpenAI 一種，但要換供應商
 * 時只需要新增一個實作這個介面的 class 並在 getAiChatProvider() 切換，不需要
 *改動任何呼叫端程式碼。
 */
export type AiChatRole = "system" | "user" | "assistant";

export interface AiChatMessage {
  role: AiChatRole;
  content: string;
}

export interface AiChatProvider {
  complete(messages: AiChatMessage[]): Promise<string>;
  /**
   * 跟 complete() 一樣，但要求模型回傳單一 JSON object（OpenAI 的
   * response_format: json_object），呼叫端自己負責 parse／驗證欄位——這裡不
   * 綁死特定的 schema 形狀，讓 Layer 1 診斷／Layer 2 資源分流可以共用同一個
   * provider 方法，各自定義自己的 JSON 結構。
   */
  completeJson(messages: AiChatMessage[], maxTokens?: number): Promise<string>;
}

/**
 * 見對話中「OXM AI 模型能力 A/B 測試」：較新一代的 OpenAI 模型（本專案目前
 * 已知 gpt-5 系列）不接受 `max_tokens`／自訂 `temperature` 這兩個參數（實測
 * 直接 400——`max_tokens` 要求改用 `max_completion_tokens`，`temperature`
 * 只接受預設值 1）。這純粹是「怎麼發送這次 API 請求」的技術參數差異，不影響
 * prompt 內容、不影響任何業務邏輯，所以用一個很窄的 model 字串判斷處理，不是
 * 為了 A/B 測試新增一套平行的 provider 或改變任何呼叫端介面——完全不支援自訂
 * temperature 的模型，其餘行為（JSON mode、訊息格式）不變。
 */
function usesNewCompletionParams(model: string): boolean {
  return /^gpt-5/.test(model);
}

class OpenAiChatProvider implements AiChatProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async complete(messages: AiChatMessage[]): Promise<string> {
    const newParams = usesNewCompletionParams(this.model);
    const response = await this.client.chat.completions.create({
      model: this.model,
      // 預設回覆要短（40～90 個中文字左右，見 routing.ts 的長度規則）；這裡的
      // 上限刻意留一點餘裕給使用者主動要求「詳細說明」的情境，但不能大到讓
      // 模型還是傾向寫長篇分析——同時當作 prompt 指示之外的技術防線。
      ...(newParams ? { max_completion_tokens: 260 } : { temperature: 0.4, max_tokens: 260 }),
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });
    const text = response.choices[0]?.message?.content;
    if (!text || !text.trim()) {
      throw new Error("AI provider returned an empty reply");
    }
    return text.trim();
  }

  async completeJson(messages: AiChatMessage[], maxTokens = 500): Promise<string> {
    const newParams = usesNewCompletionParams(this.model);
    // 見對話中「OXM AI 模型能力 A/B 測試」：實測發現部分較新模型（推理型）
    // 會把 max_completion_tokens 部分用在內部 reasoning tokens，如果沿用舊版
    // 針對非推理模型抓的 budget（例如 550），有時會整包被 reasoning 吃光、
    // 完全沒有 token 剩給實際要輸出的 JSON 內容，導致回傳空字串。這裡只是
    // 給新參數模型多留一點餘裕，不影響任何 prompt 或呼叫端邏輯。
    const effectiveMaxTokens = newParams ? Math.max(maxTokens * 4, 2000) : maxTokens;
    const response = await this.client.chat.completions.create({
      model: this.model,
      ...(newParams ? { max_completion_tokens: effectiveMaxTokens } : { temperature: 0.2, max_tokens: maxTokens }),
      response_format: { type: "json_object" },
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });
    if (response.usage) {
      // 開發期用的成本可視性 log，不影響正式回覆內容；兩層架構每輪對話會呼叫
      // 兩次 completeJson，方便驗收時觀察實際 token 用量與單層版本的差異。
      console.debug(
        `[ai:completeJson] tokens prompt=${response.usage.prompt_tokens} completion=${response.usage.completion_tokens} total=${response.usage.total_tokens}`
      );
    }
    const text = response.choices[0]?.message?.content;
    if (!text || !text.trim()) {
      throw new Error(
        `AI provider returned an empty JSON reply (model=${this.model}, finish_reason=${response.choices[0]?.finish_reason}, usage=${JSON.stringify(response.usage)})`
      );
    }
    return text.trim();
  }
}

export function isAiChatConfigured(): boolean {
  return ENV.aiChatProvider === "openai" && !!ENV.openaiApiKey;
}

/**
 * 見對話中「本機模型配置改成 Terra」：四個步驟（Layer 1 診斷／Layer 2 資源
 * 分流／Action Planner／Final Response Composer）現在可以各自獨立指定模型
 * （AI_DIAGNOSIS_MODEL／AI_ROUTING_MODEL／AI_ACTION_PLANNER_MODEL／
 * AI_RESPONSE_COMPOSER_MODEL，見 server/_core/env.ts），不是粗暴地把
 * AI_CHAT_MODEL 全部一起換掉。呼叫端（diagnosis.ts／routing.ts／
 * actionPlanner.ts／responseComposer.ts）各自傳自己的 layer 字串；不傳（或
 * 未來新增呼叫端忘記傳）時安全回退到 ENV.aiChatModel，維持改版前的行為，不
 * 會因為漏傳而意外用錯模型或噴錯。
 */
export type AiChatLayer = "diagnosis" | "routing" | "actionPlanner" | "responseComposer" | "casualPauseGate";

function resolveModelForLayer(layer?: AiChatLayer): string {
  switch (layer) {
    case "diagnosis": return ENV.aiDiagnosisModel;
    case "routing": return ENV.aiRoutingModel;
    case "actionPlanner": return ENV.aiActionPlannerModel;
    case "responseComposer": return ENV.aiResponseComposerModel;
    case "casualPauseGate": return ENV.aiCasualPauseGateModel;
    default: return ENV.aiChatModel;
  }
}

export function getAiChatProvider(layer?: AiChatLayer): AiChatProvider {
  if (ENV.aiChatProvider === "openai") {
    if (!ENV.openaiApiKey) {
      throw new Error(
        "OPENAI_API_KEY 未設定，OXM AI 對話功能無法使用（僅伺服器端讀取，不會出現在前端 bundle）"
      );
    }
    return new OpenAiChatProvider(ENV.openaiApiKey, resolveModelForLayer(layer));
  }
  throw new Error(`不支援的 AI_CHAT_PROVIDER: ${ENV.aiChatProvider}`);
}
