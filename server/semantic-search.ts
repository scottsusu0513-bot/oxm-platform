import OpenAI from 'openai';
import { INDUSTRIES } from '../shared/constants';
import { getDb } from './db';
import { aiSearchIntents } from '../drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { ENV } from './_core/env';
import { getCurrentAiCallContext } from './ai/aiCallContext';
import { logAiModelCall } from './ai/aiUsageLogging';
import { BoundedLruCache } from './boundedLruCache';

// ===== AI 搜尋意圖 =====
//
// Batch 3.6：舊版 Anthropic enhanceSearchKeyword（與 searchCache 資料表的讀寫）
// 已移除——factory.search 自 Batch 3.2 起不再呼叫，正式站 searchCache 為 0 筆。
// searchCache 資料表本身保留（不做 migration）。

export interface AISearchIntent {
  normalizedQuery:  string;
  mainIndustries:   string[];
  subIndustries:    string[];
  productKeywords:  string[];
  searchSynonyms:   string[];
  confidence:       number;
}

const ALL_MAIN_INDUSTRIES: string[] = INDUSTRIES.map(i => i.name as string);
const ALL_SUB_INDUSTRIES: string[]  = INDUSTRIES.flatMap(i => (i.sub as readonly string[]).slice());

function buildIntentPrompt(key: string): string {
  const subsByMain = INDUSTRIES.map(i => `${i.name}：${i.sub.join('、')}`).join('\n');
  return `你是 OXM 台灣製造業搜尋平台的搜尋意圖分析助手。

使用者搜尋了：「${key}」

OXM 平台上的主產業分類（僅限以下選項）：
${ALL_MAIN_INDUSTRIES.join('、')}

各主產業的子分類：
${subsByMain}

請分析使用者搜尋意圖，只回傳以下 JSON，不要有任何多餘文字：
{
  "normalizedQuery": "標準化後的查詢詞",
  "mainIndustries": ["主產業"],
  "subIndustries": ["子分類1", "子分類2"],
  "productKeywords": ["關鍵字1", "近義詞1"],
  "searchSynonyms": ["同義詞"],
  "confidence": 0.85
}

規則：
1. mainIndustries、subIndustries 只能使用上方列出的選項，禁止自創
2. 若無法對應到任何產業，mainIndustries 回傳空陣列，confidence 設 0.3 以下
3. productKeywords 可包含近義詞（例如「襪子」→「短襪、長襪、機能襪」），最多 5 個
4. mainIndustries 最多 2 個，subIndustries 最多 3 個，searchSynonyms 最多 3 個
5. 只回傳 JSON`;
}

/** OpenAI 回應不是可用的 intent JSON（JSON 解析失敗或結構不對）。 */
export class InvalidSearchIntentOutputError extends Error {
  constructor(message: string) { super(message); this.name = 'InvalidSearchIntentOutputError'; }
}

function parseAndValidateIntent(raw: string, normalizedQuery: string): AISearchIntent {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('intent output is not a JSON object');
  return {
    normalizedQuery,
    mainIndustries:  (parsed.mainIndustries  ?? []).filter((s: unknown) => typeof s === 'string' && ALL_MAIN_INDUSTRIES.includes(s)),
    subIndustries:   (parsed.subIndustries   ?? []).filter((s: unknown) => typeof s === 'string' && ALL_SUB_INDUSTRIES.includes(s)),
    productKeywords: (parsed.productKeywords ?? []).slice(0, 5).map(String),
    searchSynonyms:  (parsed.searchSynonyms  ?? []).slice(0, 3).map(String),
    confidence:      Math.max(0, Math.min(1, Number(parsed.confidence ?? 0))),
  };
}

