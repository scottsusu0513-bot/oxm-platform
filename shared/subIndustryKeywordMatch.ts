/**
 * 應用層「精準 taxonomy mapping」：把使用者輸入的關鍵字對應回
 * `factories.subIndustry` 實際儲存的完整複合 taxonomy 值（見對話中
 * 「subIndustry read-only audit」）。
 *
 * 背景：`factories.subIndustry`（JSON string array）實際存的是
 * `shared/constants.ts` `INDUSTRIES[].sub` 的**完整複合字串**，例如
 * `"線束 / 線組加工"`、`"CNC加工 / 精密加工"`——不是拆開後的原子詞。用
 * `JSON_CONTAINS(subIndustry, ["線束"])` 這種 DB 層「exact 陣列成員比對」
 * 完全找不到任何資料（因為陣列裡存的是「線束 / 線組加工」這個完整字串，
 * 不是「線束」），純 SQL 做不到「跟 taxonomy 真正對應的 exact match」。
 *
 * 這個模組在**應用層**把 `INDUSTRIES[].sub` 拆成可搜尋的原子詞（例如
 * 「CNC加工 / 精密加工」→「CNC加工」「精密加工」），keyword 完全等於某個
 * 原子詞時，才回傳該原子詞所屬的完整複合值，讓呼叫端可以對 DB 送出真正
 * 精準的 `JSON_CONTAINS(subIndustry, [完整複合值])`。
 *
 * 刻意**不做** substring/`includes()` 判斷——「塑膠」不會因為某個 sub 值是
 * 「塑膠包裝」就被判定命中，除非「塑膠」本身真的是拆開後的一個原子詞（它
 * 不是：「塑膠包裝」沒有「/」可拆，整串就是一個原子詞）。
 *
 * Source of truth 只有 `shared/constants.ts` 的 `INDUSTRIES`，不手寫第二份
 * subIndustry 清單。
 */
import { INDUSTRIES } from "./constants";

function splitCompoundTerm(s: string): string[] {
  return s.split(/[/／]/).map(t => t.trim()).filter(Boolean);
}

// 原子詞 → 所屬的完整複合 taxonomy 值集合（一個原子詞理論上可能對應多個
// 完整值，例如未來 taxonomy 調整後同一個原子詞出現在不同複合詞裡）。
const ATOMIC_TERM_TO_FULL_VALUES: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const map = new Map<string, Set<string>>();
  for (const industry of INDUSTRIES) {
    for (const sub of industry.sub) {
      for (const atomic of splitCompoundTerm(sub)) {
        if (!map.has(atomic)) map.set(atomic, new Set());
        map.get(atomic)!.add(sub);
      }
    }
  }
  return map;
})();

/**
 * 極小、明確列出的 alias 清單——只收錄「非常明確、無歧義、且已有現有
 * 搜尋／taxonomy 證據支持」的別名，不做大量手寫 synonym（見對話中「只允許
 * 非常明確、無歧義且已有現有搜尋／taxonomy 證據支持的 alias」）。
 *
 * `cnc` → `CNC加工`：`shared/constants.ts` 的 `SUB_INDUSTRY_SEARCH_ENTRIES`
 * 裡「CNC加工 / 精密加工」這筆本身的 `displayName` 就是 `"CNC加工"`
 * （既有 SEO 資料本身就把「CNC」當這個子產業的口語簡稱使用，不是本輪新造
 * 的判斷）。key 用小寫比對，呼叫端會把輸入也轉小寫。
 */
const ALIASES: Readonly<Record<string, string>> = {
  cnc: "CNC加工",
};

/**
 * 純函式，不呼叫 DB／不做任何 I/O。
 *
 * 輸入一個使用者關鍵字，回傳它對應到的完整複合 subIndustry taxonomy 值
 * （可能是 0、1 或多個）。呼叫端如果收到非空陣列，通常會對每個值做
 * `JSON_CONTAINS(subIndustry, [value])` 再用 OR 串起來。
 */
export function resolveSubIndustryKeywordMatches(rawKeyword: string): string[] {
  const trimmed = rawKeyword.trim();
  if (!trimmed) return [];

  const alias = ALIASES[trimmed.toLowerCase()];
  const candidate = alias ?? trimmed;

  const fullValues = ATOMIC_TERM_TO_FULL_VALUES.get(candidate);
  return fullValues ? Array.from(fullValues) : [];
}
