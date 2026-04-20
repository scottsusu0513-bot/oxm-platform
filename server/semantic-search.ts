import Anthropic from '@anthropic-ai/sdk';
import { INDUSTRY_OPTIONS } from '../shared/constants';
import { getDb } from './db';
import { searchCache } from '../drizzle/schema';
import { eq } from 'drizzle-orm';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? '',
});

// 記憶體快取：避免同一請求週期內重複查 DB
const memCache = new Map<string, string>();

const isEnabled = () => !!process.env.ANTHROPIC_API_KEY;

export async function enhanceSearchKeyword(keyword: string): Promise<string> {
  if (!keyword.trim()) return keyword;
  if (!isEnabled()) return keyword;

  // 截斷超長輸入，避免帶入過多 token
  const key = keyword.toLowerCase().trim().slice(0, 100);

  // 1. 記憶體快取
  if (memCache.has(key)) return memCache.get(key)!;

  // 2. DB 持久化快取
  try {
    const db = await getDb();
    if (db) {
      const [row] = await db.select().from(searchCache).where(eq(searchCache.keyword, key));
      if (row) {
        memCache.set(key, row.enhanced);
        return row.enhanced;
      }
    }
  } catch {
    // DB 查詢失敗不影響搜尋，繼續往下
  }

  // 3. 呼叫 AI API（5 秒 timeout，超時 fallback 原始關鍵字）
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('AI timeout')), 5000)
    );
    const response = await Promise.race([
      client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content: `你是台灣製造業搜尋助手。用戶搜尋了「${key}」。

可用的產業分類有：${INDUSTRY_OPTIONS.join('、')}

請判斷用戶想找的是什麼，回傳最適合的搜尋詞。規則：
1. 如果關鍵字已經是產業名稱或工廠名稱，直接回傳原始關鍵字
2. 如果是產業的同義詞（例如「衣服」→「紡織」），回傳對應的產業名稱
3. 如果是產品名稱（例如「螺絲」→「金屬加工」），回傳對應的產業名稱
4. 如果無法對應到特定產業，回傳原始關鍵字

只回傳搜尋詞本身，不要有任何解釋或標點符號。`,
          },
        ],
      }),
      timeout,
    ]);

    const enhanced = (response.content[0] as any).text?.trim() ?? keyword;

    // 寫入記憶體快取
    memCache.set(key, enhanced);

    // 寫入 DB 持久化快取（非同步，不阻塞回應）
    getDb().then(db => {
      if (!db) return;
      db.insert(searchCache).values({ keyword: key, enhanced })
        .onDuplicateKeyUpdate({ set: { enhanced } })
        .catch(() => {});
    });

    return enhanced;
  } catch (error) {
    console.error('[SemanticSearch] AI 呼叫失敗，使用原始關鍵字:', error);
    return keyword;
  }
}
