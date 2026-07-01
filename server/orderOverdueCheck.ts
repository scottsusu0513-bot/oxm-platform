import * as db from "./db";
import { sendOrderOverdueEmail } from "./email";

const DATE_FIELD_LABELS: Record<string, string> = {
  depositDueDate: "首款付款日",
  productionStartDate: "製作開始日",
  expectedCompletionDate: "預計完工日",
  expectedShipmentDate: "預計出貨日",
  finalPaymentDueDate: "尾款結款日",
};

export type OverdueCheckResult = {
  scanned: number;
  sent: number;
  skipped: number;
  errors: string[];
};

/**
 * Scans all active collaboration orders for overdue date nodes and sends
 * Email notifications to both sides. Writes a dedup record only after ALL
 * expected recipients are notified; if any recipient fails, no record is
 * written so the node will be retried on the next run.
 *
 * Callable from:
 *   - admin.runOrderOverdueEmailCheck tRPC mutation (manual trigger)
 *   - External scheduler (Windows Task Scheduler / Render Cron / GitHub Actions)
 *     via a lightweight HTTP endpoint or CLI script
 */
export async function runCollaborationOrderOverdueEmailCheck(): Promise<OverdueCheckResult> {
  const nodes = await db.listOverdueCollaborationOrderDateNodes();
  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const node of nodes) {
    const dateLabel = DATE_FIELD_LABELS[node.dateField] ?? node.dateField;

    // ── Collect seller recipients (供應工廠 owner + active co-managers) ──
    const sellerRecipients = await db.getFactoryEmailRecipients(node.factoryId);

    // ── Collect buyer recipients ──────────────────────────────────────────
    let buyerRecipients: Array<{ email: string | null; name: string | null }> = [];
    if (node.acceptedAsType === "factory" && node.acceptedAsFactoryId) {
      buyerRecipients = await db.getFactoryEmailRecipients(node.acceptedAsFactoryId);
    } else {
      const buyer = await db.getUserById(node.buyerUserId);
      if (buyer) buyerRecipients = [{ email: buyer.email ?? null, name: buyer.name ?? null }];
    }

    type Recipient = { email: string | null; name: string | null; side: string };
    const allRecipients: Recipient[] = [
      ...sellerRecipients.map(r => ({ ...r, side: "供應工廠" })),
      ...buyerRecipients.map(r => ({ ...r, side: "需求方" })),
    ];

    const validRecipients = allRecipients.filter((r): r is { email: string; name: string | null; side: string } => !!r.email);

    if (validRecipients.length === 0) {
      skipped++;
      continue;
    }

    // ── Send emails for this node (attempt all; collect failures) ─────────
    const nodeErrors: string[] = [];
    for (const recipient of validRecipients) {
      try {
        await sendOrderOverdueEmail({
          to: recipient.email,
          recipientName: recipient.name,
          projectName: node.projectName,
          factoryName: node.factoryName ?? "",
          dateLabel,
          dueDate: node.dueDate,
          orderId: node.id,
          side: recipient.side,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        nodeErrors.push(`orderId=${node.id} field=${node.dateField} to=${recipient.email}: ${msg}`);
      }
    }

    if (nodeErrors.length > 0) {
      // At least one email failed — do NOT write dedup record, retry next run
      errors.push(...nodeErrors);
      continue;
    }

    // ── All emails sent — write dedup record ──────────────────────────────
    try {
      await db.createCollaborationOrderOverdueNotification(node.id, node.dateField, node.dueDate);
      sent++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`createNotification orderId=${node.id} field=${node.dateField}: ${msg}`);
    }
  }

  return { scanned: nodes.length, sent, skipped, errors };
}
