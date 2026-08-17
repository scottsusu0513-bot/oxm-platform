import * as db from "../db";
import { getAiChatProvider, type AiChatMessage } from "./provider";
import { getAiFactoryContextByFactoryId, type AiFactoryContext } from "./factoryContext";
import { getHandoffContextById } from "./handoffContextService";
import { AI_SERVICE_REGISTRY } from "../../shared/ai/serviceRegistry";
import { shortVideoServiceLabel, shortVideoPlatformLabel, SHORT_VIDEO_GOALS } from "../../shared/shortVideoMarketing";
import { erpNeedTypeLabel } from "../../shared/erpOptimization";
import type { HandoffEligibleServiceKey } from "../../shared/ai/handoffServices";
import type { AiHandoffContext } from "../../drizzle/schema";
import {
  createPendingAssessment,
  markAssessmentCompleted,
  markAssessmentFailed,
} from "./caseAssessmentService";
import {
  buildAuthoritativeReferenceBackground,
  type AuthoritativeFactValue,
} from "./assessmentAuthority";

/**
 * Phase 5：AI Case Assessment——AI 導件案件正式成立（既有 submitApplication
 * 成功建立案件）後，用「最終 submitted form + handoff snapshot + 安全企業
 * context」生成的服務專屬 AI 初判，給顧問接手時看。
 *
 * 資料權威順序（見對話中「二、最重要的 Source of Truth 順序」）：
 * 【使用者最後 submit 的正式表單值】 > 【handoff context 的 prefillData／
 * handoffSummary（僅供參考的對話期間背景）】 > 【企業公開 context】 >
 * 【AI 推論】。衝突時永遠以正式 submitted form 為準——這裡的做法是把
 * submittedForm 放在 prompt 最前面、明確標示為「權威」，把 handoff 對話期間
 * 的內容明確標示為「僅供參考、可能已被使用者在表單修改」。
 *
 * 五個服務刻意各自獨立的格式（見對話中「七、不要做一套 Universal Assessment
 * Template」）：政府補助固定 8 欄；其餘四個服務只是一段 100～250 字內的短
 * 摘要（{"summary": "..."}）。不共用同一套 schema／prompt 骨架。
 */

export interface GovSubsidyAssessment {
  primaryRecommendation: string;
  secondaryRecommendation: string;
  currentProblem: string;
  rdStatus: string;
  equipmentNeed: string;
  tariffImpact: string;
  selfFundingCapacity: string;
  aiReasoning: string;
}

export interface ShortSummaryAssessment {
  summary: string;
}

const UNKNOWN_TEXT = "未提供";

/** 8 個欄位固定順序，parse 時用來逐一檢查＋提供保底值。 */
const GOV_SUBSIDY_FIELDS: (keyof GovSubsidyAssessment)[] = [
  "primaryRecommendation", "secondaryRecommendation", "currentProblem", "rdStatus",
  "equipmentNeed", "tariffImpact", "selfFundingCapacity", "aiReasoning",
];

const GOV_SUBSIDY_FIELD_LABELS: Record<keyof GovSubsidyAssessment, string> = {
  primaryRecommendation: "主推薦",
  secondaryRecommendation: "次推薦",
  currentProblem: "企業目前問題",
  rdStatus: "研發情況",
  equipmentNeed: "設備需求及目的",
  tariffImpact: "關稅影響",
  selfFundingCapacity: "自籌能力",
  aiReasoning: "AI 判斷理由",
};

/**
 * 可靠性修正（見對話中「八、Handoff Summary 的衝突再做一個確認」）：
 * handoffSummary 是 Layer 1（observedProblem／secondaryConcern 等）產生的
 * 自由文字，即使 prefillData 已經被 buildAuthoritativeReferenceBackground
 * deterministic 剔除衝突欄位，這段自由文字本身仍可能用一般敘述語句提到同一
 * 件事（例如「目前沒有專利」），而正式表單已經回答的其實是相反的值。這裡不
 * 對自由文字本身做任何 NLP 內容過濾或修改（不建立複雜 sanitizer），而是用
 * 100% 由程式碼算出的 supersededKeys（見 assessmentAuthority.ts）產生一份
 * 「這些主題已經有正式表單最新答案」的明確條列清單，並非「請模型自行判斷
 * 誰優先」這種空泛提示——清單內容完全由程式決定，模型只需要照做「這些主題
 * 一律不採信對話摘要」，不需要自己去比對衝突。
 */
