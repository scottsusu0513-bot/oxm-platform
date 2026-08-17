import { ERP_NEED_TYPES } from "../../shared/erpOptimization";
import {
  SHORT_VIDEO_SERVICES,
  SHORT_VIDEO_GOALS,
  SHORT_VIDEO_PLATFORMS,
} from "../../shared/shortVideoMarketing";
import type { HandoffEligibleServiceKey } from "../../shared/ai/handoffServices";

/**
 * Phase 4：AI Handoff Context 的欄位預填——人工驗收發現過一次真實違反：
 * 早期版本讓一個獨立 LLM 呼叫重新讀完整對話逐字稿、自己判斷哪些內容可以
 * 填正式表單，只用白名單驗證「值合不合法」，沒有驗證「這件事是不是使用者
 * 明確確認過」，導致理論上可能出現「我們公司不大」被塞進一個合法但完全是
 * 猜測出來的 annualRevenue 級距這種情況。
 *
 * 正式規則（見對話中「二、正式 prefill 的唯一權威來源」）：
 * 【server-authoritative confirmedFacts → service-specific deterministic
 * mapping → prefillData】。這裡完全不讀對話逐字稿、不呼叫任何 LLM——只從
 * Layer 1 每一輪已經用極度保守規則萃取好、存在 ConversationState.confirmedFacts
 * 裡的事實做「同一個 key、同一個型別」的直接比對＋白名單驗證。任何欄位在
 * confirmedFacts 裡找不到完全對應的 key／型別／合法值，一律不填，不會回頭
 * 從對話內容擴大事實集合，也不會用任何形式的語意相似度去猜。
 */

export type HandoffFieldKind = "boolean" | "enumSingle" | "enumMulti" | "number" | "text";

export interface HandoffFieldOption {
  code: string;
  label: string;
}

export interface HandoffFieldSpec {
  key: string;
  kind: HandoffFieldKind;
  options?: HandoffFieldOption[];
  /** 只有在另一個 boolean 欄位確認為這個值時，這個欄位才有意義（例如 patentCount 依賴 hasPatent=true）。 */
  dependsOnKey?: string;
  dependsOnValue?: boolean;
  /** number/text 欄位的簡單範圍限制，防止 confirmedFacts 裡萬一出現異常值時溢出進表單。 */
  min?: number;
  max?: number;
  maxLength?: number;
  /**
   * Phase 4.1：少數欄位無法用「confirmedFacts 裡剛好有同名 key」直接比對——
   * 要嘛是因為欄位本身的正式代碼是 Layer 1 prompt 裡不能出現的 OXM 內部服務
   * 代稱（例如 erp needType 的其中一個合法值字面上包含服務 key 子字串），
   * 要嘛是需要從多個各自獨立、更保守的通用事實組合出一個多選陣列（例如
   * 認證標準、短影音平台）。derive 是 deterministic 純函式，只讀
   * confirmedFacts，找不到足夠資訊就回傳 undefined、一律不填，不做任何語意
   * 猜測；有 derive 時完全取代同 key 直接比對。回傳的 sourceFacts 用於
   * provenance（見 ConfirmedFieldProvenance）。
   */
  derive?: (facts: ConfirmedFacts, options: HandoffFieldOption[] | undefined) => { value: unknown; sourceFacts: string[] } | undefined;
}

type ConfirmedFacts = Record<string, string | number | boolean>;

/** 每個進了 prefillData 的欄位，都要能追溯是從哪一個 confirmedFacts key 來的（見「四、最小 provenance」）。 */
export interface ConfirmedFieldProvenance {
  sourceFact: string;
}

export interface HandoffPrefillResult {
  prefillData: Record<string, unknown>;
  confirmedFields: Record<string, ConfirmedFieldProvenance>;
}

/**
 * Phase 4.1：「是否為企業社」在 confirmedFacts 裡不能叫 isEnterpriseFirm——
 * 這個字面字串本身就包含 Layer 1 prompt 絕對不能出現的服務代稱子字串（見
 * diagnosis.ts 檔頭硬規則），所以 Layer 1 改記一個完全通用、不含該子字串的
 * 事實 key（firmIsBusinessAssoc），這裡用 derive 轉換成表單真正需要的欄位
 * 名稱／值，兩者語意完全等價，只是換一個安全的中繼字面字串。
 */
