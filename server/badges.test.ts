/**
 * 徽章系統安全測試 —— 純函式驗證，完全不連線／不讀寫 DB，不 import db.ts
 * 或 routers.ts（避免引入任何連線副作用），只測試 shared/badges.ts 匯出的
 * 白名單清洗與公開資料裁剪邏輯。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CERTIFICATION_BADGES,
  CERTIFICATION_BADGE_IDS,
  BNI_BADGE_ID,
  sortBadgeIds,
  isValidBadgeId,
  sanitizeCertificationEvidence,
  sanitizeBadgeAssignment,
  stripCertificationEvidence,
} from "../shared/badges";

describe("CERTIFICATION_BADGES 固定清單", () => {
  it("剛好 30 種徽章", () => {
    expect(CERTIFICATION_BADGES.length).toBe(30);
    expect(CERTIFICATION_BADGE_IDS.length).toBe(30);
  });

  it("id 全部唯一", () => {
    const unique = new Set(CERTIFICATION_BADGE_IDS);
    expect(unique.size).toBe(CERTIFICATION_BADGE_IDS.length);
  });

  it("BNI 是第一筆、sortOrder 為 0", () => {
    expect(CERTIFICATION_BADGES[0].id).toBe(BNI_BADGE_ID);
    expect(CERTIFICATION_BADGES[0].sortOrder).toBe(0);
  });

  it("每個徽章都有非空的中文名稱與說明", () => {
    for (const b of CERTIFICATION_BADGES) {
      expect(b.name.trim().length).toBeGreaterThan(0);
      expect(b.description.trim().length).toBeGreaterThan(0);
      expect(b.spriteId.trim().length).toBeGreaterThan(0);
    }
  });

  it("TQF 是台灣優良食品驗證，不是紡織品驗證（曾誤植過一次，回歸測試鎖住）", () => {
    const tqf = CERTIFICATION_BADGES.find(b => b.id === "tqf");
    expect(tqf).toBeDefined();
    expect(tqf!.name).toContain("食品");
    expect(tqf!.name).not.toContain("紡織");
    expect(tqf!.description).toContain("食品");
    expect(tqf!.description).not.toContain("紡織");
  });
});

describe("sortBadgeIds", () => {
  it("BNI 永遠排第一，其餘依固定 sortOrder", () => {
    const sorted = sortBadgeIds(["ce", "bni", "iso-9001"]);
    expect(sorted).toEqual(["bni", "iso-9001", "ce"]);
  });

  it("未知 id 一律過濾，不會出現在結果中", () => {
    const sorted = sortBadgeIds(["bni", "not-a-real-badge", "hacked-id"]);
    expect(sorted).toEqual(["bni"]);
  });

  it("重複 id 去重", () => {
    const sorted = sortBadgeIds(["bni", "bni", "ce", "ce"]);
    expect(sorted).toEqual(["bni", "ce"]);
  });

  it("空陣列回傳空陣列", () => {
    expect(sortBadgeIds([])).toEqual([]);
  });
});

describe("isValidBadgeId", () => {
  it("合法 id 回傳 true", () => {
    expect(isValidBadgeId("bni")).toBe(true);
    expect(isValidBadgeId("rohs")).toBe(true);
  });

  it("未知或非字串 id 回傳 false", () => {
    expect(isValidBadgeId("not-a-real-badge")).toBe(false);
    expect(isValidBadgeId(123)).toBe(false);
    expect(isValidBadgeId(null)).toBe(false);
    expect(isValidBadgeId(undefined)).toBe(false);
  });
});

describe("sanitizeCertificationEvidence — 白名單清洗", () => {
  it("只保留仍在目前 badges 清單中的 evidence", () => {
    const result = sanitizeCertificationEvidence(
      [
        { badgeId: "bni", description: "說明", imageUrls: ["https://example.com/a.jpg"] },
        { badgeId: "ce", description: "已移除的徽章", imageUrls: [] },
      ],
      ["bni"], // ce 已不在目前選擇的 badges 清單中
    );
    expect(result).toEqual([{ badgeId: "bni", description: "說明", imageUrls: ["https://example.com/a.jpg"] }]);
  });

  it("拒絕未知 badgeId", () => {
    const result = sanitizeCertificationEvidence(
      [{ badgeId: "hacked-id", description: "x", imageUrls: [] }],
      ["hacked-id"],
    );
    expect(result).toEqual([]);
  });

  it("同一 badgeId 重複只保留第一筆", () => {
    const result = sanitizeCertificationEvidence(
      [
        { badgeId: "bni", description: "第一筆", imageUrls: [] },
        { badgeId: "bni", description: "第二筆", imageUrls: [] },
      ],
      ["bni"],
    );
    expect(result.length).toBe(1);
    expect(result[0].description).toBe("第一筆");
  });

  it("每個徽章最多 5 張圖片，超出裁切", () => {
    const urls = Array.from({ length: 8 }, (_, i) => `https://example.com/${i}.jpg`);
    const result = sanitizeCertificationEvidence([{ badgeId: "bni", description: "", imageUrls: urls }], ["bni"]);
    expect(result[0].imageUrls.length).toBe(5);
  });

  it("拒絕非 http(s) 的圖片 URL（例如 javascript: 或相對路徑）", () => {
    const result = sanitizeCertificationEvidence(
      [{ badgeId: "bni", description: "", imageUrls: ["javascript:alert(1)", "/etc/passwd", "https://example.com/ok.jpg"] }],
      ["bni"],
    );
    expect(result[0].imageUrls).toEqual(["https://example.com/ok.jpg"]);
  });

  it("說明文字裁切到 500 字上限", () => {
    const longText = "a".repeat(1000);
    const result = sanitizeCertificationEvidence([{ badgeId: "bni", description: longText, imageUrls: [] }], ["bni"]);
    expect(result[0].description.length).toBe(500);
  });

  it("非陣列輸入回傳空陣列", () => {
    expect(sanitizeCertificationEvidence(null, ["bni"])).toEqual([]);
    expect(sanitizeCertificationEvidence(undefined, ["bni"])).toEqual([]);
    expect(sanitizeCertificationEvidence("not-an-array", ["bni"])).toEqual([]);
  });

  it("全部徽章合計最多 30 張圖片，超出的部分（含後續徽章）一律裁切", () => {
    const makeUrls = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `https://example.com/${prefix}${i}.jpg`);
    const result = sanitizeCertificationEvidence(
      [
        { badgeId: "bni", description: "", imageUrls: makeUrls("a", 5) },
        { badgeId: "ce", description: "", imageUrls: makeUrls("b", 5) },
        { badgeId: "ul", description: "", imageUrls: makeUrls("c", 5) },
        { badgeId: "rohs", description: "", imageUrls: makeUrls("d", 5) },
        { badgeId: "cns", description: "", imageUrls: makeUrls("e", 5) },
        { badgeId: "bsmi", description: "", imageUrls: makeUrls("f", 5) },
        { badgeId: "haccp", description: "", imageUrls: makeUrls("g", 5) }, // 第 7 個徽章，總量會超過 30
      ],
      ["bni", "ce", "ul", "rohs", "cns", "bsmi", "haccp"],
    );
    const totalImages = result.reduce((sum, e) => sum + e.imageUrls.length, 0);
    expect(totalImages).toBe(30);
  });
});

describe("sanitizeBadgeAssignment — updateFactory／submitRevision／approveRevisionAtomic 共用清洗", () => {
  it("badges 與 evidence 成對清洗，evidence 依清洗後的 badges 過濾", () => {
    const result = sanitizeBadgeAssignment(
      ["ce", "bni", "not-real"],
      [
        { badgeId: "bni", description: "ok", imageUrls: [] },
        { badgeId: "not-real", description: "被拒絕的徽章", imageUrls: [] },
      ],
    );
    expect(result.certificationBadges).toEqual(["bni", "ce"]);
    expect(result.certificationEvidence).toEqual([{ badgeId: "bni", description: "ok", imageUrls: [] }]);
  });

  it("模擬繞過前端、直接呼叫 submitRevision：未知 badge id + 非 http(s) 圖片 URL + 未選徽章的 orphan evidence 全部被拒絕", () => {
    const maliciousProposedData = {
      certificationBadges: ["bni", "<script>alert(1)</script>", "iso-9001"],
      certificationEvidence: [
        { badgeId: "bni", description: "ok", imageUrls: ["https://example.com/real.jpg", "javascript:alert(1)"] },
        { badgeId: "ce", description: "ce 沒有被選進 badges，屬於 orphan evidence", imageUrls: ["https://example.com/orphan.jpg"] },
      ],
    };
    const result = sanitizeBadgeAssignment(maliciousProposedData.certificationBadges, maliciousProposedData.certificationEvidence);
    expect(result.certificationBadges).toEqual(["bni", "iso-9001"]);
    expect(result.certificationEvidence).toEqual([
      { badgeId: "bni", description: "ok", imageUrls: ["https://example.com/real.jpg"] },
    ]);
  });
});

describe("stripCertificationEvidence — 公開 API 回應絕不洩漏私密證明資料", () => {
  it("移除 certificationEvidence，保留其餘欄位（含公開的 certificationBadges）", () => {
    const factory = {
      id: 1,
      name: "測試工廠",
      certificationBadges: ["bni", "ce"],
      certificationEvidence: [{ badgeId: "bni", description: "秘密說明", imageUrls: ["https://example.com/secret.jpg"] }],
    };
    const publicFactory = stripCertificationEvidence(factory);
    expect(publicFactory).not.toHaveProperty("certificationEvidence");
    expect((publicFactory as any).certificationBadges).toEqual(["bni", "ce"]);
    expect(JSON.stringify(publicFactory)).not.toContain("秘密說明");
    expect(JSON.stringify(publicFactory)).not.toContain("secret.jpg");
  });
});

/**
 * routers.ts 靜態安全合約測試 —— 不 import routers.ts／db.ts（避免連線副作用），
 * 改用 readFileSync 讀取原始碼文字，對四條實際會回傳工廠資料給一般使用者／未授權者
 * 的 route 分別做「有邊界」的區塊擷取（用唯一錨點切出該 route 的原始碼片段），
 * 逐一證明每條路徑各自都有呼叫 stripCertificationEvidence，而不是在整份檔案搜一次
 * 字串就當作四條都合格。
 *
 * 之前這裡有一個自行組裝 publicResponse 的假測試，宣稱「未授權 getById 不會讀到
 * revision.proposedData」，但那個 publicResponse 是測試自己拼出來的，並不是
 * routers.ts 實際回傳的結構（真正的 factory.getById 在未授權時是把
 * latestRevision 設為 null，而不是把 proposedData 原樣回傳）。已移除，改用下方
 * 對 routers.ts 原始碼的靜態合約測試取代。
 */