const PREFILL_KEY_LABELS: Record<string, string> = {
  decisionMakerParticipation: "決策者是否共同參與",
  annualRevenue: "年營收",
  employeeCount: "員工人數",
  factoryType: "工廠類型",
  isEnterpriseFirm: "是否為企業社",
  hasGovProject: "是否曾執行政府計畫",
  govProjectName: "政府計畫名稱",
  hasAppliedForSubsidy: "是否曾申請過政府補助",
  hasPatent: "是否持有專利",
  patentCount: "專利件數",
  exportMode: "出口模式",
  needType: "ERP 需求類型",
  servicesWanted: "想了解的服務／認證項目",
  isUnsure: "是否確定想要的項目",
  primaryGoal: "主要目標",
  platforms: "目前經營平台",
  noPlatformYet: "是否尚未經營任何平台",
};

function serializeFactoryContext(context: AiFactoryContext | null): string {
  if (!context) return "目前未取得企業公開資料。";
  const parts = [
    `公司：${context.companyName}`,
    context.industry.length ? `產業：${context.industry.join("、")}` : "",
    context.region ? `地區：${context.region}` : "",
    context.businessType ? `類型：${context.businessType}` : "",
    context.foundedYear ? `成立年份：${context.foundedYear}` : "",
    context.capitalLevel ? `資本額級距：${context.capitalLevel}` : "",
    context.mfgModes.length ? `製造模式：${context.mfgModes.join("、")}` : "",
    context.description ? `簡介：${context.description.slice(0, 300)}` : "",
  ].filter(Boolean);
  return parts.join("；") || "目前未取得企業公開資料。";
}

/**
 * 可靠性修正（見對話中「六～八、移除衝突 Raw Summary」）：handoffSummary 是
 * Layer 1 產生的自由文字，即使結構化 prefillData 已經被
 * buildAuthoritativeReferenceBackground deterministic 剔除衝突欄位，這段
 * 自由文字本身仍可能用一般敘述語句提到同一件事（例如「目前沒有專利」）。
 * 上一輪的做法是仍然把 handoffSummary 原文送給模型，只加一段「這些主題已被
 * 表單取代」的提示——這仍然是 prompt-level mitigation，不是 deterministic
 * conflict elimination。
 *
 * 這一輪改成完全不做 NLP／字串層級過濾（不去猜 handoffSummary 裡哪一句話
 * 對應哪個欄位），而是用「supersededKeys 是否為空」這個 100% 程式碼可判斷
 * 的訊號決定要不要把 handoffSummary 原文送進模型：
 * - supersededKeys 為空：正式表單完全沒有覆蓋掉 prefillData 裡的任何欄位
 *   （代表這次對話記錄的結構化事實跟表單沒有衝突，例如 ERP 只有 needType
 *   一個欄位、且表單剛好也是同一個值），這種情況下 handoffSummary 不可能
 *   帶回被覆蓋的舊事實，可以放心保留完整敘述背景（見「八、不要破壞沒有
 *   衝突時的 handoffSummary」）。
 * - supersededKeys 非空：代表正式表單至少覆蓋掉一個原本記錄的結構化事實，
 *   handoffSummary 這段自由文字有非零機率用敘述語句重複提到同一件事——這裡
 *   寧可完全不傳 raw handoffSummary 給模型，只保留已經 deterministic 確認
 *   「正式表單沒有回答」的殘餘結構化事實（remainingReferenceFacts）當背景，
 *   避免任何「衝突 raw summary + 提示模型忽略」的設計（見「七」：寧可少
 *   背景，不要留下 competing fact）。
 */
function serializeHandoffBackground(
  handoffContext: AiHandoffContext,
  submittedAnswers: Record<string, AuthoritativeFactValue | undefined>
): string {
  const prefill = handoffContext.prefillDataJson as Record<string, unknown>;
  const { remainingReferenceFacts, supersededBooleanKeys } = buildAuthoritativeReferenceBackground({
    handoffSummary: handoffContext.handoffSummary,
    prefillData: prefill,
    submittedAnswers,
  });
  const remainingText = Object.keys(remainingReferenceFacts).length > 0
    ? JSON.stringify(remainingReferenceFacts)
    : "（無）";

  if (supersededBooleanKeys.length === 0) {
    // 沒有任何「是／否」類事實被表單覆蓋——enum／陣列型別欄位被回答通常只是
    // 選項更新，不是肯定/否定事實，handoffSummary 不可能重複帶回被覆蓋的舊
    // 事實，可以放心保留完整敘述背景（見「八」的 ERP 範例）。
    return [
      `對話摘要（使用者主動要求轉交顧問時的背景，僅供參考）：${handoffContext.handoffSummary}`,
      `對話中已確認的補充背景資訊（僅供參考）：${remainingText}`,
    ].join("\n");
  }

  const labels = supersededBooleanKeys.map(k => PREFILL_KEY_LABELS[k] ?? k);
  return [
    `對話摘要：已省略——正式表單已經回答了對話期間記錄的是／否事實（${labels.join("、")}），為避免這段自由文字用直述句重複帶出已被表單覆蓋的舊事實，這裡不提供原始對話摘要，僅提供下面經過程式篩選、確認「正式表單沒有回答」的殘餘背景。`,
    `對話中已確認、但「正式表單沒有回答對應概念」時才保留的補充背景資訊（僅供參考，凡正式表單已回答的項目都已由系統剔除，不會出現在這裡）：${remainingText}`,
  ].join("\n");
}

