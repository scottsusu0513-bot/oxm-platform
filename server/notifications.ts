import * as db from "./db";

export interface PlatformNotificationInput {
  recipientUserId: number;
  actorUserId?: number | null;
  actorName?: string;
  actorFactoryId?: number | null;
  actorFactoryName?: string | null;
  eventType: string;
  eventGroup: string;
  message: string;
  actionUrl?: string | null;
  titleSnapshot?: string | null;
  dedupeKey: string;
}

export async function createPlatformNotifications(inputs: PlatformNotificationInput[]): Promise<void> {
  if (inputs.length === 0) return;
  const normalized = inputs.map(i => ({
    recipientUserId: i.recipientUserId,
    actorUserId: i.actorUserId ?? null,
    actorFactoryId: i.actorFactoryId ?? null,
    eventType: i.eventType,
    eventGroup: i.eventGroup,
    actorNameSnapshot: i.actorName ?? "",
    actorFactoryNameSnapshot: i.actorFactoryName ?? null,
    message: i.message,
    actionUrl: i.actionUrl ?? null,
    titleSnapshot: i.titleSnapshot ?? null,
    dedupeKey: i.dedupeKey,
  }));
  await db.createCommunityNotificationsBatch(normalized);
}
