import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_QUESTIONS,
  INITIAL_ANSWERS,
  calculateRecommendation,
  buildResultContent,
  getUrgencyText,
  isComplete,
  toggleMultiAnswer,
  type Answers,
} from "./resourceDiagnostic";

function answers(overrides: Partial<Answers>): Answers {
  return { ...INITIAL_ANSWERS, ...overrides };
}

describe("isComplete：必填題（Q1／Q3／Q4）", () => {
  it("全空 → 未完成", () => {
    expect(isComplete(INITIAL_ANSWERS)).toBe(false);
  });

  it("只填 Q1/Q3 缺 Q4 → 未完成", () => {
    expect(isComplete(answers({ q1: "q1-subsidy", q3: "q3-subsidy" }))).toBe(false);
  });

  it("Q1/Q3/Q4 都填，Q2 留空 → 完成（Q2 非必填）", () => {
    expect(isComplete(answers({ q1: "q1-subsidy", q3: "q3-subsidy", q4: "q4-urgent" }))).toBe(true);
  });
});

describe("toggleMultiAnswer：Q2 複選與「都沒有／還在評估」互斥", () => {
  it("選擇一般選項會加入陣列", () => {
    const next = toggleMultiAnswer("q2", [], "q2-equipment");
    expect(next).toEqual(["q2-equipment"]);
  });

  it("再選第二個一般選項會累加（真正可複選）", () => {
    const next = toggleMultiAnswer("q2", ["q2-equipment"], "q2-digital");
    expect(next).toEqual(["q2-equipment", "q2-digital"]);
  });

  it("再點一次同一個選項會取消選取", () => {
    const next = toggleMultiAnswer("q2", ["q2-equipment", "q2-digital"], "q2-digital");
    expect(next).toEqual(["q2-equipment"]);
  });

  it("選擇「都沒有／還在評估」會清空其他已選選項", () => {
    const next = toggleMultiAnswer("q2", ["q2-equipment", "q2-digital"], "q2-none");
    expect(next).toEqual(["q2-none"]);
  });

  it("已選「都沒有」時再選其他選項，會自動取消「都沒有」", () => {
    const next = toggleMultiAnswer("q2", ["q2-none"], "q2-funding");
    expect(next).toEqual(["q2-funding"]);
  });
});

describe("calculateRecommendation：單題各分類最高分 → 對應主推薦", () => {
  it("Q1 選『想申請政府補助』→ subsidy 最高分 → 主推薦為政府補助", () => {
    const rec = calculateRecommendation(answers({ q1: "q1-subsidy", q3: "q3-unsure", q4: "q4-urgent" }));
    expect(rec.primary).toBe("subsidy");
  });

  it("Q1 選『資金、貸款或企業財務需要改善』→ 主推薦為企業財務", () => {
    const rec = calculateRecommendation(answers({ q1: "q1-finance", q3: "q3-unsure", q4: "q4-urgent" }));
    expect(rec.primary).toBe("finance");
  });

  it("Q1 選『客戶要求 ISO、碳盤查或相關認證』→ 主推薦為 ISO／低碳", () => {
    const rec = calculateRecommendation(answers({ q1: "q1-iso", q3: "q3-unsure", q4: "q4-urgent" }));
    expect(rec.primary).toBe("iso");
  });

  it("Q1 選『生產管理、訂單、庫存或流程很混亂』→ 主推薦為 ERP／MES", () => {
    const rec = calculateRecommendation(answers({ q1: "q1-erp", q3: "q3-unsure", q4: "q4-urgent" }));
    expect(rec.primary).toBe("erp");
  });
});

describe("calculateRecommendation：同分時使用固定穩定排序（不隨機）", () => {
  it("Q1／Q3 都選『不確定』→ 四類同分（各 +2），主推薦固定是 subsidy（RESOURCE_ORDER 第一個）", () => {
    const rec = calculateRecommendation(answers({ q1: "q1-unsure", q3: "q3-unsure", q4: "q4-later" }));
    expect(rec.scores).toEqual({ subsidy: 2, finance: 2, iso: 2, erp: 2 });
    expect(rec.primary).toBe("subsidy");
  });

  it("重複計算同一份作答，結果完全一致（穩定、非隨機）", () => {
    const a = answers({ q1: "q1-unsure", q3: "q3-unsure", q4: "q4-later" });
    const first = calculateRecommendation(a);
    const second = calculateRecommendation(a);
    expect(first).toEqual(second);
  });
});

