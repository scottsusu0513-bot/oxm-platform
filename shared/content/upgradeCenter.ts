// /upgrade-center（企業升級中心）正文的單一資料來源：只抽出需要被
// build-time 預渲染腳本（scripts/prerender-upgrade-center.ts）共用、且
// React 畫面上確實會顯示的固定文字——H1（純文字版）、各區塊標題／說明，與
// 三組純靜態列表（升級意義 3 項、六步申請流程、OXM 如何協助 3 項）的
// title/description。避免 client/src/pages/EnterpriseUpgradeCenter.tsx
// 與 prerender 腳本各自維護一份文案、日後兩邊不一致。
//
// 不放版型／樣式／icon／配色（accent/artClassName/stepCls 等）這些只有
// EnterpriseUpgradeCenter.tsx 自己會用到的東西。
//
// 刻意不收錄的內容（本來就不該出現在 prerender）：
// - Hero 區塊的即時統計數字（送出申請／正式立案／過件率等）：來自
//   trpc.upgradeCenter.publicStats，是 runtime 資料，畫面上自己也註明
//   「平台數據正式啟動後持續更新」，寫進 build-time 產物會很快過期或
//   誤導。
// - 「政府補助方案」實際清單：來自 trpc.upgradePrograms.listPublic，是
//   資料庫驅動、會隨管理員新增/下架變動的動態內容，這裡只收錄該區塊的
//   標題／說明文字，不收錄清單本身（不逐頁 server-render，也不在
//   build time 連 production DB）。
// - 「權限不足」「申請進度查詢」兩個 Dialog：使用者個人資料／案件進度，
//   完全不該出現在任何公開的 prerender 產物裡。
//
// H1 與「補助不是終點」兩句標題在畫面上都有 <br />／彩色 <span> 這類跟
// 純文字不對應的內嵌樣式，EnterpriseUpgradeCenter.tsx 維持原本的 JSX
// 手刻結構不變，這裡只保留給 prerender 用的純文字版本（與
// shared/content/home.ts 的 compareSection.title 是同一種處理方式）。

export interface UpgradeCenterListItem {
  title: string;
  description: string;
}

export const UPGRADE_CENTER_CONTENT = {
  heroH1: "把政府補助，轉成企業升級的下一步",
  heroIntro: "從研發、製程改善到海外布局，OXM 協助台灣企業辨識合適資源，媒合專業顧問，讓轉型計畫更有方向。",

  whyMattersTitle: "補助不是終點，而是升級路徑的一部分",
  whyMattersIntro: "不同企業階段，對應的研發、技術與市場資源也不同。先看懂方案方向，再進入資格評估，能讓後續準備更聚焦。",
  meaningItems: [
    { title: "理解資源", description: "將分散的政府方案整理成可閱讀的企業語言。" },
    { title: "對應階段", description: "從研發、製程、數位到市場布局辨識方向。" },
    { title: "推進轉型", description: "讓補助評估與企業真正要完成的升級目標連結。" },
  ] satisfies UpgradeCenterListItem[],

  programsTitle: "政府補助方案",
  programsIntro: "OXM 協助媒合適合企業階段的政府計畫；實際資格與受理內容依主管機關公告及顧問評估為準。",

  processTitle: "六個步驟，讓評估有跡可循",
  processIntro: "從資料填寫、資格初審到送出申請，OXM 顧問依既有流程全程陪跑。",
  processSteps: [
    { title: "填寫評估資料", description: "提供企業基本資訊、研發能力與財務狀況，5 分鐘完成初步評估表單" },
    { title: "OXM 資格初審", description: "OXM 專業團隊審查資料，確認符合政府補助基本申請資格" },
    { title: "媒合合作顧問", description: "依企業類型與目標計畫，媒合最適合的政府計畫顧問團隊" },
    { title: "專人到廠評估", description: "顧問親赴貴廠進行深度訪查，全面評估申請條件與優化方向" },
    { title: "撰寫計畫", description: "顧問協助撰寫完整政府計畫書，確保內容符合審查標準" },
    { title: "送出申請", description: "提交完整計畫書至主管機關，OXM 全程追蹤審查進度" },
  ] satisfies UpgradeCenterListItem[],

  supportTitle: "把複雜的申請路徑，整理成清楚的行動",
  supportIntro: "OXM 串接企業需求與專業顧問，協助企業從初步判讀一路走到實際送件。",
  supportItems: [
    { title: "先釐清", description: "從企業現況與目標開始，聚焦適合評估的方案方向。" },
    { title: "再媒合", description: "依企業類型與計畫目標，銜接合適的政府計畫顧問團隊。" },
    { title: "持續陪跑", description: "從資料準備、計畫撰寫到送件，保留清楚的案件進度。" },
  ] satisfies UpgradeCenterListItem[],

  ctaTitle: "不確定適合哪項補助？",
  ctaIntro: "讓 OXM 協助免費評估，找到適合您企業階段的計畫方向。",
};
