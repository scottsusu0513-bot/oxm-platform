import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { INDUSTRY_OPTIONS, INDUSTRIES } from '../shared/constants';
import { getDb } from './db';
import { searchCache, aiSearchIntents } from '../drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { ENV } from './_core/env';
import { getCurrentAiCallContext } from './ai/aiCallContext';
import { logAiModelCall } from './ai/aiUsageLogging';

// ===== 舊版 Anthropic 快取（保留，enhanceSearchKeyword 仍可用）=====
const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' });
const memCache = new Map<string, string>();
const isLegacyEnabled = () => !!process.env.ANTHROPIC_API_KEY;

export async function enhanceSearchKeyword(keyword: string): Promise<string> {
  if (!keyword.trim()) return keyword;
  if (!isLegacyEnabled()) return keyword;

  const key = keyword.toLowerCase().trim().slice(0, 100);
  if (memCache.has(key)) return memCache.get(key)!;

  try {
    const db = await getDb();
    if (db) {
      const [row] = await db.select().from(searchCache).where(eq(searchCache.keyword, key));
      if (row) { memCache.set(key, row.enhanced); return row.enhanced; }
    }
  } catch { /* fallback */ }

  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('AI timeout')), 5000)
    );
    const response = await Promise.race([
      anthropicClient.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: `你是台灣製造業搜尋助手。用戶搜尋了「${key}」。
可用的產業分類有：${INDUSTRY_OPTIONS.join('、')}
請判斷用戶想找的是什麼，回傳最適合的搜尋詞。規則：
1. 如果關鍵字已經是產業名稱或工廠名稱，直接回傳原始關鍵字
2. 如果是產業的同義詞（例如「衣服」→「紡織」），回傳對應的產業名稱
3. 如果是產品名稱（例如「螺絲」→「金屬加工」），回傳對應的產業名稱
4. 如果無法對應到特定產業，回傳原始關鍵字
只回傳搜尋詞本身，不要有任何解釋或標點符號。`,
        }],
      }),
      timeout,
    ]);
    const enhanced = (response.content[0] as any).text?.trim() ?? keyword;
    memCache.set(key, enhanced);
    getDb().then(db => {
      if (!db) return;
      db.insert(searchCache).values({ keyword: key, enhanced })
        .onDuplicateKeyUpdate({ set: { enhanced } }).catch(() => {});
    });
    return enhanced;
  } catch (error) {
    console.error('[SemanticSearch] AI 呼叫失敗，使用原始關鍵字:', error);
    return keyword;
  }
}

// ===== 新版 AI 搜尋意圖 =====

export interface AISearchIntent {
  normalizedQuery:  string;
  mainIndustries:   string[];
  subIndustries:    string[];
  productKeywords:  string[];
  searchSynonyms:   string[];
  confidence:       number;
}

const memIntentCache = new Map<string, AISearchIntent>();

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

function parseAndValidateIntent(raw: string, normalizedQuery: string): AISearchIntent {
  const parsed = JSON.parse(raw);
  return {
    normalizedQuery,
    mainIndustries:  (parsed.mainIndustries  ?? []).filter((s: unknown) => typeof s === 'string' && ALL_MAIN_INDUSTRIES.includes(s)),
    subIndustries:   (parsed.subIndustries   ?? []).filter((s: unknown) => typeof s === 'string' && ALL_SUB_INDUSTRIES.includes(s)),
    productKeywords: (parsed.productKeywords ?? []).slice(0, 5).map(String),
    searchSynonyms:  (parsed.searchSynonyms  ?? []).slice(0, 3).map(String),
    confidence:      Math.max(0, Math.min(1, Number(parsed.confidence ?? 0))),
  };
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
async function resolveSearchIntentWithOpenAI(key: string): Promise<AISearchIntent> {
  const client = new OpenAI({ apiKey: ENV.openaiApiKey });
  const startedAt = Date.now();
  const shouldLog = getCurrentAiCallContext() !== undefined;
  try {
    const response = await client.chat.completions.create({
      model:           ENV.aiSearchModel,
      max_tokens:      250,
      temperature:     0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: buildIntentPrompt(key) }],
    });
    const text = response.choices[0]?.message?.content ?? '{}';
    const result = parseAndValidateIntent(text, key);
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

export async function getSearchIntent(keyword: string): Promise<AISearchIntent | null> {
  if (!isIntentEnabled()) return null;

  const key = keyword.toLowerCase().trim().slice(0, 80);
  if (!key) return null;

  // 1. 記憶體快取
  if (memIntentCache.has(key)) return memIntentCache.get(key)!;

  // 2. DB 快取
  try {
    const db = await getDb();
    if (db) {
      const [row] = await db.select().from(aiSearchIntents).where(eq(aiSearchIntents.normalizedQuery, key));
      if (row) {
        const intent: AISearchIntent = {
          normalizedQuery:  row.normalizedQuery,
          mainIndustries:   row.mainIndustries,
          subIndustries:    row.subIndustries,
          productKeywords:  row.productKeywords,
          searchSynonyms:   row.searchSynonyms,
          confidence:       Number(row.confidence),
        };
        memIntentCache.set(key, intent);
        // 非同步更新命中計數
        getDb().then(db2 => {
          if (!db2) return;
          db2.update(aiSearchIntents)
            .set({ hitCount: sql`${aiSearchIntents.hitCount} + 1`, lastUsedAt: new Date() })
            .where(eq(aiSearchIntents.normalizedQuery, key))
            .catch(() => {});
        });
        return intent;
      }
    }
  } catch { /* DB 失敗繼續呼叫 AI */ }

  // 3. 呼叫 AI（1500ms timeout）
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('AI intent timeout')), 2500)
    );

    let resolvePromise: Promise<AISearchIntent>;
    if (ENV.aiSearchProvider === 'openai') {
      resolvePromise = resolveSearchIntentWithOpenAI(key);
    } else {
      return null;
    }

    const intent = await Promise.race([resolvePromise, timeout]);
    memIntentCache.set(key, intent);

    // 非同步寫入 DB
    getDb().then(db => {
      if (!db) return;
      db.insert(aiSearchIntents).values({
        normalizedQuery:  key,
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
          hitCount:        sql`${aiSearchIntents.hitCount} + 1`,
          lastUsedAt:      new Date(),
        },
      }).catch(() => {});
    });

    return intent;
  } catch (err) {
    console.error('[AISearch] intent resolve failed, falling back:', (err as Error).message);
    return null;
  }
}