function buildCommonContextBlock(params: {
  handoffContext: AiHandoffContext;
  factoryContext: AiFactoryContext | null;
  submittedAnswers: Record<string, AuthoritativeFactValue | undefined>;
}): string {
  return [
    "===== 企業公開 context（僅供參考背景，不是判斷依據的主要來源）=====",
    serializeFactoryContext(params.factoryContext),
    "",
    "===== 對話期間背景（僅供參考的補充資訊；系統已事先剔除所有跟下面「最終送出的正式表單」重複或衝突的舊值，這裡不會再出現需要你自己判斷衝突的項目）=====",
    serializeHandoffBackground(params.handoffContext, params.submittedAnswers),
  ].join("\n");
}

/** 呼叫一次 LLM，要求回傳單一 JSON object，找不到/解析失敗就直接丟錯給呼叫端處理（標記 failed）。 */
async function callAssessmentModel(systemPrompt: string, maxTokens: number): Promise<Record<string, unknown>> {
  const messages: AiChatMessage[] = [{ role: "system", content: systemPrompt }];
  const provider = getAiChatProvider();
  const raw = await provider.completeJson(messages, maxTokens);
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AI assessment 回傳的不是合法 JSON object");
  }
  return parsed as Record<string, unknown>;
}

function asShortString(value: unknown, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) return UNKNOWN_TEXT;
  return value.trim().slice(0, maxLength);
}

// ===== 政府補助 =====

export interface GovSubsidySubmittedForm {
  decisionMakerParticipation: string;
  annualRevenue: string;
  employeeCount: string;
  factoryType: string;
  isEnterpriseFirm: boolean;
  hasGovernmentProject: boolean;
  governmentProjectName: string | null;
  hasAppliedForGovernmentSubsidy: boolean;
  hasPatent: boolean;
  patentCount: number | null;
  exportStatus: string;
  notes: string | null;
}

