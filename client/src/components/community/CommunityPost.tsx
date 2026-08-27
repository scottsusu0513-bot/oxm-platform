import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import Navbar from "@/components/Navbar";
import { Helmet } from "react-helmet-async";
import { Link, useLocation } from "wouter";
import {
  ChevronLeft, Loader2, Lock, Pin, AlertTriangle,
  Pencil, Trash2, EyeOff, Eye, MoreHorizontal, Reply, Quote, Send, X, ShoppingBag, MessagesSquare,
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
import CommunityReactionButton from "./CommunityReactionButton";
import CommunityContentFollowButton from "./CommunityContentFollowButton";
import MentionTextarea, { type MentionInput, type MentionTextareaHandle } from "./MentionTextarea";
import { isSafeCommunityReturnSource } from "@/lib/communityReturnSource";

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
  // quoteMention 只在「引用」第二層留言時帶入——parentCommentId 一律解析到
  // 第一層（root），quoteMention 則是要自動預填進輸入框的 @對象 mention，
  // 讓 composer 走跟使用者手動從 autocomplete 選到的完全相同的 mention state
  // （見 CommunityPost 內 onReply 的實作與呼叫端說明）。
  onReply: (parentCommentId: number, toUserId: number | null, toName: string, quoteMention?: MentionInput) => void;
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
              <CommunityReactionButton
                targetType="comment"
                targetId={comment.id}
                disabled={!currentUserId}
              />
            )}
            {currentUserId && !comment.isHidden && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() => {
                  const name = comment.authorFactoryName ?? comment.authorName ?? "對方";
                  if (isNested) {
                    // 引用第二層留言：parentCommentId 必須解析回第一層
                    // （comment.parentCommentId，也就是這則留言自己所屬的
                    // root），不能用 comment.id（自己），否則會撞到 server
                    // 「只允許兩層留言結構」的檢查——因為 server 是檢查
                    // 「要回覆的目標本身有沒有自己的 parent」。
                    onReply(
                      comment.parentCommentId!,
                      comment.authorUserId,
                      `@${name}`,
                      comment.authorUserId != null
                        ? { type: "user", id: comment.authorUserId, displayName: name }
                        : undefined,
                    );
                  } else {
                    onReply(comment.id, comment.authorUserId, name);
                  }
                }}
              >
                {isNested ? (
                  <>
                    <Quote className="w-3 h-3 mr-1" />
                    引用
                  </>
                ) : (
                  <>
                    <Reply className="w-3 h-3 mr-1" />
                    回覆
                  </>
                )}
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

  // 返回討論區：來源一律來自 history.state.from（由 CommunitySpace 進入貼文時
  // navigate(path, {state}) 帶入），驗證通過才用真正的 history.back()，否則
  // 安全 fallback 到這個 spaceCode 自己的討論列表（不是 /community）——見
  // isSafeCommunityReturnSource 的規則說明。比照 ChatPage.tsx 既有的
  // isSafeChatReturnSource／handleReturn 寫法。
  const rawReturnSource = (window.history.state as Record<string, unknown> | null)?.from;
  const returnSource: string | null = isSafeCommunityReturnSource(rawReturnSource) ? rawReturnSource : null;
  const RETURN_FALLBACK_PATH = `/community/${spaceCode}/discussions`;
  const handleReturn = () => {
    if (returnSource && typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      navigate(RETURN_FALLBACK_PATH, { replace: true });
    }
  };

  const commentTextareaRef = useRef<MentionTextareaHandle>(null);
  const [commentText, setCommentText] = useState("");
  const [commentMentions, setCommentMentions] = useState<MentionInput[]>([]);
  const [replyTo, setReplyTo] = useState<{ parentCommentId: number; replyToUserId: number | null; label: string } | null>(null);
  const [editingComment, setEditingComment] = useState<{ id: number; content: string } | null>(null);
  const [editingPost, setEditingPost] = useState<{ title: string; content: string; commentsEnabled: boolean; images: string[]; isUploading: boolean } | null>(null);
  const [editingPostMentions, setEditingPostMentions] = useState<MentionInput[]>([]);

  const { data, isLoading, isError } = trpc.community.getPost.useQuery({ postId });

  const spaceName = slugToName[spaceCode] ?? spaceCode;

  const createCommentMut = trpc.community.createComment.useMutation({
    onSuccess: () => {
      setCommentText("");
      setCommentMentions([]);
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
      setEditingPostMentions([]);
      utils.community.getPost.invalidate({ postId });
      toast.success("貼文已更新");
    },
    onError: (e) => toast.error(e.message),
  });

  const deletePostMut = trpc.community.deletePost.useMutation({
    onSuccess: () => {
      toast.success("貼文已刪除");
      navigate(`/community/${spaceCode}/discussions`);
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
      navigate(`/community/${spaceCode}/discussions`);
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
      mentions: commentMentions,
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
      mentions: editingPostMentions.map(m => ({ type: m.type, id: m.id })),
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
          <Link href={`/community/${spaceCode}/discussions`}>
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
    <div className="min-h-screen bg-slate-50/60 dark:bg-background">
      <Helmet>
        <title>{post.title} — {spaceName} — OXM 商案討論區</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <Navbar />

      <main className="container py-5 sm:py-8 max-w-3xl">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link href="/community" className="hover:text-foreground transition-colors">商案討論區</Link>
          <ChevronLeft className="w-3 h-3 rotate-180" />
          <Link href={`/community/${spaceCode}/discussions`} className="hover:text-foreground transition-colors">{spaceName}</Link>
        </div>

        {/* 返回討論區：優先用 history.back() 回到使用者實際進來的列表頁（含
            productId/query），沒有可信來源時才 fallback 回這個 spaceCode 的
            討論列表——見 handleReturn／isSafeCommunityReturnSource。 */}
        <button
          type="button"
          onClick={handleReturn}
          className="inline-flex items-center gap-1.5 mb-4 h-9 px-3 -ml-3 rounded-lg text-sm font-medium text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          返回討論區
        </button>

        {/* Post header */}
        <article className="relative overflow-hidden bg-card border border-purple-100/80 dark:border-purple-900/40 rounded-2xl p-5 sm:p-6 mb-6 shadow-sm">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-orange-400 via-purple-500 to-purple-600" aria-hidden="true" />
          {editingPost ? (
            /* Inline edit form */
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-muted-foreground">編輯貼文</span>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditingPost(null); setEditingPostMentions([]); }}>
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
              <MentionTextarea
                value={editingPost.content}
                onChange={(v) => setEditingPost({ ...editingPost, content: v })}
                mentions={editingPostMentions}
                onMentionsChange={setEditingPostMentions}
                placeholder="內容… 輸入 @ 可提及工廠或使用者（最多 10 個）"
                rows={8}
                disabled={updatePostMut.isPending}
                className="text-sm"
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
                <Button variant="outline" size="sm" onClick={() => { setEditingPost(null); setEditingPostMentions([]); }} disabled={updatePostMut.isPending}>取消</Button>
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

                {/* Reaction + Follow row */}
                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border">
                  {user && (
                    <CommunityReactionButton
                      targetType="post"
                      targetId={post.id}
                    />
                  )}
                  {user && (
                    <div className="ml-auto">
                      <CommunityContentFollowButton contentId={post.id} />
                    </div>
                  )}
                </div>

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
                      <DropdownMenuItem onClick={() => { setEditingPost({ title: post.title, content: post.content, commentsEnabled: post.commentsEnabled, images: (post.images ?? []) as string[], isUploading: false }); setEditingPostMentions((data.postMentions ?? []).map(m => ({ type: m.type, id: m.id }))); }}>
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
        </article>

        {/* Comments section */}
        <section className="bg-card border border-purple-100/80 dark:border-purple-900/40 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-5 sm:px-6 py-4 border-b border-purple-100/70 dark:border-purple-900/30 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300">
              <MessagesSquare className="h-4 w-4" aria-hidden="true" />
            </span>
            <h2 className="font-semibold text-sm">{post.commentCount} 則留言</h2>
          </div>

          {comments.length === 0 ? (
            <div className="py-10 px-5 text-center text-sm text-muted-foreground">
              <MessagesSquare className="mx-auto mb-2 h-7 w-7 text-purple-300 dark:text-purple-700" aria-hidden="true" />
              <p>尚無留言，成為第一個留言的人</p>
            </div>
          ) : (
            <div className="divide-y divide-border px-6">
              {comments.map((comment) => (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  isAdmin={isAdmin}
                  currentUserId={user?.id}
                  onReply={(parentCommentId, replyToUserId, label, quoteMention) => {
                    setReplyTo({ parentCommentId, replyToUserId, label });
                    if (quoteMention) {
                      // 引用第二層留言：預帶 @對象 進輸入框，且必須是「真正的
                      // mention」（跟使用者手動從 autocomplete 選到的狀態一
                      // 樣），server 才會透過 mentions[] 通知被引用的人——
                      // replyToUserId 只掛在留言上做顯示用，真正驅動通知的是
                      // parentCommentId 對應到的作者（root）與 mentions[]。
                      const insertText = `@${quoteMention.displayName} `;
                      setCommentText(insertText);
                      setCommentMentions([quoteMention]);
                      requestAnimationFrame(() => commentTextareaRef.current?.focusEnd());
                    }
                  }}
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
                  <MentionTextarea
                    ref={commentTextareaRef}
                    value={commentText}
                    onChange={setCommentText}
                    mentions={commentMentions}
                    onMentionsChange={setCommentMentions}
                    postId={postId}
                    placeholder={replyTo ? `回覆 ${replyTo.label}…（輸入 @ 提及他人）` : "留言…（輸入 @ 提及他人）"}
                    rows={2}
                    disabled={createCommentMut.isPending}
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
        </section>
      </main>
    </div>
  );
}
