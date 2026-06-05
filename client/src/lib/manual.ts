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
  note?: string | string[];  // 橘色提示框；傳陣列時每一項各為一段
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
  /** ready = 已完成；draft = 步驟已規劃但圖片尚未就緒；coming-soon = 尚未規劃 */
  status: 'ready' | 'draft' | 'coming-soon';
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
    keywords: ['註冊', '帳號', '會員', 'Google', 'LINE', 'Apple', '登入', '驗證信', '信箱驗證', '收不到驗證信', '垃圾郵件', '促銷信件', '客服'],
    isPopular: true,
    order: 1,
    status: 'ready',
    steps: [
      {
        id: 'step-1',
        title: '點擊登入',
        description: '在 OXM 首頁右上角，點擊橘色「登入」按鈕，開啟登入畫面。',
        image: '/manual/getting-started/register/step-01/1.png',
        imageAlt: 'OXM 首頁右上角導覽列，橘色虛線框標示台灣版夥、刊登工廠與登入按鈕，步驟編號 ①',
        imageCaption: '點擊右上角的「登入」按鈕',
      },
      {
        id: 'step-2',
        title: '選擇登入方式',
        description: '畫面提供 Google、LINE、Apple 三種登入方式，選擇慣用的帳號完成登入。首次登入即自動建立帳號，無需填寫表單。',
        image: '/manual/getting-started/register/step-02/2.png',
        imageAlt: '登入 OXM 畫面，橘色虛線框標示三個登入按鈕（Google、LINE、Apple），步驟編號 ②',
        imageCaption: '選擇慣用的登入方式',
      },
      {
        id: 'step-3',
        title: '完成 Email 驗證',
        description: '登入後前往「會員中心 → 我的資料」，確認主要信箱是否已完成驗證。若尚未驗證，請依畫面提示重新寄送驗證信。',
        note: [
          '尚未完成 Email 驗證的帳號，無法刊登工廠／工作室，也無法向工廠發送詢問。',
          '若未收到驗證信，請先檢查垃圾郵件或促銷信件匣；仍未收到時，請聯繫 OXM 客服協助處理。',
        ],
        image: '/manual/getting-started/register/step-03/3.png',
        imageAlt: '會員中心「我的資料」頁面，橘色虛線框標示主要信箱驗證狀態區塊，步驟編號 ③',
        imageCaption: '在「我的資料」確認主要信箱的驗證狀態',
      },
    ],
  },
  // ── 我要找工廠 ───────────────────────────────────────────────────────────

  {
    id: 'search-factory',
    categoryId: 'find-factory',
    title: '如何搜尋並聯絡工廠',
    summary: '在首頁輸入關鍵字後開始搜尋，利用產業、地區等條件篩選，直接聯繫工廠或用一鍵詢價同時詢問多間。',
    keywords: ['搜尋', '工廠', '工作室', '關鍵字', 'ODM', 'OEM', '篩選', '條件', '產業', '地區', 'MOQ', '資本額', '收藏', '愛心', '聯繫工廠', '一鍵詢價', '批次詢價', '多間工廠'],
    isPopular: true,
    order: 1,
    status: 'draft',
    steps: [
      { id: 'step-1', title: '在首頁輸入搜尋關鍵字',   description: '在首頁搜尋框輸入想找的產品、加工方式或產業關鍵字，點「搜尋代工廠 & 工作室」開始搜尋。' },
      { id: 'step-2', title: '查看搜尋結果',            description: '搜尋後出現符合條件的工廠卡片列表，點擊卡片可進入工廠詳情頁。' },
      { id: 'step-3', title: '使用篩選條件',            description: '左側（桌機）或頁面上方（手機）可依類型、代工模式、主產業、子產業、地區等條件縮小範圍。' },
      { id: 'step-4', title: '查看工廠詳情',            description: '詳情頁可查看工廠名稱、產業標籤、評分、服務項目、產品與工廠照片。' },
      { id: 'step-5', title: '聯繫工廠',                description: '找到合適的工廠後，點「聯繫工廠」按鈕開啟對話，輸入需求後送出。' },
      { id: 'step-6', title: '收藏工廠',                description: '點「收藏」可將工廠加入我的收藏；之後可從「我的收藏」頁快速找回。' },
      { id: 'step-7', title: '一鍵詢價多間工廠',        description: '在搜尋結果點「加入一鍵詢價」將多間工廠加入清單，填好詢價內容後點「送出一鍵詢價」一次送出。' },
    ],
  },

  // ── 我要刊登工廠／工作室 ─────────────────────────────────────────────────

  {
    id: 'register-factory',
    categoryId: 'list-factory',
    title: '如何刊登工廠／工作室',
    summary: '免費刊登工廠或工作室，填寫基本資料與產業分類後送出審核，審核通過即可對外公開，之後可隨時修改資料。',
    keywords: ['刊登工廠', '刊登工作室', '免費刊登', '基本資料', '工廠名稱', '工作室名稱', '地址', '主產業', '子產業', 'OEM', 'ODM', '小量接單', '打樣', '建立工廠', '建立工作室', '送出審核', '修改資料', '工廠後台'],
    isPopular: true,
    order: 1,
    status: 'draft',
    steps: [
      { id: 'step-1', title: '點擊刊登工廠',                  description: '在 Navbar 點「刊登工廠」，或在首頁點「免費刊登工廠／工作室」按鈕，進入刊登頁面。' },
      { id: 'step-2', title: '選擇類型與填寫基本資料',        description: '選擇「工廠」或「工作室」，填寫名稱、地址、代工模式、聯絡方式等基本資料。' },
      { id: 'step-3', title: '選擇產業分類',                  description: '選擇主產業後可進一步選擇子產業，讓買家用篩選功能更容易找到你。' },
      { id: 'step-4', title: '點擊「建立工廠」或「建立工作室」', description: '確認資料無誤後，點下方橘色按鈕完成初步建立，並進入後台繼續完善資料。' },
      { id: 'step-5', title: '完善後台資料並送出審核',        description: '在後台補齊照片、產品、簡介等資料，完成後點「送出審核」等待管理員審核。' },
      { id: 'step-6', title: '審核通過後修改資料',            description: '審核通過後隨時可在後台修改資料，不需要重新送審。' },
    ],
  },

  // ── 整理我的商場 ─────────────────────────────────────────────────────────

  {
    id: 'upload-photos',
    categoryId: 'manage-store',
    title: '如何完善工廠後台',
    summary: '進入工廠管理後台，完善照片、產品資料與接單狀態，讓買家找到你時能看到完整資訊。',
    keywords: ['工廠後台', '商場', '工廠頁', '照片集', '上傳圖片', '新增產品', '修改產品', '產品管理', '產品名稱', '產品介紹', '報價', '接單狀態', '接單中', '產線繁忙', '產線滿載', '曝光'],
    isPopular: true,
    order: 1,
    status: 'draft',
    steps: [
      { id: 'step-1', title: '進入工廠後台',          description: '登入後點右上角頭像或「後台管理」進入工廠後台，可在各分頁管理照片、產品與資料。' },
      { id: 'step-2', title: '上傳工廠照片',          description: '切換到「照片集」分頁，上傳廠房、設備、生產線等照片，最多 20 張。' },
      { id: 'step-3', title: '新增產品',              description: '切換到「產品管理」分頁，點「新增產品」按鈕建立產品資料。' },
      { id: 'step-4', title: '填寫與編輯產品資料',    description: '填寫產品名稱、分類、報價區間、樣品說明等欄位，完成後儲存。' },
      { id: 'step-5', title: '設定接單狀態',          description: '在基本資料頁可切換接單狀態：接單中、產線繁忙、產線滿載，讓買家掌握目前可配合度。' },
    ],
  },

  // ── 訊息、詢價與 PDF ─────────────────────────────────────────────────────

  {
    id: 'send-message',
    categoryId: 'messaging',
    title: '如何使用訊息與 PDF 型錄',
    summary: '買家點「聯繫工廠」即可開始對話；工廠方可傳送架上商品與 PDF 型錄（限工廠方）；收不到通知時可在會員中心調整設定。',
    keywords: ['訊息', '詢價', '聯繫工廠', '回覆買家', '對話', '傳送架上商品', 'PDF', '型錄', '商品型錄', '附件', '通知', 'Email 通知', 'APP 推播', '收不到通知'],
    isPopular: true,
    order: 1,
    status: 'draft',
    steps: [
      { id: 'step-1', title: '從工廠頁開始詢問',        description: '在工廠詳情頁點「聯繫工廠」按鈕，開啟對話後輸入需求送出。' },
      { id: 'step-2', title: '傳送訊息與查看對話',      description: '進入對話頁後可查看歷史訊息、輸入回覆內容，雙方都可在此溝通。' },
      { id: 'step-3', title: '工廠傳送架上商品（工廠方）', description: '工廠方可點輸入區左側「+」按鈕，選「傳送架上商品」，將已建立的產品傳給買家參考。', note: '此功能僅限工廠主及共同管理者使用。' },
      { id: 'step-4', title: '工廠上傳 PDF 型錄（工廠方）', description: '工廠方點「+」後選「上傳商品型錄（限 PDF，7 天）」，上傳 PDF 後即傳送給買家。', note: '此功能僅限工廠主及共同管理者使用；PDF 有效期為 7 天。' },
      { id: 'step-5', title: '收不到通知時調整設定',    description: '前往「會員中心 → 通知設定」，確認 Email 通知與 APP 推播是否已開啟。' },
    ],
  },

  // ── 合作確認單 ───────────────────────────────────────────────────────────

  {
    id: 'create-order',
    categoryId: 'collaboration',
    title: '如何建立與完成合作確認單',
    summary: '工廠方從對話中建立合作確認單，買家確認後工廠在後台更新進度，直到完成合作；雙方均可申請取消。',
    keywords: ['合作確認單', '建立訂單', '合作內容', '金額', '數量', '交期', '備註', '確認合作', '製作中', '已出貨', '已完成', '更新進度', '完成合作', '取消合作', '申請取消'],
    isPopular: true,
    order: 1,
    status: 'draft',
    steps: [
      { id: 'step-1', title: '從對話中建立合作確認單', description: '工廠方在對話輸入區點「+」按鈕，選「建立合作確認單」。', note: '建立合作確認單功能僅限工廠主及共同管理者使用。' },
      { id: 'step-2', title: '填寫合作內容',           description: '填寫主旨、金額、數量、預計完成日期與備註，確認內容正確。' },
      { id: 'step-3', title: '送出合作確認單',         description: '點「送出合作確認單」，確認單訊息會傳送至對話中讓買家查看。' },
      { id: 'step-4', title: '買家確認合作',           description: '買家在對話中看到確認單訊息，閱讀後點「確認合作」完成雙方確認。' },
      { id: 'step-5', title: '工廠更新合作進度',       description: '工廠方在後台「合作確認單」分頁，可更新進度：製作中 → 已出貨 → 已完成。' },
      { id: 'step-6', title: '完成合作',               description: '進度更新至「已完成」後，合作確認單正式結案，雙方可留下合作紀錄。' },
      { id: 'step-7', title: '申請取消合作',           description: '若需取消，可在對話中的確認單訊息點「申請取消合作」，對方同意後完成取消。' },
    ],
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
