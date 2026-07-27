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
  stripCertificationEvidenceFromRevision,
  isValidCertificationEvidenceKey,
  appendCertificationEvidenceImage,
  applyCertificationEvidenceDescriptions,
  summarizeCertificationEvidenceForOwner,
} from "../shared/badges";

// 測試用合法私有 object key（factoryId=1，符合 isValidCertificationEvidenceKey 格式）
const validKey = (n: number | string, ext: "jpg" | "png" | "webp" = "jpg") =>
  `certification-evidence/1/testkey${String(n).padStart(4, "0")}abcdefgh.${ext}`;

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

describe("isValidCertificationEvidenceKey", () => {
  it("合法私有 object key 回傳 true", () => {
    expect(isValidCertificationEvidenceKey(validKey(1))).toBe(true);
    expect(isValidCertificationEvidenceKey(validKey(2, "png"))).toBe(true);
    expect(isValidCertificationEvidenceKey(validKey(3, "webp"))).toBe(true);
  });

  it("拒絕永久公開 URL 與 presigned URL（本次遷移的核心防線：不可誤把網址當 key 存進資料庫）", () => {
    expect(isValidCertificationEvidenceKey("https://bucket.s3.amazonaws.com/certification-evidence/1/a.jpg")).toBe(false);
    expect(isValidCertificationEvidenceKey("https://bucket.s3.amazonaws.com/x.jpg?X-Amz-Signature=abc")).toBe(false);
  });

  it("拒絕夾帶徽章／認證名稱、路徑跳脫或非法字元的 key", () => {
    expect(isValidCertificationEvidenceKey("certification-evidence/1/ISO/IEC 27001.jpg")).toBe(false);
    expect(isValidCertificationEvidenceKey("certification-evidence/../1/testkeyabcdefghij.jpg")).toBe(false);
    expect(isValidCertificationEvidenceKey("certification-evidence/1/../../etc/passwd")).toBe(false);
    expect(isValidCertificationEvidenceKey("other-prefix/1/testkeyabcdefghij.jpg")).toBe(false);
  });

  it("拒絕非數字 factoryId 與不支援的副檔名", () => {
    expect(isValidCertificationEvidenceKey("certification-evidence/abc/testkeyabcdefghij.jpg")).toBe(false);
    expect(isValidCertificationEvidenceKey("certification-evidence/1/testkeyabcdefghij.pdf")).toBe(false);
  });

  it("非字串輸入一律回傳 false", () => {
    expect(isValidCertificationEvidenceKey(123)).toBe(false);
    expect(isValidCertificationEvidenceKey(null)).toBe(false);
    expect(isValidCertificationEvidenceKey(undefined)).toBe(false);
  });
});