// ── 快取身分與新鮮度（Batch 3.6）───────────────────────────────────────
//
// 快取身分＝`${SEARCH_INTENT_CACHE_VERSION}:${normalizedQuery}`（存在
// aiSearchIntents.normalizedQuery 欄位）。prompt／model／產業分類／intent 結構有
// 語意變更時，把版本往上加即可讓舊結果自然失效——舊版本的 DB rows 不刪、不做
// migration，只是不再被命中。刻意不用部署 hash（每次部署都讓全部快取失效）。
export const SEARCH_INTENT_CACHE_VERSION = 'v2';
/** 信心 ≥ 此值的 intent 才會讓搜尋進入 AI mode（見 server/db.ts searchFactories）。 */
export const SEARCH_INTENT_LOW_CONFIDENCE_THRESHOLD = 0.5;
export const SEARCH_INTENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SEARCH_INTENT_LOW_CONFIDENCE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SEARCH_INTENT_MEMORY_CACHE_MAX_ENTRIES = 1000;

export function searchIntentCacheIdentity(normalizedKey: string): string {
  return `${SEARCH_INTENT_CACHE_VERSION}:${normalizedKey}`;
}

export function searchIntentTtlMs(confidence: number): number {
  return confidence >= SEARCH_INTENT_LOW_CONFIDENCE_THRESHOLD ? SEARCH_INTENT_TTL_MS : SEARCH_INTENT_LOW_CONFIDENCE_TTL_MS;
}

/** 以「最後一次真正解析出這個 intent 的時間」判斷是否仍在 TTL 內。 */
export function isSearchIntentFresh(resolvedAt: Date, confidence: number, now: number = Date.now()): boolean {
  const t = resolvedAt.getTime();
  return Number.isFinite(t) && now - t < searchIntentTtlMs(confidence);
}

// 行程內記憶體快取：有上限的 LRU，每筆帶自己的到期時間（DB 快取不受影響）。
const memIntentCache = new BoundedLruCache<string, { intent: AISearchIntent; expiresAt: number }>(SEARCH_INTENT_MEMORY_CACHE_MAX_ENTRIES);

// ── OpenAI client（行程內共用；只有 API key 變更時才重建）──────────────
let openAiClient: { apiKey: string; client: OpenAI } | null = null;
function getOpenAiClient(): OpenAI {
  if (!openAiClient || openAiClient.apiKey !== ENV.openaiApiKey) {
    openAiClient = { apiKey: ENV.openaiApiKey, client: new OpenAI({ apiKey: ENV.openaiApiKey }) };
  }
  return openAiClient.client;
}

/**
 * Phase 8.1（見對話中「provider instrumentation」）：這個 client 跟
 * provider.ts 的 OpenAiChatProvider 是完全獨立的第二條 LLM 路徑（AI Shell
 * 的 factory search 語意排序步驟＋公開 /search 頁的關鍵字強化都會走到這
 * 裡）。只有在 AI Shell 的 chatService.ts 已經用 runWithAiCallContext 包住
 * 呼叫鏈時才記錄 usage（getCurrentAiCallContext() 有值）——公開 /search 頁
 * 直接呼叫 getSearchIntent()，沒有包 ambient context，不應該產生任何
 * aiModelCalls row（不是「用 null 歸屬」，是完全不記）。
 */
