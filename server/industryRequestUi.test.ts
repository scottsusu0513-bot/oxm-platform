/**
 * 產業新增需求 + 官方身份的前端接線 source-contract 測試（比照
 * server/certificationCenterNoPublicEntry.test.ts 等既有檔案：純讀原始碼字串
 * 比對，驗證關鍵接線沒有被改壞，不啟動 jsdom）。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(...segs: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segs), "utf-8");
}

describe("首頁 CTA：『沒有你的產業？』次要入口", () => {
  const src = read("client", "src", "pages", "Home.tsx");

  it("CTA 區有『沒有你的產業？』按鈕，且是次要視覺（非 size=lg 的主 Button）", () => {
    expect(src).toMatch(/沒有你的產業？/);
    // 出現在 CTA 區塊（『開始搜尋』附近），且用文字/連結樣式，不是 <Button size="lg">
    const ctaBlock = src.match(/\{\/\* CTA \*\/\}[\s\S]*?IndustryRequestModal[\s\S]*?\/>/)?.[0] ?? "";
    expect(ctaBlock).toMatch(/沒有你的產業？/);
    expect(ctaBlock).toMatch(/<button[\s\S]*?沒有你的產業？[\s\S]*?<\/button>/);
  });

  it("未登入 → performLogin()，不開 modal、不建立匿名需求", () => {
    expect(src).toMatch(/if \(!isAuthenticated\) \{ performLogin\(\); return; \}/);
    expect(src).toMatch(/setIndustryRequestOpen\(true\)/);
  });

  it("掛載 <IndustryRequestModal open={...} onOpenChange={...} />", () => {
    expect(src).toMatch(/<IndustryRequestModal\s+open=\{industryRequestOpen\}\s+onOpenChange=\{setIndustryRequestOpen\}\s*\/>/);
  });
});

describe("IndustryRequestModal 三種狀態", () => {
  const src = read("client", "src", "components", "IndustryRequestModal.tsx");

  it("未登入分支：不呼叫 create，只導向 performLogin", () => {
    expect(src).toMatch(/if \(open && !isAuthenticated\)/);
    expect(src).toMatch(/performLogin\(\)/);
  });

  it("表單：姓名/Email 預填自會員 profile、電話預填且可空、需求說明必填 trim 檢查", () => {
    expect(src).toMatch(/setName\(user\?\.name \?\? ""\)/);
    expect(src).toMatch(/setEmail\(user\?\.email \?\? ""\)/);
    expect(src).toMatch(/setPhone\(user\?\.phone \?\? ""\)/);
    expect(src).toMatch(/const trimmedDesc = description\.trim\(\)/);
    expect(src).toMatch(/trimmedDesc\.length > 0/);
    expect(src).toMatch(/請描述您希望新增的產業/);
    expect(src).toMatch(/要求新增產業/);
  });

  it("送出中 disabled + loading，避免 double submit", () => {
    expect(src).toMatch(/disabled=\{!canSubmit\}/);
    expect(src).toMatch(/createMut\.isPending/);
    expect(src).toMatch(/送出中…/);
  });

  it("送出成功 → 立即切成『已收到您的需求』唯讀畫面（不是只 toast）", () => {
    expect(src).toMatch(/setJustSubmitted\(res\.request\)/);
    expect(src).toMatch(/已收到您的需求/);
    expect(src).toMatch(/管理員已受理中，請靜待通知/);
  });

  it("已有 active（重開）→ 顯示唯讀 snapshot + 送出時間 + 無『要求新增產業』按鈕", () => {
    expect(src).toMatch(/mineQuery\.data\?\.isActive/);
    expect(src).toMatch(/您已於 \{fmtDateTime\(request\.createdAt\)\} 提出需求/);
    // ReadonlySubmission 內不含送出按鈕
    const readonly = src.match(/function ReadonlySubmission[\s\S]*?\n\}/)?.[0] ?? "";
    expect(readonly).not.toMatch(/要求新增產業/);
    expect(readonly).toMatch(/bg-muted/);
  });

  it("mobile：DialogContent 有 max-height 綁 viewport + flex-col，body overflow-y-auto（X 不被推出）", () => {
    expect(src).toMatch(/max-h-\[calc\(100dvh-2rem\)\]/);
    expect(src).toMatch(/flex .*flex-col/);
    expect(src).toMatch(/overflow-y-auto/);
    expect(src).toMatch(/shrink-0/);
  });
});

describe("管理員客服中心：第三分頁『產業要求』", () => {
  const src = read("client", "src", "pages", "AdminSupportCenter.tsx");

  it("Tabs 內新增 value=\"industry\" 的『產業要求』trigger + content，沿用既有 Tabs 架構", () => {
    expect(src).toMatch(/<TabsTrigger value="industry"[\s\S]*?產業要求/);
    expect(src).toMatch(/<TabsContent value="industry"><IndustryRequestsTab \/><\/TabsContent>/);
    // 既有兩個分頁仍在
    expect(src).toMatch(/<TabsTrigger value="tickets"/);
    expect(src).toMatch(/<TabsTrigger value="reports"/);
  });

  it("狀態四值：pending/reviewing/resolved/rejected（待處理/處理中/已完成/不採用）", () => {
    const statuses = src.match(/const INDUSTRY_STATUSES = \[[\s\S]*?\] as const;/)?.[0] ?? "";
    expect(statuses).toMatch(/"pending"[\s\S]*"待處理"/);
    expect(statuses).toMatch(/"reviewing"[\s\S]*"處理中"/);
    expect(statuses).toMatch(/"resolved"[\s\S]*"已完成"/);
    expect(statuses).toMatch(/"rejected"[\s\S]*"不採用"/);
  });

  it("案件操作沿用既有 pattern：status Select + adminNote Textarea + StatusTimeline 進度", () => {
    // status 更新走 IndustryRequestsTab 的 updateStatus mutation → 透過 onUpdate prop 傳入 Actions
    expect(src).toMatch(/trpc\.industryRequest\.admin\.updateStatus\.useMutation/);
    expect(src).toMatch(/onUpdate=\{\(id, status, adminNote\) => updateMutation\.mutate\(\{ id, status, adminNote \}\)\}/);
    expect(src).toMatch(/處理備註（僅內部可見）/);
    expect(src).toMatch(/<StatusTimeline history=\{historyQuery\.data\}/);
    expect(src).toMatch(/trpc\.industryRequest\.admin\.getHistory\.useQuery/);
  });

  it("『私訊會員』CTA → industryRequest.admin.messageUser，成功後導向既有 /admin/messages/:campaignId thread", () => {
    expect(src).toMatch(/私訊會員/);
    expect(src).toMatch(/trpc\.industryRequest\.admin\.messageUser\.useMutation/);
    expect(src).toMatch(/setLocation\(`\/admin\/messages\/\$\{res\.campaignId\}`\)/);
  });

  it("案件列表顯示 姓名/Email/電話/需求說明/提出日期/更新日期，展開後含 userId 關聯", () => {
    const tab = src.match(/function IndustryRequestsTab[\s\S]*?\n\}/)?.[0] ?? "";
    expect(tab).toMatch(/r\.email/);
    expect(tab).toMatch(/r\.phone/);
    expect(tab).toMatch(/r\.description/);
    expect(tab).toMatch(/提出 \{new Date\(r\.createdAt\)/);
    expect(tab).toMatch(/更新 \{new Date\(r\.updatedAt\)/);
    expect(tab).toMatch(/會員 ID：#\{r\.userId\}/);
  });
});

describe("官方 sender 身份：client 只依 API senderIdentity render（不看 openId/email/role/ENV）", () => {
  it("AdminMessageDetail.tsx 用 campaign.senderIdentity，不再 hardcode『★ 平台管理員』字串到 render", () => {
    const src = read("client", "src", "pages", "AdminMessageDetail.tsx");
    expect(src).toMatch(/campaign\?\.senderIdentity/);
    expect(src).toMatch(/senderIdentity\?\.isOfficialOxmAccount/);
    expect(src).toMatch(/OFFICIAL_OXM_NAME_CLASSNAME/);
    // 官方時橘色半粗、一般管理員維持既有 font-bold text-orange-500
    expect(src).toMatch(/font-bold text-orange-500/);
    expect(src).not.toMatch(/OWNER_OPEN_ID/);
    expect(src).not.toMatch(/import\.meta\.env\.[A-Z_]*OWNER/);
  });

  it("MyMessages.tsx 收件匣用 conv.senderDisplayName / senderIsOfficialOxm，不 hardcode 標題", () => {
    const src = read("client", "src", "pages", "MyMessages.tsx");
    expect(src).toMatch(/senderIsOfficialOxm/);
    expect(src).toMatch(/senderDisplayName/);
    expect(src).toMatch(/OFFICIAL_OXM_NAME_CLASSNAME/);
    expect(src).not.toMatch(/OWNER_OPEN_ID/);
  });

  it("server 端 chat.getAdminMessage / myConversations 用 resolveAdminSenderIdentity 附上身份", () => {
    const src = read("server", "routers.ts");
    expect(src).toMatch(/import \{ resolveAdminSenderIdentity \} from '\.\/_core\/officialIdentity'/);
    expect(src).toMatch(/senderIdentity = resolveAdminSenderIdentity\(sender \?\? null\)/);
    expect(src).toMatch(/resolveAdminSenderIdentity\(senderById\.get\(c\.senderId\) \?\? null\)/);
  });

  it("shared/officialIdentity.ts 固定官方名稱、且 server resolver 以 openId 對 OWNER_OPEN_ID 判斷（不看 email/role/白名單）", () => {
    const shared = read("shared", "officialIdentity.ts");
    expect(shared).toMatch(/OFFICIAL_OXM_DISPLAY_NAME = "OXM負責人｜小鈞"/);
    const server = read("server", "_core", "officialIdentity.ts");
    // isOfficialOxmAccount 函式本體：只比對 openId 與 process.env.OWNER_OPEN_ID
    const fn = server.match(/export function isOfficialOxmAccount[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).toMatch(/process\.env\.OWNER_OPEN_ID/);
    expect(fn).toMatch(/user\.openId === owner/);
    expect(fn).not.toMatch(/\.email/);
    expect(fn).not.toMatch(/\.role/);
    expect(fn).not.toMatch(/adminWhitelist/);
  });
});