const ROUTERS_SOURCE = readFileSync(path.join(__dirname, "routers.ts"), "utf-8");

/**
 * 用一對唯一錨點字串切出原始碼片段。兩個錨點都必須在整份檔案中「恰好出現一次」，
 * 否則代表錨點不夠精準（可能誤切到同名的其他 route），測試會直接失敗，
 * 而不是安靜地切到錯的區塊。
 */
function extractBlock(source: string, startAnchor: string, endAnchor: string): string {
  const start = source.indexOf(startAnchor);
  expect(start, `找不到起始錨點：${startAnchor}`).toBeGreaterThanOrEqual(0);
  expect(source.indexOf(startAnchor, start + 1), `起始錨點必須在檔案中唯一：${startAnchor}`).toBe(-1);

  const end = source.indexOf(endAnchor, start + startAnchor.length);
  expect(end, `找不到結束錨點：${endAnchor}`).toBeGreaterThan(start);
  expect(source.indexOf(endAnchor, end + 1), `結束錨點必須在檔案中唯一：${endAnchor}`).toBe(-1);

  return source.slice(start, end);
}

describe("server/routers.ts 靜態安全合約 —— 四條回傳工廠資料的路徑都必須呼叫 stripCertificationEvidence", () => {
  it("factory.getById：未授權／公開回應分支呼叫 stripCertificationEvidence（isAuthorized 為 true 時才回傳未裁剪的 factory）", () => {
    const block = extractBlock(
      ROUTERS_SOURCE,
      "getById: publicProcedure.input(z.object({\r\n      id: z.number(),",
      "getMine: protectedProcedure.query(async ({ ctx }) => {",
    );
    expect(block).toMatch(/const publicSafeFactory = isAuthorized \? factory : stripCertificationEvidence\(factory\);/);
  });

  it("factory.search：回傳的 items 與 ads 內嵌的 factory 都呼叫 stripCertificationEvidence", () => {
    const block = extractBlock(
      ROUTERS_SOURCE,
      "search: publicProcedure.input(z.object({",
      "delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {",
    );
    expect(block).toContain("items: result.items.map(stripCertificationEvidence)");
    expect(block).toMatch(
      /ads: ads\.map\(ad => ad\.factory \? \{ \.\.\.ad, factory: stripCertificationEvidence\(ad\.factory\) \} : ad\)/,
    );
  });

  it("favorite.getByUser：回傳的 items 呼叫 stripCertificationEvidence（收藏清單的使用者不是 owner／共管者／admin）", () => {
    const block = extractBlock(
      ROUTERS_SOURCE,
      "getByUser: protectedProcedure.input(z.object({",
      "// ===== 管理員儀表板 =====",
    );
    expect(block).toContain("items: result.items.map(stripCertificationEvidence)");
  });

  it("ad.getActive：nested factory 呼叫 stripCertificationEvidence", () => {
    const block = extractBlock(
      ROUTERS_SOURCE,
      "getActive: publicProcedure.input(z.object({",
      "create: adminProcedure.input(z.object({\r\n      factoryId: z.number(),",
    );
    expect(block).toMatch(
      /ads\.slice\(0, 5\)\.map\(ad => ad\.factory \? \{ \.\.\.ad, factory: stripCertificationEvidence\(ad\.factory\) \} : ad\)/,
    );
  });
});
