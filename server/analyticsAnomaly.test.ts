/**
 * Integration test for the 9/23-type anomaly detector（見對話中「三十六、
 * 昨天 9/23 類型異常的偵測規則」）。保守判定：必須同時符合「新 visitorId
 * 暴增」+「搜尋事件暴增」才觸發，單一訊號（只是流量比較大）不足以觸發。
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { sql, eq, and } from "drizzle-orm";
import * as db from "./db";
import { analyticsSessions, analyticsEvents, analyticsSecurityEvents } from "../drizzle/schema";
import { detectAnomaliesForDate } from "./analyticsDb";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
// 未來日期，避免撞到真實資料——但 MySQL TIMESTAMP 欄位是 32-bit unix
// timestamp，硬上限是 2038-01-19（Y2038 問題），一開始選 2099 年會直接被
// MySQL 拒絕（"Incorrect datetime value"，不是本次改動的邏輯錯誤，是選錯
// 測試日期範圍）。改用 2027 年（距今約一年後，仍遠遠早於 2038 上限，也
// 不可能撞到目前真實資料）。
const TEST_DATE = `2027-01-${(parseInt(runId.slice(-2), 36) % 27 + 1).toString().padStart(2, "0")}`;
const [TD_Y, TD_M, TD_D] = TEST_DATE.split("-").map(Number);
// 純 epoch 運算算出「Asia/Taipei TEST_DATE 當天第 h 個小時」對應的 UTC
// instant，不用 Date.setUTCHours() 之類的物件變異方法——見對話中已知的
// mysql2 Date 序列化風險，這裡刻意只用最單純的 Date.UTC() + 毫秒運算，
// 避免任何依賴呼叫環境的隱含行為。
function taipeiHourToUtcDate(hour: number): Date {
  return new Date(Date.UTC(TD_Y, TD_M - 1, TD_D, hour, 0, 0) - 8 * 3600 * 1000);
}
const visitorIds: string[] = [];

afterAll(async () => {
  const conn = await db.getDb();
  if (conn) {
    for (const v of visitorIds) {
      await conn.execute(sql`DELETE FROM analyticsSessions WHERE visitorId = ${v}`);
    }
    await conn.execute(sql`DELETE FROM analyticsSecurityEvents WHERE date = ${TEST_DATE}`);
  }
}, 30000);

async function seedNormalHours(baselineDate: string, baselineHours: number[], countPerHour: number) {
  for (const h of baselineHours) {
    for (let i = 0; i < countPerHour; i++) {
      const visitorId = `anomaly-${runId}-baseline-${h}-${i}`;
      visitorIds.push(visitorId);
      // 直接插入 session（不透過 recordAnalyticsEvent，因為需要控制 date/hour
      // 落在特定值，而不是「現在」）。
      const conn = await db.getDb();
      if (!conn) throw new Error("no db");
      const fakeStartedAt = taipeiHourToUtcDate(h);
      await conn.insert(analyticsSessions).values({
        sessionKey: randomUUID(),
        visitorId,
        classification: "human",
        eventCount: 1,
        startedAt: fakeStartedAt,
        lastEventAt: fakeStartedAt,
        date: baselineDate,
      });
    }
  }
}

describe("detectAnomaliesForDate — 保守判定，只有 visitor spike + search spike 同時出現才觸發", () => {
  it("正常波動（沒有 search spike）不應該產生 anomaly", async () => {
    await seedNormalHours(TEST_DATE, [1, 2, 3, 4, 5], 5);
    await detectAnomaliesForDate(TEST_DATE);
    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    const anomalies = await conn.select().from(analyticsSecurityEvents)
      .where(and(eq(analyticsSecurityEvents.date, TEST_DATE), eq(analyticsSecurityEvents.eventType, "NEW_VISITOR_SPIKE")));
    expect(anomalies.length).toBe(0);
  });

  it("visitor spike（某小時新 visitor 遠高於其他小時的 baseline）+ 同時搜尋暴增 → 觸發 NEW_VISITOR_SPIKE", async () => {
    const spikeHour = 11;
    // 這個小時大量新 visitor（40 個，遠高於 baseline 的 5 個/小時），同時每
    // 個都各自產生一筆 search event，確保 visitor 門檻（>max(avg*3,20)）
    // 與 search 門檻（>30）都會被舒服地超過，不要卡在邊界值。
    for (let i = 0; i < 40; i++) {
      const visitorId = `anomaly-${runId}-spike-${i}`;
      visitorIds.push(visitorId);
      const conn = await db.getDb();
      if (!conn) throw new Error("no db");
      const fakeStartedAt = taipeiHourToUtcDate(spikeHour);
      const [inserted] = await conn.insert(analyticsSessions).values({
        sessionKey: randomUUID(),
        visitorId,
        classification: "human",
        eventCount: 1,
        startedAt: fakeStartedAt,
        lastEventAt: fakeStartedAt,
        date: TEST_DATE,
      }).$returningId();
      // 同時灌大量 search event 到這個小時（> 30 門檻）
      await conn.insert(analyticsEvents).values({
        sessionRowId: inserted.id,
        visitorId,
        eventType: "search",
        keyword: "測試",
        keywordNormalized: "測試",
        classification: "human",
        date: TEST_DATE,
        hour: spikeHour,
        createdAt: fakeStartedAt,
      });
    }

    await detectAnomaliesForDate(TEST_DATE);

    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    const anomalies = await conn.select().from(analyticsSecurityEvents)
      .where(and(eq(analyticsSecurityEvents.date, TEST_DATE), eq(analyticsSecurityEvents.eventType, "NEW_VISITOR_SPIKE")));
    expect(anomalies.length).toBeGreaterThanOrEqual(1);
    const spikeEntry = anomalies.find(a => a.hour === spikeHour);
    expect(spikeEntry).toBeDefined();
    expect(spikeEntry!.signals).toContain("HIGH_NEW_VISITOR_RATE");
    expect(spikeEntry!.signals).toContain("SEARCH_RATE_SPIKE");
  });

  it("重複呼叫 detectAnomaliesForDate 不會對同一個時段重複寫入 anomaly（避免同一件事被記錄很多次）", async () => {
    await detectAnomaliesForDate(TEST_DATE);
    await detectAnomaliesForDate(TEST_DATE);
    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    const anomalies = await conn.select().from(analyticsSecurityEvents)
      .where(and(eq(analyticsSecurityEvents.date, TEST_DATE), eq(analyticsSecurityEvents.eventType, "NEW_VISITOR_SPIKE"), eq(analyticsSecurityEvents.hour, 11)));
    expect(anomalies.length).toBe(1);
  });
});
