/**
 * 一次性腳本：OXM 第一批「找消息」正式發布（90 則母表，87 則實際發布，3 則因來源
 * 異常排除，見 news-batch1-data.json 旁的異常報告）。
 *
 * 直接呼叫 server/db.ts 的 createNews()，刻意不經過 server/routers.ts 的
 * news.create tRPC mutation——dispatchNewsNotifications 只存在於 routers.ts，
 * db.createNews() 本身完全不會觸發任何 Email／App Push／newsNotifications
 * 紀錄。這是本批「全部禁止通知」規則唯一需要的技術手段，且只在這支一次性腳本
 * 生效，不影響一般管理員後台 news.create／news.update 之後的正常通知行為。
 *
 * 冪等性：以「標題完全相同」判斷這篇是否已經匯入過（母表 90 筆標題已確認彼此
 * 不重複，且與現有正式站消息重複的機率可忽略），已存在就跳過、不重複建立。
 *
 * 用法：
 *   railway run tsx scripts/import-news-batch1.ts            ← 只檢查，不寫入（dry-run）
 *   railway run tsx scripts/import-news-batch1.ts --publish  ← 確認後實際建立
 */
import "dotenv/config";
import { getDb, createNews } from "../server/db";
import { news, users } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { ENV } from "../server/_core/env";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DRY_RUN = !process.argv.includes("--publish");

interface BatchItem {
  id: string;
  title: string;
  summary: string;
  content: string;
  isImportant: boolean;
  isCompetition: boolean;
  isExhibition: boolean;
  industryNames: string[];
  sourceName: string | null;
  sourceUrl: string | null;
}

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("❌ DB 連線失敗");
    process.exit(1);
  }

  const dataPath = path.resolve(__dirname, "news-batch1-data.json");
  const items: BatchItem[] = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  console.log(`讀取到 ${items.length} 則待發布消息（母表編號僅供本次腳本輸出對照用，不會寫入資料庫欄位）`);

  if (ENV.adminWhitelistEmails.length === 0) {
    console.error("❌ ADMIN_WHITELIST_EMAILS 未設定，無法決定 createdBy");
    process.exit(1);
  }
  const [creator] = await db.select({ id: users.id, email: users.email })
    .from(users).where(eq(users.email, ENV.adminWhitelistEmails[0])).limit(1);
  if (!creator) {
    console.error(`❌ 找不到白名單管理員帳號（${ENV.adminWhitelistEmails[0]}），無法決定 createdBy`);
    process.exit(1);
  }
  console.log(`createdBy 使用管理員帳號 id=${creator.id}\n`);

  const succeeded: string[] = [];
  const skipped: { id: string; title: string }[] = [];
  const failed: { id: string; title: string; reason: string }[] = [];

  for (const item of items) {
    const [existing] = await db.select({ id: news.id }).from(news).where(eq(news.title, item.title)).limit(1);
    if (existing) {
      skipped.push({ id: item.id, title: item.title });
      console.log(`⏭️  [${item.id}] 已存在（news.id=${existing.id}），跳過：${item.title}`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`🔎 [${item.id}] dry-run，將會建立：${item.title}`);
      succeeded.push(item.id);
      continue;
    }

    try {
      const result = await createNews({
        title: item.title,
        summary: item.summary,
        content: item.content,
        status: "published",
        isImportant: item.isImportant,
        isCompetition: item.isCompetition,
        isExhibition: item.isExhibition,
        industryNames: item.industryNames,
        sourceName: item.sourceName,
        sourceUrl: item.sourceUrl,
        createdBy: creator.id,
      });
      succeeded.push(item.id);
      console.log(`✅ [${item.id}] 建立成功，news.id=${result.id}：${item.title}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failed.push({ id: item.id, title: item.title, reason });
      console.error(`❌ [${item.id}] 建立失敗：${item.title}\n   原因：${reason}`);
    }
  }

  console.log("\n===== 總結 =====");
  console.log(`模式: ${DRY_RUN ? "dry-run（未寫入）" : "正式發布"}`);
  console.log(`成功: ${succeeded.length} — ${succeeded.join(", ")}`);
  console.log(`跳過（已存在）: ${skipped.length} — ${skipped.map(s => s.id).join(", ")}`);
  console.log(`失敗: ${failed.length}`);
  for (const f of failed) console.log(`  - [${f.id}] ${f.title}: ${f.reason}`);

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("FATAL", err);
  process.exit(1);
});