function deriveIsEnterpriseFirm(facts: ConfirmedFacts): { value: unknown; sourceFacts: string[] } | undefined {
  const raw = facts["firmIsBusinessAssoc"];
  return typeof raw === "boolean" ? { value: raw, sourceFacts: ["firmIsBusinessAssoc"] } : undefined;
}

/**
 * Phase 4.1：ERP 的 needType 有一個合法值（"erp_adoption"）字面上包含服務
 * key 子字串，Layer 1 prompt 不能直接教它輸出這個代碼。改成兩個完全通用、
 * 不點名任何服務的現況事實（manualOpsPainPoint／productionLinePainPoint），
 * 這裡 deterministic 組合出最終欄位值：兩者都成立→整合改善；只有前者→
 * 對應「希望系統化管理」的那個選項；只有後者→對應「希望優化現場動線」的
 * 那個選項。同時保留「confirmedFacts 剛好直接就有合法 needType」這個舊路徑
 * 當作 fallback，不因為新增保守事實就砍掉原本就合法的直接比對。
 */
function deriveErpNeedType(facts: ConfirmedFacts, options: HandoffFieldOption[] | undefined): { value: unknown; sourceFacts: string[] } | undefined {
  const valid = new Set((options ?? []).map(o => o.code));
  const direct = facts["needType"];
  if (typeof direct === "string" && valid.has(direct)) {
    return { value: direct, sourceFacts: ["needType"] };
  }
  const manual = facts["manualOpsPainPoint"] === true;
  const line = facts["productionLinePainPoint"] === true;
  const integrated = ERP_NEED_TYPES.find(n => n.key === "integrated")?.key;
  const adoption = ERP_NEED_TYPES.find(n => n.key === "erp_adoption")?.key;
  const lineOpt = ERP_NEED_TYPES.find(n => n.key === "line_optimization")?.key;
  if (manual && line && integrated) return { value: integrated, sourceFacts: ["manualOpsPainPoint", "productionLinePainPoint"] };
  if (manual && adoption) return { value: adoption, sourceFacts: ["manualOpsPainPoint"] };
  if (line && lineOpt) return { value: lineOpt, sourceFacts: ["productionLinePainPoint"] };
  return undefined;
}

/**
 * Phase 4.1：confirmedFacts 是純量，無法直接表示「同時選了兩個標準／平台」。
 * Layer 1 改成每個標準／平台各自一個獨立布林事實，這裡收集所有成立的旗標，
 * 各自對照回目前真正的目錄代碼／固定代碼，且一定要求該代碼真的存在於
 * 傳入的 options（certification 是即時查詢到的目錄，admin 下架或改代碼時
 * 這裡會自然跳過，不會塞進一個目錄裡已經不存在的代碼）。同時保留「
 * confirmedFacts 剛好直接就是一個合法代碼字串」這個舊路徑當 fallback。
 */
function deriveEnumMultiFromFlags(
  directKey: string,
  flagToCode: Record<string, string>
): (facts: ConfirmedFacts, options: HandoffFieldOption[] | undefined) => { value: unknown; sourceFacts: string[] } | undefined {
  return (facts, options) => {
    const valid = new Set((options ?? []).map(o => o.code));
    const codes: string[] = [];
    const sourceFacts: string[] = [];
    const direct = facts[directKey];
    if (typeof direct === "string" && valid.has(direct) && !codes.includes(direct)) {
      codes.push(direct);
      sourceFacts.push(directKey);
    }
    for (const [factKey, code] of Object.entries(flagToCode)) {
      if (facts[factKey] === true && valid.has(code) && !codes.includes(code)) {
        codes.push(code);
        sourceFacts.push(factKey);
      }
    }
    if (codes.length === 0) return undefined;
    return { value: codes, sourceFacts };
  };
}

const CERTIFICATION_STANDARD_FLAG_TO_CODE: Record<string, string> = {
  certRequestedIso9001: "iso-9001",
  certRequestedIso14001: "iso-14001",
  certRequestedIso45001: "iso-45001",
  certRequestedIso50001: "iso-50001",
  certRequestedIso27001: "iso-27001",
  certRequestedCarbonInventory: "iso-14064-1",
  certRequestedProductCarbonFootprint: "iso-14067",
};

