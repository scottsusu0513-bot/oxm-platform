/**
 * 一次性腳本：補寄最新一筆 admin message campaign 的 email 通知
 * 用法：
 *   tsx scripts/resend-campaign-emails.ts            ← 只查詢，不寄信（dry-run）
 *   tsx scripts/resend-campaign-emails.ts --send     ← 確認後實際寄信
 */
import "dotenv/config";
import { getDb } from "../server/db";
import { messageCampaigns, messageRecipients, users } from "../drizzle/schema";
import { desc, eq, and, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { sendAdminBroadcastEmail } from "../server/email";

const DRY_RUN = !process.argv.includes("--send");

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("❌ DB 連線失敗");
    process.exit(1);
  }

  // 1. 找最新一筆 campaign（含收件人數量）
  const [latest] = await db
    .select({
      campaignId: messageCampaigns.id,
      title: messageCampaigns.title,
      content: messageCampaigns.content,
      targetType: messageCampaigns.targetType,
      createdAt: messageCampaigns.createdAt,
      recipientCount: sql<number>`COUNT(${messageRecipients.id})`,
    })
    .from(messageCampaigns)
    .leftJoin(messageRecipients, eq(messageRecipients.campaignId, messageCampaigns.id))
    .groupBy(messageCampaigns.id)
    .orderBy(desc(messageCampaigns.createdAt))
    .limit(1);

  if (!latest) {
    console.error("❌ 找不到任何 campaign");
    process.exit(1);
  }

  console.log("\n===== 最新 Campaign =====");
  console.log(`campaignId  : ${latest.campaignId}`);
  console.log(`標題        : ${latest.title}`);
  console.log(`targetType  : ${latest.targetType}`);
  console.log(`建立時間    : ${new Date(latest.createdAt).toLocaleString("zh-TW")}`);
  console.log(`收件人數量  : ${latest.recipientCount}`);
  console.log(`內容預覽    : ${String(latest.content).substring(0, 80)}...`);

  if (DRY_RUN) {
    console.log("\n⚠️  Dry-run 模式，不寄信。確認後請加 --send 參數重新執行。");
    process.exit(0);
  }

  // 2. 取得收件人 email 清單（排除已刪帳號、無 email）
  const rawRecipients = await db
    .select({ userId: users.id, email: users.email, name: users.name })
    .from(messageRecipients)
    .innerJoin(users, eq(messageRecipients.receiverId, users.id))
    .where(and(eq(messageRecipients.campaignId, latest.campaignId), isNull(users.deletedAt)));

  const totalRecipients = rawRecipients.length;

  // 去重（同一 email 只寄一次）
  const seen = new Set<string>();
  const toSend = rawRecipients.filter(r => {
    if (!r.email) return false;
    if (seen.has(r.email)) return false;
    seen.add(r.email);
    return true;
  });

  console.log(`\n總收件人數     : ${totalRecipients}`);
  console.log(`有 email 且不重複 : ${toSend.length}`);
  console.log(`無 email（跳過）  : ${totalRecipients - toSend.length}`);
  console.log("\n開始補寄...\n");

  let successCount = 0;
  const failList: { email: string; error: string }[] = [];

  for (const r of toSend) {
    try {
      await sendAdminBroadcastEmail({
        toEmail: r.email!,
        toName: r.name,
        campaignTitle: latest.title,
        campaignContent: latest.content,
        campaignId: latest.campaignId,
      });
      successCount++;
      console.log(`  ✅ ${r.email}`);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      failList.push({ email: r.email!, error: msg });
      console.log(`  ❌ ${r.email} — ${msg}`);
    }
  }

  console.log("\n===== 補寄結果 =====");
  console.log(`campaignId  : ${latest.campaignId}`);
  console.log(`站內信標題  : ${latest.title}`);
  console.log(`總收件人數  : ${totalRecipients}`);
  console.log(`有 email 數 : ${toSend.length}`);
  console.log(`成功寄出    : ${successCount}`);
  console.log(`失敗數      : ${failList.length}`);
  if (failList.length > 0) {
    console.log("\n失敗名單：");
    failList.forEach(f => console.log(`  - ${f.email}：${f.error}`));
  }

  process.exit(failList.length > 0 ? 1 : 0);
}

main().catch(e => {
  console.error("腳本執行失敗：", e);
  process.exit(1);
});
