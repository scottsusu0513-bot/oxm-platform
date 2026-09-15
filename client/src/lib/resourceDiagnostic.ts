// /resources 頁「企業需求診斷」小工具的純邏輯（題目設定、計分、結果判斷）。
// 刻意跟 UI（client/src/components/ResourceDiagnostic.tsx）分開放，避免計分
// 規則散落在 JSX 裡，未來調整題目／權重只需要改這個檔案，且方便單獨測試
// calculateRecommendation() 這個純函式，不需要 render 元件。
//
// 完全前端純規則計分：不接 AI、不呼叫 API、不存資料庫，也不用
// localStorage／sessionStorage——重新整理即回到初始狀態（見任務要求）。
//
// href 直接引用 RESOURCES_CONTENT.services（/resources 頁四張服務卡片共用
// 的同一份內容來源），不重新硬寫網址，確保診斷結果的 CTA 永遠跟卡片本身的
// 連結一致，不會出現「猜錯網址」的風險。
import { RESOURCES_CONTENT } from "@shared/content/resources";

export type ResourceKey = "subsidy" | "finance" | "iso" | "erp";

/** 固定的推薦優先順序，也是頁面上四張服務卡片本身的順序：同分時用它決定
 *  哪個排前面，不用亂數，確保結果每次都穩定一致（見任務要求 D）。 */
export const RESOURCE_ORDER: ResourceKey[] = ["subsidy", "finance", "iso", "erp"];

type ScoreDelta = Partial<Record<ResourceKey, number>>;

export interface DiagnosticOption {
  id: string;
  label: string;
  /** 省略等同於不加分（例如 Q2 的「都沒有／還在評估」、Q4 的所有選項）。 */
  score?: ScoreDelta;
  /** 只有 Q2（複選）會用到：選了這個選項要跟同一題其他選項互斥。 */
  exclusive?: boolean;
}

export interface DiagnosticQuestion {
  id: "q1" | "q2" | "q3" | "q4";
  type: "single" | "multi";
  title: string;
  /** 必填題：未作答時 submit 會被擋下並顯示提示（見 isComplete）。Q2 是複選
   *  且允許不選（等同「都沒有」），所以不列入必填。 */
  required: boolean;
  options: DiagnosticOption[];
}

export const DIAGNOSTIC_QUESTIONS: DiagnosticQuestion[] = [
  {
    id: "q1",
    type: "single",
    required: true,
    title: "目前最想解決的問題是？",
    options: [
      { id: "q1-subsidy", label: "想申請政府補助，降低投資成本", score: { subsidy: 3 } },
      { id: "q1-finance", label: "資金、貸款或企業財務需要改善", score: { finance: 3 } },
      { id: "q1-iso", label: "客戶要求 ISO、碳盤查或相關認證", score: { iso: 3 } },
      { id: "q1-erp", label: "生產管理、訂單、庫存或流程很混亂", score: { erp: 3 } },
      { id: "q1-unsure", label: "還不確定，只知道公司需要改善", score: { subsidy: 1, finance: 1, iso: 1, erp: 1 } },
    ],
  },
  {
    id: "q2",
    type: "multi",
    required: false,
    title: "公司最近是否準備進行下列事情？",
    options: [
      { id: "q2-equipment", label: "購買設備／擴廠", score: { subsidy: 2, finance: 1 } },
      { id: "q2-digital", label: "數位轉型／導入系統", score: { erp: 2, subsidy: 1 } },
      { id: "q2-export", label: "接大企業或外銷客戶", score: { iso: 2 } },
      { id: "q2-energy", label: "節能減碳／能源改善", score: { iso: 2, subsidy: 1 } },
      { id: "q2-funding", label: "融資／增加營運資金", score: { finance: 3 } },
      { id: "q2-none", label: "都沒有／還在評估", exclusive: true },
    ],
  },
  {
    id: "q3",
    type: "single",
    required: true,
    title: "目前最讓你困擾的是？",
    options: [
      { id: "q3-subsidy", label: "不知道有哪些補助可以申請", score: { subsidy: 3 } },
      { id: "q3-finance", label: "資金壓力或財務結構", score: { finance: 3 } },
      { id: "q3-iso", label: "不知道該做哪一種認證", score: { iso: 3 } },
      { id: "q3-erp", label: "公司很多事情還靠人工、Excel、紙本", score: { erp: 3 } },
      { id: "q3-unsure", label: "不知道問題到底出在哪裡", score: { subsidy: 1, finance: 1, iso: 1, erp: 1 } },
    ],
  },
  {
    id: "q4",
    type: "single",
    required: true,
    title: "你目前希望在多久內處理？",
    options: [
      { id: "q4-urgent", label: "近期就要處理" },
      { id: "q4-mid", label: "3～6 個月內" },
      { id: "q4-later", label: "先了解、之後再規劃" },
    ],
  },
];

export interface Answers {
  q1: string | null;
  q2: string[];
  q3: string | null;
  q4: string | null;
}

export const INITIAL_ANSWERS: Answers = { q1: null, q2: [], q3: null, q4: null };

function findQuestion(id: DiagnosticQuestion["id"]): DiagnosticQuestion {
  const question = DIAGNOSTIC_QUESTIONS.find(q => q.id === id);
  if (!question) throw new Error(`Unknown diagnostic question: ${id}`);
  return question;
}

function findOption(questionId: DiagnosticQuestion["id"], optionId: string): DiagnosticOption | undefined {
  return findQuestion(questionId).options.find(o => o.id === optionId);
}

