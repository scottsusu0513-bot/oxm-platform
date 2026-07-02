import * as db from "./db";
import { createPlatformNotifications, PlatformNotificationInput } from "./notifications";
import { sendPushToRecipients } from "./push";

type NotifBase = Omit<PlatformNotificationInput, "recipientUserId" | "dedupeKey">;

export interface PushOpts {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/** Fire-and-forget: write one platform notification + optional push to a single user. */
export function notifyUser(
  recipientUserId: number,
  notif: NotifBase & { dedupeKey: string },
  push?: PushOpts
): void {
  void _notifyUser(recipientUserId, notif, push);
}

async function _notifyUser(
  recipientUserId: number,
  notif: NotifBase & { dedupeKey: string },
  push?: PushOpts
): Promise<void> {
  await createPlatformNotifications([{ ...notif, recipientUserId }])
    .catch(e => console.error(`[Notify] platform (${notif.eventType}) u${recipientUserId}:`, e instanceof Error ? e.message : e));

  if (push) {
    await sendPushToRecipients({
      userIds: [recipientUserId],
      title: push.title,
      body: push.body,
      data: push.data ?? { targetPath: notif.actionUrl ?? "/notifications" },
    }).catch(e => console.error(`[Push] (${notif.eventType}) u${recipientUserId}:`, e instanceof Error ? e.message : e));
  }
}

/** Fire-and-forget: write platform notifications + optional push to all admin users. */
export function notifyAdmins(notif: NotifBase & { dedupeKey: string }, push?: PushOpts): void {
  void _notifyAdmins(notif, push);
}

async function _notifyAdmins(notif: NotifBase & { dedupeKey: string }, push?: PushOpts): Promise<void> {
  try {
    const adminIds = await db.getAdminUserIds();
    if (adminIds.length === 0) return;
    await createPlatformNotifications(
      adminIds.map(uid => ({ ...notif, recipientUserId: uid, dedupeKey: `${notif.dedupeKey}:u${uid}` }))
    ).catch(e => console.error(`[Notify] admins (${notif.eventType}):`, e instanceof Error ? e.message : e));
    if (push) {
      await sendPushToRecipients({
        userIds: adminIds,
        title: push.title,
        body: push.body,
        data: push.data ?? { targetPath: notif.actionUrl ?? "/notifications" },
      }).catch(e => console.error(`[Push] admins (${notif.eventType}):`, e instanceof Error ? e.message : e));
    }
  } catch (e) {
    console.error(`[Notify] notifyAdmins (${notif.eventType}):`, e instanceof Error ? e.message : e);
  }
}

/** Fire-and-forget: write platform notifications + optional push to factory owner + all active co-managers. */
export function notifyFactoryMembers(
  factoryId: number,
  notif: NotifBase & { dedupeKey: string },
  push?: PushOpts,
  opts?: { excludeUserId?: number }
): void {
  void _notifyFactoryMembers(factoryId, notif, push, opts);
}

async function _notifyFactoryMembers(
  factoryId: number,
  notif: NotifBase & { dedupeKey: string },
  push?: PushOpts,
  opts?: { excludeUserId?: number }
): Promise<void> {
  try {
    const [factory, coMgrIds] = await Promise.all([
      db.getFactoryById(factoryId),
      db.getActiveCoManagerUserIds(factoryId),
    ]);
    if (!factory) return;

    const seen = new Set<number>();
    const memberIds: number[] = [];
    const addId = (id: number) => {
      if (seen.has(id) || (opts?.excludeUserId != null && id === opts.excludeUserId)) return;
      seen.add(id);
      memberIds.push(id);
    };
    addId(factory.ownerId);
    for (const id of coMgrIds) addId(id);
    if (memberIds.length === 0) return;

    await createPlatformNotifications(
      memberIds.map(uid => ({ ...notif, recipientUserId: uid, dedupeKey: `${notif.dedupeKey}:u${uid}` }))
    ).catch(e => console.error(`[Notify] factory members (${notif.eventType}):`, e instanceof Error ? e.message : e));

    if (push) {
      await sendPushToRecipients({
        userIds: memberIds,
        excludeUserId: opts?.excludeUserId,
        title: push.title,
        body: push.body,
        data: push.data ?? { targetPath: notif.actionUrl ?? "/notifications" },
      }).catch(e => console.error(`[Push] factory members (${notif.eventType}):`, e instanceof Error ? e.message : e));
    }
  } catch (e) {
    console.error(`[Notify] notifyFactoryMembers (${notif.eventType}) factory:${factoryId}:`, e instanceof Error ? e.message : e);
  }
}