describe("sanitizeCertificationEvidence — 白名單清洗", () => {
  it("只保留仍在目前 badges 清單中的 evidence", () => {
    const result = sanitizeCertificationEvidence(
      [
        { badgeId: "bni", description: "說明", imageKeys: [validKey(1)] },
        { badgeId: "ce", description: "已移除的徽章", imageKeys: [] },
      ],
      ["bni"], // ce 已不在目前選擇的 badges 清單中
    );
    expect(result).toEqual([{ badgeId: "bni", description: "說明", imageKeys: [validKey(1)] }]);
  });

  it("拒絕未知 badgeId", () => {
    const result = sanitizeCertificationEvidence(
      [{ badgeId: "hacked-id", description: "x", imageKeys: [] }],
      ["hacked-id"],
    );
    expect(result).toEqual([]);
  });

  it("同一 badgeId 重複只保留第一筆", () => {
    const result = sanitizeCertificationEvidence(
      [
        { badgeId: "bni", description: "第一筆", imageKeys: [] },
        { badgeId: "bni", description: "第二筆", imageKeys: [] },
      ],
      ["bni"],
    );
    expect(result.length).toBe(1);
    expect(result[0].description).toBe("第一筆");
  });

  it("每個徽章最多 5 張圖片，超出裁切", () => {
    const keys = Array.from({ length: 8 }, (_, i) => validKey(i));
    const result = sanitizeCertificationEvidence([{ badgeId: "bni", description: "", imageKeys: keys }], ["bni"]);
    expect(result[0].imageKeys.length).toBe(5);
  });

  it("拒絕非法格式的圖片 key（例如永久網址、javascript: 或相對路徑）", () => {
    const result = sanitizeCertificationEvidence(
      [{ badgeId: "bni", description: "", imageKeys: ["javascript:alert(1)", "/etc/passwd", "https://example.com/ok.jpg", validKey(1)] }],
      ["bni"],
    );
    expect(result[0].imageKeys).toEqual([validKey(1)]);
  });

  it("說明文字裁切到 500 字上限", () => {
    const longText = "a".repeat(1000);
    const result = sanitizeCertificationEvidence([{ badgeId: "bni", description: longText, imageKeys: [] }], ["bni"]);
    expect(result[0].description.length).toBe(500);
  });

  it("非陣列輸入回傳空陣列", () => {
    expect(sanitizeCertificationEvidence(null, ["bni"])).toEqual([]);
    expect(sanitizeCertificationEvidence(undefined, ["bni"])).toEqual([]);
    expect(sanitizeCertificationEvidence("not-an-array", ["bni"])).toEqual([]);
  });

  it("全部徽章合計最多 30 張圖片，超出的部分（含後續徽章）一律裁切", () => {
    const makeKeys = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => validKey(`${prefix}${i}`));
    const result = sanitizeCertificationEvidence(
      [
        { badgeId: "bni", description: "", imageKeys: makeKeys("a", 5) },
        { badgeId: "ce", description: "", imageKeys: makeKeys("b", 5) },
        { badgeId: "ul", description: "", imageKeys: makeKeys("c", 5) },
        { badgeId: "rohs", description: "", imageKeys: makeKeys("d", 5) },
        { badgeId: "cns", description: "", imageKeys: makeKeys("e", 5) },
        { badgeId: "bsmi", description: "", imageKeys: makeKeys("f", 5) },
        { badgeId: "haccp", description: "", imageKeys: makeKeys("g", 5) }, // 第 7 個徽章，總量會超過 30
      ],
      ["bni", "ce", "ul", "rohs", "cns", "bsmi", "haccp"],
    );
    const totalImages = result.reduce((sum, e) => sum + e.imageKeys.length, 0);
    expect(totalImages).toBe(30);
  });
});

describe("sanitizeBadgeAssignment — updateFactory／submitRevision／approveRevisionAtomic 共用清洗", () => {
  it("badges 與 evidence 成對清洗，evidence 依清洗後的 badges 過濾", () => {
    const result = sanitizeBadgeAssignment(
      ["ce", "bni", "not-real"],
      [
        { badgeId: "bni", description: "ok", imageKeys: [] },
        { badgeId: "not-real", description: "被拒絕的徽章", imageKeys: [] },
      ],
    );
    expect(result.certificationBadges).toEqual(["bni", "ce"]);
    expect(result.certificationEvidence).toEqual([{ badgeId: "bni", description: "ok", imageKeys: [] }]);
  });

  it("模擬繞過前端、直接呼叫 submitRevision：未知 badge id + 非法格式的圖片 key（含永久 URL）+ 未選徽章的 orphan evidence 全部被拒絕", () => {
    const maliciousProposedData = {
      certificationBadges: ["bni", "<script>alert(1)</script>", "iso-9001"],
      certificationEvidence: [
        { badgeId: "bni", description: "ok", imageKeys: [validKey(1), "https://example.com/real.jpg", "javascript:alert(1)"] },
        { badgeId: "ce", description: "ce 沒有被選進 badges，屬於 orphan evidence", imageKeys: [validKey(2)] },
      ],
    };
    const result = sanitizeBadgeAssignment(maliciousProposedData.certificationBadges, maliciousProposedData.certificationEvidence);
    expect(result.certificationBadges).toEqual(["bni", "iso-9001"]);
    expect(result.certificationEvidence).toEqual([
      { badgeId: "bni", description: "ok", imageKeys: [validKey(1)] },
    ]);
  });
});

