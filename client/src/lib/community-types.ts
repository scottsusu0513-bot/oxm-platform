import type { CommunityBid } from "../../../drizzle/schema";

// Shared frontend types for community feature (mirrors DB types with meta fields)
export interface CommunityCommentWithMeta {
  id: number;
  postId: number;
  authorUserId: number | null;
  authorFactoryId: number | null;
  content: string;
  parentCommentId: number | null;
  replyToUserId: number | null;
  isHidden: boolean;
  deletedAt: Date | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  authorName: string | null;
  authorFactoryName: string | null;
  replyToUserName: string | null;
  replies?: CommunityCommentWithMeta[];
}

export type CommunityBidStatus = CommunityBid["status"];

/**
 * The DB `status` column only reaches "ended" if an admin/backend explicitly
 * sets it — nothing currently transitions an "active" bid past its deadline.
 * This derives the status as it should be DISPLAYED, without writing to the
 * DB or introducing a second deadline calculation: an "active" bid whose
 * deadline has already passed is shown as "ended"; every other status
 * (rejected / pending_review / draft / cancelled / already-ended) is
 * returned unchanged so a real human/admin status is never overridden.
 */
export function getEffectiveBidStatus(
  bid: { status: CommunityBidStatus; deadline: Date | string | null },
): CommunityBidStatus {
  if (bid.status === "active" && bid.deadline != null && new Date(bid.deadline).getTime() <= Date.now()) {
    return "ended";
  }
  return bid.status;
}