function buildGovSubsidyPrompt(params: {
  submittedForm: GovSubsidySubmittedForm;
  handoffContext: AiHandoffContext;
  factoryContext: AiFactoryContext | null;
}): string {
  const programs = AI_SERVICE_REGISTRY.find(s => s.key === "gov_subsidy")?.govSubsidyPrograms ?? [];
  const programProfiles = programs.map(p => `- ${p.name}：${p.profile}`).join("\n");
  const form = params.submittedForm;
  // key 命名對應 handoffPrefill.ts govSubsidyFieldSpecs 的 prefill key，用來
  // 讓 buildAuthoritativeReferenceBackground 知道哪些 handoff 舊值已經被正式
  // 表單回答、必須剔除（見「一」「二」）。這裡全部欄位在型別上都是必填，因此
  // 一律視為「已回答」；govProjectName／patentCount 依附在對應的 boolean 是否
  // 成立，boolean 一旦確定，連帶把這個概念也一起解決掉（false 時舊的「有專利
  // N 件」不能再殘留當背景）。
  const submittedAnswers: Record<string, AuthoritativeFactValue | undefined> = {
    decisionMakerParticipation: form.decisionMakerParticipation,
    annualRevenue: form.annualRevenue,
    employeeCount: form.employeeCount,
    factoryType: form.factoryType,
    isEnterpriseFirm: form.isEnterpriseFirm,
    hasGovProject: form.hasGovernmentProject,
    govProjectName: form.hasGovernmentProject ? (form.governmentProjectName ?? null) : null,
    hasAppliedForSubsidy: form.hasAppliedForGovernmentSubsidy,
    hasPatent: form.hasPatent,
    patentCount: form.hasPatent ? (form.patentCount ?? null) : null,
    exportMode: form.exportStatus,
  };

  return [
    "你是協助顧問快速看懂政府補助案件的助理。這是內部整理步驟，不是公開文件，輸出只會顯示給合作顧問看，不是政府審查結果。",
    "",
    "===== 最終送出的正式申請表單（權威資料，優先於下面所有其他背景）=====",
    `決策者是否共同參與洽談：${form.decisionMakerParticipation}`,
    `年營收：${form.annualRevenue}`,
    `員工人數：${form.employeeCount}`,
    `工廠類型：${form.factoryType}`,
    `是否為企業社：${form.isEnterpriseFirm ? "是" : "否"}`,
    `是否曾執行政府計畫：${form.hasGovernmentProject ? `是（${form.governmentProjectName ?? "未填寫計畫名稱"}）` : "否"}`,
    `是否曾申請過政府補助：${form.hasAppliedForGovernmentSubsidy ? "是" : "否"}`,
    `是否持有專利：${form.hasPatent ? `是（${form.patentCount ?? "未填寫數量"} 件）` : "否"}`,
    `出口模式：${form.exportStatus}`,
    `申請人補充說明：${form.notes ?? "（無）"}`,
    "",
    buildCommonContextBlock({ ...params, submittedAnswers }),
    "",
    "===== 六大政府補助方向側寫（判斷主推薦／次推薦時的依據，不是逐字照搬）=====",
    programProfiles,
    "",
    "【判斷細節，務必遵守】",
    "- 製造業 19+1 AI 診斷輔導：適合企業想導 AI／自動化，但還不知道應該用在哪裡、需要先做診斷的情況；不是「使用者提到 AI 兩個字」就自動推薦，如果企業真正問題是庫存/工單/排程等基礎管理，應該先考慮是否為 ERP 範疇。",
    "- CITD：偏製造業產品／技術／製程／技術升級，不是單純「買設備擴產」。",
    "- SBIR：需要明確的創新研發目標（新產品／新技術／新服務）。",
    "- 研發轉型：必須尊重當年度正式政策條件，不能因為只是大型設備投資就自動推薦。",
    "- SIIR：偏服務／商業模式創新，且需要有市場驗證，不是製造技術本身。",
    "- 海外市場拓展：需要產品已有一定成熟度、準備真正建立海外通路布局，不是只有參展或探路階段。",
    "- 是否為企業社純粹是登記型態資訊，不得做任何負面資格判斷。",
    "",
    "【文案規則，務必遵守】",
    "- AI 初判不是政府審查結果，主推薦／次推薦一律用「目前較適合往 XXX 評估」「若研發創新程度較高可考慮 XXX」這類語氣，絕對不能寫「符合 XXX」「一定可以申請」「核准機率高」這類斷言。",
    "- 表單或背景完全沒有提到的欄位，一律誠實寫「未提供」或「目前未取得相關資訊」，絕對不能自己杜撰或用「應具備一定能力」這種安慰性語句頂替（例如關稅影響沒聊到就寫「未提供」，不能因為「沒有專利」就推論「不適合申請」）。",
    "- 每一欄只寫一句到極短一段，不要寫成報告；不要新增這 8 欄以外的任何欄位（不要 AI 信心、不要進度、不要待確認清單）。",
    "",
    "只回傳一個 JSON object，格式如下，8 個 key 缺一不可，value 一律是簡短字串：",
    '{"primaryRecommendation":"","secondaryRecommendation":"","currentProblem":"","rdStatus":"","equipmentNeed":"","tariffImpact":"","selfFundingCapacity":"","aiReasoning":""}',
  ].join("\n");
}

function parseGovSubsidyAssessment(raw: Record<string, unknown>): GovSubsidyAssessment {
  const result = {} as GovSubsidyAssessment;
  for (const field of GOV_SUBSIDY_FIELDS) {
    result[field] = asShortString(raw[field], 300);
  }
  return result;
}

function govSubsidyAssessmentText(a: GovSubsidyAssessment): string {
  return GOV_SUBSIDY_FIELDS.map(f => `${GOV_SUBSIDY_FIELD_LABELS[f]}：${a[f]}`).join("\n");
}

// ===== ERP =====

export interface ErpSubmittedForm {
  needType: string;
  additionalNotes: string | null;
}

