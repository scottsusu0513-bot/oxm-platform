/**
 * 公告「相關內容連結（actionUrl）」回歸測試。
 *
 * 背景：actionUrl 只有 type === "news"（平台消息）能設定，其他類型一律強制
 * 為 null；這條規則的真正保證點在 server/db.ts 的 normalizeAnnouncementActionUrl
 * （createAnnouncement／updateAnnouncement 共用），不只依賴前端或 Router，
 * 即使直接呼叫 db 函式（跳過 Router）規則依然成立。update 是 partial input，
 * 因此還需要正確處理「這次 payload 有沒有帶 type／actionUrl」與「資料庫目前
 * 的 type」交叉出的邊界情況（詳見下方 describe 區塊）。
 *
 * createAnnouncement／updateAnnouncement／getAnnouncementById 都是真實 DB
 * 函式，測試走本機測試資料庫（受 server/test-db-guard.ts 保護，不可能連到
 * 正式/遠端資料庫），每筆測試建立的公告都在 finally 內刪除，assertion 失敗
 * 或例外時也一樣會 cleanup。前端渲染條件與「哪些地方不得顯示按鈕」則採用
 * 與 server/factoryContactLogin.test.ts、server/navbarMobileAccordion.test.ts
 * 相同的原始碼內容斷言手法，不引入新測試框架。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import * as db from "./db";
import { getDb } from "./db";
import { announcements } from "../drizzle/schema";

async function cleanupAnnouncement(id: number | undefined): Promise<void> {
  if (!id) return;
  await db.deleteAnnouncement(id);
}

describe("createAnnouncement: actionUrl 只有 news 能設定，格式驗證", () => {
  it("news 公告不填 actionUrl，可正常建立並儲存 null", async () => {
    let id: number | undefined;
    try {
      id = await db.createAnnouncement({ title: "t-no-url", content: "c", type: "news" });
      const row = await db.getAnnouncementById(id);
      expect(row?.actionUrl).toBeNull();
    } finally {
      await cleanupAnnouncement(id);
    }
  });

  it("news actionUrl 空白字串，儲存為 null", async () => {
    let id: number | undefined;
    try {
      id = await db.createAnnouncement({ title: "t-blank-url", content: "c", type: "news", actionUrl: "   " });
      const row = await db.getAnnouncementById(id);
      expect(row?.actionUrl).toBeNull();
    } finally {
      await cleanupAnnouncement(id);
    }
  });

  it("news /upgrade-center（站內相對路徑）合法", async () => {
    let id: number | undefined;
    try {
      id = await db.createAnnouncement({ title: "t-internal", content: "c", type: "news", actionUrl: "/upgrade-center" });
      const row = await db.getAnnouncementById(id);
      expect(row?.actionUrl).toBe("/upgrade-center");
    } finally {
      await cleanupAnnouncement(id);
    }
  });

  it("news HTTPS 外部網址合法", async () => {
    let id: number | undefined;
    try {
      id = await db.createAnnouncement({ title: "t-https", content: "c", type: "news", actionUrl: "https://example.com/page" });
      const row = await db.getAnnouncementById(id);
      expect(row?.actionUrl).toBe("https://example.com/page");
    } finally {
      await cleanupAnnouncement(id);
    }
  });

  it("news javascript: 被拒絕", async () => {
    await expect(
      db.createAnnouncement({ title: "t-js", content: "c", type: "news", actionUrl: "javascript:alert(1)" })
    ).rejects.toThrow();
  });

  it("news data: 被拒絕", async () => {
    await expect(
      db.createAnnouncement({ title: "t-data", content: "c", type: "news", actionUrl: "data:text/html,hi" })
    ).rejects.toThrow();
  });

  it("news //example.com（protocol-relative）被拒絕", async () => {
    await expect(
      db.createAnnouncement({ title: "t-protorel", content: "c", type: "news", actionUrl: "//example.com" })
    ).rejects.toThrow();
  });

  it("news http://example.com（非 HTTPS）被拒絕", async () => {
    await expect(
      db.createAnnouncement({ title: "t-http", content: "c", type: "news", actionUrl: "http://example.com" })
    ).rejects.toThrow();
  });

  it("maintenance／update 即使傳入 actionUrl，最終仍強制為 null（不因格式合法與否而擋住儲存）", async () => {
    let id1: number | undefined;
    let id2: number | undefined;
    try {
      id1 = await db.createAnnouncement({ title: "t-maint", content: "c", type: "maintenance", actionUrl: "https://example.com" });
      const row1 = await db.getAnnouncementById(id1);
      expect(row1?.actionUrl).toBeNull();

      id2 = await db.createAnnouncement({ title: "t-update", content: "c", type: "update", actionUrl: "/foo" });
      const row2 = await db.getAnnouncementById(id2);
      expect(row2?.actionUrl).toBeNull();
    } finally {
      await cleanupAnnouncement(id1);
      await cleanupAnnouncement(id2);
    }
  });
});

describe("updateAnnouncement: partial update 邊界情況", () => {
  it("情境 B：news 有 actionUrl，只修改 title 時保留原網址（沒帶 type/actionUrl）", async () => {
    let id: number | undefined;
    try {
      id = await db.createAnnouncement({ title: "before", content: "c", type: "news", actionUrl: "/foo" });
      await db.updateAnnouncement(id, { title: "after" });
      const row = await db.getAnnouncementById(id);
      expect(row?.title).toBe("after");
      expect(row?.actionUrl).toBe("/foo");
    } finally {
      await cleanupAnnouncement(id);
    }
  });

  it("情境 A：news 改成 maintenance 且沒傳 actionUrl，舊網址仍會清成 null", async () => {
    let id: number | undefined;
    try {
      id = await db.createAnnouncement({ title: "t", content: "c", type: "news", actionUrl: "/foo" });
      await db.updateAnnouncement(id, { type: "maintenance" });
      const row = await db.getAnnouncementById(id);
      expect(row?.type).toBe("maintenance");
      expect(row?.actionUrl).toBeNull();
    } finally {
      await cleanupAnnouncement(id);
    }
  });

  it("情境 D：maintenance 只修改標題，即使資料庫已有異常殘留 actionUrl，這次更新也會清成 null", async () => {
    let id: number | undefined;
    try {
      id = await db.createAnnouncement({ title: "t", content: "c", type: "maintenance" });
      // 模擬舊資料異常（不經過 normalizeAnnouncementActionUrl 直接寫入），
      // 驗證下一次任何欄位的更新都會自動把它清成 null（自我修復，不只在
      // 明確改 type/actionUrl 時才處理）。
      const conn = await getDb();
      if (!conn) throw new Error("no db");
      await conn.update(announcements).set({ actionUrl: "/leaked-legacy-value" }).where(eq(announcements.id, id));

      await db.updateAnnouncement(id, { title: "only title changed" });
      const row = await db.getAnnouncementById(id);
      expect(row?.title).toBe("only title changed");
      expect(row?.actionUrl).toBeNull();
    } finally {
      await cleanupAnnouncement(id);
    }
  });

  it("情境 E：maintenance 改成 news 並傳合法網址，成功保存", async () => {
    let id: number | undefined;
    try {
      id = await db.createAnnouncement({ title: "t", content: "c", type: "maintenance" });
      await db.updateAnnouncement(id, { type: "news", actionUrl: "/bar" });
      const row = await db.getAnnouncementById(id);
      expect(row?.type).toBe("news");
      expect(row?.actionUrl).toBe("/bar");
    } finally {
      await cleanupAnnouncement(id);
    }
  });

  it("情境 E：maintenance 改成 news 但沒傳網址，actionUrl 為 null（不會復活先前已清除的舊網址）", async () => {
    let id: number | undefined;
    try {
      id = await db.createAnnouncement({ title: "t", content: "c", type: "maintenance" });
      await db.updateAnnouncement(id, { type: "news" });
      const row = await db.getAnnouncementById(id);
      expect(row?.type).toBe("news");
      expect(row?.actionUrl).toBeNull();
    } finally {
      await cleanupAnnouncement(id);
    }
  });

  it("情境 C：news 明確傳 actionUrl=null，成功清除", async () => {
    let id: number | undefined;
    try {
      id = await db.createAnnouncement({ title: "t", content: "c", type: "news", actionUrl: "/foo" });
      await db.updateAnnouncement(id, { actionUrl: null });
      const row = await db.getAnnouncementById(id);
      expect(row?.actionUrl).toBeNull();
    } finally {
      await cleanupAnnouncement(id);
    }
  });

  it("情境 C：news 明確傳 actionUrl=''，成功清除", async () => {
    let id: number | undefined;
    try {
      id = await db.createAnnouncement({ title: "t", content: "c", type: "news", actionUrl: "/foo" });
      await db.updateAnnouncement(id, { actionUrl: "" });
      const row = await db.getAnnouncementById(id);
      expect(row?.actionUrl).toBeNull();
    } finally {
      await cleanupAnnouncement(id);
    }
  });

  it("情境 C：news 傳入新網址，更新為新網址", async () => {
    let id: number | undefined;
    try {
      id = await db.createAnnouncement({ title: "t", content: "c", type: "news", actionUrl: "/foo" });
      await db.updateAnnouncement(id, { actionUrl: "/bar" });
      const row = await db.getAnnouncementById(id);
      expect(row?.actionUrl).toBe("/bar");
    } finally {
      await cleanupAnnouncement(id);
    }
  });
});

describe("client/src/pages/Announcements.tsx: 唯一允許顯示按鈕的位置", () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, "..", "client", "src", "pages", "Announcements.tsx"),
    "utf-8"
  );

  it("按鈕渲染條件同時檢查 type === news 與 actionUrl", () => {
    expect(source).toMatch(/\{item\.type === "news" && item\.actionUrl && \(/);
  });

  it("按鈕文字固定為「了解更多」，且沒有 actionLabel 欄位", () => {
    expect(source).toMatch(/了解更多/);
    expect(source).not.toMatch(/actionLabel/);
  });

  it("站內網址使用 wouter Link（SPA 路由），不使用 window.location 整頁跳轉", () => {
    expect(source).toMatch(/<Link href=\{actionUrl\}>/);
    expect(source).not.toMatch(/window\.location\.href\s*=\s*actionUrl/);
  });

  it("站外網址具備安全開啟屬性，且 APP 環境改用 openExternalUrl（不直接用 <a target=_blank> 劫持 WebView）", () => {
    expect(source).toMatch(/target="_blank" rel="noopener noreferrer"/);
    expect(source).toMatch(/isNativeApp\(\)/);
    expect(source).toMatch(/openExternalUrl\(actionUrl\)/);
  });
});

describe("其他公告顯示入口：不得渲染「了解更多」按鈕", () => {
  it("Home.tsx 公告摘要區塊（AnnouncementsSection）不含 actionUrl／按鈕渲染邏輯", () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "..", "client", "src", "pages", "Home.tsx"),
      "utf-8"
    );
    const sectionMatch = source.match(/function AnnouncementsSection\([\s\S]*?\n\}\n/);
    expect(sectionMatch, "找不到 AnnouncementsSection 函式").not.toBeNull();
    const section = sectionMatch![0];
    expect(section).not.toMatch(/actionUrl/);
    expect(section).not.toMatch(/了解更多/);
  });

  it("AdminAnnouncements.tsx 沒有渲染「了解更多」按鈕（輔助文字裡提到這個詞不算——只確認沒有實際 <Button> 渲染）", () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "..", "client", "src", "pages", "AdminAnnouncements.tsx"),
      "utf-8"
    );
    // 唯一允許提到「了解更多」的地方是輔助說明文字（一句話描述會員在公告頁看到什麼），
    // 不能是任何 <Button>／<a> 之類的實際可點擊渲染。
    expect(source).toMatch(/填寫後，使用者可在完整公告下方點選「了解更多」前往相關頁面。/);
    expect(source).not.toMatch(/<Button[^>]*>[\s\S]{0,80}了解更多/);
    expect(source).not.toMatch(/AnnouncementActionButton/);
  });
});

describe("AdminAnnouncements.tsx: 表單只有 news 顯示 actionUrl 欄位，切換類型會清空", () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, "..", "client", "src", "pages", "AdminAnnouncements.tsx"),
    "utf-8"
  );

  it("相關內容連結欄位只在 form.type === 'news' 時渲染", () => {
    expect(source).toMatch(/\{form\.type === "news" && \(/);
    expect(source).toMatch(/相關內容連結（選填）/);
    expect(source).toMatch(/例如：\/upgrade-center 或 https:\/\/example\.com\/page/);
  });

  it("類型下拉切換時，同一次 setState 內清空 actionUrl", () => {
    expect(source).toMatch(/actionUrl: v === "news" \? p\.actionUrl : "",/);
  });

  it("編輯回填：非 news 公告 actionUrl 一律以空字串呈現（即使資料庫有殘留值）", () => {
    expect(source).toMatch(/actionUrl: item\.type === "news" \? \(item\.actionUrl \?\? ""\) : "",/);
  });

  it("送出前的第二層防線：非 news 一律送 null，不把表單殘留網址送到後端", () => {
    expect(source).toMatch(/const actionUrl = form\.type === "news" \? \(form\.actionUrl\.trim\(\) \|\| null\) : null;/);
  });

  it("DEFAULT_FORM 與 resetForm 語意上會清空 actionUrl（新增成功後重設表單）", () => {
    expect(source).toMatch(/const DEFAULT_FORM: FormState = \{ title: "", content: "", type: "news", isPinned: false, actionUrl: "", sendEmail: false \};/);
  });
});
