import { useState } from "react";
import { trpc } from "@/lib/trpc";
import Navbar from "@/components/Navbar";
import { Helmet } from "react-helmet-async";
import { Link, useLocation } from "wouter";
import {
  ChevronLeft, Loader2, Lock, Pin, AlertTriangle,
  Pencil, Trash2, EyeOff, Eye, MoreHorizontal, Reply, Send, X, ShoppingBag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/_core/hooks/useAuth";
import { INDUSTRY_SLUGS } from "@shared/constants";
import { formatDistanceToNow } from "date-fns";
import { zhTW } from "date-fns/locale";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CommunityCommentWithMeta } from "@/lib/community-types";
import CommunityImageUploader from "./CommunityImageUploader";

interface Props {
  spaceCode: string;
  postId: number;
}

const CROSS_INDUSTRY_SLUG = "cross-industry";
const slugToName: Record<string, string> = {
  ...Object.fromEntries(Object.entries(INDUSTRY_SLUGS).map(([name, slug]) => [slug, name])),
  [CROSS_INDUSTRY_SLUG]: "跨產業交流區",
};

function AuthorLabel({ name, factoryName }: { name: string | null; factoryName: string | null }) {
  if (factoryName) return <span className="font-medium text-sm">{factoryName}</span>;
  return <span className="font-medium text-sm">{name ?? "匿名"}</span>;
}

function TimeAgo({ date }: { date: Date | string }) {
  return (
    <span className="text-xs text-muted-foreground">
      {formatDistanceToNow(new Date(date), { addSuffix: true, locale: zhTW })}
    </span>
  );
}

interface CommentItemProps {
  comment: CommunityCommentWithMeta;
  isAdmin: boolean;
  currentUserId?: number;
  onReply: (commentId: number, toUserId: number | null, toName: string) => void;
  onEdit: (comment: CommunityCommentWithMeta) => void;
  onDelete: (commentId: number) => void;
  onHide: (commentId: number, hidden: boolean) => void;
  isNested?: boolean;
}

