/**
 * 「新增公告」同步發送 Email 選項 — source-wiring 回歸測試。
 *
 * 背景：這是一次性的發布選項（不是公告資料本身），真正的規則保證點有三處：
 * 1. server/routers.ts 的 announcement.create：schema 預設 sendEmail=false、
 *    明確把 sendEmail 從公告資料拆開（不傳進 db.createAnnouncement）、只有
 *    sendEmail === true 才進入既有 Email 廣播流程；平台內通知與 APP 推播
 *    完全不受這個條件影響。
 * 2. server/routers.ts 的 announcement.update：input schema 完全沒有
 *    sendEmail 欄位，也就沒有任何入口能透過編輯重新寄信。
 * 3. client/src/pages/AdminAnnouncements.tsx：表單只有「新增」時顯示 Email
 *    勾選區塊，預設不勾選，編輯模式不顯示也不會送出這個欄位。
 *
 * 這裡採用與 server/announcementActionUrl.test.ts、server/navbarMobileAccordion.test.ts
 * 相同的原始碼區塊斷言手法：先用明確、獨一無二的錨點註解／字串把目標區塊從
 * 巨大的 routers.ts 中精準切出來，再對切出來的區塊做斷言，避免對整份檔案做
 * 容易誤判的模糊字串比對（同一份檔案裡還有 ad.create、loginPopup.create 等
 * 其他同名 mutation，不能只搜尋 "create: adminProcedure" 這種通用字串）。
 * 不 mock、不呼叫真正的 email 寄送函式，也不需要走真正的 fire-and-forget
 * 非同步流程（那一段本來就是 best-effort、不阻塞 mutation 回傳），只需要驗證
 * 程式碼本身的條件邏輯確實把 sendEmail 接起來、接對地方。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// 這幾個檔案在這個 repo 的 working copy 是 CRLF，多行 regex 裡的 \n 不會比對
// 到 \r\n，因此讀檔後統一正規化成 \n，只影響這個測試檔案內比對用的字串，
// 不會寫回原始檔案。
function readNormalized(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n");
}

const routersSource = readNormalized(path.resolve(import.meta.dirname, "routers.ts"));
const adminAnnouncementsSource = readNormalized(
  path.resolve(import.meta.dirname, "..", "client", "src", "pages", "AdminAnnouncements.tsx")
);
const dbSource = readNormalized(path.resolve(import.meta.dirname, "db.ts"));

// 精準切出 announcement router 整個區塊（list/create/update/delete），不含
// 檔案中其他同名的 create/update mutation（例如 ad.create、loginPopup 等）。
function extractAnnouncementRouterBlock(): string {
  const match = routersSource.match(
    /\/\/ ===== 平台公告 =====\n  announcement: router\(\{[\s\S]*?\n  \}\),\n\n  \/\/ ===== 找消息/
  );
  expect(match, "找不到 announcement router 區塊").not.toBeNull();
  return match![0];
}

function extractCreateMutationBlock(routerBlock: string): string {
  const start = routerBlock.indexOf("create: adminProcedure");
  const end = routerBlock.indexOf("update: adminProcedure");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return routerBlock.slice(start, end);
}

function extractUpdateMutationBlock(routerBlock: string): string {
  const start = routerBlock.indexOf("update: adminProcedure");
  const end = routerBlock.indexOf("delete: adminProcedure");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return routerBlock.slice(start, end);
}

function extractAdminFormBlock(): string {
  const match = adminAnnouncementsSource.match(
    /\{\/\* 新增 \/ 編輯表單 \*\/\}\n\s*\{showForm && \([\s\S]*?\n        \)\}\n\n\s*\{\/\* 公告列表 \*\/\}/
  );
  expect(match, "找不到新增／編輯表單區塊").not.toBeNull();
  return match![0];
}

// handleSubmit 是實際送出 mutate 呼叫的地方，不在 JSX 表單區塊（formBlock）裡，
// 因此需要另外從整份原始碼切出來，不能只看 JSX。
function extractHandleSubmitBlock(): string {
  const match = adminAnnouncementsSource.match(/const handleSubmit = \(\) => \{[\s\S]*?\n  \};/);
  expect(match, "找不到 handleSubmit 函式").not.toBeNull();
  return match![0];
}

const routerBlock = extractAnnouncementRouterBlock();
const createBlock = extractCreateMutationBlock(routerBlock);
const updateBlock = extractUpdateMutationBlock(routerBlock);
const formBlock = extractAdminFormBlock();
const handleSubmitBlock = extractHandleSubmitBlock();

describe("後端 announcement.create：sendEmail 是一次性選項，預設 false", () => {
  it("input schema 有 sendEmail，且預設為 false", () => {
    expect(createBlock).toMatch(/sendEmail:\s*z\.boolean\(\)\.default\(false\)/);
  });

  it("sendEmail 在呼叫 db.createAnnouncement 前明確被拆開，不當成公告資料", () => {
    expect(createBlock).toMatch(/const \{ sendEmail, \.\.\.announcementData \} = input;/);
  });

  it("db.createAnnouncement 收到的是拆開後的 announcementData，不是整個 input（否則 sendEmail 會被當成公告欄位傳進去）", () => {
    expect(createBlock).toMatch(/db\.createAnnouncement\(announcementData\)/);
    expect(createBlock).not.toMatch(/db\.createAnnouncement\(input\)/);
  });
});

describe("後端 announcement.create：站內通知與 APP 推播不受 sendEmail 條件控制", () => {
  it("站內通知區塊（fire-and-forget）完全不引用 sendEmail", () => {
    const start = createBlock.indexOf("// 站內通知");
    const end = createBlock.indexOf("// 手機推播");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const section = createBlock.slice(start, end);
    expect(section).not.toMatch(/sendEmail/);
  });

  it("APP 推播區塊（fire-and-forget）完全不引用 sendEmail", () => {
    const start = createBlock.indexOf("// 手機推播");
    const end = createBlock.indexOf("// Email 廣播");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const section = createBlock.slice(start, end);
    expect(section).not.toMatch(/sendEmail/);
  });
});

describe("後端 announcement.create：Email 廣播只在 sendEmail === true 時執行", () => {
  const emailBlockStart = createBlock.indexOf("// Email 廣播");
  const emailBlock = createBlock.slice(emailBlockStart);

  it("sendEmail 為 false／未傳時：只留下不含個資的跳過紀錄，不查詢收件人、不呼叫寄信函式", () => {
    expect(emailBlock).toMatch(/if \(!sendEmail\) \{/);
    expect(emailBlock).toMatch(/\[announcement\] email skipped id=\$\{announcementId\}: not selected by admin/);

    // 跳過分支（if 區塊本體）不應該出現既有的收件人查詢或寄信呼叫。
    const skipBranchStart = emailBlock.indexOf("if (!sendEmail) {");
    const skipBranchEnd = emailBlock.indexOf("} else {");
    expect(skipBranchEnd).toBeGreaterThan(skipBranchStart);
    const skipBranch = emailBlock.slice(skipBranchStart, skipBranchEnd);
    expect(skipBranch).not.toMatch(/getActiveUsersForAnnouncement/);
    expect(skipBranch).not.toMatch(/sendPlatformAnnouncementEmail/);
  });

  it("sendEmail 為 true 時：else 分支保留既有 Email 廣播流程（收件人查詢、opt-out 過濾、429 重試、寄送間隔）", () => {
    const elseBranchStart = emailBlock.indexOf("} else {");
    expect(elseBranchStart).toBeGreaterThan(-1);
    const elseBranch = emailBlock.slice(elseBranchStart);

    expect(elseBranch).toMatch(/getActiveUsersForAnnouncement/);
    expect(elseBranch).toMatch(/sendPlatformAnnouncementEmail/);
    // opt-out：notificationSettings.announcement !== false 才寄
    expect(elseBranch).toMatch(/s\['announcement'\] !== false/);
    // 429 重試與寄送間隔維持既有邏輯，不因這次改動被移除。
    expect(elseBranch).toMatch(/isRateLimitError/);
    expect(elseBranch).toMatch(/INTER_EMAIL_DELAY_MS/);
    expect(elseBranch).toMatch(/RETRY_DELAYS_MS/);
    // Email 失敗不可影響公告建立／站內通知／推播：仍是獨立 try/catch 包裹，
    // 錯誤只記錄不外拋。
    expect(elseBranch).toMatch(/\[announcement\] broadcast failed id=\$\{announcementId\}/);
  });

  it("sendPlatformAnnouncementEmail 只出現在 else 分支之後，不在 if(!sendEmail) 的跳過分支內", () => {
    const skipIdx = emailBlock.indexOf("if (!sendEmail) {");
    const elseIdx = emailBlock.indexOf("} else {");
    expect(skipIdx).toBeGreaterThan(-1);
    expect(elseIdx).toBeGreaterThan(skipIdx);

    // 只看「if 本體」到「else」之間這段（跳過分支），前面的說明註解不算數。
    const skipBranch = emailBlock.slice(skipIdx, elseIdx);
    expect(skipBranch).not.toMatch(/sendPlatformAnnouncementEmail\(/);

    // else 分支開始之後，才允許出現真正的呼叫。
    const afterElse = emailBlock.slice(elseIdx);
    expect(afterElse).toMatch(/sendPlatformAnnouncementEmail\(/);
  });
});

describe("後端 announcement.update：沒有重新寄送 Email 的入口", () => {
  it("input schema 完全沒有 sendEmail 欄位", () => {
    expect(updateBlock).not.toMatch(/sendEmail/);
  });

  it("mutation 本體不呼叫 Email 廣播、不查詢收件人", () => {
    expect(updateBlock).not.toMatch(/sendPlatformAnnouncementEmail/);
    expect(updateBlock).not.toMatch(/getActiveUsersForAnnouncement/);
  });

  it("只呼叫 db.updateAnnouncement，且不重新觸發站內通知／推播", () => {
    expect(updateBlock).toMatch(/db\.updateAnnouncement\(id, data\)/);
    expect(updateBlock).not.toMatch(/createPlatformNotifications/);
    expect(updateBlock).not.toMatch(/sendPushToRecipients/);
  });
});

describe("db.createAnnouncement：函式簽章本身就不接受 sendEmail（就算 Router 層失誤，也不會被當成公告欄位寫入）", () => {
  it("createAnnouncement 的參數型別不包含 sendEmail", () => {
    const match = dbSource.match(/export async function createAnnouncement\(data: \{[\s\S]*?\}\)/);
    expect(match, "找不到 createAnnouncement 函式簽章").not.toBeNull();
    expect(match![0]).not.toMatch(/sendEmail/);
  });
});

describe("前端 AdminAnnouncements.tsx：sendEmail 預設 false，只有新增時顯示、只有新增時送出", () => {
  it("DEFAULT_FORM 的 sendEmail 預設為 false", () => {
    expect(adminAnnouncementsSource).toMatch(
      /const DEFAULT_FORM: FormState = \{ title: "", content: "", type: "news", isPinned: false, actionUrl: "", sendEmail: false \};/
    );
  });

  it("通知方式區塊（含 Email 勾選）只在 !editingId（新增模式）時渲染", () => {
    expect(formBlock).toMatch(/\{!editingId && \(/);
    expect(formBlock).toMatch(/通知方式/);
    expect(formBlock).toMatch(/同步發送 Email 通知/);
  });

  it("Email 勾選區塊顯示固定發送的平台內通知／依設定發送的 APP 推播說明", () => {
    expect(formBlock).toMatch(/平台內通知：發布時固定發送/);
    expect(formBlock).toMatch(/APP 推播：發布時依會員通知設定發送/);
  });

  it("Checkbox 下方有明確的不可撤回說明文字", () => {
    expect(formBlock).toMatch(
      /勾選後，公告發布時將寄送給已開啟「平台公告 Email」的會員；Email 寄出後無法撤回。/
    );
  });

  it("新增公告送出時會帶上 sendEmail", () => {
    expect(handleSubmitBlock).toMatch(
      /createMut\.mutate\(\{ title: form\.title, content: form\.content, type: form\.type, isPinned: form\.isPinned, actionUrl, sendEmail: form\.sendEmail \}\);/
    );
  });

  it("編輯公告送出時不會帶上 sendEmail", () => {
    const updateCallMatch = handleSubmitBlock.match(/updateMut\.mutate\(\{[^}]*\}\);/);
    expect(updateCallMatch, "找不到 updateMut.mutate 呼叫").not.toBeNull();
    expect(updateCallMatch![0]).not.toMatch(/sendEmail/);
  });

  it("編輯回填（handleEdit）固定把 sendEmail 設為 false，且註解說明編輯模式不會顯示也不會送出", () => {
    expect(adminAnnouncementsSource).toMatch(/sendEmail: false,\n    \}\);/);
  });
});