function buildErpPrompt(params: {
  submittedForm: ErpSubmittedForm;
  handoffContext: AiHandoffContext;
  factoryContext: AiFactoryContext | null;
}): string {
  const submittedAnswers: Record<string, AuthoritativeFactValue | undefined> = {
    needType: params.submittedForm.needType,
  };

  return [
    "你是協助顧問快速看懂 ERP／產線優化案件的助理。這是內部整理步驟，輸出只會顯示給合作顧問看。",
    "",
    "===== 最終送出的正式申請表單（權威資料，優先於下面所有其他背景）=====",
    `需求類型：${params.submittedForm.needType}`,
    `申請人補充說明：${params.submittedForm.additionalNotes ?? "（無）"}`,
    "",
    buildCommonContextBlock({ ...params, submittedAnswers }),
    "",
    "【內容規則】summary 必須至少涵蓋：現在訂單／工單／庫存／排程怎麼處理、最主要 bottleneck、想改善什麼、是否有 AI／ERP 整合興趣。完全沒有資料的項目不要寫、不要猜（例如背景完全沒提到 AI，就不要在 summary 裡自己加一句 AI 整合興趣）。禁止把這份 summary 寫成一份顧問報告或重複整段對話摘要，控制在 100～250 個中文字內。",
    "",
    '只回傳一個 JSON object：{"summary":""}',
  ].join("\n");
}

// ===== ISO／低碳認證 =====

export interface CertificationSubmittedForm {
  servicesWantedLabels: string[];
  isUnsure: boolean;
  additionalNotes: string | null;
}

function buildCertificationPrompt(params: {
  submittedForm: CertificationSubmittedForm;
  handoffContext: AiHandoffContext;
  factoryContext: AiFactoryContext | null;
}): string {
  const form = params.submittedForm;
  const submittedAnswers: Record<string, AuthoritativeFactValue | undefined> = {
    servicesWanted: form.servicesWantedLabels,
    isUnsure: form.isUnsure,
  };
  return [
    "你是協助顧問快速看懂 ISO／低碳認證案件的助理。這是內部整理步驟，輸出只會顯示給合作顧問看。",
    "",
    "===== 最終送出的正式申請表單（權威資料，優先於下面所有其他背景）=====",
    `想了解的認證／低碳服務：${form.isUnsure ? "不確定，希望由顧問協助判斷" : (form.servicesWantedLabels.join("、") || "（未選擇）")}`,
    `申請人補充說明：${form.additionalNotes ?? "（無）"}`,
    "",
    buildCommonContextBlock({ ...params, submittedAnswers }),
    "",
    "【內容規則】summary 必須至少涵蓋：想做哪個認證／低碳項目（完全依表單勾選的項目，不得自行新增其他標準，例如表單只勾 ISO 9001，絕對不能自己多寫 ISO 14001）、原因（客戶要求／投標／供應鏈／自主提升／出口需求——只有背景真的有提到才寫）、目前狀態、希望的時間或方向（有資料才寫）。表單勾選「不確定」時，只能誠實寫使用者目前還不確定需要哪一項，不能自己猜一個具體標準。控制在 100～250 個中文字內。",
    "",
    '只回傳一個 JSON object：{"summary":""}',
  ].join("\n");
}

// ===== 短影音／找形象 =====

export interface ShortVideoSubmittedForm {
  servicesWantedLabels: string[];
  isUnsure: boolean;
  primaryGoalLabel: string;
  platformLabels: string[];
  noPlatformYet: boolean;
  additionalNotes: string | null;
}

function buildShortVideoPrompt(params: {
  submittedForm: ShortVideoSubmittedForm;
  handoffContext: AiHandoffContext;
  factoryContext: AiFactoryContext | null;
}): string {
  const form = params.submittedForm;
  const submittedAnswers: Record<string, AuthoritativeFactValue | undefined> = {
    servicesWanted: form.servicesWantedLabels,
    isUnsure: form.isUnsure,
    primaryGoal: form.primaryGoalLabel,
    platforms: form.platformLabels,
    noPlatformYet: form.noPlatformYet,
  };
  return [
    "你是協助顧問快速看懂短影音／品牌內容案件的助理。這是內部整理步驟，輸出只會顯示給合作顧問看。",
    "",
    "===== 最終送出的正式申請表單（權威資料，優先於下面所有其他背景）=====",
    `想了解的服務：${form.isUnsure ? "不確定，希望由顧問協助判斷" : (form.servicesWantedLabels.join("、") || "（未選擇）")}`,
    `主要目標：${form.primaryGoalLabel}`,
    `目前經營平台：${form.noPlatformYet ? "尚未經營任何平台" : (form.platformLabels.join("、") || "（未選擇）")}`,
    `申請人補充說明：${form.additionalNotes ?? "（無）"}`,
    "",
    buildCommonContextBlock({ ...params, submittedAnswers }),
    "",
    "【內容規則】summary 必須至少涵蓋：可拍的企業故事／製程／創辦人／MIT 亮點（只依表單與背景實際提到的內容，不得自行發明）、使用者想達成什麼、預計投放平台（完全依表單勾選，表單沒勾的平台絕對不能自己加，例如表單只勾 Instagram，不能自己多寫 TikTok／YouTube）、是否已有社群經營基礎。「想增加曝光」這種泛用描述不足以自動寫成已確認的平台或內容形式。控制在 100～250 個中文字內。",
    "",
    '只回傳一個 JSON object：{"summary":""}',
  ].join("\n");
}