function CommentItem({ comment, isAdmin, currentUserId, onReply, onEdit, onDelete, onHide, isNested }: CommentItemProps) {
  const isDeleted = comment.deletedAt != null;
  const isAuthor = !isDeleted && currentUserId === comment.authorUserId;
  const canEdit = isAuthor || isAdmin;

  return (
    <div className={`${isNested ? "ml-8 border-l-2 border-border pl-4" : ""} py-3`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {isDeleted ? (
            <p className="text-sm text-muted-foreground italic">此留言已刪除</p>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <AuthorLabel name={comment.authorName} factoryName={comment.authorFactoryName} />
                {comment.replyToUserName && (
                  <span className="text-xs text-muted-foreground">回覆 {comment.replyToUserName}</span>
                )}
                <TimeAgo date={comment.createdAt} />
                {comment.isHidden && isAdmin && (
                  <span className="text-xs text-muted-foreground italic">(已隱藏)</span>
                )}
              </div>
              {comment.isHidden && !isAdmin ? (
                <p className="text-sm text-muted-foreground italic mt-1">此留言已被隱藏</p>
              ) : (
                <p className="text-sm mt-1 whitespace-pre-wrap break-words">{comment.content}</p>
              )}
            </>
          )}
        </div>

        {/* Actions */}
        {!isDeleted && (
          <div className="flex items-center gap-1 shrink-0">
            {currentUserId && !comment.isHidden && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() => onReply(comment.id, comment.authorUserId, comment.authorFactoryName ?? comment.authorName ?? "對方")}
              >
                <Reply className="w-3 h-3 mr-1" />
                回覆
              </Button>
            )}
            {canEdit && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                    <MoreHorizontal className="w-3.5 h-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {isAuthor && (
                    <DropdownMenuItem onClick={() => onEdit(comment)}>
                      <Pencil className="w-3.5 h-3.5 mr-2" />
                      編輯
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(comment.id)}>
                    <Trash2 className="w-3.5 h-3.5 mr-2" />
                    刪除
                  </DropdownMenuItem>
                  {isAdmin && (
                    <DropdownMenuItem onClick={() => onHide(comment.id, !comment.isHidden)}>
                      {comment.isHidden ? <Eye className="w-3.5 h-3.5 mr-2" /> : <EyeOff className="w-3.5 h-3.5 mr-2" />}
                      {comment.isHidden ? "取消隱藏" : "隱藏"}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>

      {/* Nested replies */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-1">
          {comment.replies.map(reply => (
            <CommentItem
              key={reply.id}
              comment={reply}
              isAdmin={isAdmin}
              currentUserId={currentUserId}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
              onHide={onHide}
              isNested
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function CommunityPost({ spaceCode, postId }: Props) {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const utils = trpc.useUtils();

  const [commentText, setCommentText] = useState("");
  const [replyTo, setReplyTo] = useState<{ parentCommentId: number; replyToUserId: number | null; label: string } | null>(null);
  const [editingComment, setEditingComment] = useState<{ id: number; content: string } | null>(null);
  const [editingPost, setEditingPost] = useState<{ title: string; content: string; commentsEnabled: boolean; images: string[]; isUploading: boolean } | null>(null);

  const { data, isLoading, isError } = trpc.community.getPost.useQuery({ postId });

  const spaceName = slugToName[spaceCode] ?? spaceCode;

  const createCommentMut = trpc.community.createComment.useMutation({
    onSuccess: () => {
      setCommentText("");
      setReplyTo(null);
      utils.community.getPost.invalidate({ postId });
      toast.success("留言已送出");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateCommentMut = trpc.community.updateComment.useMutation({
    onSuccess: () => {
      setEditingComment(null);
      utils.community.getPost.invalidate({ postId });
      toast.success("留言已更新");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteCommentMut = trpc.community.deleteComment.useMutation({
    onSuccess: () => {
      utils.community.getPost.invalidate({ postId });
      toast.success("留言已刪除");
    },
    onError: (e) => toast.error(e.message),
  });

  const updatePostMut = trpc.community.updatePost.useMutation({
    onSuccess: () => {
      setEditingPost(null);
      utils.community.getPost.invalidate({ postId });
      toast.success("貼文已更新");
    },
    onError: (e) => toast.error(e.message),
  });

  const deletePostMut = trpc.community.deletePost.useMutation({
    onSuccess: () => {
      toast.success("貼文已刪除");
      navigate(`/community/${spaceCode}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const hideCommentMut = trpc.admin.community.hideComment.useMutation({
    onSuccess: () => {
      utils.community.getPost.invalidate({ postId });
    },
    onError: (e) => toast.error(e.message),
  });

  const hidePostMut = trpc.admin.community.hidePost.useMutation({
    onSuccess: () => {
      utils.community.getPost.invalidate({ postId });
      toast.success("操作完成");
    },
    onError: (e) => toast.error(e.message),
  });

  const lockPostMut = trpc.admin.community.lockPost.useMutation({
    onSuccess: () => {
      utils.community.getPost.invalidate({ postId });
      toast.success("操作完成");
    },
    onError: (e) => toast.error(e.message),
  });

  const pinPostMut = trpc.admin.community.pinPost.useMutation({
    onSuccess: () => {
      utils.community.getPost.invalidate({ postId });
      toast.success("操作完成");
    },
    onError: (e) => toast.error(e.message),
  });

  const adminDeletePostMut = trpc.admin.community.deletePost.useMutation({
    onSuccess: () => {
      toast.success("貼文已永久刪除");
      navigate(`/community/${spaceCode}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmitComment = () => {
    if (!commentText.trim()) return;
    createCommentMut.mutate({
      postId,
      content: commentText.trim(),
      parentCommentId: replyTo?.parentCommentId,
      replyToUserId: replyTo?.replyToUserId ?? undefined,
    });
  };

  const handleEditCommentSave = () => {
    if (!editingComment || !editingComment.content.trim()) return;
    updateCommentMut.mutate({ commentId: editingComment.id, content: editingComment.content.trim() });
  };

  const handleSavePost = () => {
    if (!editingPost) return;
    if (!editingPost.title.trim() || !editingPost.content.trim()) {
      toast.error("標題和內容不能為空");
      return;
    }
    updatePostMut.mutate({
      postId,
      title: editingPost.title.trim(),
      content: editingPost.content.trim(),
      commentsEnabled: editingPost.commentsEnabled,
      images: editingPost.images,
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container py-16 text-center">
          <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground">找不到此貼文</p>
          <Link href={`/community/${spaceCode}`}>
            <Button variant="outline" size="sm" className="mt-4">回到討論列表</Button>
          </Link>
        </div>
      </div>
    );
  }

  const { post, comments } = data;
  const isPostAuthor = user?.id === post.authorUserId;
  const isLocked = post.isLocked;

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>{post.title} — {spaceName} — OXM 商案討論區</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <Navbar />

      <main className="container py-8 max-w-3xl">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link href="/community" className="hover:text-foreground transition-colors">商案討論區</Link>
          <ChevronLeft className="w-3 h-3 rotate-180" />
          <Link href={`/community/${spaceCode}`} className="hover:text-foreground transition-colors">{spaceName}</Link>
        </div>

        {/* Post header */}
        <div className="bg-card border border-border rounded-xl p-6 mb-6">
          {editingPost ? (
            /* Inline edit form */
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-muted-foreground">編輯貼文</span>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setEditingPost(null)}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
              <Input
                value={editingPost.title}
                onChange={(e) => setEditingPost({ ...editingPost, title: e.target.value })}
                placeholder="標題"
                maxLength={200}
                className="text-base font-bold"
              />
              <Textarea
                value={editingPost.content}
                onChange={(e) => setEditingPost({ ...editingPost, content: e.target.value })}
                placeholder="內容"
                rows={8}
                className="resize-none text-sm"
                maxLength={10000}
              />
              <div className="space-y-1.5">
                <Label className="text-sm">附加圖片（最多 6 張）</Label>
                <CommunityImageUploader
                  images={editingPost.images}
                  onChange={(urls) => setEditingPost({ ...editingPost, images: urls })}
                  disabled={updatePostMut.isPending}
                  onUploadingChange={(v) => setEditingPost((p) => p ? { ...p, isUploading: v } : p)}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="edit-comments-enabled"
                  checked={editingPost.commentsEnabled}
                  onCheckedChange={(v) => setEditingPost({ ...editingPost, commentsEnabled: v })}
                />
                <Label htmlFor="edit-comments-enabled" className="text-sm cursor-pointer">
                  開放留言
                </Label>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setEditingPost(null)} disabled={updatePostMut.isPending}>取消</Button>
                <Button
                  size="sm"
                  onClick={handleSavePost}
                  disabled={updatePostMut.isPending || editingPost.isUploading || !editingPost.title.trim() || !editingPost.content.trim()}
                  className="bg-gradient-to-r from-orange-500 to-amber-500 text-white border-0"
                >
                  {(updatePostMut.isPending || editingPost.isUploading) && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                  {editingPost.isUploading ? "上傳中…" : "儲存"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  {post.isPinned && <Pin className="w-4 h-4 text-orange-500 shrink-0" />}
                  {isLocked && <Lock className="w-4 h-4 text-muted-foreground shrink-0" />}
                  {post.isHidden && isAdmin && (
                    <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">已隱藏</span>
                  )}
                </div>
                <h1 className="text-xl font-bold mb-1">{post.title}</h1>
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                  <AuthorLabel name={post.authorName} factoryName={post.authorFactoryName} />
                  <span>·</span>
                  <TimeAgo date={post.createdAt} />
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{post.content}</p>

                {/* Post images */}
                {(post.images ?? []).length > 0 && (
                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {(post.images as string[]).map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                        <img
                          src={url}
                          alt={`附圖 ${i + 1}`}
                          className="w-full h-32 object-cover rounded-lg border border-border hover:opacity-90 transition-opacity"
                        />
                      </a>
                    ))}
                  </div>
                )}

                {/* Pinned products */}
                {data.pinnedProducts && data.pinnedProducts.length > 0 && (
                  <div className="mt-4 border-t border-border pt-4">
                    <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground font-medium">
                      <ShoppingBag className="w-3.5 h-3.5" />
                      相關商品
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {data.pinnedProducts.map((p) => (
                        <Link key={p.id} href={`/factory/${p.factoryId}`}>
                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/30 hover:bg-muted/60 transition-colors cursor-pointer max-w-[200px]">
                            {(p.images as string[] | null)?.[0] && (
                              <img
                                src={(p.images as string[])[0]}
                                alt={p.name}
                                className="w-8 h-8 rounded object-cover shrink-0"
                              />
                            )}
                            <span className="text-xs font-medium truncate">{p.name}</span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Post actions */}
              {(isPostAuthor || isAdmin) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0">
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {isPostAuthor && !isLocked && (
                      <DropdownMenuItem onClick={() => setEditingPost({ title: post.title, content: post.content, commentsEnabled: post.commentsEnabled, images: (post.images ?? []) as string[], isUploading: false })}>
                        <Pencil className="w-3.5 h-3.5 mr-2" />
                        編輯貼文
                      </DropdownMenuItem>
                    )}
                    {isPostAuthor && (
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => deletePostMut.mutate({ postId })}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-2" />
                        刪除貼文
                      </DropdownMenuItem>
                    )}
                    {isAdmin && (
                      <>
                        <DropdownMenuItem onClick={() => pinPostMut.mutate({ postId, pinned: !post.isPinned })}>
                          <Pin className="w-3.5 h-3.5 mr-2" />
                          {post.isPinned ? "取消置頂" : "置頂"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => lockPostMut.mutate({ postId, locked: !post.isLocked })}>
                          <Lock className="w-3.5 h-3.5 mr-2" />
                          {post.isLocked ? "解除鎖定" : "鎖定"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => hidePostMut.mutate({ postId, hidden: !post.isHidden })}>
                          {post.isHidden ? <Eye className="w-3.5 h-3.5 mr-2" /> : <EyeOff className="w-3.5 h-3.5 mr-2" />}
                          {post.isHidden ? "取消隱藏" : "隱藏"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => adminDeletePostMut.mutate({ postId })}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-2" />
                          永久刪除（管理員）
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )}
        </div>

        {/* Comments section */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="font-semibold text-sm">{post.commentCount} 則留言</h2>
          </div>

          {comments.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              尚無留言，成為第一個留言的人
            </div>
          ) : (
            <div className="divide-y divide-border px-6">
              {comments.map((comment) => (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  isAdmin={isAdmin}
                  currentUserId={user?.id}
                  onReply={(parentCommentId, replyToUserId, label) =>
                    setReplyTo({ parentCommentId, replyToUserId, label })
                  }
                  onEdit={(c) => setEditingComment({ id: c.id, content: c.content })}
                  onDelete={(id) => deleteCommentMut.mutate({ commentId: id })}
                  onHide={(id, hidden) => hideCommentMut.mutate({ commentId: id, hidden })}
                />
              ))}
            </div>
          )}

          {/* Comment input */}
          {user && !isLocked && post.commentsEnabled && (
            <div className="px-6 py-4 border-t border-border bg-muted/20">
              {replyTo && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                  <Reply className="w-3 h-3" />
                  <span>回覆 {replyTo.label}</span>
                  <button
                    className="ml-auto hover:text-foreground"
                    onClick={() => setReplyTo(null)}
                  >
                    取消
                  </button>
                </div>
              )}
              {editingComment ? (
                <div className="space-y-2">
                  <Textarea
                    value={editingComment.content}
                    onChange={(e) => setEditingComment({ ...editingComment, content: e.target.value })}
                    placeholder="編輯留言..."
                    rows={3}
                    className="text-sm resize-none"
                  />
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" size="sm" onClick={() => setEditingComment(null)}>取消</Button>
                    <Button
                      size="sm"
                      disabled={updateCommentMut.isPending || !editingComment.content.trim()}
                      onClick={handleEditCommentSave}
                    >
                      儲存
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 items-end">
                  <Textarea
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder={replyTo ? `回覆 ${replyTo.label}...` : "留言..."}
                    rows={2}
                    className="text-sm resize-none flex-1"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSubmitComment();
                    }}
                  />
                  <Button
                    size="sm"
                    disabled={createCommentMut.isPending || !commentText.trim()}
                    onClick={handleSubmitComment}
                    className="h-9 px-3 shrink-0"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {!user && (
            <div className="px-6 py-4 border-t border-border text-center text-sm text-muted-foreground">
              請先登入才能留言
            </div>
          )}

          {user && isLocked && !isAdmin && (
            <div className="px-6 py-4 border-t border-border flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
              <Lock className="w-3.5 h-3.5" />
              此貼文已鎖定
            </div>
          )}

          {user && !isLocked && !post.commentsEnabled && !isAdmin && (
            <div className="px-6 py-4 border-t border-border text-center text-sm text-muted-foreground">
              作者已關閉此貼文的留言功能
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
