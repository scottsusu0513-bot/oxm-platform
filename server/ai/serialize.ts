import type { ServiceDefinition, GovSubsidyProgram } from "../../shared/ai/serviceRegistry";
import type { AiFactoryContext } from "./factoryContext";
import type { AiChatTurn } from "./types";

/**
 * Layer 2（OXM Resource Routing）專用的序列化 helper。
 *
 * 刻意獨立成這個檔案：Layer 1（企業診斷層）絕對不能 import
 * serializeService／Service Registry，只有 Layer 2 才可以看到服務清單——這
 * 個檔案的存在本身就是「兩層看得到的資料不同」這個硬規則的其中一道防線
 * （另一道是 diagnosis.ts 的 prompt 內容審查）。serializeFactoryContext 兩層
 * 都會用到（企業背景是一般商業知識，不是 OXM 服務資訊），所以放在這個共用檔
 * 也提供給 diagnosis.ts import。
 */
/**
 * Phase 6G.1（見對話中「政府補助 Program Decision Layer」）：六大政府補助
 * 方向的完整序列化——同一份輸出同時供 routing.ts（透過 serializeService 併入
 * 服務清單）與 caseAssessment.ts 共用，避免兩處各自手寫一份「判斷細節」容易
 * 漂移不一致（見對話中「二十：Case Assessment 去重」）。
 */
export function serializeGovSubsidyPrograms(programs: GovSubsidyProgram[]): string {
  return programs
    .map(p => {
      const lines = [`- ${p.name}（key: ${p.key}）：${p.profile}`];
      if (p.fitSignals && p.fitSignals.length > 0) lines.push(`  適合情境：${p.fitSignals.join("；")}`);
      if (p.cautionSignals && p.cautionSignals.length > 0) lines.push(`  注意／不要誤判：${p.cautionSignals.join("；")}`);
      if (p.comparisonNotes) lines.push(`  與其他方向的差異：${p.comparisonNotes}`);
      if (p.usefulQuestions && p.usefulQuestions.length > 0) lines.push(`  可追問：${p.usefulQuestions.join("；")}`);
      return lines.join("\n");
    })
    .join("\n");
}

export function serializeService(s: ServiceDefinition): string {
  const lines = [
    `【${s.displayName}】(key: ${s.key})`,
    `是什麼：${s.whatItIs}`,
    `解決什麼問題：${s.problemsSolved}`,
    `可能代表需要它的情境（語意原型，不是關鍵字，使用者可能用完全不同的說法表達同一件事）：${s.triggerScenarios}`,
    `還可以追問什麼（只在答案真的會改變判斷時才問）：${s.followUpQuestions}`,
    `什麼情況不該太早推：${s.whenNotToPushEarly}`,
  ];
  if (s.relations.length > 0) {
    lines.push(
      "與其他服務的關係：" +
        s.relations
          .map(r => `對 ${r.withServiceKey}：${r.type}（${r.note}）`)
          .join("；")
    );
  }
  lines.push(`顧問最終需要理解什麼：${s.advisorNeedsToUnderstand}`);
  if (s.serviceScope && s.serviceScope.length > 0) {
    lines.push(`實際服務範圍（見「Phase 6E：不要編造服務範圍」，回答 service_info 查詢只能依這裡列出的項目）：\n` + s.serviceScope.map(item => `- ${item}`).join("\n"));
  }
  if (s.notIncluded) {
    lines.push(`不包含／常見誤解（必須誠實澄清，不能承諾這裡沒有的東西）：${s.notIncluded}`);
  }
  if (s.govSubsidyPrograms && s.govSubsidyPrograms.length > 0) {
    lines.push("此服務下的細分方向（適合情境／注意事項／與其他方向的差異，是判斷 govSubsidyRecommendation 主推薦／次推薦的唯一依據）：");
    lines.push(serializeGovSubsidyPrograms(s.govSubsidyPrograms));
  }
  return lines.join("\n");
}

export function serializeFactoryContext(ctx: AiFactoryContext | null): string {
  if (!ctx) {
    return "目前不知道使用者的公司背景（可能未登入、或尚未在 OXM 建立工廠資料）。不要假裝知道，也不需要主動追問「你們公司是做什麼的」這種可以從後續對話自然帶出的資訊——但如果對話中使用者自己提到，直接使用即可。";
  }
  const parts = [
    `公司名稱：${ctx.companyName}`,
    ctx.industry.length ? `產業：${ctx.industry.join("、")}` : "",
    ctx.subIndustry.length ? `子分類：${ctx.subIndustry.join("、")}` : "",
    `地區：${ctx.region}`,
    `類型：${ctx.businessType === "studio" ? "工作室" : "工廠"}`,
    ctx.foundedYear ? `成立年份：${ctx.foundedYear}` : "",
    ctx.capitalLevel ? `資本額級距：${ctx.capitalLevel}` : "",
    ctx.mfgModes.length ? `經營模式：${ctx.mfgModes.join("、")}` : "",
    ctx.description ? `公司簡介：${ctx.description}` : "",
  ].filter(Boolean);
  return (
    "這位使用者在 OXM 已經有工廠資料，以下資訊已知，絕對不要重新詢問這些內容，直接當成已知事實使用：\n" +
    parts.join("\n")
  );
}

/** 把對話歷史序列化成可讀的逐字稿，供 Layer 1／Layer 2 的 prompt 使用。 */
export function serializeHistory(history: AiChatTurn[]): string {
  return history
    .map(m => `${m.role === "user" ? "使用者" : "AI"}：${m.content}`)
    .join("\n");
}