describe("stripCertificationEvidence — 公開 API 回應絕不洩漏私密證明資料", () => {
  it("移除 certificationEvidence，保留其餘欄位（含公開的 certificationBadges）", () => {
    const factory = {
      id: 1,
      name: "測試工廠",
      certificationBadges: ["bni", "ce"],
      certificationEvidence: [{ badgeId: "bni", description: "秘密說明", imageKeys: [validKey(1)] }],
    };
    const publicFactory = stripCertificationEvidence(factory);
    expect(publicFactory).not.toHaveProperty("certificationEvidence");
    expect((publicFactory as any).certificationBadges).toEqual(["bni", "ce"]);
    expect(JSON.stringify(publicFactory)).not.toContain("秘密說明");
    expect(JSON.stringify(publicFactory)).not.toContain("certification-evidence");
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

  it("factory.search：回傳的 items 與 ads 內嵌的 factory 都呼叫 stripCertificationEvidence 與 stripHiddenBadgesForPublic", () => {
    const block = extractBlock(
      ROUTERS_SOURCE,
      "search: publicProcedure.input(z.object({",
      "delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {",
    );
    expect(block).toMatch(/const stripForSearch = \(f: any\) => stripHiddenBadgesForPublic\(stripCertificationEvidence\(f\)\);/);
    expect(block).toContain("items: result.items.map(stripForSearch)");
    expect(block).toMatch(
      /ads: ads\.map\(ad => ad\.factory \? \{ \.\.\.ad, factory: stripForSearch\(ad\.factory\) \} : ad\)/,
    );
  });

  it("favorite.getByUser：回傳的 items 呼叫 stripCertificationEvidence 與 stripHiddenBadgesForPublic（收藏清單的使用者不是 owner／共管者／admin）", () => {
    const block = extractBlock(
      ROUTERS_SOURCE,
      "getByUser: protectedProcedure.input(z.object({",
      "// ===== 管理員儀表板 =====",
    );
    expect(block).toMatch(/items: result\.items\.map\(f => stripHiddenBadgesForPublic\(stripCertificationEvidence\(f\)\)\)/);
  });

  it("ad.getActive：nested factory 呼叫 stripCertificationEvidence 與 stripHiddenBadgesForPublic", () => {
    const block = extractBlock(
      ROUTERS_SOURCE,
      "getActive: publicProcedure.input(z.object({",
      "create: adminProcedure.input(z.object({\r\n      factoryId: z.number(),",
    );
    expect(block).toMatch(
      /ads\.slice\(0, 5\)\.map\(ad => ad\.factory \? \{ \.\.\.ad, factory: stripHiddenBadgesForPublic\(stripCertificationEvidence\(ad\.factory\)\) \} : ad\)/,
    );
  });

  it("factory.getById：不論呼叫者身份一律呼叫 stripCertificationEvidence；非授權視角額外呼叫 stripHiddenBadgesForPublic 移除完整 certificationBadges（工廠 owner／共管者送出證明圖片後也不得再從這支 API 讀回原始 imageKeys）", () => {
    const block = extractBlock(
      ROUTERS_SOURCE,
      "getById: publicProcedure.input(z.object({\r\n      id: z.number(),",
      "getMine: protectedProcedure.query(async ({ ctx }) => {",
    );
    expect(block).toMatch(/const publicSafeFactory = isAuthorized\s*\? stripCertificationEvidence\(factory\)\s*: stripHiddenBadgesForPublic\(stripCertificationEvidence\(factory\)\);/);
    expect(block).toMatch(/latestRevision \? stripCertificationEvidenceFromRevision\(latestRevision\) : null/);
    // 反向確認：不能還殘留舊版「isAuthorized ? factory : ...」這種依身份決定
    // 是否裁剪的寫法。
    expect(block).not.toMatch(/isAuthorized \? factory :/);
    // 只有在有權限查看這筆工廠時才附上消毒後的摘要，且一律呼叫
    // summarizeCertificationEvidenceForOwner（不是直接回傳原始 certificationEvidence）。
    expect(block).toMatch(/if \(isAuthorized\) \{\s*result\.certificationEvidenceStatus = summarizeCertificationEvidenceForOwner\(factory\.certificationEvidence\);/);
  });

  it("factory.getMine：一律呼叫 stripCertificationEvidence，latestRevision 也一併裁剪，並附上消毒後的 certificationEvidenceStatus 摘要", () => {
    const block = extractBlock(
      ROUTERS_SOURCE,
      "getMine: protectedProcedure.query(async ({ ctx }) => {",
      "myApprovedFactories: protectedProcedure.query(async ({ ctx }) => {",
    );
    expect(block).toMatch(/stripCertificationEvidence\(factory\)/);
    expect(block).toMatch(/latestRevision \? stripCertificationEvidenceFromRevision\(latestRevision\) : null/);
    expect(block).toMatch(/certificationEvidenceStatus: summarizeCertificationEvidenceForOwner\(factory\.certificationEvidence\)/);
  });

  it("factory.uploadBadgeEvidence：回應絕不包含 key 欄位，只回傳安全的統計結果", () => {
    const block = extractBlock(
      ROUTERS_SOURCE,
      "uploadBadgeEvidence: badgeEvidenceUploadProcedure.input(z.object({",
      "getCertificationEvidenceViewUrls: protectedProcedure.input(z.object({",
    );
    // 回傳值只能是安全欄位，不能有 key／imageKeys／url 等敏感欄位
    expect(block).toMatch(/return \{ uploaded: true, hasEvidence: true, imageCount: bindResult\.imageCount, badgeId: input\.badgeId \};/);
    expect(block).not.toMatch(/return \{ key/);
    expect(block).not.toMatch(/\burl\b/);
    // object key 一律透過 db.appendFactoryCertificationEvidenceImage 綁定，
    // 不會把 key 存在任何 request-scoped 以外、可能跨請求殘留的記憶體暫存中。
    expect(block).toMatch(/db\.appendFactoryCertificationEvidenceImage\(factory\.id, input\.badgeId, key\)/);
  });

  it("getCertificationEvidenceViewUrls：先驗證管理員身分（非 admin 一律 FORBIDDEN），且 key 由伺服器自己從 DB 讀出，不接受前端傳入的 keys 參數", () => {
    const block = extractBlock(
      ROUTERS_SOURCE,
      "getCertificationEvidenceViewUrls: protectedProcedure.input(z.object({",
      "submitForReview: protectedProcedure.mutation(async ({ ctx }) => {",
    );
    expect(block).toMatch(/if \(ctx\.user\.role !== 'admin'\) \{\s*throw new TRPCError\(\{ code: 'FORBIDDEN'/);
    // input 不應該再有 client 傳入的 keys 陣列參數
    expect(block).not.toMatch(/keys: z\.array/);
    // key 一律從 factory.certificationEvidence／revision 的 originalData／
    // proposedData 讀出（collectFrom），不是從 input 讀
    expect(block).toMatch(/collectFrom\(\(factory as any\)\.certificationEvidence\)/);
  });
});

describe("appendCertificationEvidenceImage — object key 全程只存在伺服器端，上傳成功當下直接附加", () => {
  it("既有 key 保留，新 key 附加在後面，回傳的 imageCount 是附加後的張數", () => {
    const existing = [{ badgeId: "bni", description: "舊說明", imageKeys: [validKey(1)] }];
    const result = appendCertificationEvidenceImage(existing, "bni", validKey(2));
    expect(result).toEqual({
      ok: true,
      evidence: [{ badgeId: "bni", description: "舊說明", imageKeys: [validKey(1), validKey(2)] }],
      imageCount: 2,
    });
  });

  it("該徽章原本沒有 evidence entry 時，自動新建一筆", () => {
    const result = appendCertificationEvidenceImage([], "ce", validKey(1));
    expect(result).toEqual({
      ok: true,
      evidence: [{ badgeId: "ce", description: "", imageKeys: [validKey(1)] }],
      imageCount: 1,
    });
  });

  it("不影響其他徽章既有的 evidence", () => {
    const existing = [{ badgeId: "ce", description: "說明B", imageKeys: [validKey(1)] }];
    const result = appendCertificationEvidenceImage(existing, "bni", validKey(2));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.evidence.find(e => e.badgeId === "ce")?.imageKeys).toEqual([validKey(1)]);
      expect(result.evidence.find(e => e.badgeId === "bni")?.imageKeys).toEqual([validKey(2)]);
    }
  });

  it("單一徽章已達 5 張上限時拒絕附加，回傳 PER_BADGE_LIMIT", () => {
    const existing = [{ badgeId: "bni", description: "", imageKeys: [validKey(1), validKey(2), validKey(3), validKey(4), validKey(5)] }];
    const result = appendCertificationEvidenceImage(existing, "bni", validKey(6));
    expect(result).toEqual({ ok: false, reason: "PER_BADGE_LIMIT" });
  });

  it("全部徽章總計已達 30 張上限時拒絕附加，回傳 TOTAL_LIMIT", () => {
    const existing = Array.from({ length: 6 }, (_, i) => ({
      badgeId: CERTIFICATION_BADGE_IDS[i],
      description: "",
      imageKeys: [validKey(i * 5 + 1), validKey(i * 5 + 2), validKey(i * 5 + 3), validKey(i * 5 + 4), validKey(i * 5 + 5)],
    }));
    const result = appendCertificationEvidenceImage(existing, CERTIFICATION_BADGE_IDS[6], validKey(999));
    expect(result).toEqual({ ok: false, reason: "TOTAL_LIMIT" });
  });

  it("未知的 badgeId 一律拒絕，回傳 INVALID_BADGE", () => {
    const result = appendCertificationEvidenceImage([], "not-a-real-badge", validKey(1));
    expect(result).toEqual({ ok: false, reason: "INVALID_BADGE" });
  });
});

describe("applyCertificationEvidenceDescriptions — 工廠端只能編輯說明文字，圖片 key 一律從 DB 原樣帶入", () => {
  it("工廠端送來的說明文字覆蓋、既有 imageKeys 原樣保留（工廠端根本沒有機會送出 imageKeys）", () => {
    const existing = [{ badgeId: "bni", description: "舊說明", imageKeys: [validKey(1)] }];
    const clientDescriptions = [{ badgeId: "bni", description: "新說明" }];
    const result = applyCertificationEvidenceDescriptions(existing, clientDescriptions, ["bni"]);
    expect(result).toEqual([{ badgeId: "bni", description: "新說明", imageKeys: [validKey(1)] }]);
  });

  it("即使呼叫端在物件裡夾帶 imageKeys，也完全不會被讀取或採用", () => {
    const existing = [{ badgeId: "bni", description: "舊說明", imageKeys: [validKey(1)] }];
    const clientDescriptions = [{ badgeId: "bni", description: "新說明", imageKeys: [validKey(99), "https://evil.example.com/x.jpg"] }];
    const result = applyCertificationEvidenceDescriptions(existing, clientDescriptions, ["bni"]);
    expect(result).toEqual([{ badgeId: "bni", description: "新說明", imageKeys: [validKey(1)] }]);
  });

  it("選定清單中但這次沒有送說明文字的徽章，沿用既有說明與 imageKeys", () => {
    const existing = [
      { badgeId: "bni", description: "說明A", imageKeys: [validKey(1)] },
      { badgeId: "ce", description: "說明B", imageKeys: [validKey(2)] },
    ];
    const result = applyCertificationEvidenceDescriptions(existing, [{ badgeId: "bni", description: "說明A" }], ["bni", "ce"]);
    expect(result.find(e => e.badgeId === "ce")).toEqual({ badgeId: "ce", description: "說明B", imageKeys: [validKey(2)] });
  });

  it("徽章從選定清單移除後，其既有 evidence（含 imageKeys）不會出現在結果中", () => {
    const existing = [{ badgeId: "ce", description: "已移除的徽章", imageKeys: [validKey(1)] }];
    const result = applyCertificationEvidenceDescriptions(existing, [], ["bni"]);
    expect(result.find(e => e.badgeId === "ce")).toBeUndefined();
  });

  it("尚未上傳過任何圖片的新選定徽章，回傳空的 imageKeys", () => {
    const result = applyCertificationEvidenceDescriptions([], [{ badgeId: "bni", description: "剛選的" }], ["bni"]);
    expect(result).toEqual([{ badgeId: "bni", description: "剛選的", imageKeys: [] }]);
  });
});

describe("summarizeCertificationEvidenceForOwner — 工廠端可見的消毒摘要，絕不含 imageKeys", () => {
  it("回傳 badgeId／說明文字／是否已上傳／張數，不含 imageKeys 欄位", () => {
    const evidence = [{ badgeId: "bni", description: "說明", imageKeys: [validKey(1), validKey(2)] }];
    const result = summarizeCertificationEvidenceForOwner(evidence);
    expect(result).toEqual([{ badgeId: "bni", description: "說明", hasEvidence: true, imageCount: 2 }]);
    expect(JSON.stringify(result)).not.toContain("certification-evidence/");
  });

  it("尚未上傳圖片的徽章：hasEvidence 為 false，imageCount 為 0", () => {
    const evidence = [{ badgeId: "bni", description: "說明", imageKeys: [] }];
    const result = summarizeCertificationEvidenceForOwner(evidence);
    expect(result).toEqual([{ badgeId: "bni", description: "說明", hasEvidence: false, imageCount: 0 }]);
  });

  it("非陣列／空值輸入回傳空陣列", () => {
    expect(summarizeCertificationEvidenceForOwner(null)).toEqual([]);
    expect(summarizeCertificationEvidenceForOwner(undefined)).toEqual([]);
  });
});

describe("stripCertificationEvidenceFromRevision — latestRevision 的 originalData／proposedData 也不得洩漏證明圖片", () => {
  it("兩個欄位都有 certificationEvidence 時都要移除", () => {
    const revision = {
      id: 1,
      originalData: { name: "舊名稱", certificationEvidence: [{ badgeId: "bni", description: "秘密", imageKeys: [validKey(1)] }] },
      proposedData: { name: "新名稱", certificationEvidence: [{ badgeId: "bni", description: "秘密2", imageKeys: [validKey(2)] }] },
    };
    const result = stripCertificationEvidenceFromRevision(revision);
    expect(result.originalData).not.toHaveProperty("certificationEvidence");
    expect(result.proposedData).not.toHaveProperty("certificationEvidence");
    expect(result.originalData?.name).toBe("舊名稱");
    expect(result.proposedData?.name).toBe("新名稱");
    expect(JSON.stringify(result)).not.toContain("秘密");
  });

  it("欄位本來就沒有 certificationEvidence 時不受影響", () => {
    const revision = { id: 2, originalData: { name: "A" }, proposedData: { name: "B" } };
    const result = stripCertificationEvidenceFromRevision(revision);
    expect(result).toEqual(revision);
  });
});