async function resolveSearchIntentWithOpenAI(key: string, signal: AbortSignal): Promise<AISearchIntent> {
  const client = getOpenAiClient();
  const startedAt = Date.now();
  const shouldLog = getCurrentAiCallContext() !== undefined;
  try {
    // 只限搜尋 intent 這個請求（不動任何共用 client）：signal 由
    // resolveSearchIntent 的唯一 deadline 控制，到期時真的中止底層 HTTP
    // 請求；maxRetries: 0——可 fallback 的非交易型請求，SDK 預設的 2 次自動
    // 重試與短 deadline 不相容（見 Batch 3.2）。
    const response = await client.chat.completions.create({
      model:           ENV.aiSearchModel,
      max_tokens:      250,
      temperature:     0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: buildIntentPrompt(key) }],
    }, { signal, maxRetries: 0 });
    const text = response.choices[0]?.message?.content ?? '{}';
    let result: AISearchIntent;
    try {
      result = parseAndValidateIntent(text, key);
    } catch (parseErr) {
      throw new InvalidSearchIntentOutputError((parseErr as Error).message);
    }
    if (shouldLog) {
      void logAiModelCall({
        layer: 'factorySemantic',
        model: ENV.aiSearchModel,
        provider: 'openai',
        latencyMs: Date.now() - startedAt,
        success: true,
        usage: response.usage
          ? {
              inputTokens: response.usage.prompt_tokens ?? null,
              outputTokens: response.usage.completion_tokens ?? null,
              totalTokens: response.usage.total_tokens ?? null,
              cachedInputTokens: response.usage.prompt_tokens_details?.cached_tokens ?? null,
              reasoningTokens: response.usage.completion_tokens_details?.reasoning_tokens ?? null,
            }
          : undefined,
      });
    }
    return result;
  } catch (err) {
    if (shouldLog) {
      void logAiModelCall({
        layer: 'factorySemantic',
        model: ENV.aiSearchModel,
        provider: 'openai',
        latencyMs: Date.now() - startedAt,
        success: false,
        errorCategory: 'unknown_error',
      });
    }
    throw err;
  }
}

function isIntentEnabled(): boolean {
  if (ENV.aiSearchProvider === 'disabled') return false;
  if (ENV.aiSearchProvider === 'openai')    return !!ENV.openaiApiKey;
  if (ENV.aiSearchProvider === 'anthropic') return !!process.env.ANTHROPIC_API_KEY;
  return false;
}

/**
 * 搜尋 intent 的 AI 硬期限（Batch 3.2）。唯一的 deadline 擁有者：到期時用
 * AbortController 真的中止 OpenAI HTTP 請求（不是只停止等待），timer 一律清除。
 * 3.5s 的理由見 Batch 3.2 報告：本機實測冷呼叫 p90 約 3.4s，2.5s 會讓約兩成
 * 冷查詢 timeout，而 timeout 的結果不會被快取、同一個查詢就會一直慢。
 */
export const SEARCH_INTENT_DEADLINE_MS = 3500;

/** 只供 server 內部 log／測試，不對外公開。 */
export type SearchIntentOutcome =
  | 'memory_cache_hit' | 'db_cache_hit' | 'success'
  | 'timeout' | 'provider_error' | 'invalid_output' | 'disabled'
  | 'provider_unavailable';

type ProviderResult = { intent: AISearchIntent | null; outcome: SearchIntentOutcome };

// ── Provider 故障保護（Batch 3.6）──────────────────────────────────────
//
// OpenAI 故障時，每一次 HYBRID／SEMANTIC 搜尋都要等滿 3.5s 才 fallback。連續
// FAILURE_SHIELD_THRESHOLD 次「provider 明確不可用」（timeout／連線失敗／5xx）
// 後，FAILURE_SHIELD_WINDOW_MS 內直接略過 provider、用原始 keyword 搜尋（跟
// timeout 的 fallback 結果完全相同）。刻意要連續多次才打開：Batch 3.2 實測冷呼叫
// p90 約 3.4s，單一慢查詢 timeout 不應該讓所有人 30 秒內都用不到 AI。4xx
// （金鑰／設定錯誤）與格式錯誤不計入、不打開保護，真正的設定錯誤照樣每次都會
// 出現在 log。成功一次就重置。窗口固定、不延長；只用時間戳，不留任何 timer。
export const FAILURE_SHIELD_THRESHOLD = 3;
export const FAILURE_SHIELD_WINDOW_MS = 30_000;
let consecutiveProviderFailures = 0;
let failureShieldUntil = 0;

function isProviderUnavailableError(err: unknown, aborted: boolean): boolean {
  if (aborted) return true;
  const e = err as { name?: unknown; status?: unknown } | null;
  if (e?.name === 'APIConnectionError' || e?.name === 'APIConnectionTimeoutError') return true;
  return typeof e?.status === 'number' && e.status >= 500;
}