// ===== 企業財務 =====
// 表單本身沒有任何業務欄位（見 Phase 4 既有結論），summary 完全依 handoffSummary／
// prefillData／企業 context 產生，因此不需要 submittedForm 型別。

function buildFinancePrompt(params: {
  handoffContext: AiHandoffContext;
  factoryContext: AiFactoryContext | null;
}): string {
  // finance 表單沒有任何業務欄位可對照（見 buildFieldSpecs 的 finance 分支），
  // submittedAnswers 恆為空物件——不影響行為，因為 prefillData 本來就恆為 {}。
  const submittedAnswers: Record<string, AuthoritativeFactValue | undefined> = {};
  return [
    "你是協助顧問快速看懂企業財務優化案件的助理。這是內部整理步驟，輸出只會顯示給合作顧問看。這個服務的正式申請表單本身沒有業務欄位（只有聯絡資料），因此業務判斷完全依賴下面的對話期間背景。",
    "",
    buildCommonContextBlock({ ...params, submittedAnswers }),
    "",
    "【內容規則】summary 必須至少涵蓋：資金／現金流問題、資金用途、帳期／應收款／週轉情況、現有融資背景（有資料才寫）、使用者想解決什麼。完全沒有資料的項目不要寫、不要猜。絕對不能承諾貸款額度、利率、或保證一定可核貸。控制在 100～250 個中文字內。",
    "",
    '只回傳一個 JSON object：{"summary":""}',
  ].join("\n");
}

function parseShortSummary(raw: Record<string, unknown>): ShortSummaryAssessment {
  return { summary: asShortString(raw.summary, 500) };
}

// ===== 統一入口 =====

type InitiateParams =
  | { serviceKey: "gov_subsidy"; submittedForm: GovSubsidySubmittedForm }
  | { serviceKey: "erp"; submittedForm: ErpSubmittedForm }
  | { serviceKey: "certification"; submittedForm: CertificationSubmittedForm }
  | { serviceKey: "short_video"; submittedForm: ShortVideoSubmittedForm }
  | { serviceKey: "finance"; submittedForm: Record<string, never> };

export type InitiateCaseAssessmentParams = InitiateParams & {
  handoffContext: AiHandoffContext;
  caseId: number;
  factoryId: number;
  userId: number;
};

async function runGeneration(params: InitiateCaseAssessmentParams, factoryContext: AiFactoryContext | null): Promise<{ assessmentJson: Record<string, unknown>; assessmentText: string }> {
  switch (params.serviceKey) {
    case "gov_subsidy": {
      const prompt = buildGovSubsidyPrompt({ submittedForm: params.submittedForm, handoffContext: params.handoffContext, factoryContext });
      const raw = await callAssessmentModel(prompt, 700);
      const parsed = parseGovSubsidyAssessment(raw);
      return { assessmentJson: parsed as unknown as Record<string, unknown>, assessmentText: govSubsidyAssessmentText(parsed) };
    }
    case "erp": {
      const prompt = buildErpPrompt({ submittedForm: params.submittedForm, handoffContext: params.handoffContext, factoryContext });
      const raw = await callAssessmentModel(prompt, 400);
      const parsed = parseShortSummary(raw);
      return { assessmentJson: parsed as unknown as Record<string, unknown>, assessmentText: parsed.summary };
    }
    case "certification": {
      const prompt = buildCertificationPrompt({ submittedForm: params.submittedForm, handoffContext: params.handoffContext, factoryContext });
      const raw = await callAssessmentModel(prompt, 400);
      const parsed = parseShortSummary(raw);
      return { assessmentJson: parsed as unknown as Record<string, unknown>, assessmentText: parsed.summary };
    }
    case "short_video": {
      const prompt = buildShortVideoPrompt({ submittedForm: params.submittedForm, handoffContext: params.handoffContext, factoryContext });
      const raw = await callAssessmentModel(prompt, 400);
      const parsed = parseShortSummary(raw);
      return { assessmentJson: parsed as unknown as Record<string, unknown>, assessmentText: parsed.summary };
    }
    case "finance": {
      const prompt = buildFinancePrompt({ handoffContext: params.handoffContext, factoryContext });
      const raw = await callAssessmentModel(prompt, 400);
      const parsed = parseShortSummary(raw);
      return { assessmentJson: parsed as unknown as Record<string, unknown>, assessmentText: parsed.summary };
    }
  }
}

