import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { Loader2, MessageSquare, Pin, Lock, PlusCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/_core/hooks/useAuth";
import { INDUSTRY_SLUGS } from "@shared/constants";
import { COMMUNITY_CROSS_INDUSTRY_NAME, COMMUNITY_CROSS_INDUSTRY_SLUG } from "@shared/const";
import { formatDistanceToNow } from "date-fns";
import { zhTW } from "date-fns/locale";
import CommunityNewPostDialog from "./CommunityNewPostDialog";
import CommunityBoardFollowButton from "./CommunityBoardFollowButton";
import { DiscussionCtaArtwork, DiscussionEmptyArtwork } from "./CommunityArtwork";

interface Props {
  spaceCode: string;
}

const slugToName: Record<string, string> = {
  ...Object.fromEntries(Object.entries(INDUSTRY_SLUGS).map(([name, slug]) => [slug, name])),
  [COMMUNITY_CROSS_INDUSTRY_SLUG]: COMMUNITY_CROSS_INDUSTRY_NAME,
};

const PAGE_SIZE = 20;

export default function CommunitySpace({ spaceCode }: Props) {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [showNewPost, setShowNewPost] = useState(false);

  const { data, isLoading, isError, refetch } = trpc.community.listPosts.useQuery(
    { spaceCode, page, pageSize: PAGE_SIZE },
    { enabled: !!spaceCode },
  );

  const spaceName = slugToName[spaceCode] ?? spaceCode;
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  // 從列表點進貼文詳情時，帶入目前實際來源（含 query string），讓詳情頁的
  // 「← 返回討論區」可以優先用 history.back() 回到這裡，而不是永遠 fallback
  // 回寫死的 /community/:spaceCode/discussions（見 communityReturnSource.ts）。
  const goToPost = (postId: number) => {
    navigate(`/community/${spaceCode}/discussions/${postId}`, {
      state: { from: window.location.pathname + window.location.search },
    });
  };

  return (
    <div>
      {/* Compact posting CTA */}
      <div className="mb-4 overflow-hidden rounded-2xl border border-purple-100/80 bg-white shadow-sm dark:border-purple-900/40 dark:bg-card">
        <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300">
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <h2 className="font-semibold text-slate-900 dark:text-foreground">{spaceName}</h2>
                {data && <span className="text-xs text-muted-foreground">{data.total} 則討論</span>}
              </div>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                分享問題、實務經驗與產業觀察，讓同業一起找出解法。
              </p>
            </div>
          </div>
          <DiscussionCtaArtwork className="pointer-events-none hidden h-[84px] w-40 shrink-0 rounded-xl object-cover shadow-sm ring-1 ring-purple-100/70 lg:block dark:ring-purple-900/40" />
          {user && (
            <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
              <CommunityBoardFollowButton spaceCode={spaceCode} />
              <Button
                size="sm"
                className="border-0 bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-sm transition-transform hover:-translate-y-px hover:from-orange-600 hover:to-amber-600"
                onClick={() => setShowNewPost(true)}
              >
                <PlusCircle className="mr-1.5 h-4 w-4" />
                發表討論
              </Button>
            </div>
          )}
        </div>
      </div>

      {isError ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-red-100 bg-white py-12 text-sm text-destructive shadow-sm dark:border-red-900/30 dark:bg-card">
          <AlertTriangle className="w-4 h-4" />
          載入失敗，
          <button onClick={() => void refetch()} className="underline underline-offset-2">
            重試
          </button>
        </div>
      ) : isLoading ? (
        <div className="flex justify-center rounded-2xl border border-purple-100/80 bg-white py-16 shadow-sm dark:border-purple-900/40 dark:bg-card">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="divide-y divide-purple-100/70 overflow-hidden rounded-2xl border border-purple-100/80 bg-card shadow-sm dark:divide-purple-900/30 dark:border-purple-900/40">
          {!data?.items || data.items.length === 0 ? (
            <div className="flex min-h-[390px] flex-col items-center justify-center px-5 py-10 text-center sm:min-h-[420px]">
              <DiscussionEmptyArtwork className="mb-4 w-full max-w-[360px] rounded-2xl object-cover shadow-sm ring-1 ring-purple-100/70 dark:ring-purple-900/40" />
              <h3 className="text-base font-semibold text-slate-900 dark:text-foreground">目前還沒有相關討論</h3>
              <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
                成為第一個提出問題的人，讓產業夥伴一起交流經驗。
              </p>
              {user && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 border-orange-200 text-orange-700 hover:bg-orange-50 dark:border-orange-900/50 dark:text-orange-300 dark:hover:bg-orange-950/30"
                  onClick={() => setShowNewPost(true)}
                >
                  <PlusCircle className="mr-1.5 h-4 w-4" />
                  發表第一則討論
                </Button>
              )}
            </div>
          ) : (
            data.items.map((post) => (
              <button
                type="button"
                key={post.id}
                className={`group flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-purple-50/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-500 dark:hover:bg-purple-950/15 ${post.isPinned ? "bg-orange-50/35 dark:bg-orange-950/10" : "bg-card"}`}
                onClick={() => goToPost(post.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                    {post.isPinned && <Pin className="w-3.5 h-3.5 text-orange-500 shrink-0" />}
                    {post.isLocked && (
                      <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className="line-clamp-2 text-sm font-semibold leading-snug transition-colors group-hover:text-purple-700 dark:group-hover:text-purple-300">{post.title}</span>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                    <span>{post.authorFactoryName ?? post.authorName ?? "匿名"}</span>
                    <span>·</span>
                    <span>
                      {formatDistanceToNow(new Date(post.createdAt), {
                        addSuffix: true,
                        locale: zhTW,
                      })}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs text-muted-foreground dark:bg-muted/50">
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>{post.commentCount}</span>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            上一頁
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一頁
          </Button>
        </div>
      )}

      {showNewPost && (
        <CommunityNewPostDialog
          spaceCode={spaceCode}
          spaceName={spaceName}
          onClose={() => setShowNewPost(false)}
          onCreated={(postId) => {
            setShowNewPost(false);
            goToPost(postId);
          }}
        />
      )}
    </div>
  );
}
