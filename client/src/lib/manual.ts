// ── 使用手冊入口開關 ─────────────────────────────────────────────────────────
// 設為 false：隱藏所有入口；/manual 仍可直接進入，但顯示製作中提示。
// 設為 true：正式顯示所有入口，製作中提示自動隱藏。
export const MANUAL_ENTRY_ENABLED = false;

// ── 使用手冊資料結構 ─────────────────────────────────────────────────────────
//
// 新增教學步驟流程：
// 1. 在 ARTICLES 找到對應 article，將 status 改為 'ready'
// 2. 在 steps 陣列加入 ManualStep 物件
// 3. 圖片放在 client/public/manual/<articleId>/ 目錄
// 4. image 欄位填入相對路徑，例如 "/manual/register/step1.png"
// 5. annotations 可預留箭頭／方框／步驟圓圈座標（x/y 為百分比 0–100）
// ────────────────────────────────────────────────────────────────────────────

export type AnnotationType = 'arrow' | 'box' | 'circle' | 'step' | 'click';

export interface Annotation {
  type: AnnotationType;
  x?: number;        // 水平位置，百分比 0–100
  y?: number;        // 垂直位置，百分比 0–100
  label?: string;    // 說明文字或步驟編號
  step?: number;     // 對應步驟編號（type='step' 時使用）
  width?: number;    // 方框寬度，百分比（type='box' 時使用）
  height?: number;   // 方框高度，百分比（type='box' 時使用）
}

export interface ManualStep {
  id: string;
  title?: string;
  description: string;
  note?: string;          // 橘色提示框（重要提醒，不適合放在 description 裡的強調資訊）
  image?: string;         // 路徑，例如 "/manual/getting-started/register/step-01/annotated.png"
  imageAlt?: string;
  imageCaption?: string;
  annotations?: Annotation[];
}

export interface ManualArticle {
  id: string;
  categoryId: string;
  title: string;
  summary: string;        // 卡片摘要，約 30–60 字
  keywords: string[];     // 搜尋關鍵字
  isPopular: boolean;
  order: number;
  status: 'ready' | 'coming-soon';
  steps: ManualStep[];
}

export interface ManualCategory {
  id: string;
  title: string;
  order: number;
}

// ── 分類 ────────────────────────────────────────────────────────────────────

export const MANUAL_CATEGORIES: ManualCategory[] = [
  { id: 'getting-started', title: '新手開始',           order: 1 },
  { id: 'find-factory',    title: '我要找工廠',          order: 2 },
  { id: 'list-factory',    title: '我要刊登工廠／工作室', order: 3 },
  { id: 'manage-store',    title: '整理我的商場',         order: 4 },
  { id: 'messaging',       title: '訊息、詢價與 PDF',    order: 5 },
  { id: 'collaboration',   title: '合作確認單',           order: 6 },
];

// ── 教學文章 ─────────────────────────────────────────────────────────────────