/** createPendingAssessment 是單純一筆 INSERT，失敗多半是暫時性 DB 抖動，值得原地重試幾次。 */
const PENDING_CREATE_ATTEMPTS = 3;
const PENDING_CREATE_RETRY_DELAY_MS = 150;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createPendingAssessmentWithRetry(params: {
  userId: number;
  factoryId: number;
  serviceKey: HandoffEligibleServiceKey;
  caseId: number;
  handoffContextId: number;
}): Promise<number | null> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= PENDING_CREATE_ATTEMPTS; attempt++) {
    try {
      return await createPendingAssessment(params);
    } catch (err) {
      lastErr = err;
      if (attempt < PENDING_CREATE_ATTEMPTS) await delay(PENDING_CREATE_RETRY_DELAY_MS * attempt);
    }
  }
  console.error(
    `[caseAssessment] createPendingAssessment 重試 ${PENDING_CREATE_ATTEMPTS} 次仍失敗 (${params.serviceKey}#${params.caseId}, handoffContextId=${params.handoffContextId}):`,
    lastErr instanceof Error ? lastErr.message : lastErr
  );
  return null;
}

/**
 * 唯一對外入口，供 5 個 submitApplication mutation 在案件成立、handoff token
 * 確認有效之後呼叫。可靠性修正（見對話中「四、Assessment pending row 建立
 * 失敗的漏洞」「五、Handoff consume 與 Assessment record 的最低保證」）：
 * - pending record 的建立本身仍然不能讓案件建立失敗——但原本「即使失敗也
 *   靜默 return」的做法，配合呼叫端無論如何都會消費 handoff token，會造成
 *   「token 已消費、卻完全沒有 assessment record，連 retry job 都找不到這筆
 *   案件」的永久遺失。這裡改成：(1) pending row 建立本身先做有限次數的原地
 *   重試（多半只是暫時性 DB 抖動）；(2) 回傳 boolean 讓呼叫端知道 pending
 *   row 是否真的建立成功；(3) 只有回傳 true 時，呼叫端才可以消費 handoff
 *   token（見 routers.ts 五處 submitApplication 呼叫端的對應調整）——如果
 *   最終仍然失敗，handoff token 保持未消費、未過期前仍是可追溯、可辨識「這
 *   筆案件需要 assessment」的唯一線索，而不是被消費後從此無法追溯。
 * - 真正的 LLM 生成與寫入完成/失敗狀態仍是 fire-and-forget（不 await），確保
 *   submitApplication 的 response 永遠不會被 LLM 延遲或失敗拖住。
 */
export async function initiateCaseAssessment(params: InitiateCaseAssessmentParams): Promise<boolean> {
  const assessmentId = await createPendingAssessmentWithRetry({
    userId: params.userId,
    factoryId: params.factoryId,
    serviceKey: params.serviceKey,
    caseId: params.caseId,
    handoffContextId: params.handoffContext.id,
  });
  if (assessmentId == null) return false;

  void (async () => {
    try {
      const factoryContext = await getAiFactoryContextByFactoryId(params.factoryId);
      const { assessmentJson, assessmentText } = await runGeneration(params, factoryContext);
      await markAssessmentCompleted(assessmentId, { assessmentJson, assessmentText });
    } catch (err) {
      console.error(`[caseAssessment] generation failed for assessment #${assessmentId} (${params.serviceKey}#${params.caseId}):`, err instanceof Error ? err.message : err);
      await markAssessmentFailed(assessmentId, err instanceof Error ? err.message : "unknown error").catch(() => {});
    }
  })();
  return true;
}

/**
 * buildRetryInitiateParams 的輸入形狀——刻意只取用到的 5 個欄位，不要求整筆
 * AiCaseAssessment（見對話中「七、Assessment recovery 資料來源」）：真正的
 * AiCaseAssessment row 天然滿足這個形狀（原本 retry job 的呼叫方式不必改），
 * 但 missing-assessment recovery 這種「assessment row 根本還不存在、只有
 * handoff context 本身」的情境，也可以直接從 AiHandoffContext 組出同樣形狀
 * 呼叫，不必先假造一筆不存在的 assessment 物件。
 */
export interface RetryParamsSource {
  handoffContextId: number | null;
  factoryId: number | null;
  userId: number | null;
  caseId: number;
  serviceKey: string;
}

