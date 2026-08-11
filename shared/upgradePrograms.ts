export const UPGRADE_PROGRAM_VISUAL_KEYS = [
  "innovation",
  "manufacturing",
  "digital",
  "growth",
  "global",
  "funding",
] as const;

export type UpgradeProgramVisualKey = (typeof UPGRADE_PROGRAM_VISUAL_KEYS)[number];

export const UPGRADE_PROGRAM_VISUAL_LABELS: Record<UpgradeProgramVisualKey, string> = {
  innovation: "創新研發",
  manufacturing: "製造升級",
  digital: "數位轉型",
  growth: "企業成長",
  global: "海外布局",
  funding: "資源挹注",
};

export type UpgradeProgramSeed = {
  slug: string;
  title: string;
  shortTitle: string | null;
  description: string;
  targetAudience: string | null;
  highlights: readonly string[];
  badge: string | null;
  statusLabel: string | null;
  visualKey: UpgradeProgramVisualKey;
  maxFundingLabel: string | null;
  imageUrl: string | null;
  ctaLabel: string;
  displayOrder: number;
  enabled: boolean;
};

/**
 * 新表尚未套用時的唯讀相容資料，也是 migration 完成後第一次啟動時的種子來源。
 * 公開 React 頁面不直接 import 這份資料；正式資料表存在後，管理員後台與公開頁
 * 都只讀寫 upgradePrograms。這裡只保留 migration 過渡期所需的既有五項內容。
 */
export const UPGRADE_PROGRAM_SEEDS: readonly UpgradeProgramSeed[] = [
  {
    slug: "sbir",
    title: "小型企業創新研發計畫",
    shortTitle: "SBIR",
    description: "針對中小企業創新研發活動提供補助，涵蓋前期研究、可行性評估及研發計畫三個階段。",
    targetAudience: null,
    highlights: ["研發費用補助", "可分期申請", "最廣適用"],
    badge: "政府補助計畫",
    statusLabel: null,
    visualKey: "innovation",
    maxFundingLabel: "3,000 萬元",
    imageUrl: null,
    ctaLabel: "免費評估資格",
    displayOrder: 10,
    enabled: true,
  },
  {
    slug: "citd",
    title: "協助傳統產業技術開發",
    shortTitle: "CITD",
    description: "專為傳統製造業設計，補助技術升級、製程改善及智慧化轉型所需研發費用。",
    targetAudience: null,
    highlights: ["傳統產業適用", "製程技術升級", "智慧化補助"],
    badge: "政府補助計畫",
    statusLabel: null,
    visualKey: "manufacturing",
    maxFundingLabel: "1,000 萬元",
    imageUrl: null,
    ctaLabel: "免費評估資格",
    displayOrder: 20,
    enabled: true,
  },
  {
    slug: "siir",
    title: "服務業創新研發計畫",
    shortTitle: "SIIR",
    description: "鼓勵服務業廠商投入創新研發，提升服務模式與數位轉型能力。",
    targetAudience: null,
    highlights: ["服務業適用", "數位轉型", "商業模式創新"],
    badge: "政府補助計畫",
    statusLabel: null,
    visualKey: "digital",
    maxFundingLabel: "1,000 萬元",
    imageUrl: null,
    ctaLabel: "免費評估資格",
    displayOrder: 30,
    enabled: true,
  },
  {
    slug: "rd-transformation",
    title: "企業研發轉型與升級計畫",
    shortTitle: "研發轉型補助",
    description: "協助企業投入產品開發、技術升級、研發流程優化與轉型布局，強化長期競爭力。",
    targetAudience: null,
    highlights: ["產品開發", "技術升級", "轉型布局"],
    badge: "政府補助計畫",
    statusLabel: null,
    visualKey: "growth",
    maxFundingLabel: "4,000 萬元",
    imageUrl: null,
    ctaLabel: "免費評估資格",
    displayOrder: 40,
    enabled: true,
  },
  {
    slug: "overseas-channels",
    title: "海外市場拓展與通路布局",
    shortTitle: "海外通路計畫",
    description: "協助企業布建海外展示據點、發貨倉庫、服務維修中心、海外分公司、子公司或代理經銷通路，強化海外市場落地能力。",
    targetAudience: null,
    highlights: ["海外據點", "通路布建", "代理經銷"],
    badge: "政府補助計畫",
    statusLabel: null,
    visualKey: "global",
    maxFundingLabel: "2,000 萬元",
    imageUrl: null,
    ctaLabel: "免費評估資格",
    displayOrder: 50,
    enabled: true,
  },
] as const;

export function selectVisibleUpgradePrograms<
  T extends { enabled: boolean; archivedAt: Date | string | null; displayOrder: number; id: number },
>(programs: readonly T[]): T[] {
  return programs
    .filter((program) => program.enabled && program.archivedAt == null)
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id);
}