function recordProviderFailure(err: unknown, aborted: boolean): void {
  if (!isProviderUnavailableError(err, aborted)) return;
  consecutiveProviderFailures += 1;
  if (consecutiveProviderFailures >= FAILURE_SHIELD_THRESHOLD) {
    failureShieldUntil = Date.now() + FAILURE_SHIELD_WINDOW_MS;
    consecutiveProviderFailures = 0;
  }
}

function isFailureShieldOpen(): boolean {
  return Date.now() < failureShieldUntil;
}

// ── 相同請求合併（Batch 3.6）──────────────────────────────────────────
//
// prompt 唯一的變數就是 normalized key，所以「key 相同」＝「送給 OpenAI 的請求
// 相同」，不同 keyword／篩選條件／搜尋模式不會被合併。只合併「沒有 AI 呼叫
// context」的請求（公開 /search）：AI 助理的呼叫帶 usage 歸屬 context，共用別人
// 的 provider 呼叫會讓 usage 記在錯的對話上，因此一律獨立呼叫。完成或失敗都在
// finally 移除，Map 不會累積。
const inFlightIntentRequests = new Map<string, Promise<ProviderResult>>();

/** 真正呼叫 provider 一次：deadline、故障保護計數、成功時寫入快取。 */
async function callProviderOnce(key: string): Promise<ProviderResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_INTENT_DEADLINE_MS);
  const startedAt = Date.now();
  let intent: AISearchIntent;
  try {
    intent = await resolveSearchIntentWithOpenAI(key, controller.signal);
  } catch (err) {
    const aborted = controller.signal.aborted;
    const outcome: SearchIntentOutcome = aborted
      ? 'timeout'
      : err instanceof InvalidSearchIntentOutputError ? 'invalid_output' : 'provider_error';
    recordProviderFailure(err, aborted);
    console.warn(`[AISearch] intent ${outcome} after ${Date.now() - startedAt}ms, falling back to keyword search`);
    return { intent: null, outcome };
  } finally {
    clearTimeout(timer);
  }

  consecutiveProviderFailures = 0;
  failureShieldUntil = 0;
  memIntentCache.set(key, { intent, expiresAt: Date.now() + searchIntentTtlMs(intent.confidence) });

  // 非同步寫入 DB（只有真正成功的 intent 才會走到這裡）。updatedAt 明確設為現在：
  // 它代表「最後一次真正解析的時間」，是新鮮度判斷的依據。
  const identity = searchIntentCacheIdentity(key);
  getDb().then(db => {
    if (!db) return;
    db.insert(aiSearchIntents).values({
      normalizedQuery:  identity,
      mainIndustries:   intent.mainIndustries,
      subIndustries:    intent.subIndustries,
      productKeywords:  intent.productKeywords,
      searchSynonyms:   intent.searchSynonyms,
      confidence:       String(intent.confidence),
      aiProvider:       ENV.aiSearchProvider,
      aiModel:          ENV.aiSearchModel,
    }).onDuplicateKeyUpdate({
      set: {
        mainIndustries:  intent.mainIndustries,
        subIndustries:   intent.subIndustries,
        productKeywords: intent.productKeywords,
        searchSynonyms:  intent.searchSynonyms,
        confidence:      String(intent.confidence),
        aiProvider:      ENV.aiSearchProvider,
        aiModel:         ENV.aiSearchModel,
        hitCount:        sql`${aiSearchIntents.hitCount} + 1`,
        lastUsedAt:      new Date(),
        updatedAt:       new Date(),
      },
    }).catch(() => {});
  }).catch(() => {});

  return { intent, outcome: 'success' };
}

export async function getSearchIntent(keyword: string): Promise<AISearchIntent | null> {
  return (await resolveSearchIntent(keyword)).intent;
}