/**
 * 供 retry job／missing-assessment recovery 共用——從 serviceKey/caseId/
 * handoffContextId 重新讀回「當下最新的正式案件資料」與 handoff context，
 * 組成跟第一次生成時同樣形狀的參數（見對話中「三十二、Assessment 生成後
 * 不應再依賴 conversation 原文」：這裡完全不讀任何 conversation，只讀案件
 * 本身與 handoff context 的既有欄位）。任何一段讀不到（例如 handoff context
 * 已經被清理、或案件本身查無資料）都回傳 null，呼叫端應該把這次 retry
 * 視為仍然失敗，不嘗試硬湊資料。
 */
export async function buildRetryInitiateParams(source: RetryParamsSource): Promise<InitiateCaseAssessmentParams | null> {
  if (source.handoffContextId == null || source.factoryId == null) return null;
  const handoffContext = await getHandoffContextById(source.handoffContextId);
  if (!handoffContext) return null;
  const userId = source.userId;
  if (userId == null) return null;
  const common = { handoffContext, caseId: source.caseId, factoryId: source.factoryId, userId };

  switch (source.serviceKey as HandoffEligibleServiceKey) {
    case "gov_subsidy": {
      const row = await db.getUpgradeApplicationById(source.caseId);
      if (!row) return null;
      return {
        ...common,
        serviceKey: "gov_subsidy",
        submittedForm: {
          decisionMakerParticipation: row.decisionMakerParticipation ?? UNKNOWN_TEXT,
          annualRevenue: row.annualRevenue ?? UNKNOWN_TEXT,
          employeeCount: row.employeeCount,
          factoryType: row.factoryType,
          isEnterpriseFirm: row.isEnterpriseFirm ?? false,
          hasGovernmentProject: row.hasGovernmentProject,
          governmentProjectName: row.governmentProjectName ?? null,
          hasAppliedForGovernmentSubsidy: row.hasAppliedForGovernmentSubsidy ?? false,
          hasPatent: row.hasPatent,
          patentCount: row.patentCount ?? null,
          exportStatus: row.exportStatus,
          notes: row.notes ?? null,
        },
      };
    }
    case "erp": {
      const row = await db.getErpCaseById(source.caseId);
      if (!row) return null;
      return {
        ...common,
        serviceKey: "erp",
        submittedForm: { needType: erpNeedTypeLabel(row.needType), additionalNotes: row.additionalNotes ?? null },
      };
    }
    case "certification": {
      const row = await db.getCertificationCaseById(source.caseId);
      if (!row) return null;
      const servicesWanted = (row.servicesWanted as string[] | null) ?? [];
      const catalog = servicesWanted.length > 0 ? await db.listPublicCertificationServices() : [];
      const nameByCode = new Map(catalog.map(c => [c.code, c.name]));
      return {
        ...common,
        serviceKey: "certification",
        submittedForm: {
          servicesWantedLabels: servicesWanted.map(code => nameByCode.get(code) ?? code),
          isUnsure: row.isUnsure,
          additionalNotes: row.additionalNotes ?? null,
        },
      };
    }
    case "short_video": {
      const row = await db.getShortVideoCaseById(source.caseId);
      if (!row) return null;
      const servicesWanted = (row.servicesWanted as string[] | null) ?? [];
      const platforms = (row.platforms as string[] | null) ?? [];
      return {
        ...common,
        serviceKey: "short_video",
        submittedForm: {
          servicesWantedLabels: servicesWanted.map(shortVideoServiceLabel),
          isUnsure: row.isUnsure,
          primaryGoalLabel: SHORT_VIDEO_GOALS.find(g => g.key === row.primaryGoal)?.label ?? row.primaryGoal,
          platformLabels: platforms.map(shortVideoPlatformLabel),
          noPlatformYet: row.noPlatformYet,
          additionalNotes: row.additionalNotes ?? null,
        },
      };
    }
    case "finance": {
      const row = await db.getFinanceApplicationById(source.caseId);
      if (!row) return null;
      return { ...common, serviceKey: "finance", submittedForm: {} };
    }
  }
}

/** 供 retry job 使用——重新生成同一筆 assessment 的內容並更新既有 row（見「二十六」）。 */
export async function regenerateCaseAssessment(
  assessmentId: number,
  params: InitiateCaseAssessmentParams
): Promise<void> {
  const factoryContext = await getAiFactoryContextByFactoryId(params.factoryId);
  const { assessmentJson, assessmentText } = await runGeneration(params, factoryContext);
  await markAssessmentCompleted(assessmentId, { assessmentJson, assessmentText });
}

export type { HandoffEligibleServiceKey };
