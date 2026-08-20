import * as db from "../db";
import type { Factory } from "../../drizzle/schema";

/**
 * 送進 LLM 的企業 context 白名單。
 *
 * 刻意只列出「已經是公開/半公開、對企業診斷有幫助」的欄位，不是把整張
 * factories row 丟給模型。明確排除：adminNote、contactStatus、
 * certificationEvidence、rejectionReason、deletedAt、ownerId、聯絡方式
 * （phone/contactEmail/address/contactPersonName）等內部或個資欄位——AI 對話
 * 診斷不需要這些就能正常運作，少給比多給安全。
 */
export interface AiFactoryContext {
  companyName: string;
  industry: string[];
  subIndustry: string[];
  region: string;
  businessType: string;
  foundedYear: number | null;
  capitalLevel: string;
  mfgModes: string[];
  description: string;
}

/**
 * 匯出給 Phase 5 case assessment 用——同一份安全白名單投影，不另外重寫一次
 * （見對話中「十六、Assessment 生成資料來源」列出的安全欄位跟這裡完全一致）。
 */
export function toAiFactoryContext(f: Factory): AiFactoryContext {
  return {
    companyName: f.name,
    industry: (f.industry as string[] | null) ?? [],
    subIndustry: (f.subIndustry as string[] | null) ?? [],
    region: f.region,
    businessType: f.businessType,
    foundedYear: f.foundedYear ?? null,
    capitalLevel: f.capitalLevel,
    mfgModes: (f.mfgModes as string[] | null) ?? [],
    description: f.description ?? "",
  };
}

/**
 * Phase 11.2 P0 根因修正（見對話中「七、統一 Factory Resolver」）：這裡曾經
 * 各自呼叫 db.getFactoryByOwnerId／db.getCoManagedFactories，兩者都不篩
 * status——代表 draft／pending／rejected／delisted 的工廠都會被當成「目前
 * 工廠」，餵進 LLM prompt、寫進 conversation.factoryId、進而寫進 Enterprise
 * Memory 的 factory 歸屬。這跟 server/ai/entitlement.ts 用的
 * db.getActiveFactoryAffiliationDetail()（只認 status='approved'）是兩條
 * 完全不同標準的解析路徑，Phase 11.1 Audit 認定為 P0 根因之一。
 *
 * 現在統一改成呼叫同一個 db.getActiveFactoryAffiliationDetail()——entitlement
 * （quota 資格）／conversation factory／factory context／Enterprise Memory
 * factory／quota owner 這五件事，全部共用這一個 source of truth：只有
 * status='approved' 的工廠才算「這個使用者目前的企業」。
 */
async function resolveApprovedFactoryRow(userId: number): Promise<Factory | undefined> {
  const affiliation = await db.getActiveFactoryAffiliationDetail(userId);
  if (!affiliation) return undefined;
  return db.getFactoryById(affiliation.factoryId);
}

/**
 * 找不到任何「已核准」關聯工廠時回傳 null，呼叫端應該把 AI 對話當成「還不
 * 知道使用者公司背景」繼續進行，而不是拋錯中斷對話。draft／pending／
 * rejected／delisted 的工廠一律視同「沒有工廠」（見上方 resolveApprovedFactoryRow
 * 的說明）。
 */
export async function getAiFactoryContext(userId: number): Promise<AiFactoryContext | null> {
  const row = await resolveApprovedFactoryRow(userId);
  return row ? toAiFactoryContext(row) : null;
}

/**
 * Phase 5 專用：五個案件表都是用 factoryId（不是 userId）指向工廠，跟 Layer 1
 * 對話用的「哪個登入使用者屬於哪家公司」是不同的解析路徑，所以另外提供一個
 * 直接吃 factoryId 的版本，共用同一份安全白名單投影。找不到工廠或工廠已被
 * 刪除時回傳 null，呼叫端應該把它當「這部分 context 缺席」處理，不是拋錯。
 */
export async function getAiFactoryContextByFactoryId(factoryId: number): Promise<AiFactoryContext | null> {
  const row = await db.getFactoryById(factoryId);
  return row ? toAiFactoryContext(row) : null;
}

export interface AiFactoryResolution {
  /** 只用於 DB 關聯（例如 aiConversations.factoryId snapshot／Enterprise Memory 歸屬），不是送給 LLM 的白名單欄位。 */
  id: number;
  context: AiFactoryContext;
  role: "owner" | "co_manager";
}

/**
 * 見對話中「七、統一 Factory Resolver」：AI 這一側（conversation 建立、
 * factory context、Enterprise Memory 歸屬）唯一允許使用的工廠解析函式，跟
 * getAiFactoryContext 共用同一次「只認 approved」解析，額外回傳 id／role——
 * 用在需要把 conversation／Enterprise Memory 關聯到工廠 row 的地方（見
 * server/ai/chatService.ts／server/ai/memory.ts），避免呼叫端為了拿 id 重複
 * 做一次一樣的查詢。找不到已核准工廠時回傳 null——呼叫端必須把這個情況當成
 * 「沒有企業 context」處理（例如 Admin 沒有 approved 工廠時），不得 fallback
 * 成任何非 approved 的工廠、也不得 fallback 成上一次 conversation 殘留的
 * factoryId（見「三、Memory Read API」：沒有 factoryId 就是不讀 memory，沒有
 * 例外）。
 */
export async function resolveApprovedAiFactoryContext(userId: number): Promise<AiFactoryResolution | null> {
  const affiliation = await db.getActiveFactoryAffiliationDetail(userId);
  if (!affiliation) return null;
  const row = await db.getFactoryById(affiliation.factoryId);
  if (!row) return null;
  return { id: row.id, context: toAiFactoryContext(row), role: affiliation.role };
}
