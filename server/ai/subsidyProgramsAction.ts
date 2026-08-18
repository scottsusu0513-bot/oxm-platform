import { listPublicUpgradePrograms, type PublicUpgradeProgram } from "../upgradePrograms";
import { getServiceDefinition } from "../../shared/ai/serviceRegistry";
import type { AiChatTurn } from "./types";

/**
 * Phase 6C：OXM AI 讀取政府補助方案——跟找工廠／找消息同一個產品定位（見
 * 對話中「政府補助資訊查詢 ≠ Handoff」）：AI 直接查詢 OXM 既有
 * upgradePrograms 資料並在聊天裡回答，不建立顧問 Handoff、不顯示
 * 【幫你送出詢問】。
 *
 * 不新增 LLM call（見「十八」）：方案比對用 deterministic 字串比對，完全
 * 比照 newsSearchAction.ts 的手法；唯一的資料來源是
 * server/upgradePrograms.ts 既有的 listPublicUpgradePrograms()（管理員後台
 * 新增／停用方案會直接反映，不需要改這裡任何一行）。
 */

const DISPLAY_LIMIT = 6;
const KEYWORD_INPUT_MAX_LENGTH = 300;
const VIEW_ALL_URL = "/upgrade-center";

/**
 * 「製造業 19+1 AI 診斷輔導」是 shared/ai/serviceRegistry.ts 既有的顧問知識
 * （見對話中「已建立的政府補助 knowledge / Service Registry」），但它是
 * 「診斷輔導」而不是 upgradePrograms 資料表裡的公開方案卡片，DB 裡不會有
 * 對應資料列——這裡只是最小限度地認得這個既有名詞，讓 Composer 在 DB 查無
 * 資料時仍能誠實地用既有 Registry 知識回答，不是新增一份補助清單。
 */
const NINETEEN_PLUS_ONE_ALIASES = ["19+1", "19＋1", "十九加一", "19加1", "產業競爭力輔導團"];

export interface SubsidyProgramCandidate {
  slug: string;
  title: string;
  shortTitle: string | null;
  description: string;
  targetAudience: string | null;
  highlights: string[];
  maxFundingLabel: string | null;
  statusLabel: string | null;
  /** Service Registry 裡對應的補充側寫（如果找得到），只當背景知識用，見「來源權威」。 */
  registryProfile: string | null;
  url: string;
}

export interface SubsidyProgramsActionResult {
  candidates: SubsidyProgramCandidate[];
  /** 目前啟用中（未封存）的方案總數，不受 DISPLAY_LIMIT 截斷影響。 */
  totalActiveCount: number;
  matchedProgramSlugs: string[];
  compareMode: boolean;
  zeroResult: boolean;
  /** 使用者這輪提到的名詞對應到 Service Registry 既有知識、但 DB 目前沒有對應公開方案（例如 19+1）。 */
  registryOnlyMatch: { name: string; profile: string } | null;
  viewAllUrl: string;
}

function buildLatestUserTurnText(history: AiChatTurn[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    if (turn.role === "user" && turn.content.trim()) return turn.content.trim().slice(0, KEYWORD_INPUT_MAX_LENGTH);
  }
  return "";
}

/** 每個方案的別名都直接來自真實 DB 資料（slug/shortTitle/title），不是另一份寫死的對照表。 */
function programAliases(program: PublicUpgradeProgram): string[] {
  return [program.slug, program.shortTitle, program.title].filter((v): v is string => !!v);
}

/** Deterministic：對 activePrograms 的真實 slug/shortTitle/title 做子字串比對，大小寫不敏感（方案代號多為英文縮寫）。 */
export function extractMatchedProgramSlugs(text: string, activePrograms: PublicUpgradeProgram[]): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const program of activePrograms) {
    const hit = programAliases(program).some(alias => lower.includes(alias.toLowerCase()));
    if (hit && !found.includes(program.slug)) found.push(program.slug);
  }
  return found;
}

const SUBSIDY_QUERY_FILLER_TERMS = [
  "最近", "有沒有", "有什麼", "什麼", "相關", "的呢", "的話", "呢", "嗎",
  "政府", "補助", "方案", "計畫", "是什麼", "差在哪", "差別", "比較", "跟",
  "有哪些", "哪些", "目前", "現在", "OXM", "oxm",
  // 常見指示代名詞／人稱代名詞語助詞：跟上面同一種「拿掉語法框架，不是分類」
  // 的用途，不是新增業務關鍵字規則——只是把常見會出現在單一完整句子裡的
  // 代名詞也視為結構性字詞，避免殘留成無意義的假關鍵字（例如「那你們現在
  // 有哪些政府補助？」如果沒拿掉「那」「你們」，會殘留出完全無意義的
  // 「那你們」當關鍵字，見對話中真實 regression 案例）。
  "你們", "我們", "他們", "那", "這",
];

function extractKeywords(text: string): string[] {
  let remaining = text;
  for (const term of SUBSIDY_QUERY_FILLER_TERMS) remaining = remaining.split(term).join(" ");
  const cleaned = remaining.replace(/[，,。.？?！!、\s]+/g, " ").trim();
  if (!cleaned) return [];
  return cleaned.split(" ").filter(t => t.length >= 2).slice(0, 3);
}

function matchesNineteenPlusOne(text: string): boolean {
  return NINETEEN_PLUS_ONE_ALIASES.some(alias => text.includes(alias));
}

