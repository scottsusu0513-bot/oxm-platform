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
    keywords: ['搜尋', '工廠', '工作室', '關鍵字', 'ODM', 'OEM', 'OBM', '篩選', '條件', '類型', '代工模式', '產業', '地區', 'MOQ', '資本額', '收藏', '愛心', '聯繫工廠', '一鍵詢價', '批次詢價', '多間工廠'],
    isPopular: true,
    order: 1,
    status: 'ready',
    steps: [
      {
        id: 'step-1',
        title: '輸入需求並設定搜尋條件',
        description: '在首頁選擇類型（工廠、工作室或全部），也可先設定代工模式、產業與地區等條件，輸入想找的產品、加工方式或產業關鍵字，再點擊「搜尋工廠 & 工作室」。',
        image: '/manual/find-factory/search-factory/step-01/4.png',
        imageAlt: 'OXM 首頁搜尋區，橘色框標示類型選擇（工廠／工作室／全部）、篩選條件欄位與搜尋按鈕，步驟編號 ①',
        imageCaption: '在首頁輸入關鍵字並設定搜尋條件',
      },
      {
        id: 'step-2',
        title: '查看搜尋結果',
        description: '搜尋後顯示符合條件的工廠與工作室清單，點擊卡片即可查看完整資料。',
        image: '/manual/find-factory/search-factory/step-02/5.png',
        imageAlt: '搜尋結果頁面，橘色框標示工廠卡片列表，左側顯示篩選條件面板，步驟編號 ②',
        imageCaption: '搜尋結果以卡片形式列出，點擊即可查看詳情',
      },
      {
        id: 'step-3',
        title: '查看工廠詳情',
        description: '進入工廠頁後，可查看工廠介紹、產業分類、代工模式、聯絡資訊、工廠照片與產品列表。',
        image: '/manual/find-factory/search-factory/step-04/6.png',
        imageAlt: '工廠詳情頁面，橘色框標示工廠基本資訊區塊（名稱、標籤、評分、地址、聯絡方式），步驟編號 ③',
        imageCaption: '工廠詳情頁提供完整的工廠資訊',
      },
      {
        id: 'step-4',
        title: '聯繫工廠',
        description: '找到合適的工廠後，點擊「聯繫工廠」開始傳送詢問，對話記錄可從上方導覽列「我的訊息」查看。',
        image: '/manual/find-factory/search-factory/step-05/7.png',
        imageAlt: '工廠詳情頁面，橘色框標示「聯繫工廠」按鈕，箭頭指向導覽列「我的訊息」，步驟編號 ④',
        imageCaption: '點擊「聯繫工廠」開啟對話',
      },
      {
        id: 'step-5',
        title: '收藏工廠',
        description: '點擊「收藏」即可保存感興趣的工廠，之後可從上方導覽列「我的收藏」快速查看。',
        image: '/manual/find-factory/search-factory/step-06/8.png',
        imageAlt: '工廠詳情頁面，橘色框標示「收藏」按鈕，箭頭指向導覽列「我的收藏」，步驟編號 ⑤',
        imageCaption: '點擊「收藏」保存感興趣的工廠',
      },
      {
        id: 'step-6',
        title: '一鍵詢價多間工廠',
        description: '在搜尋結果頁點擊「加入一鍵詢價」將多間工廠加入清單，填寫詢價需求後點「送出一鍵詢價」一次送出給多間工廠。',
        image: '/manual/find-factory/search-factory/step-07/9.png',
        imageAlt: '搜尋結果頁面，橘色框標示左側一鍵詢價清單面板，右側工廠卡片顯示已加入狀態，步驟編號 ⑥',
        imageCaption: '一鍵詢價清單可同時詢問多間工廠',
      },
    ],
  },

  // ── 我要刊登工廠／工作室 ─────────────────────────────────────────────────

  {
    id: 'register-factory',
    categoryId: 'list-factory',
    title: '如何刊登工廠／工作室',
    summary: '免費刊登工廠或工作室，填寫基本資料與產業分類後送出審核，審核通過即可對外公開，之後可隨時修改資料。',
    keywords: ['刊登工廠', '刊登工作室', '免費刊登', '基本資料', '工廠名稱', '工作室名稱', '地址', '主產業', '子產業', 'OEM', 'ODM', 'OBM', '小量接單', '打樣', '建立工廠', '建立工作室', '送出審核', '修改資料', '工廠後台', '重新送審', '修改理由', '等待審核', '審核通過', '工廠上線', '前台資料'],
    isPopular: true,
    order: 1,
    status: 'draft',
    steps: [
      {
        id: 'step-1',
        title: '點擊「註冊工廠」，閱讀申請須知',
        description: '登入後，點擊導覽列的「註冊工廠」。畫面會先顯示申請須知，確認後點「我已了解，繼續申請」，進入刊登表單。',
        note: '每個帳號只能申請刊登一次，申請後無法更改帳號所有者。請確保填寫的資訊真實有效，虛假申請將被永久禁用。',
        image: '/manual/list-factory/register-factory/step-01/10.png',
        imageAlt: '導覽列「註冊工廠」按鈕已標示，下方顯示申請須知 dialog，步驟編號 ①',
        imageCaption: '點擊「註冊工廠」並確認申請須知',
      },
      {
        id: 'step-2',
        title: '選擇申請類型',
        description: '選擇「工廠」或「工作室」。工廠適合具備生產設備的製造工廠；工作室適合手工藝、設計師或個人接案者。',
        image: '/manual/list-factory/register-factory/step-02/11.png',
        imageAlt: '申請刊登頁面，橘色框標示「工廠」與「工作室」類型選擇卡，步驟編號 ②',
        imageCaption: '選擇工廠或工作室',
      },
      {
        id: 'step-3',
        title: '填寫基本資料',
        description: '上傳工廠頭像（選填），填寫名稱，選擇主產業、代工模式（ODM／OEM）、地區與資本額。標示 * 的欄位為必填。',
        image: '/manual/list-factory/register-factory/step-03/12.png',
        imageAlt: '刊登表單，橘色框標示頭像、名稱、主產業、代工模式、地區、資本額等基本欄位，步驟編號 ③',
        imageCaption: '填寫工廠名稱、主產業與代工模式',
      },
      {
        id: 'step-4',
        title: '填寫聯絡資料並送出申請',
        description: '繼續填寫簡介、成立年份、負責人、聯絡方式與地址。確認無誤後，點底部橘色「建立工廠」或「建立工作室」按鈕完成初步建立。',
        image: '/manual/list-factory/register-factory/step-04/13.png',
        imageAlt: '刊登表單下段，橘色框標示地址、聯絡方式等欄位及底部橘色「建立工廠」按鈕，步驟編號 ④',
        imageCaption: '填寫聯絡資料後點建立',
      },
      {
        id: 'step-5',
        title: '進入後台，完善工廠資料',
        description: '建立後自動進入工廠管理後台。頁面頂部顯示「尚未送審」狀態，請補齊基本資料，準備送出第一次審核。',
        note: '請確認資料正確後再送出審核。工廠／工作室上線後，若再次修改公開資料，必須重新送出審核，管理員核准後前台內容才會變更。',
        image: '/manual/list-factory/register-factory/step-05/14.png',
        imageAlt: '工廠管理後台，灰色橫幅顯示「您的工廠尚未送審，完善資料後請送出審核才能上線」，狀態標示「未送審」，步驟編號 ⑤',
        imageCaption: '進入後台，補齊資料準備送審',
      },
      {
        id: 'step-6',
        title: '送出第一次審核',
        description: '在後台「基本資料」頁面底部，點擊「送出審核」按鈕，並在確認框中點「確認送出」。送出後資料暫時鎖定，等待管理員審核；審核通過後工廠將正式上線。',
        image: '/manual/list-factory/register-factory/step-06/15.png',
        imageAlt: '工廠後台底部，橘色框標示「送出審核」按鈕及「確認送出審核？」確認 dialog，步驟編號 ⑤⑥',
        imageCaption: '點送出審核，確認框中點確認送出',
      },
      {
        id: 'step-7',
        title: '審核通過，工廠正式上線',
        description: '管理員審核通過後，後台頂部顯示綠色「已上線」橫幅，買家可以在搜尋頁面找到您的工廠。',
        image: '/manual/list-factory/register-factory/step-07/7.png',
        imageAlt: '工廠管理後台，綠色橫幅顯示「您的工廠已上線，買家可以在搜尋頁面找到您」，狀態標示「已上線」，步驟編號 ⑦',
        imageCaption: '審核通過，工廠已上線',
      },
      {
        id: 'step-8',
        title: '修改已上線資料並重新送審',
        description: '工廠通過審核並上線後，若重新修改公開資料，需要填寫簡短的修改理由並再次送出審核。管理員核准前，前台仍會顯示原本已通過的資料；核准後才會套用最新內容。',
        note: [
          '重新送審期間不會影響原本已上線的工廠頁，買家仍可查看原本已核准的資料。',
          '請簡短說明本次修改內容，方便平台管理員確認變更。',
          '教學圖片將於功能完成後補上。',
        ],
      },
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
      {
        id: 'step-1',
        title: '進入工廠後台',
        description: '登入後，點擊導覽列上方的「工廠/工作室」按鈕，即可進入工廠管理後台，開始完善您的工廠資料。',
        image: '/manual/manage-store/upload-photos/step-01/17.png',
        imageAlt: 'OXM 首頁導覽列，橘色圓框標示「工廠/工作室」連結，步驟編號 ①',
        imageCaption: '點擊導覽列「工廠/工作室」進入後台',
      },
      {
        id: 'step-2',
        title: '上傳工廠大頭貼',
        description: '在「基本資料」分頁的「工廠大頭貼」區塊，點擊頭像圖示或「更換照片」按鈕，從電腦選取圖片（JPG / PNG，最大 5MB）上傳作為工廠封面。',
        image: '/manual/manage-store/upload-photos/step-02/18.png',
        imageAlt: '工廠後台基本資料頁，橘色框標示工廠大頭貼上傳區及系統選檔視窗，步驟編號 ②',
        imageCaption: '點擊頭像區塊或「更換照片」上傳工廠大頭貼',
      },
      {
        id: 'step-3',
        title: '新增產品並填寫資料',
        description: '切換到「產品管理」分頁，點右上角「新增產品」，在下方展開的表單中填寫產品名稱、選擇價格方式（區間／固定／時價）、填寫產品描述，並上傳最多 3 張產品圖片，完成後點「新增」儲存。',
        image: '/manual/manage-store/upload-photos/step-03/19.png',
        imageAlt: '工廠後台產品管理分頁，橘色框標示新增產品表單，包含名稱、價格方式、描述、圖片欄位，步驟編號 ③',
        imageCaption: '在產品管理分頁點「新增產品」並填寫詳情',
      },
      {
        id: 'step-4',
        title: '設定產品分類',
        description: '產品分類可讓買家在你的工廠頁更快找到所需商品。新增產品後，可在「分類管理」建立自訂分類，並在各產品的表單中指定分類標籤。',
        note: ['教學圖片將於商品分類功能調整完成後補上。'],
      },
      {
        id: 'step-5',
        title: '設定接單狀態',
        description: '在「基本資料」分頁下滑至「營業資訊」區塊，選擇目前的接單狀態（接單中／產線繁忙／產線滿載），也可設定平日與假日的營業時間，完成後點右下角「儲存變更」。',
        image: '/manual/manage-store/upload-photos/step-05/21.png',
        imageAlt: '工廠後台基本資料頁，橘色框標示營業資訊區塊，顯示接單狀態選項與營業時間欄位，步驟編號 ⑤',
        imageCaption: '在營業資訊區塊選擇接單狀態，儲存後即時更新',
      },
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