const SHORT_VIDEO_PLATFORM_FLAG_TO_CODE: Record<string, string> = {
  platformInstagram: "instagram",
  platformFacebook: "facebook",
  platformTiktok: "tiktok",
  platformYoutube: "youtube",
};

function govSubsidyFieldSpecs(): HandoffFieldSpec[] {
  return [
    {
      key: "decisionMakerParticipation",
      kind: "enumSingle",
      options: [
        { code: "owner", label: "負責人將共同參與" },
        { code: "manager", label: "由具決策權主管共同參與" },
        { code: "unavailable", label: "目前無法安排決策者參與" },
      ],
    },
    {
      key: "annualRevenue",
      kind: "enumSingle",
      options: [
        { code: "under_5m", label: "500 萬以下" },
        { code: "5m_to_10m", label: "500～1,000 萬" },
        { code: "over_10m", label: "1,000 萬以上" },
      ],
    },
    {
      key: "employeeCount",
      kind: "enumSingle",
      options: [
        { code: "1_5", label: "1～5 人" },
        { code: "6_30", label: "6～30 人" },
        { code: "31_100", label: "31～100 人" },
        { code: "101_300", label: "101～300 人" },
        { code: "over_300", label: "300 人以上" },
      ],
    },
    {
      key: "factoryType",
      kind: "enumSingle",
      options: [
        { code: "general", label: "一般工廠" },
        { code: "specific", label: "特定工廠登記" },
        { code: "managed", label: "納管工廠" },
        { code: "unregistered", label: "尚未登記" },
        { code: "unknown", label: "不確定" },
      ],
    },
    { key: "isEnterpriseFirm", kind: "boolean", derive: deriveIsEnterpriseFirm },
    { key: "hasGovProject", kind: "boolean" },
    { key: "govProjectName", kind: "text", maxLength: 200, dependsOnKey: "hasGovProject", dependsOnValue: true },
    { key: "hasAppliedForSubsidy", kind: "boolean" },
    { key: "hasPatent", kind: "boolean" },
    { key: "patentCount", kind: "number", min: 1, max: 9999, dependsOnKey: "hasPatent", dependsOnValue: true },
    {
      key: "exportMode",
      kind: "enumSingle",
      options: [
        { code: "direct_with_export_quote", label: "直接出口（含出口報價單）" },
        { code: "indirect_trading_company", label: "間接出口－透過貿易商" },
        { code: "indirect_distributor_agent", label: "間接出口－有經銷商／代理商" },
        { code: "no_export", label: "無出口" },
      ],
    },
  ];
}

function erpFieldSpecs(): HandoffFieldSpec[] {
  return [
    {
      key: "needType",
      kind: "enumSingle",
      options: ERP_NEED_TYPES.filter(n => n.key !== "unsure").map(n => ({ code: n.key, label: n.label })),
      derive: deriveErpNeedType,
    },
  ];
}

function certificationFieldSpecs(catalog: { code: string; name: string }[]): HandoffFieldSpec[] {
  if (catalog.length === 0) return [];
  return [
    {
      key: "servicesWanted",
      kind: "enumMulti",
      options: catalog.map(c => ({ code: c.code, label: c.name })),
      derive: deriveEnumMultiFromFlags("servicesWanted", CERTIFICATION_STANDARD_FLAG_TO_CODE),
    },
    { key: "isUnsure", kind: "boolean" },
  ];
}

function shortVideoFieldSpecs(): HandoffFieldSpec[] {
  return [
    { key: "servicesWanted", kind: "enumMulti", options: SHORT_VIDEO_SERVICES.map(s => ({ code: s.key, label: s.label })) },
    { key: "isUnsure", kind: "boolean" },
    { key: "primaryGoal", kind: "enumSingle", options: SHORT_VIDEO_GOALS.map(g => ({ code: g.key, label: g.label })) },
    {
      key: "platforms",
      kind: "enumMulti",
      options: SHORT_VIDEO_PLATFORMS.map(p => ({ code: p.key, label: p.label })),
      derive: deriveEnumMultiFromFlags("platforms", SHORT_VIDEO_PLATFORM_FLAG_TO_CODE),
    },
    { key: "noPlatformYet", kind: "boolean" },
  ];
}

