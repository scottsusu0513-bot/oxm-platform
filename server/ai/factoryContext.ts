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
 * 解析「這個登入使用者屬於哪家公司」，同時處理 owner 與 active 共同管理者
 * 兩種身分（Phase 0 已確認：只查 owner 會讓共管者遇到「找不到工廠」）。
 * 找不到任何關聯工廠時回傳 undefined。
 */
async function resolveFactoryRow(userId: number): Promise<Factory | undefined> {
  const owned = await db.getFactoryByOwnerId(userId);
  if (owned) return owned;

  const coManaged = await db.getCoManagedFactories(userId);
  if (coManaged.length === 0) return undefined;

  const preferred = coManaged.find(f => f.status !== "delisted") ?? coManaged[0];
  return db.getFactoryById(preferred.factoryId);
}

/**
 * 找不到任何關聯工廠時回傳 null，呼叫端應該把 AI 對話當成「還不知道使用者
 * 公司背景」繼續進行，而不是拋錯中斷對話。
 */
export async function getAiFactoryContext(userId: number): Promise<AiFactoryContext | null> {
  const row = await resolveFactoryRow(userId);
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
  /** 只用於 DB 關聯（例如 aiConversations.factoryId snapshot），不是送給 LLM 的白名單欄位。 */
  id: number;
  context: AiFactoryContext;
}

/** 跟 getAiFactoryContext 共用同一次工廠解析，但額外回傳 id——用在需要把
 * conversation 關聯到工廠 row 的地方（見 server/ai/conversationService.ts），
 * 避免呼叫端為了拿 id 重複做一次一樣的 owner/co-manager 查詢。 */
export async function resolveAiFactory(userId: number): Promise<AiFactoryResolution | null> {
  const row = await resolveFactoryRow(userId);
  return row ? { id: row.id, context: toAiFactoryContext(row) } : null;
}