/**
 * 只看「最新一則使用者訊息」，不 fallback 沿用整段歷史（見對話中「Phase 6B
 * + 6C 人工驗收發現一個跨 Resource Routing bug」的延伸修正）：Layer 2 的
 * resourceTarget 已經在更上游正確判斷「這一輪是不是換了新的資源目標」，這裡
 * 如果還往回吃整段歷史文字，會把上一輪（可能完全不同資源、例如找消息）留下
 * 的殘留字詞（例如「金屬加工」「食品」）誤當成這一輪政府補助查詢的關鍵字，
 * 導致明明是「有哪些政府補助」這種完整、獨立的整句查詢，卻被無關的舊字詞
 * 汙染成查無資料。跟 matchedProgramSlugs 有沒有命中方案名稱無關的省略式追問
 * （例如「那SBIR呢？」）本身在最新這一句就已經包含完整資訊，不需要回頭看
 * 歷史；真正需要跨輪省略資訊的情境本輪刻意不支援（見「十九：不要為了形式
 * 硬加」，沒有持久化的 currentSubsidyQueryState）。
 */
function resolveSubsidyQueryFilters(history: AiChatTurn[], activePrograms: PublicUpgradeProgram[]): {
  matchedProgramSlugs: string[];
  keywords: string[];
  queryTextForRegistryCheck: string;
} {
  const latestText = buildLatestUserTurnText(history);
  const matchedProgramSlugs = extractMatchedProgramSlugs(latestText, activePrograms);
  const keywords = matchedProgramSlugs.length > 0 ? [] : extractKeywords(latestText);

  return { matchedProgramSlugs, keywords, queryTextForRegistryCheck: latestText };
}

function findRegistryProfile(program: PublicUpgradeProgram): string | null {
  const govSubsidy = getServiceDefinition("gov_subsidy");
  const candidates = govSubsidy?.govSubsidyPrograms ?? [];
  const haystacks = [program.shortTitle, program.title].filter((v): v is string => !!v).map(s => s.toLowerCase());
  for (const c of candidates) {
    const name = c.name.toLowerCase();
    if (haystacks.some(h => h.includes(name) || name.includes(h))) return c.profile;
  }
  return null;
}

function toCandidate(program: PublicUpgradeProgram): SubsidyProgramCandidate {
  return {
    slug: program.slug,
    title: program.title,
    shortTitle: program.shortTitle,
    description: program.description,
    targetAudience: program.targetAudience,
    highlights: program.highlights,
    maxFundingLabel: program.maxFundingLabel,
    statusLabel: program.statusLabel,
    registryProfile: findRegistryProfile(program),
    url: VIEW_ALL_URL,
  };
}

/**
 * 唯一對外入口，供 chatService.ts 在 Layer 2 判斷
 * routing.govSubsidyLookupRelevant 之後呼叫。資料來源固定是
 * listPublicUpgradePrograms()（只回傳啟用且未封存的方案，見「七：方案資料
 * 必須來自真實 DB」），不會把已停用或封存的方案當成目前可申請方案推薦。
 */
export async function runSubsidyProgramsAction(history: AiChatTurn[]): Promise<SubsidyProgramsActionResult> {
  const activePrograms = await listPublicUpgradePrograms();
  const { matchedProgramSlugs, keywords, queryTextForRegistryCheck } = resolveSubsidyQueryFilters(history, activePrograms);

  let matched: PublicUpgradeProgram[];
  if (matchedProgramSlugs.length > 0) {
    matched = activePrograms.filter(p => matchedProgramSlugs.includes(p.slug));
  } else if (keywords.length > 0) {
    matched = activePrograms.filter(p =>
      keywords.some(k => {
        const haystacks = [p.title, p.shortTitle, p.description, p.targetAudience, ...p.highlights];
        return haystacks.some(h => h && h.includes(k));
      })
    );
  } else {
    // 純粹「有哪些補助」這種泛用列表請求（見「八」的例子 B）：upgradePrograms
    // 是管理員自己維護、數量本來就有限的公開清單，不像 news 那樣需要担心
    // 「顯示所有已上架內容」是無邊界查詢，直接回傳目前全部啟用方案。
    matched = activePrograms;
  }

  const zeroResult = matched.length === 0;

  // 見對話中「政府補助資料一致性問題」：19+1 現在已經是 upgradePrograms 裡
  // 真實存在的公開方案（見 shared/upgradePrograms.ts），所以只有 DB 真的查無
  // 資料時，才 fallback 用 Service Registry 的既有知識當背景說明——DB 已經
  // 命中時絕對不能再講「目前不是 upgradePrograms 資料表裡的公開方案卡片」
  // 這種現在已經不正確的話。
  const registryOnlyMatch = zeroResult && matchesNineteenPlusOne(queryTextForRegistryCheck)
    ? (() => {
        const entry = getServiceDefinition("gov_subsidy")?.govSubsidyPrograms?.find(p => p.key === "manufacturing_19plus1");
        return entry ? { name: entry.name, profile: entry.profile } : null;
      })()
    : null;

  return {
    candidates: matched.slice(0, DISPLAY_LIMIT).map(toCandidate),
    totalActiveCount: activePrograms.length,
    matchedProgramSlugs,
    compareMode: matchedProgramSlugs.length >= 2,
    zeroResult,
    registryOnlyMatch,
    viewAllUrl: VIEW_ALL_URL,
  };
}