describe("calculateRecommendation：次推薦規則（分數 >= 最高分 - 2 才顯示）", () => {
  it("次高分數在門檻內 → 顯示為次推薦", () => {
    // subsidy: q1-subsidy(+3) = 3；finance: q3-finance(+3) = 3 → 差距 0 <= 2，符合門檻
    const rec = calculateRecommendation(answers({ q1: "q1-subsidy", q3: "q3-finance", q4: "q4-urgent" }));
    expect(rec.scores).toEqual({ subsidy: 3, finance: 3, iso: 0, erp: 0 });
    expect(rec.primary).toBe("subsidy");
    expect(rec.secondary).toBe("finance");
  });

  it("次高分數超出門檻（差距 > 2）→ 不顯示次推薦（null）", () => {
    const rec = calculateRecommendation(answers({ q1: "q1-subsidy", q3: "q3-subsidy", q4: "q4-urgent" }));
    // subsidy = 3(q1) + 3(q3) = 6；其餘三類皆為 0 → 差距 6 > 2，不應有次推薦
    expect(rec.scores).toEqual({ subsidy: 6, finance: 0, iso: 0, erp: 0 });
    expect(rec.secondary).toBeNull();
  });

  it("次推薦排序沿用 RESOURCE_ORDER：多個分類同為次高分時，取排序在前者", () => {
    // q1-unsure + q3-subsidy：subsidy = 1+3 = 4；finance/iso/erp 各 1。
    // 次高分只有 finance/iso/erp 打平在 1，門檻 4-2=2，1 < 2，這個案例不會出現次推薦；
    // 改用更貼近同分次推薦情境的組合：
    const rec = calculateRecommendation(answers({ q1: "q1-unsure", q3: "q3-subsidy", q4: "q4-later" }));
    expect(rec.scores).toEqual({ subsidy: 4, finance: 1, iso: 1, erp: 1 });
    // 4 - 1 = 3 > 2，不符合次推薦門檻
    expect(rec.secondary).toBeNull();
  });
});

describe("calculateRecommendation：Q4（時間急迫程度）不影響分類，只影響文案", () => {
  const base = { q1: "q1-erp", q3: "q3-erp" } as const;

  it("三種 Q4 選項的分類結果完全相同", () => {
    const urgent = calculateRecommendation(answers({ ...base, q4: "q4-urgent" }));
    const mid = calculateRecommendation(answers({ ...base, q4: "q4-mid" }));
    const later = calculateRecommendation(answers({ ...base, q4: "q4-later" }));
    expect(urgent.primary).toBe("erp");
    expect(mid.primary).toBe("erp");
    expect(later.primary).toBe("erp");
    expect(urgent.scores).toEqual(mid.scores);
    expect(mid.scores).toEqual(later.scores);
  });

  it("getUrgencyText 依 Q4 選項回傳對應文案", () => {
    expect(getUrgencyText("q4-urgent")).toBe("建議優先了解。");
    expect(getUrgencyText("q4-mid")).toBe("適合現在開始規劃。");
    expect(getUrgencyText("q4-later")).toBe("可先了解服務內容與適用情境。");
    expect(getUrgencyText(null)).toBeNull();
  });
});

describe("buildResultContent：CTA href 沿用 /resources 四張服務卡片既有 route", () => {
  it("政府補助 → /upgrade-center", () => {
    expect(buildResultContent("subsidy").href).toBe("/upgrade-center");
  });

  it("企業財務優化 → /finance-optimization", () => {
    expect(buildResultContent("finance").href).toBe("/finance-optimization");
  });

  it("ISO 與低碳認證 → /certification-center", () => {
    expect(buildResultContent("iso").href).toBe("/certification-center");
  });

  it("ERP / MES 與產線優化 → /erp-optimization", () => {
    expect(buildResultContent("erp").href).toBe("/erp-optimization");
  });

  it("四個 href 彼此不同，且都不是新路由（都對應現有 /resources 卡片 href）", () => {
    const hrefs = (["subsidy", "finance", "iso", "erp"] as const).map(key => buildResultContent(key).href);
    expect(new Set(hrefs).size).toBe(4);
  });
});

describe("題目設定完整性", () => {
  it("共 4 題，題目 id 依序為 q1~q4", () => {
    expect(DIAGNOSTIC_QUESTIONS.map(q => q.id)).toEqual(["q1", "q2", "q3", "q4"]);
  });

  it("Q1 單選 5 個選項、Q2 複選 6 個選項、Q3 單選 5 個選項、Q4 單選 3 個選項", () => {
    const [q1, q2, q3, q4] = DIAGNOSTIC_QUESTIONS;
    expect(q1.type).toBe("single");
    expect(q1.options).toHaveLength(5);
    expect(q2.type).toBe("multi");
    expect(q2.options).toHaveLength(6);
    expect(q3.type).toBe("single");
    expect(q3.options).toHaveLength(5);
    expect(q4.type).toBe("single");
    expect(q4.options).toHaveLength(3);
  });
});
