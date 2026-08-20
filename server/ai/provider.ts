import OpenAI from "openai";
import { ENV } from "../_core/env";
import { logAiModelCall } from "./aiUsageLogging";

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
   *
   * Phase 12.2（見對話「十六」）：jsonSchema 是選填的第三個參數，只有明確
   * 傳入時才切換成 OpenAI Structured Outputs（response_format:
   * json_schema／strict:true），沒傳就維持原本的 json_object 模式——刻意
   * 只讓 Memory Summary layer 這種需要更高 JSON 有效性保證的呼叫端選用，不
   * 改變 Diagnosis／Routing／ActionPlanner／ResponseComposer／
   * CaseAssessment／CasualPauseGate 這些既有呼叫端的行為。
   */
  completeJson(
    messages: AiChatMessage[],
    maxTokens?: number,
    jsonSchema?: { name: string; schema: Record<string, unknown> }
  ): Promise<string>;
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

/**
 * Phase 10.2 P1（見對話中「九～十二」）：單次 provider 呼叫的逾時上限。原本
 * 完全沒有設定，落到 openai SDK 的 client 端預設值（10 分鐘，還會在逾時後自動
 * retry 最多 2 次）——一次卡住的呼叫可能讓整輪 ai.chat 掛在 server 端將近半小時
 * 都不回應。這裡改用 openai SDK 每次請求都能單獨覆寫的 RequestOptions.timeout
 * （見 node_modules/openai 的 Client.buildRequest／fetchWithTimeout：這個
 * timeout 底層真的接上 AbortController 主動中止 fetch，不是只有呼叫端自己
 * 停止等待的 Promise.race——那種做法只會讓「我們」不等，實際打給 OpenAI 的
 * request 還是會繼續跑、繼續計費）。60 秒是本專案回覆內容的長度上限（見
 * complete() 的 max_tokens=260／completeJson() 的 JSON 輸出）在正常網路條件下
 * 綽綽有餘的量級，遠低於「不能長達 5 分鐘」的上限。
 */
const PROVIDER_TIMEOUT_MS = 60_000;

/** OpenAI SDK 錯誤物件的 status code 對應到簡短分類，不落地完整錯誤訊息／stack（見對話中「九」）。 */
function classifyProviderError(err: unknown): string {
  // 逾時要優先、決定性地判斷（比對 SDK 真正丟出來的 error class／name，不是
  // 對錯誤訊息字串做啟發式猜測）——實測 openai SDK 逾時丟出的
  // APIConnectionTimeoutError，訊息是「Request timed out.」，字面上並不包含
  // "timeout" 這個字，舊版只用 /timeout/i 比對訊息字串的寫法其實抓不到，會
  // 誤落到 unknown_error／provider_error，見「九」。
  if (err instanceof OpenAI.APIConnectionTimeoutError) return "timeout";
  if (err instanceof Error && err.name === "APIConnectionTimeoutError") return "timeout";
  const status = (err as { status?: number })?.status;
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "auth_error";
  if (typeof status === "number" && status >= 500) return "provider_server_error";
  if (err instanceof Error && /empty (reply|JSON reply)/.test(err.message)) return "empty_reply";
  if (err instanceof Error && /time(d)?\s*out/i.test(err.message)) return "timeout";
  return "unknown_error";
}

function extractUsage(usage?: OpenAI.Completions.CompletionUsage) {
  if (!usage) return undefined;
  return {
    inputTokens: usage.prompt_tokens ?? null,
    outputTokens: usage.completion_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
    cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? null,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? null,
  };
}

class OpenAiChatProvider implements AiChatProvider {
  private client: OpenAI;
  private model: string;
  private layer?: AiChatLayer;