export const MANUAL_ARTICLES: ManualArticle[] = [

  // ── 新手開始 ─────────────────────────────────────────────────────────────

  {
    id: 'register',
    categoryId: 'getting-started',
    title: '如何註冊帳號',
    summary: '使用 Google、LINE 或 Apple 帳號即可快速完成 OXM 會員註冊，首次登入即自動建立帳號，無需填寫複雜表單。',
    keywords: ['註冊', '帳號', '會員', 'Google', 'LINE', 'Apple', '登入', '驗證信', '信箱驗證'],
    isPopular: false,
    order: 1,
    status: 'ready',
    steps: [
      {
        id: 'step-1',
        title: '點擊登入',
        description: '在 OXM 首頁右上角，點擊橘色「登入」按鈕，進入帳號登入畫面。',
        image: '/manual/getting-started/register/step-01/annotated.png',
        imageAlt: 'OXM 首頁右上角的橘色「登入」按鈕，以橘色框線和 ① 標示位置',
        imageCaption: '登入按鈕位於頁面右上角導覽列',
        annotations: [
          { type: 'box',  x: 90.4, y: 11.7, width: 6.4, height: 5.9, label: '登入按鈕' },
          { type: 'step', x: 90.4, y: 11.7, step: 1 },
        ],
      },
      {
        id: 'step-2',
        title: '選擇登入方式',
        description: '選擇 Google、LINE 或 Apple，按照畫面指示完成授權。首次登入即自動完成帳號建立，無需額外填寫表單。',
        image: '/manual/getting-started/register/step-02/annotated.png',
        imageAlt: '登入選擇畫面，包含 Google、LINE、Apple 三個登入按鈕，以橘色框線和 ② 標示',
        imageCaption: '選擇你慣用的帳號完成登入',
        annotations: [
          { type: 'box',  x: 37.9, y: 35.9, width: 24.5, height: 14.9, label: '登入方式選擇區' },
          { type: 'step', x: 37.9, y: 35.9, step: 2 },
        ],
      },
      {
        id: 'step-3',
        title: '驗證主要信箱',
        description: '登入後請前往「會員中心 → 我的資料」，確認主要信箱是否已完成驗證。若尚未驗證，可點擊重新寄送驗證信。',
        note: '尚未完成 Email 驗證的帳號，無法刊登工廠／工作室，也無法向工廠發送詢問。',
        image: '/manual/getting-started/register/step-03/annotated.png',
        imageAlt: '會員中心我的資料頁面，主要信箱欄位以橘色框線和 ③ 標示驗證狀態與重寄入口',
        imageCaption: '在「會員中心 → 我的資料」確認信箱驗證狀態',
        annotations: [
          { type: 'box',  x: 12.5, y: 52.2, width: 26.4, height: 9.1, label: '主要信箱驗證區' },
          { type: 'step', x: 12.5, y: 52.2, step: 3 },
        ],
      },
    ],
  },
  {
    id: 'login',
    categoryId: 'getting-started',
    title: '如何登入 OXM',
    summary: '透過右上角的「登入」按鈕，使用 Google 帳號一鍵登入平台。',
    keywords: ['登入', '帳號', 'Google', '會員'],
    isPopular: false,
    order: 2,
    status: 'coming-soon',
    steps: [],
  },
  {
    id: 'no-verification-email',
    categoryId: 'getting-started',
    title: '收不到驗證信怎麼辦',
    summary: '若收不到驗證信，請先確認垃圾信件夾，或重新發送驗證信。',
    keywords: ['驗證信', '信箱', 'Email', '收不到', '垃圾信'],
    isPopular: true,
    order: 3,
    status: 'coming-soon',
    steps: [],
  },

  // ── 我要找工廠 ───────────────────────────────────────────────────────────

  {
    id: 'search-factory',
    categoryId: 'find-factory',
    title: '如何搜尋工廠',
    summary: '在首頁或搜尋頁輸入關鍵字，可依產業、地區、資本額等條件篩選適合的工廠。',
    keywords: ['搜尋', '工廠', '關鍵字', '尋找', 'ODM', 'OEM'],
    isPopular: true,
    order: 1,
    status: 'coming-soon',
    steps: [],
  },
  {
    id: 'use-filters',
    categoryId: 'find-factory',
    title: '如何使用篩選條件',
    summary: '搜尋頁面可依產業分類、地區、資本額、製造模式等多重條件快速縮小範圍。',
    keywords: ['篩選', '條件', '產業', '地區', '資本額', '搜尋'],
    isPopular: false,
    order: 2,
    status: 'coming-soon',
    steps: [],
  },
  {
    id: 'save-favorite',
    categoryId: 'find-factory',
    title: '如何收藏工廠',
    summary: '在工廠詳情頁點擊愛心圖示即可加入收藏，方便日後快速找回。',
    keywords: ['收藏', '愛心', '我的收藏', '書籤'],
    isPopular: false,
    order: 3,
    status: 'coming-soon',
    steps: [],
  },
  {
    id: 'bulk-inquiry',
    categoryId: 'find-factory',
    title: '如何一次詢問多間工廠',
    summary: '勾選多間工廠後，可在搜尋頁使用「一鍵詢價」功能同步送出詢問訊息。',
    keywords: ['一鍵詢價', '批次', '多間工廠', '詢問', '詢價'],
    isPopular: true,
    order: 4,
    status: 'coming-soon',
    steps: [],
  },

  // ── 我要刊登工廠／工作室 ─────────────────────────────────────────────────

  {
    id: 'register-factory',
    categoryId: 'list-factory',
    title: '如何免費刊登工廠／工作室',
    summary: '登入後點擊「刊登工廠」，填寫基本資料後即可免費送審，審核通過後對外公開。',
    keywords: ['刊登', '工廠', '工作室', '上架', '免費', '建立', '新增'],
    isPopular: true,
    order: 1,
    status: 'coming-soon',
    steps: [],
  },
  {
    id: 'fill-basic-info',
    categoryId: 'list-factory',
    title: '如何填寫基本資料',
    summary: '包含工廠名稱、地址、負責人、聯絡方式與簡介等基本欄位填寫說明。',
    keywords: ['基本資料', '名稱', '地址', '聯絡', '填寫'],
    isPopular: false,
    order: 2,
    status: 'coming-soon',
    steps: [],
  },
  {
    id: 'select-industry',
    categoryId: 'list-factory',
    title: '如何選擇產業分類',
    summary: '從 10 大產業各選最多 5–7 個小分類，讓買家更容易找到你的工廠。',
    keywords: ['產業', '分類', '小分類', '標籤'],
    isPopular: false,
    order: 3,
    status: 'coming-soon',
    steps: [],
  },
  {
    id: 'edit-after-approval',
    categoryId: 'list-factory',
    title: '審核後如何修改資料',
    summary: '工廠通過審核後，可在工廠後台隨時更新資料，修改不需要重新送審。',
    keywords: ['修改', '更新', '審核', '後台', '編輯'],
    isPopular: false,
    order: 4,
    status: 'coming-soon',
    steps: [],
  },

  // ── 整理我的商場 ─────────────────────────────────────────────────────────

  {
    id: 'upload-photos',
    categoryId: 'manage-store',
    title: '如何上傳工廠圖片',
    summary: '在工廠後台可上傳多張工廠照片，建議上傳廠房、產線或產品實拍照。',
    keywords: ['圖片', '照片', '上傳', '相片', '封面'],
    isPopular: false,
    order: 1,
    status: 'coming-soon',
    steps: [],
  },
  {
    id: 'add-product',
    categoryId: 'manage-store',
    title: '如何新增產品或服務',
    summary: '在後台「產品管理」頁面，可新增產品名稱、圖片、規格與報價區間。',
    keywords: ['產品', '服務', '新增', '上架', '報價'],
    isPopular: false,
    order: 2,
    status: 'coming-soon',
    steps: [],
  },
  {
    id: 'edit-product',
    categoryId: 'manage-store',
    title: '如何修改產品資料',
    summary: '進入後台的產品列表，點擊「編輯」即可修改產品名稱、圖片或價格。',
    keywords: ['修改', '產品', '編輯', '更新'],
    isPopular: false,
    order: 3,
    status: 'coming-soon',
    steps: [],
  },
  {
    id: 'improve-profile',
    categoryId: 'manage-store',
    title: '如何完善工廠頁',
    summary: '填寫越完整的工廠資料，在搜尋結果中排名越高，也越容易獲得詢問。',
    keywords: ['完善', '資料', '優化', '排名', '曝光'],
    isPopular: false,
    order: 4,
    status: 'coming-soon',
    steps: [],
  },

  // ── 訊息、詢價與 PDF ─────────────────────────────────────────────────────

  {
    id: 'send-message',
    categoryId: 'messaging',
    title: '如何傳送訊息',
    summary: '在工廠詳情頁點擊「洽詢工廠」即可開啟對話，輸入需求後送出。',
    keywords: ['訊息', '傳送', '對話', '聯絡', '詢問'],
    isPopular: false,
    order: 1,
    status: 'coming-soon',
    steps: [],
  },
  {
    id: 'reply-buyer',
    categoryId: 'messaging',
    title: '如何回覆買家',
    summary: '工廠後台的「訊息」分頁可查看所有買家對話，點擊即可進入對話回覆。',
    keywords: ['回覆', '買家', '訊息', '對話', '後台'],
    isPopular: false,
    order: 2,
    status: 'coming-soon',
    steps: [],
  },
  {
    id: 'send-pdf',
    categoryId: 'messaging',
    title: '如何傳送 PDF',
    summary: '在對話視窗中點擊附件按鈕，即可上傳並傳送 PDF 報價單或規格書。',
    keywords: ['PDF', '附件', '檔案', '傳送', '上傳', '報價單'],
    isPopular: true,
    order: 3,
    status: 'coming-soon',
    steps: [],
  },
  {
    id: 'no-message-notification',
    categoryId: 'messaging',
    title: '收不到訊息通知怎麼辦',
    summary: '確認通知設定是否開啟，或至會員中心的「通知設定」調整 Email 通知偏好。',
    keywords: ['通知', '訊息', 'Email', '推播', '收不到'],
    isPopular: true,
    order: 4,
    status: 'coming-soon',
    steps: [],
  },

  // ── 合作確認單 ───────────────────────────────────────────────────────────

  {
    id: 'create-order',
    categoryId: 'collaboration',
    title: '如何建立合作確認單',
    summary: '雙方對合作條件達成共識後，工廠可在對話中建立合作確認單並傳送給買家確認。',
    keywords: ['合作確認單', '建立', '訂單', '確認'],
    isPopular: true,
    order: 1,
    status: 'coming-soon',
    steps: [],
  },
  {
    id: 'confirm-order',
    categoryId: 'collaboration',
    title: '如何確認合作內容',
    summary: '買家收到合作確認單後，閱讀條款並點擊「確認合作」即完成雙方確認。',
    keywords: ['確認', '合作', '確認單', '同意'],
    isPopular: false,
    order: 2,
    status: 'coming-soon',
    steps: [],
  },
  {
    id: 'update-order-progress',
    categoryId: 'collaboration',
    title: '如何更新合作進度',
    summary: '工廠可在合作確認單詳情頁更新目前的進度狀態，讓買家即時掌握進展。',
    keywords: ['進度', '更新', '合作', '狀態'],
    isPopular: false,
    order: 3,
    status: 'coming-soon',
    steps: [],
  },
  {
    id: 'complete-order',
    categoryId: 'collaboration',
    title: '如何完成合作',
    summary: '當合作結束後，雙方可標記確認單為「已完成」，留下合作紀錄。',
    keywords: ['完成', '結案', '合作', '完結'],
    isPopular: false,
    order: 4,
    status: 'coming-soon',
    steps: [],
  },
  {
    id: 'cancel-order',
    categoryId: 'collaboration',
    title: '如何申請取消合作',
    summary: '若需取消合作，可在確認單詳情頁申請取消，對方同意後方可完成取消。',
    keywords: ['取消', '退出', '合作', '解除'],
    isPopular: false,
    order: 5,
    status: 'coming-soon',
    steps: [],
  },
];

// ── 查詢工具 ─────────────────────────────────────────────────────────────────

export function getArticlesByCategory(categoryId: string): ManualArticle[] {
  return MANUAL_ARTICLES
    .filter(a => a.categoryId === categoryId)
    .sort((a, b) => a.order - b.order);
}

export function getPopularArticles(): ManualArticle[] {
  return MANUAL_ARTICLES
    .filter(a => a.isPopular)
    .sort((a, b) => a.order - b.order);
}

export function searchArticles(query: string): ManualArticle[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return MANUAL_ARTICLES.filter(a => {
    const cat = MANUAL_CATEGORIES.find(c => c.id === a.categoryId);
    return (
      a.title.toLowerCase().includes(q) ||
      a.summary.toLowerCase().includes(q) ||
      a.keywords.some(k => k.toLowerCase().includes(q)) ||
      cat?.title.toLowerCase().includes(q)
    );
  });
}
