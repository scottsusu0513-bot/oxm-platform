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

  return (
    <div>
      {/* Board header row */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold">{spaceName}</h2>
          {data && (
            <p className="text-sm text-muted-foreground">{data.total} 則討論</p>
          )}
        </div>
        {user && (
          <div className="flex items-center gap-2">
            <CommunityBoardFollowButton spaceCode={spaceCode} />
            <Button
              size="sm"
              className="bg-gradient-to-r from-orange-500 to-amber-500 text-white border-0"
              onClick={() => setShowNewPost(true)}
            >
              <PlusCircle className="w-4 h-4 mr-1.5" />
              發文
            </Button>
          </div>
        )}
      </div>

      {isError && (
        <div className="flex items-center gap-2 text-destructive py-12 justify-center text-sm">
          <AlertTriangle className="w-4 h-4" />
          載入失敗，
          <button onClick={() => void refetch()} className="underline">
            重試
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
          {!data?.items || data.items.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground text-sm">
              此討論區尚無貼文，成為第一個發文的人！
            </div>
          ) : (
            data.items.map((post) => (
              <div
                key={post.id}
                className="flex items-start gap-3 p-4 bg-card hover:bg-muted/30 transition-colors cursor-pointer"
                onClick={() => navigate(`/community/${spaceCode}/discussions/${post.id}`)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                    {post.isPinned && <Pin className="w-3.5 h-3.5 text-orange-500 shrink-0" />}
                    {post.isLocked && (
                      <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className="font-semibold text-sm truncate">{post.title}</span>
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
                <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>{post.commentCount}</span>
                </div>
              </div>
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
            navigate(`/community/${spaceCode}/discussions/${postId}`);
          }}
        />
      )}
    </div>
  );
}
