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
