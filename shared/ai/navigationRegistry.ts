/**
 * Phase 6C：OXM AI 站內導覽（見對話中「十二、十三：不要用巨大 route
 * if/else，Navigation Registry 必須是 server-authoritative」）。
 *
 * AI（Layer 2 routing）只能從這份清單裡選一個 key，真正的網址一律由這裡
 * 決定——模型不能自己輸出任意 path。新增／調整可導覽頁面只需要改這裡，不
 * 需要動 AI 核心邏輯或到處找 route 字串。
 *
 * V1（Phase 6C）只收錄完全公開、不需要登入的頁面（見「十二：讓 AI 只看到
 * 可安全導覽的 OXM 公開頁面」）。Phase 6D 為了讓 Platform Help 主題（見
 * shared/ai/platformHelpRegistry.ts）能附上正確的導覽 CTA，新增了三個
 * 登入後才有完整功能、但未登入造訪也不會壞掉的頁面（/register-factory 未
 * 登入會顯示登入提示、/messages 未登入會顯示登入提示、/dashboard 未登入會
 * 導回首頁）——已個別確認過這三個頁面對未登入使用者的實際行為，不是憑空
 * 假設。
 */
export interface OxmNavigationEntry {
  key: string;
  title: string;
  /** 給 AI 判斷「使用者這句話是不是想去這裡」用的簡短說明，不是給使用者看的文案。 */
  description: string;
  route: string;
}

export const OXM_NAVIGATION_REGISTRY: OxmNavigationEntry[] = [
  {
    key: "factory_search",
    title: "找工廠",
    description: "搜尋 OXM 平台上的製造工廠合作對象，可依產業、地區篩選。",
    route: "/search",
  },
  {
    key: "news",
    title: "找消息",
    description: "OXM 的產業新聞／展覽／競賽／補助公告看板。",
    route: "/news",
  },
  {
    key: "gov_subsidy",
    title: "政府補助專區",
    description: "OXM 目前提供的政府補助方案介紹與申請入口。",
    route: "/upgrade-center",
  },
  {
    key: "erp",
    title: "ERP／產線優化專區",
    description: "ERP／生產管理導入與優化服務介紹。",
    route: "/erp-optimization",
  },
  {
    key: "certification",
    title: "ISO／低碳認證專區",
    description: "ISO、碳盤查等認證輔導服務介紹。",
    route: "/certification-center",
  },
  {
    key: "short_video",
    title: "品牌／短影音專區",
    description: "品牌故事、短影音、社群代操服務介紹。",
    route: "/short-video-marketing",
  },
  {
    key: "finance",
    title: "企業財務優化專區",
    description: "融資、現金流、財務結構優化服務介紹。",
    route: "/finance-optimization",
  },
  {
    key: "resource_center",
    title: "資源總覽",
    description: "OXM 所有服務項目的總覽頁面，使用者不確定要去哪裡時可以導這裡。",
    route: "/resources",
  },
  {
    key: "about",
    title: "關於 OXM",
    description: "OXM 平台本身的介紹頁面（不是某個服務的介紹）。",
    route: "/about",
  },
  {
    key: "factory_register",
    title: "刊登工廠",
    description: "申請刊登工廠／工作室的頁面，需要登入才能送出申請（未登入會顯示登入提示，不會壞掉）。",
    route: "/register-factory",
  },
  {
    key: "factory_dashboard",
    title: "工廠後台",
    description: "已核准工廠的管理後台，可修改工廠資料、產品、接單狀態（需要登入且是工廠主或共同管理者，未登入會導回首頁）。",
    route: "/dashboard",
  },
  {
    key: "messages",
    title: "我的訊息",
    description: "查看與工廠的詢價／對話紀錄（需要登入，未登入會顯示登入提示，不會壞掉）。",
    route: "/messages",
  },
];

export function getNavigationEntry(key: string): OxmNavigationEntry | undefined {
  return OXM_NAVIGATION_REGISTRY.find(e => e.key === key);
}
