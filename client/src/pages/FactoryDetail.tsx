import { Helmet } from "react-helmet-async";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import Navbar from "@/components/Navbar";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useRoute, useLocation } from "wouter";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { MessageCircle } from "lucide-react";
import { shareContent } from "@/lib/share";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { NativePullToRefreshLayout } from "@/components/NativePullToRefreshLayout";
import { FactoryDetailView } from "@/components/FactoryDetailView";

export default function FactoryDetail() {
  const [, params] = useRoute("/factory/:id");
  const factoryId = Number(params?.id);
  const [, navigate] = useLocation();
  const { user, isAuthenticated } = useAuth();

  const handleBackToSearch = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      navigate("/search");
    }
  };

  // 新工廠詳情頁一律從頁首開始（回歸情境：SPA 導航不像整頁重新載入會自動重置
  // scroll，從搜尋頁滑到很下面再點進工廠頁時，會直接沿用舊的 scrollY，落在
  // 頁面中段甚至底部）。只鎖定「進到這個 route／這個 factoryId」這個時間點
  // 重置一次，依賴 factoryId 是因為即使 wouter 在同一個 <Route path="/factory/:id">
  // 底下切換不同工廠 id 時可能不會整個 unmount/remount，仍然要在那個瞬間重置；
  // 不依賴 factory 資料本身（isLoading／isFav／review 等任何一般 state 變化都
  // 不會重新觸發這個 effect），避免收藏、評價、資料重新整理等操作把使用者
  // 強制拉回頁首。
  useEffect(() => {
    if (!factoryId) return;
    window.scrollTo(0, 0);
  }, [factoryId]);

  const { data: factory, isLoading } = trpc.factory.getById.useQuery({ id: factoryId }, { enabled: !!factoryId });
  const { data: reviewData } = trpc.review.getByFactory.useQuery({ factoryId, page: 1, pageSize: 10 }, { enabled: !!factoryId });
  const { data: isFavData } = trpc.favorite.isLiked.useQuery({ factoryId }, { enabled: !!factoryId && isAuthenticated });
  const { data: myReview } = trpc.review.getMyReviewForFactory.useQuery({ factoryId }, { enabled: !!factoryId && isAuthenticated });
  const { data: photos = [] } = trpc.factory.getPhotos.useQuery({ factoryId }, { enabled: !!factoryId });
  const { data: categories = [] } = trpc.category.getByFactory.useQuery({ factoryId }, { enabled: !!factoryId });

  const [isFav, setIsFav] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const utils = trpc.useUtils();
  const handleRefresh = useCallback(async () => {
    await Promise.all([
      utils.factory.getById.invalidate({ id: factoryId }),
      utils.factory.getPhotos.invalidate({ factoryId }),
      utils.review.getByFactory.invalidate({ factoryId }),
      utils.review.getMyReviewForFactory.invalidate({ factoryId }),
      utils.favorite.isLiked.invalidate({ factoryId }),
      utils.favorite.getByUser.invalidate(),
      utils.category.getByFactory.invalidate({ factoryId }),
      utils.product.getByFactory.invalidate({ factoryId }),
    ]);
  }, [utils, factoryId]);
  const { contentRef, indicatorRef, iconRef, phase } = usePullToRefresh({
    onRefresh: handleRefresh,
    disabled: !factoryId || overlayOpen,
  });
  const submitReport = trpc.report.create.useMutation({
    onSuccess: () => {
      toast.success("檢舉已送出，我們會盡快處理");
    },
    onError: (err) => toast.error(err.message),
  });

  useEffect(() => {
    if (isFavData) setIsFav(isFavData.isFavorited);
  }, [isFavData]);

  useEffect(() => {
    if (!factory) return;
    const KEY = "oxm_recent_viewed";
    try {
      const prev: any[] = JSON.parse(localStorage.getItem(KEY) || "[]");
      const raw = (factory as any).industry;
      const industryArr = Array.isArray(raw) ? raw : (typeof raw === 'string' && raw ? [raw] : []);
      const entry = {
        id: factory.id,
        name: factory.name,
        industry: industryArr,
        region: factory.region,
        businessType: (factory as any).businessType ?? "factory",
        avatarUrl: (factory as any).avatarUrl ?? null,
        avatarCrop: (factory as any).avatarCrop ?? null,
        avgRating: factory.avgRating,
        reviewCount: factory.reviewCount,
        viewedAt: Date.now(),
      };
      const updated = [entry, ...prev.filter((f: any) => f.id !== factory.id)].slice(0, 20);
      localStorage.setItem(KEY, JSON.stringify(updated));
    } catch {}
  }, [factory?.id]);

  const createReview = trpc.review.create.useMutation({
    onSuccess: () => {
      toast.success("評價已送出");
      utils.review.getByFactory.invalidate({ factoryId });
      utils.factory.getById.invalidate({ id: factoryId });
      utils.review.getMyReviewForFactory.invalidate({ factoryId });
    },
    onError: (err) => toast.error(err.message),
  });

  const updateReview = trpc.review.update.useMutation({
    onSuccess: () => {
      toast.success("評價已更新");
      utils.review.getByFactory.invalidate({ factoryId });
      utils.factory.getById.invalidate({ id: factoryId });
      utils.review.getMyReviewForFactory.invalidate({ factoryId });
    },
    onError: (err) => toast.error(err.message),
  });

  const handleChat = (productId?: number, productName?: string) => {
    const params = new URLSearchParams();
    params.set("factoryId", String(factoryId));
    if (productId) params.set("productId", String(productId));
    if (productName) params.set("productName", productName);
    // 讓 Chat 的返回按鈕知道要回這間工廠，而不是 fallback 到「我的訊息」。
    navigate(`/chat/new?${params.toString()}`, { state: { from: `/factory/${factoryId}` } });
  };

  const toggleFav = trpc.favorite.toggle.useMutation({
    onSuccess: (data) => {
      setIsFav(data.isFavorited);
      toast.success(data.isFavorited ? "已加入收藏" : "已取消收藏");
      utils.favorite.getByUser.invalidate();
    },
    onError: () => toast.error("操作失敗"),
  });

  const handleToggleFav = () => {
    toggleFav.mutate({ factoryId });
  };

  const handleShare = () => {
    const url = `${window.location.origin}/factory/${factoryId}`;
    const shareTitle = factory?.name ?? "OXM 工廠";
    const shareText = `在 OXM 認識 ${shareTitle}，台灣傳產工廠媒合平台`;
    void shareContent({ title: shareTitle, text: shareText, url });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container py-8">
          <Skeleton className="h-8 w-48 mb-4" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (!factory) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container py-16 text-center">
          <p className="text-muted-foreground">找不到此工廠</p>
          <Button variant="link" onClick={handleBackToSearch}>返回搜尋</Button>
        </div>
      </div>
    );
  }

  const factoryIndustryArr: string[] = (() => {
    const raw = (factory as any).industry;
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string' && raw) return [raw];
    return [];
  })();
  const factoryIndustry = factoryIndustryArr.join("、");
  const factoryRegion = factory.region ?? "";
  const factorySubIndustryArr: string[] = Array.isArray((factory as any).subIndustry) ? (factory as any).subIndustry : [];
  const factoryMfgModes: string[] = Array.isArray((factory as any).mfgModes) ? (factory as any).mfgModes : [];
  const subIndustryText = factorySubIndustryArr.slice(0, 2).join("、");
  const canonicalUrl = `https://www.oxmmatch.com/factory/${factory.id}`;
  const metaTitle = `${factory.name}｜${subIndustryText || factoryIndustry}工廠介紹｜OXM`;
  const metaDesc = [
    factory.name,
    factoryRegion ? `位於${factoryRegion}` : "",
    factoryIndustry ? `${factoryIndustry}工廠` : "",
    subIndustryText ? `主營${subIndustryText}` : "",
    factoryMfgModes.length ? `提供 ${factoryMfgModes.join(" / ")} 服務` : "",
    factory.description ? factory.description.slice(0, 60) : "",
    "OXM 台灣傳統產業資源媒合平台",
  ].filter(Boolean).join("，");
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: factory.name,
    url: canonicalUrl,
    description: factory.description || `${factoryIndustry}工廠，位於${factoryRegion}`,
    areaServed: factoryRegion,
    knowsAbout: [...factoryIndustryArr, ...factorySubIndustryArr],
  });

  // Same field-selection order as the server-side OG injection (cover ->
  // avatar -> first factory photo -> first product photo -> OXM default),
  // so the DOM after hydration matches what crawlers saw in the raw HTML.
  const toAbsoluteImageUrl = (u?: string | null): string | null => {
    if (!u) return null;
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith("/")) return `${window.location.origin}${u}`;
    return null;
  };
  const firstProductImage = Array.isArray((factory as any).products)
    ? (factory as any).products.find((p: any) => Array.isArray(p.images) && p.images.length > 0)?.images?.[0]
    : undefined;
  const ogImage =
    toAbsoluteImageUrl((factory as any).coverImageUrl) ||
    toAbsoluteImageUrl((factory as any).avatarUrl) ||
    toAbsoluteImageUrl(photos[0]?.url) ||
    toAbsoluteImageUrl(firstProductImage) ||
    `${window.location.origin}/og-image.png`;

  return (
    <>
      <NativePullToRefreshLayout contentRef={contentRef} indicatorRef={indicatorRef} iconRef={iconRef} phase={phase} className="min-h-screen bg-background animate-page-enter">
        <Helmet>
          <title>{metaTitle}</title>
          <meta name="description" content={metaDesc} />
          <link rel="canonical" href={canonicalUrl} />
          <meta property="og:type" content="website" />
          <meta property="og:title" content={metaTitle} />
          <meta property="og:description" content={metaDesc} />
          <meta property="og:image" content={ogImage} />
          <meta property="og:url" content={canonicalUrl} />
          <meta property="og:site_name" content="OXM" />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={metaTitle} />
          <meta name="twitter:description" content={metaDesc} />
          <meta name="twitter:image" content={ogImage} />
          <script type="application/ld+json">{jsonLd}</script>
        </Helmet>
        <FloatingBackButton fallbackHref="/search" />

        <FactoryDetailView
          factory={factory as any}
          photos={photos}
          categories={categories}
          reviewData={reviewData}
          myReview={myReview}
          isAuthenticated={isAuthenticated}
          user={user}
          isFav={isFav}
          favPending={toggleFav.isPending}
          reviewSubmitPending={createReview.isPending || updateReview.isPending}
          reportPending={submitReport.isPending}
          onChat={handleChat}
          onToggleFav={handleToggleFav}
          onShare={handleShare}
          onSubmitCreateReview={(rating, comment) => createReview.mutate({ factoryId, rating, comment: comment || undefined })}
          onSubmitUpdateReview={(rating, comment) => { if (!myReview) return; updateReview.mutate({ id: myReview.id, rating, comment: comment || undefined }); }}
          onSubmitReport={(reason) => submitReport.mutateAsync({ factoryId, reason })}
          onOverlayOpenChange={setOverlayOpen}
        />
      </NativePullToRefreshLayout>

      {/* Floating Chat Button — rendered outside the transform wrapper so it stays viewport-fixed */}
      <button
        onClick={() => handleChat()}
        className="fixed bottom-6 right-6 w-14 h-14 bg-primary text-primary-foreground rounded-full shadow-lg hover:shadow-xl transition-all flex items-center justify-center z-50 hover:scale-105"
        title="聯繫工廠"
      >
        <MessageCircle className="w-6 h-6" />
      </button>
    </>
  );
}