/** 複選題（目前只有 Q2）的切換邏輯：選到 exclusive 選項（「都沒有／還在
 *  評估」）就清空其他選項並只留它；選到任何非 exclusive 選項則自動移除
 *  已選的 exclusive 選項，兩者互斥（見任務要求 B 的注意事項）。 */
export function toggleMultiAnswer(questionId: DiagnosticQuestion["id"], current: string[], optionId: string): string[] {
  const question = findQuestion(questionId);
  const option = question.options.find(o => o.id === optionId);
  if (!option) return current;

  if (option.exclusive) {
    return current.includes(optionId) ? [] : [optionId];
  }

  const withoutExclusive = current.filter(id => !question.options.find(o => o.id === id)?.exclusive);
  return withoutExclusive.includes(optionId)
    ? withoutExclusive.filter(id => id !== optionId)
    : [...withoutExclusive, optionId];
}

/** 必填題（Q1／Q3／Q4）是否都已作答；Q2 允許保持未選。 */
export function isComplete(answers: Answers): boolean {
  return DIAGNOSTIC_QUESTIONS.filter(q => q.required).every(q => {
    const value = answers[q.id];
    return typeof value === "string" ? value.length > 0 : Array.isArray(value) && value.length > 0;
  });
}

/** 不分是否必填，單純判斷某一題目前是否已作答，供進度指示器使用。 */
export function isQuestionAnswered(question: DiagnosticQuestion, answers: Answers): boolean {
  const value = answers[question.id];
  if (typeof value === "string") return value.length > 0;
  return Array.isArray(value) && value.length > 0;
}

/** 個別必填題是否還沒作答，供 UI 在對應題目旁顯示輕量提示用。 */
export function isQuestionMissing(question: DiagnosticQuestion, answers: Answers): boolean {
  if (!question.required) return false;
  return !isQuestionAnswered(question, answers);
}

export interface Recommendation {
  primary: ResourceKey;
  secondary: ResourceKey | null;
  scores: Record<ResourceKey, number>;
}

/** 純函式：依目前作答計算四個維度分數，回傳主推薦／次推薦。同分時不用亂
 *  數，靠 RESOURCE_ORDER 的固定順序＋穩定排序（Array.prototype.sort 自
 *  ES2019 起保證穩定）決定順序，確保結果每次重算都一致（見任務要求 D）。
 *  次推薦門檻：分數 >= 最高分 - 2 才顯示，否則回傳 null（見任務要求 D）。 */
export function calculateRecommendation(answers: Answers): Recommendation {
  const scores: Record<ResourceKey, number> = { subsidy: 0, finance: 0, iso: 0, erp: 0 };

  const addScore = (delta: ScoreDelta | undefined) => {
    if (!delta) return;
    for (const key of RESOURCE_ORDER) scores[key] += delta[key] ?? 0;
  };

  if (answers.q1) addScore(findOption("q1", answers.q1)?.score);
  for (const optionId of answers.q2) addScore(findOption("q2", optionId)?.score);
  if (answers.q3) addScore(findOption("q3", answers.q3)?.score);

  const ranked = RESOURCE_ORDER
    .map(key => ({ key, score: scores[key] }))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  const runnerUp = ranked[1];
  const secondary = runnerUp && runnerUp.score >= top.score - 2 ? runnerUp.key : null;

  return { primary: top.key, secondary, scores };
}

/** 第 4 題只影響文案，不影響分類（見任務要求 C）。文案沿用任務要求給的三句
 *  範例，刻意簡短，附加在結果說明之後，不重寫成一整段冗長文字。 */
const URGENCY_TEXT: Record<string, string> = {
  "q4-urgent": "建議優先了解。",
  "q4-mid": "適合現在開始規劃。",
  "q4-later": "可先了解服務內容與適用情境。",
};

export function getUrgencyText(q4: string | null): string | null {
  if (!q4) return null;
  return URGENCY_TEXT[q4] ?? null;
}

export interface ResultContent {
  key: ResourceKey;
  title: string;
  description: string;
  href: string;
}

// title/description 文字為任務要求 F 指定的固定文案；href 引用
// RESOURCES_CONTENT.services（/resources 四張服務卡片同一份內容來源），
// index 對應 shared/content/resources.ts 既有順序：0=政府補助、1=企業財務、
// 2=ISO／低碳、3=ERP／MES（與 client/src/pages/ResourceCenter.tsx 的
// RESOURCE_SERVICE_UI 陣列順序一致）。
const RESULT_BASE: Record<ResourceKey, Omit<ResultContent, "key">> = {
  subsidy: {
    title: "政府補助",
    description: "從您的回答來看，目前可能有設備投資、數位轉型、節能改善或其他企業升級需求，建議先了解目前可申請的政府補助方案與適用條件。",
    href: RESOURCES_CONTENT.services[0].href,
  },
  finance: {
    title: "企業財務優化",
    description: "從您的回答來看，目前較需要先釐清資金需求、融資條件或企業財務結構，再評估適合的改善方向與資金方案。",
    href: RESOURCES_CONTENT.services[1].href,
  },
  iso: {
    title: "ISO 與低碳認證",
    description: "從您的回答來看，目前較需要先釐清客戶要求、現有管理制度與認證目標，再判斷適合導入 ISO、碳盤查或其他低碳服務。",
    href: RESOURCES_CONTENT.services[2].href,
  },
  erp: {
    title: "ERP / MES 與產線優化",
    description: "從您的回答來看，目前可能存在訂單、庫存、生產流程或資訊分散等管理問題，建議先了解是否適合透過 ERP、MES 或流程數位化進行改善。",
    href: RESOURCES_CONTENT.services[3].href,
  },
};

export function buildResultContent(key: ResourceKey): ResultContent {
  return { key, ...RESULT_BASE[key] };
}