export function buildFieldSpecs(
  serviceKey: HandoffEligibleServiceKey,
  certificationCatalog: { code: string; name: string }[] = []
): HandoffFieldSpec[] {
  switch (serviceKey) {
    case "gov_subsidy": return govSubsidyFieldSpecs();
    case "erp": return erpFieldSpecs();
    case "certification": return certificationFieldSpecs(certificationCatalog);
    case "short_video": return shortVideoFieldSpecs();
    case "finance": return []; // 見對話中「二十一」：財務表單沒有業務欄位可預填，不要為了 AI 硬加欄位。
  }
}

/**
 * 有 derive 的欄位交給 derive 純函式處理（見 HandoffFieldSpec.derive 說明）；
 * 沒有 derive 的欄位維持原本「同一個 key、同一個型別」的直接比對——不做任何
 * 語意層面的轉換或猜測。confirmedFacts 是純量（Record<string, string|number
 * |boolean>），沒有 derive 的 enumMulti 欄位最多只能靠「單一字串值剛好等於
 * 某個合法代碼」被 wrap 成一個元素的陣列。
 */
function mapConfirmedFactToFieldValue(
  spec: HandoffFieldSpec,
  facts: ConfirmedFacts
): { value: unknown; sourceFact: string } | undefined {
  if (spec.derive) {
    const derived = spec.derive(facts, spec.options);
    if (!derived) return undefined;
    return { value: derived.value, sourceFact: derived.sourceFacts.join("+") };
  }

  if (!(spec.key in facts)) return undefined;
  const raw = facts[spec.key];
  const value = ((): unknown | undefined => {
    switch (spec.kind) {
      case "boolean":
        return typeof raw === "boolean" ? raw : undefined;
      case "number": {
        if (typeof raw !== "number" || !Number.isInteger(raw)) return undefined;
        if (spec.min != null && raw < spec.min) return undefined;
        if (spec.max != null && raw > spec.max) return undefined;
        return raw;
      }
      case "text": {
        if (typeof raw !== "string" || !raw.trim()) return undefined;
        return raw.trim().slice(0, spec.maxLength ?? 200);
      }
      case "enumSingle": {
        const valid = new Set((spec.options ?? []).map(o => o.code));
        return typeof raw === "string" && valid.has(raw) ? raw : undefined;
      }
      case "enumMulti": {
        const valid = new Set((spec.options ?? []).map(o => o.code));
        return typeof raw === "string" && valid.has(raw) ? [raw] : undefined;
      }
    }
  })();
  if (value === undefined) return undefined;
  return { value, sourceFact: spec.key };
}

/**
 * 唯一的 prefill 入口——同步、deterministic、不呼叫任何模型、不讀對話逐字稿。
 * 依序處理 specs（陣列順序本身就保證依賴欄位一定排在被依賴欄位之後，例如
 * hasPatent 在 patentCount 之前），確保 dependsOnKey 檢查時 prefillData 裡
 * 已經有依賴欄位的值可以比對。
 */
export function buildHandoffPrefillFromConfirmedFacts(params: {
  specs: HandoffFieldSpec[];
  confirmedFacts: ConfirmedFacts;
}): HandoffPrefillResult {
  const prefillData: Record<string, unknown> = {};
  const confirmedFields: Record<string, ConfirmedFieldProvenance> = {};

  for (const spec of params.specs) {
    const result = mapConfirmedFactToFieldValue(spec, params.confirmedFacts);
    if (!result) continue;
    if (spec.dependsOnKey && prefillData[spec.dependsOnKey] !== spec.dependsOnValue) continue;
    prefillData[spec.key] = result.value;
    confirmedFields[spec.key] = { sourceFact: result.sourceFact };
  }
  return { prefillData, confirmedFields };
}

/**
 * handoffSummary 不呼叫模型——Current Conversation State 裡的
 * observedProblem／primaryBusinessDirection／secondaryConcern 已經是這輪
 * Layer 1 產生的精簡文字，直接組合即可（見對話中「二十八」：這裡只是先
 * snapshot，不是正式 AI 初判）。
 */
export function buildHandoffSummary(state: {
  observedProblem: string | null;
  primaryBusinessDirection: string | null;
  secondaryConcern: string | null;
}): string {
  const parts = [state.observedProblem, state.primaryBusinessDirection, state.secondaryConcern]
    .filter((p): p is string => !!p && p.trim().length > 0);
  const text = parts.join("；");
  return (text || "使用者主動要求轉交顧問，對話中未產生明確摘要文字。").slice(0, 500);
}