  constructor(apiKey: string, model: string, layer?: AiChatLayer) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.layer = layer;
  }

  async complete(messages: AiChatMessage[]): Promise<string> {
    const newParams = usesNewCompletionParams(this.model);
    const startedAt = Date.now();
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        // 預設回覆要短（40～90 個中文字左右，見 routing.ts 的長度規則）；這裡的
        // 上限刻意留一點餘裕給使用者主動要求「詳細說明」的情境，但不能大到讓
        // 模型還是傾向寫長篇分析——同時當作 prompt 指示之外的技術防線。
        ...(newParams ? { max_completion_tokens: 260 } : { temperature: 0.4, max_tokens: 260 }),
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }, { timeout: PROVIDER_TIMEOUT_MS });
      const text = response.choices[0]?.message?.content;
      if (!text || !text.trim()) {
        throw new Error("AI provider returned an empty reply");
      }
      void logAiModelCall({
        layer: this.layer ?? "diagnosis",
        model: this.model,
        provider: "openai",
        latencyMs: Date.now() - startedAt,
        success: true,
        usage: extractUsage(response.usage),
      });
      return text.trim();
    } catch (err) {
      void logAiModelCall({
        layer: this.layer ?? "diagnosis",
        model: this.model,
        provider: "openai",
        latencyMs: Date.now() - startedAt,
        success: false,
        errorCategory: classifyProviderError(err),
      });
      throw err;
    }
  }

  async completeJson(
    messages: AiChatMessage[],
    maxTokens = 500,
    jsonSchema?: { name: string; schema: Record<string, unknown> }
  ): Promise<string> {
    const newParams = usesNewCompletionParams(this.model);
    // 見對話中「OXM AI 模型能力 A/B 測試」：實測發現部分較新模型（推理型）
    // 會把 max_completion_tokens 部分用在內部 reasoning tokens，如果沿用舊版
    // 針對非推理模型抓的 budget（例如 550），有時會整包被 reasoning 吃光、
    // 完全沒有 token 剩給實際要輸出的 JSON 內容，導致回傳空字串。這裡只是
    // 給新參數模型多留一點餘裕，不影響任何 prompt 或呼叫端邏輯。
    const effectiveMaxTokens = newParams ? Math.max(maxTokens * 4, 2000) : maxTokens;
    const startedAt = Date.now();
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        ...(newParams ? { max_completion_tokens: effectiveMaxTokens } : { temperature: 0.2, max_tokens: maxTokens }),
        response_format: jsonSchema
          ? { type: "json_schema", json_schema: { name: jsonSchema.name, strict: true, schema: jsonSchema.schema } }
          : { type: "json_object" },
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }, { timeout: PROVIDER_TIMEOUT_MS });
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
      void logAiModelCall({
        layer: this.layer ?? "diagnosis",
        model: this.model,
        provider: "openai",
        latencyMs: Date.now() - startedAt,
        success: true,
        usage: extractUsage(response.usage),
      });
      return text.trim();
    } catch (err) {
      void logAiModelCall({
        layer: this.layer ?? "diagnosis",
        model: this.model,
        provider: "openai",
        latencyMs: Date.now() - startedAt,
        success: false,
        errorCategory: classifyProviderError(err),
      });
      throw err;
    }
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
// Phase 8.1（見對話中「九」）：caseAssessment／memorySummary／memoryMerge 是
// 純粹為了 usage logging 加的新值，resolveModelForLayer 的 switch 沒有對應
// case、會落到跟「完全不傳 layer」相同的 default（ENV.aiChatModel）——不改變
// 這三個呼叫端原本的模型選擇行為，只是讓它們現在可以標註正確的 log 分類。
export type AiChatLayer =
  | "diagnosis"
  | "routing"
  | "actionPlanner"
  | "responseComposer"
  | "casualPauseGate"
  | "caseAssessment"
  | "memorySummary"
  | "memoryMerge";

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
    return new OpenAiChatProvider(ENV.openaiApiKey, resolveModelForLayer(layer), layer);
  }
  throw new Error(`不支援的 AI_CHAT_PROVIDER: ${ENV.aiChatProvider}`);
}
