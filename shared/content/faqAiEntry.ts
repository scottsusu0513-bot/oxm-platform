// FAQ 頁「AI 問答入口預留區」的靜態標題／說明文字——單一資料來源。
//
// 這是本輪新增的獨立區塊，不是既有 16 題 FAQ 正文的一部分，因此刻意獨立成
// 這個檔案，不動 shared/content/faq.ts（本輪規定 16 題 FAQ 正文與該檔案禁止
// 變動）。client/src/components/faq/FaqAiEntry.tsx（畫面顯示）與
// scripts/prerender-faq.ts（build-time 可抓取正文片段）共用同一份文字，
// 避免兩邊各自維護一份、日後不一致。
export const FAQ_AI_ENTRY_CONTENT = {
  title: "有問題？直接問 OXM",
  description: "輸入你的問題，未來將由 OXM AI 協助你找到最相關的產業問答與資源。",
} as const;
