import { useState } from "react";
import { trpc } from "@/lib/trpc";
import Navbar from "@/components/Navbar";
import { Helmet } from "react-helmet-async";
import { Link, useLocation } from "wouter";
import { ChevronLeft, Loader2, MessageSquare, Pin, Lock, PlusCircle, AlertTriangle, Gavel } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/_core/hooks/useAuth";
import { INDUSTRY_SLUGS } from "@shared/constants";
import { formatDistanceToNow } from "date-fns";
import { zhTW } from "date-fns/locale";
import CommunityNewPostDialog from "./CommunityNewPostDialog";

interface Props {
  spaceCode: string;
}

const CROSS_INDUSTRY_SLUG = "cross-industry";

const slugToName: Record<string, string> = {
  ...Object.fromEntries(Object.entries(INDUSTRY_SLUGS).map(([name, slug]) => [slug, name])),
  [CROSS_INDUSTRY_SLUG]: "跨產業交流區",
};

export default function CommunitySpace({ spaceCode }: Props) {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [showNewPost, setShowNewPost] = useState(false);
  const PAGE_SIZE = 20;

  const { data, isLoading, isError, refetch } = trpc.community.listPosts.useQuery(
    { spaceCode, page, pageSize: PAGE_SIZE },
    { enabled: !!spaceCode },
  );

  const spaceName = slugToName[spaceCode] ?? spaceCode;
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>{spaceName} — OXM 商案討論區</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <Navbar />

      <main className="container py-8 max-w-4xl">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link href="/community" className="hover:text-foreground transition-colors">商案討論區</Link>
          <ChevronLeft className="w-3 h-3 rotate-180" />
          <span className="text-foreground font-medium">{spaceName}</span>
        </div>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">{spaceName}</h1>
            {data && (
              <p className="text-sm text-muted-foreground mt-0.5">{data.total} 則討論</p>
            )}
          </div>
          {user && (
            <Button
              size="sm"
              className="bg-gradient-to-r from-orange-500 to-amber-500 text-white border-0"
              onClick={() => setShowNewPost(true)}
            >
              <PlusCircle className="w-4 h-4 mr-1.5" />
              發文
            </Button>
          )}
        </div>

        {isError && (
          <div className="flex items-center gap-2 text-destructive py-12 justify-center text-sm">
            <AlertTriangle className="w-4 h-4" />
            載入失敗，請重試
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
            {(!data?.items || data.items.length === 0) ? (
              <div className="py-16 text-center text-muted-foreground text-sm">
                此討論區尚無貼文，成為第一個發文的人！
              </div>
            ) : (
              data.items.map((post) => (
                <div
                  key={post.id}
                  className="flex items-start gap-3 p-4 bg-card hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => navigate(`/community/${spaceCode}/${post.id}`)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      {post.isPinned && <Pin className="w-3.5 h-3.5 text-orange-500 shrink-0" />}
                      {post.isLocked && <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                      <span className="font-semibold text-sm truncate">{post.title}</span>
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                      <span>{post.authorFactoryName ?? post.authorName ?? "匿名"}</span>
                      <span>·</span>
                      <span>
                        {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true, locale: zhTW })}
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
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
              上一頁
            </Button>
            <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              下一頁
            </Button>
          </div>
        )}
        {/* 競標區 — 開發中 */}
        <div className="mt-8 rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center">
          <Gavel className="w-6 h-6 mx-auto mb-2 text-muted-foreground/50" />
          <p className="text-sm font-medium text-muted-foreground">競標區</p>
          <p className="text-xs text-muted-foreground/70 mt-0.5">功能開發中，敬請期待</p>
        </div>
      </main>

      {showNewPost && (
        <CommunityNewPostDialog
          spaceCode={spaceCode}
          spaceName={spaceName}
          onClose={() => setShowNewPost(false)}
          onCreated={(postId) => {
            setShowNewPost(false);
            navigate(`/community/${spaceCode}/${postId}`);
          }}
        />
      )}
    </div>
  );
}