/**
 * 取得搜尋 intent 並回報結果類別。timeout／provider error（含 429／5xx／網路）
 * ／invalid output／故障保護中 一律回傳 intent=null，呼叫端直接用原始 keyword
 * 走既有非 AI 搜尋；失敗時不寫任何 intent 快取。
 */
export async function resolveSearchIntent(keyword: string): Promise<ProviderResult> {
  if (!isIntentEnabled()) return { intent: null, outcome: 'disabled' };

  const key = keyword.toLowerCase().trim().slice(0, 80);
  if (!key) return { intent: null, outcome: 'disabled' };

  // 1. 記憶體快取（有上限的 LRU，過期即丟棄）
  const memHit = memIntentCache.get(key);
  if (memHit) {
    if (memHit.expiresAt > Date.now()) return { intent: memHit.intent, outcome: 'memory_cache_hit' };
    memIntentCache.delete(key);
  }

  // 2. DB 快取（同版本且仍在 TTL 內才算命中；過期的 row 不刪，成功後由 upsert 更新）
  const identity = searchIntentCacheIdentity(key);
  try {
    const db = await getDb();
    if (db) {
      const [row] = await db.select().from(aiSearchIntents).where(eq(aiSearchIntents.normalizedQuery, identity));
      if (row) {
        const confidence = Number(row.confidence);
        const resolvedAt = new Date(row.updatedAt);
        if (isSearchIntentFresh(resolvedAt, confidence)) {
          const intent: AISearchIntent = {
            normalizedQuery:  key,
            mainIndustries:   row.mainIndustries,
            subIndustries:    row.subIndustries,
            productKeywords:  row.productKeywords,
            searchSynonyms:   row.searchSynonyms,
            confidence,
          };
          memIntentCache.set(key, { intent, expiresAt: resolvedAt.getTime() + searchIntentTtlMs(confidence) });
          // 非同步更新命中計數。updatedAt 明確保留原值：這欄有 ON UPDATE
          // CURRENT_TIMESTAMP，不保留的話每次命中都會把新鮮度往後延，熱門查詢
          // 就永遠不會過期。
          getDb().then(db2 => {
            if (!db2) return;
            db2.update(aiSearchIntents)
              .set({ hitCount: sql`${aiSearchIntents.hitCount} + 1`, lastUsedAt: new Date(), updatedAt: sql`${aiSearchIntents.updatedAt}` })
              .where(eq(aiSearchIntents.normalizedQuery, identity))
              .catch(() => {});
          }).catch(() => {});
          return { intent, outcome: 'db_cache_hit' };
        }
      }
    }
  } catch { /* DB 失敗繼續呼叫 AI */ }

  if (ENV.aiSearchProvider !== 'openai') return { intent: null, outcome: 'disabled' };

  // 3. 故障保護中：直接 fallback（不打 provider）
  if (isFailureShieldOpen()) return { intent: null, outcome: 'provider_unavailable' };

  // 4. 呼叫 AI（公開搜尋的相同 key 併發請求共用同一次 provider 呼叫）
  if (getCurrentAiCallContext() !== undefined) return callProviderOnce(key);
  const existing = inFlightIntentRequests.get(key);
  if (existing) return existing;
  const request = callProviderOnce(key).finally(() => {
    if (inFlightIntentRequests.get(key) === request) inFlightIntentRequests.delete(key);
  });
  inFlightIntentRequests.set(key, request);
  return request;
}

/** 測試用：重置行程內狀態（記憶體快取、in-flight、故障保護）。 */
export function __resetSearchIntentStateForTests(): void {
  memIntentCache.clear();
  inFlightIntentRequests.clear();
  consecutiveProviderFailures = 0;
  failureShieldUntil = 0;
  openAiClient = null;
}

/** 測試用：目前的行程內狀態。 */
export function __getSearchIntentStateForTests() {
  return {
    memoryCacheSize: memIntentCache.size,
    inFlight: inFlightIntentRequests.size,
    failureShieldOpen: isFailureShieldOpen(),
    consecutiveProviderFailures,
  };
}
