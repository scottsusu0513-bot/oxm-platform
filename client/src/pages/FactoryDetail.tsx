import { Helmet } from "react-helmet-async";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { performLogin } from "@/const";
import { useRoute, useLocation } from "wouter";
import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Star, MapPin, Phone, Globe, Calendar, Building2, DollarSign,
  MessageCircle, Package, Check, X, ArrowLeft, Send, Heart, Wrench, Factory as FactoryIcon, Flag, Clock, ChevronLeft, ChevronRight, Images, CheckCircle, Share2
} from "lucide-react";
import { shareContent } from "@/lib/share";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { NativePullToRefreshLayout } from "@/components/NativePullToRefreshLayout";

function normalizeDescription(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n");
}

function InfoRow({ label1, val1, label2, val2 }: {
  label1: string; val1?: ReactNode;
  label2?: string; val2?: ReactNode;
}) {
  const isEmpty = (v: React.ReactNode) => v === null || v === undefined || v === "";
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 border-b last:border-0">
      <div className="px-5 py-3">
        <p className="text-xs text-muted-foreground mb-0.5">{label1}</p>
        <div className="text-sm">{isEmpty(val1) ? "—" : val1}</div>
      </div>
      {label2 !== undefined && (
        <div className="px-5 py-3 border-t sm:border-t-0 sm:border-l">
          <p className="text-xs text-muted-foreground mb-0.5">{label2}</p>
          <div className="text-sm">{isEmpty(val2) ? "—" : val2}</div>
        </div>
      )}
    </div>
  );
}

function ProductImageCarousel({ images, onImageClick }: { images: string[]; onImageClick?: (images: string[], index: number) => void }) {
  const [idx, setIdx] = useState(0);
  if (!images.length) return null;
  const prev = (e: React.MouseEvent) => { e.stopPropagation(); setIdx(i => (i - 1 + images.length) % images.length); };
  const next = (e: React.MouseEvent) => { e.stopPropagation(); setIdx(i => (i + 1) % images.length); };
  return (
    <div className="relative w-28 h-28 shrink-0 rounded-lg overflow-hidden bg-muted">
      <img
        src={images[idx]}
        alt=""
        className={`w-full h-full object-cover ${onImageClick ? "cursor-pointer" : ""}`}
        loading="lazy"
        onClick={(e) => { e.stopPropagation(); onImageClick?.(images, idx); }}
      />
      {images.length > 1 && (
        <>
          <button onClick={prev} className="absolute left-0 inset-y-0 w-7 flex items-center justify-center bg-black/30 hover:bg-black/50 text-white transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={next} className="absolute right-0 inset-y-0 w-7 flex items-center justify-center bg-black/30 hover:bg-black/50 text-white transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
          <div className="absolute bottom-1 left-0 right-0 flex justify-center gap-1">
            {images.map((_, i) => (
              <span key={i} className={`w-1.5 h-1.5 rounded-full ${i === idx ? "bg-white" : "bg-white/50"}`} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function isValidUrl(url: string): boolean {
  if (!url || url.trim() === "" || url === "無" || url === "N/A" || url === "-") return false;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.includes(".");
  } catch {
    return false;
  }
}
function formatPrice(val: string | null | undefined): string {
  if (!val) return "";
  const num = parseFloat(val);
  if (isNaN(num)) return val;
  return num.toLocaleString("zh-TW");
}

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

  const { data: factory, isLoading } = trpc.factory.getById.useQuery({ id: factoryId }, { enabled: !!factoryId });
  const { data: reviewData } = trpc.review.getByFactory.useQuery({ factoryId, page: 1, pageSize: 10 }, { enabled: !!factoryId });
  const { data: isFavData } = trpc.favorite.isLiked.useQuery({ factoryId }, { enabled: !!factoryId && isAuthenticated });
  const { data: myReview } = trpc.review.getMyReviewForFactory.useQuery({ factoryId }, { enabled: !!factoryId && isAuthenticated });
  const { data: photos = [] } = trpc.factory.getPhotos.useQuery({ factoryId }, { enabled: !!factoryId });
  const { data: categories = [] } = trpc.category.getByFactory.useQuery({ factoryId }, { enabled: !!factoryId });

  const [isFav, setIsFav] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [activeCat, setActiveCat] = useState<number | null | "all">("all");

  // Review form
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [showUpdateConfirm, setShowUpdateConfirm] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [reportReason, setReportReason] = useState("");
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
    disabled: !factoryId || lightboxIndex !== null || showReportDialog,
  });
  const submitReport = trpc.report.create.useMutation({
    onSuccess: () => {
      toast.success("檢舉已送出，我們會盡快處理");
      setShowReportDialog(false);
      setReportReason("");
    },
    onError: (err) => toast.error(err.message),
  });

  // 已有評價時預填
  useEffect(() => {
    if (myReview) {
      setRating(myReview.rating);
      setComment(myReview.comment ?? "");
    }
  }, [myReview]);

  useEffect(() => {
    if (isFavData) setIsFav(isFavData.isFavorited);
  }, [isFavData]);

  useEffect(() => {
    if (!factory) return;
    const KEY = "oxm_recent_viewed";
    try {
      const prev: any[] = JSON.parse(localStorage.getItem(KEY) || "[]");
      const entry = {
        id: factory.id,
        name: factory.name,
        industry: factoryIndustryArr,
        region: factory.region,
        businessType: (factory as any).businessType ?? "factory",
        avatarUrl: (factory as any).avatarUrl ?? null,
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

  const handleSubmitReview = () => {
    if (rating === 0) return;
    if (myReview) {
      // 已有評價，顯示確認對話框
      setShowUpdateConfirm(true);
    } else {
      createReview.mutate({ factoryId, rating, comment: comment || undefined });
    }
  };

  const handleConfirmUpdate = () => {
    if (!myReview) return;
    updateReview.mutate({ id: myReview.id, rating, comment: comment || undefined });
    setShowUpdateConfirm(false);
  };

  const handleChat = (productId?: number, productName?: string) => {
    if (!isAuthenticated) { performLogin(); return; }
    const params = new URLSearchParams();
    params.set("factoryId", String(factoryId));
    if (productId) params.set("productId", String(productId));
    if (productName) params.set("productName", productName);
    navigate(`/chat/new?${params.toString()}`);
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
    if (!isAuthenticated) { performLogin(); return; }
    toggleFav.mutate({ factoryId });
  };

  const handleShare = () => {
    const url = `${window.location.origin}/factory/${factoryId}`;
    const shareTitle = factory?.name ?? "OXM 工廠";
    const shareText = `在 OXM 認識 ${shareTitle}，台灣傳產工廠媒合平台`;
    void shareContent({ title: shareTitle, text: shareText, url });
  };

  const [activeSection, setActiveSection] = useState("section-basic");
  const activeSectionRef = useRef("section-basic");

  useEffect(() => {
    if (!factory) return;
    const sectionIds = ["section-basic", "section-contact", "section-photos", "section-products", "section-reviews"];
    const visible = new Set<string>();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      });
      const first = sectionIds.find(id => visible.has(id));
      if (first && first !== activeSectionRef.current) {
        activeSectionRef.current = first;
        setActiveSection(first);
      }
    }, { rootMargin: "-10% 0px -70% 0px" });
    sectionIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [factory?.id]);

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

  const tocItems = [
    { id: "section-basic", label: "基本資料" },
    { id: "section-contact", label: "聯絡資訊" },
    ...(photos.length > 0 ? [{ id: "section-photos", label: "工廠照片" }] : []),
    { id: "section-products", label: "商品 / 服務" },
    { id: "section-reviews", label: "評價" },
  ];

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
      <Navbar />
      <FloatingBackButton fallbackHref="/search" />

      {/* ── Cover image — full-width on mobile, max-w-7xl centered on desktop ── */}
      <div className="w-full lg:max-w-7xl lg:mx-auto">
        <div className="relative overflow-hidden aspect-[16/5] lg:rounded-b-xl">
          {(factory as any).coverImageUrl ? (
            <img
              src={(factory as any).coverImageUrl}
              alt=""
              className="w-full h-full object-cover"
              loading="eager"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-orange-400 via-rose-500 to-violet-600" />
          )}
          {/* subtle bottom fade so logo blends in */}
          <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />
        </div>
      </div>

      <div className="w-full lg:max-w-7xl lg:mx-auto px-4 sm:px-6 lg:px-0">
        {/* ── Header: logo | name+description | actions ── */}
        {/* relative z-10 so this layer paints above the cover div (positioned element) */}
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-start gap-3 mb-4">
          {/* Left: Logo — overlaps cover */}
          <div
            className={`w-20 h-20 md:w-24 md:h-24 rounded-2xl border-4 border-white shadow-lg bg-white overflow-hidden shrink-0 -mt-10 md:-mt-12 ${(factory as any).avatarUrl ? "cursor-pointer hover:opacity-90 transition-opacity" : ""}`}
            onClick={() => { if ((factory as any).avatarUrl) { setPreviewImages([(factory as any).avatarUrl]); setPreviewIndex(0); } }}
          >
            {(factory as any).avatarUrl ? (
              <img src={(factory as any).avatarUrl} alt={factory.name} className="w-full h-full object-contain" loading="eager" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                {(factory as any).businessType === "studio"
                  ? <Wrench className="w-8 h-8 text-purple-200" />
                  : <FactoryIcon className="w-8 h-8 text-orange-200" />}
              </div>
            )}
          </div>

          {/* Center: name + description */}
          <div className="flex-1 min-w-0 sm:pt-1">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <h1 className="text-xl md:text-2xl font-bold leading-tight">{factory.name}</h1>
              {(factory as any).certified && (
                <span className="inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full font-medium">
                  ✓ 認證工廠
                </span>
              )}
            </div>
            {factory.description && (
              <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                {normalizeDescription(factory.description)}
              </p>
            )}
          </div>

          {/* Right: action buttons */}
          <div className="flex gap-2 shrink-0 flex-wrap">
            <Button onClick={() => handleChat()}>
              <MessageCircle className="w-4 h-4 mr-1.5" />聯繫工廠
            </Button>
            <Button variant={isFav ? "default" : "outline"} onClick={handleToggleFav} disabled={toggleFav.isPending}>
              <Heart className={`w-4 h-4 mr-1.5 ${isFav ? "fill-current" : ""}`} />
              {isFav ? "已收藏" : "收藏"}
            </Button>
            <Button variant="outline" onClick={handleShare}>
              <Share2 className="w-4 h-4 mr-1.5" />分享
            </Button>
            {isAuthenticated && (
              <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setShowReportDialog(true)}>
                <Flag className="w-4 h-4 mr-1" />檢舉
              </Button>
            )}
          </div>
        </div>

        {/* ── Body: TOC + sections ── */}
        <div className="flex gap-8 items-start mt-6">

          {/* TOC sidebar — 桌面版（lg+）常駐顯示；sticky + self-start 讓它在 items-start 的
              flex row 中維持自己的高度，捲動時浮動於 Navbar（h-16=64px）下方 top-20（80px） */}
          <div className="hidden lg:block w-40 shrink-0 sticky top-20 self-start">
            <nav className="space-y-0.5">
              {tocItems.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    const el = document.getElementById(item.id);
                    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className={`w-full text-left text-sm px-3 py-2 rounded-lg transition-colors ${
                    activeSection === item.id
                      ? "bg-orange-50 text-orange-700 font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Main sections */}
          <div className="flex-1 min-w-0 space-y-6 pb-24">

            {/* ── 基本資料 ── */}
            <section id="section-basic" className="scroll-mt-20">
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-base">基本資料</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {/* Row 1 */}
                  <InfoRow
                    label1="主產業"
                    val1={factoryIndustry || undefined}
                    label2="子產業"
                    val2={factorySubIndustryArr.join("、") || undefined}
                  />
                  {/* Row 2 */}
                  <InfoRow
                    label1="商家類型"
                    val1={(factory as any).businessType === "studio" ? "工作室" : "工廠"}
                    label2="接單狀態"
                    val2={(() => {
                      const st = (factory as any).operationStatus;
                      if (!st || st === "normal") return <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />接單中</span>;
                      if (st === "busy") return <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-500 shrink-0" />產線繁忙</span>;
                      return <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />產線滿載</span>;
                    })()}
                  />
                  {/* Row 3 */}
                  <InfoRow
                    label1="服務類型"
                    val1={factoryMfgModes.join("、") || undefined}
                    label2="接單模式"
                    val2={undefined}
                  />
                  {/* Row 4 */}
                  <InfoRow
                    label1="負責人"
                    val1={factory.ownerName}
                    label2="聯絡窗口"
                    val2={(factory as any).contactPersonName}
                  />
                  {/* Row 5 */}
                  <InfoRow
                    label1="聯絡電話"
                    val1={factory.phone
                      ? <a href={`tel:${factory.phone.replace(/[\s\-\(\)]/g, "")}`} className="hover:underline underline-offset-2">{factory.phone}</a>
                      : undefined}
                    label2="是否接小量"
                    val2={undefined}
                  />
                  {/* Row 6 */}
                  <InfoRow
                    label1="是否提供打樣"
                    val1={undefined}
                    label2="資本額"
                    val2={factory.capitalLevel}
                  />
                  {/* Row 7 */}
                  <InfoRow
                    label1="成立年份"
                    val1={factory.foundedYear ? `${factory.foundedYear} 年` : undefined}
                    label2="所在地區"
                    val2={factory.region}
                  />
                  {/* Row 8 */}
                  <InfoRow
                    label1="工廠地址"
                    val1={(factory as any).address}
                    label2="營業時間"
                    val2={(factory as any).weekdayHours}
                  />
                  {/* Row 9 */}
                  <InfoRow
                    label1="休假日"
                    val1={(factory as any).weekendHours}
                    label2="休假日其他說明"
                    val2={(factory as any).businessNote}
                  />
                  {/* Row 10 */}
                  <InfoRow
                    label1="回覆時間"
                    val1={(() => {
                      const h = parseFloat((factory as any).avgResponseHours ?? "");
                      if (isNaN(h)) return undefined;
                      if (h < 2) return "通常 2 小時內回覆";
                      if (h < 24) return "通常 24 小時內回覆";
                      return "回覆時間較長";
                    })()}
                    label2="統一編號"
                    val2={undefined}
                  />
                  {/* Row 11 */}
                  <InfoRow
                    label1="官方網站"
                    val1={factory.website
                      ? (isValidUrl(factory.website)
                          ? <a href={factory.website.startsWith("http") ? factory.website : `https://${factory.website}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{factory.website}</a>
                          : factory.website)
                      : undefined}
                    label2="社群 / 外部連結"
                    val2={undefined}
                  />
                </CardContent>
              </Card>
            </section>

            {/* ── 聯絡資訊 ── */}
            <section id="section-contact" className="scroll-mt-20">
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-base">聯絡資訊</CardTitle>
                </CardHeader>
                <CardContent className="p-0 divide-y divide-border">
                  {(factory as any).contactPersonName && (
                    <div className="flex items-start gap-3 px-5 py-3">
                      <Building2 className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">聯絡窗口</p>
                        <p className="text-sm">{(factory as any).contactPersonName}</p>
                      </div>
                    </div>
                  )}
                  {factory.phone && (
                    <div className="flex items-start gap-3 px-5 py-3">
                      <Phone className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">聯絡電話</p>
                        <a href={`tel:${factory.phone.replace(/[\s\-\(\)]/g, "")}`} className="text-sm hover:underline">
                          {factory.phone}
                        </a>
                      </div>
                    </div>
                  )}
                  {(factory as any).address && (
                    <div className="flex items-start gap-3 px-5 py-3">
                      <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">工廠地址</p>
                        <p className="text-sm">{(factory as any).address}</p>
                      </div>
                    </div>
                  )}
                  {factory.website && (
                    <div className="flex items-start gap-3 px-5 py-3">
                      <Globe className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">官方網站</p>
                        {isValidUrl(factory.website) ? (
                          <a href={factory.website.startsWith("http") ? factory.website : `https://${factory.website}`}
                             target="_blank" rel="noopener noreferrer"
                             className="text-sm text-primary hover:underline break-all">
                            {factory.website}
                          </a>
                        ) : (
                          <p className="text-sm">{factory.website}</p>
                        )}
                      </div>
                    </div>
                  )}
                  {(factory as any).contactEmail && (
                    <div className="flex items-start gap-3 px-5 py-3">
                      <Send className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">聯絡信箱</p>
                        <a href={`mailto:${(factory as any).contactEmail}`} className="text-sm hover:underline break-all">
                          {(factory as any).contactEmail}
                        </a>
                      </div>
                    </div>
                  )}
                  {!(factory as any).contactPersonName && !factory.phone && !(factory as any).address && !factory.website && !(factory as any).contactEmail && (
                    <div className="px-5 py-6 text-center text-sm text-muted-foreground">尚未填寫聯絡資訊</div>
                  )}
                </CardContent>
              </Card>
            </section>

            {/* ── 工廠照片 ── */}
            {photos.length > 0 && (
              <section id="section-photos" className="scroll-mt-20">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Images className="w-4 h-4" />工廠照片
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {photos.map((photo, idx) => (
                        <div
                          key={photo.id}
                          className="aspect-square rounded-lg overflow-hidden bg-muted cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => setLightboxIndex(idx)}
                        >
                          <img src={photo.url} alt={photo.caption ?? ""} className="w-full h-full object-cover" loading="lazy" />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </section>
            )}

            {/* ── 商品 / 服務 ── */}
            <section id="section-products" className="scroll-mt-20">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Package className="w-4 h-4" />商品 / 服務
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {factory.products.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">此工廠尚未上架產品</p>
                  ) : (
                    <>
                      {categories.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-4">
                          {[{ id: "all" as const, name: "全部" }, ...categories].map(cat => (
                            <button
                              key={String(cat.id)}
                              onClick={() => setActiveCat(cat.id as any)}
                              className={`text-xs px-3 py-1 rounded-full border transition-colors ${activeCat === cat.id ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary"}`}
                            >
                              {cat.name}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="space-y-3">
                        {factory.products.filter((p: any) =>
                          activeCat === "all" || p.categoryId === activeCat
                        ).map((product: any) => (
                          <div key={product.id} className="p-4 rounded-lg border hover:bg-muted/30 transition-colors">
                            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                              <div className="flex gap-3 flex-1">
                                {product.images && (product.images as string[]).length > 0 && (
                                  <ProductImageCarousel
                                    images={product.images as string[]}
                                    onImageClick={(imgs, i) => { setPreviewImages(imgs); setPreviewIndex(i); }}
                                  />
                                )}
                                <div className="flex-1">
                                  <h4 className="font-medium mb-1">{product.name}</h4>
                                  {product.description && <p className="text-sm text-muted-foreground mb-2">{product.description}</p>}
                                  <div className="flex flex-wrap gap-3 text-sm">
                                    {(product.priceMin || product.priceMax) && (
                                      <span className="flex items-center gap-1 text-primary font-medium">
                                        <DollarSign className="w-3 h-3" />
                                        {product.priceMin && product.priceMax
                                          ? `${formatPrice(product.priceMin)} ~ ${formatPrice(product.priceMax)} 元`
                                          : product.priceMin ? `${formatPrice(product.priceMin)} 元起` : `最高 ${formatPrice(product.priceMax)} 元`}
                                      </span>
                                    )}
                                    <span className="flex items-center gap-1">
                                      {product.acceptSmallOrder ? <Check className="w-3 h-3 text-green-600" /> : <X className="w-3 h-3 text-red-500" />}
                                      {product.acceptSmallOrder ? "接受小量訂單" : "不接小量訂單"}
                                    </span>
                                    <span className="flex items-center gap-1">
                                      {product.provideSample ? <Check className="w-3 h-3 text-green-600" /> : <X className="w-3 h-3 text-red-500" />}
                                      {product.provideSample ? "提供打樣" : "不提供打樣"}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <Button variant="outline" size="sm" onClick={() => handleChat(product.id, product.name)} className="shrink-0">
                                <MessageCircle className="w-4 h-4 mr-1" />詢問此產品
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </section>

            {/* ── 顧客評價 ── */}
            <section id="section-reviews" className="scroll-mt-20">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Star className="w-4 h-4" />顧客評價
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {isAuthenticated && (
                    <div className="mb-6 p-4 rounded-lg bg-muted/30">
                      <h4 className="font-medium mb-1">
                        {myReview ? "您的評價（可修改）" : "留下您的評價"}
                      </h4>
                      {myReview && (
                        <p className="text-xs text-muted-foreground mb-3">
                          您已於 {new Date(myReview.createdAt).toLocaleDateString("zh-TW")} 評價過此工廠，可直接修改後送出。
                        </p>
                      )}
                      <div className="flex gap-1 mb-3">
                        {[1, 2, 3, 4, 5].map(s => (
                          <button
                            key={s}
                            onMouseEnter={() => setHoverRating(s)}
                            onMouseLeave={() => setHoverRating(0)}
                            onClick={() => setRating(s)}
                            className="p-0.5"
                          >
                            <Star className={`w-6 h-6 transition-colors ${(hoverRating || rating) >= s ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground/30"}`} />
                          </button>
                        ))}
                        {rating > 0 && <span className="ml-2 text-sm text-muted-foreground">{rating} 星</span>}
                      </div>
                      <Textarea
                        placeholder="分享您的合作經驗..."
                        value={comment}
                        onChange={e => setComment(e.target.value)}
                        className="mb-3"
                        rows={3}
                      />
                      <Button
                        disabled={rating === 0 || createReview.isPending || updateReview.isPending}
                        onClick={handleSubmitReview}
                      >
                        <Send className="w-4 h-4 mr-1" />
                        {createReview.isPending || updateReview.isPending ? "送出中..." : myReview ? "更新評價" : "送出評價"}
                      </Button>
                    </div>
                  )}
                  {!isAuthenticated && (
                    <div className="mb-6 p-4 rounded-lg bg-muted/30 text-center">
                      <p className="text-muted-foreground mb-2">登入後即可留下評價</p>
                      <Button size="sm" onClick={() => performLogin()}>登入</Button>
                    </div>
                  )}
                  <Separator className="mb-4" />
                  {reviewData?.items.length === 0 ? (
                    <p className="text-center text-muted-foreground py-6">尚無評價</p>
                  ) : (
                    <div className="space-y-4">
                      {(reviewData?.items.filter((r: any) => r.reviewType === "verified_order").length ?? 0) > 0 && (
                        <div className="flex items-center gap-1.5 text-sm text-orange-600 font-medium pb-1">
                          <CheckCircle className="w-4 h-4" />
                          已完成合作評價：{reviewData!.items.filter((r: any) => r.reviewType === "verified_order").length} 則
                        </div>
                      )}
                      {reviewData?.items.map((review: any) => {
                        const isVerified = review.reviewType === "verified_order";
                        return (
                          <div key={review.id} className={`p-4 rounded-lg border ${
                            isVerified ? "bg-amber-50 border-orange-200"
                            : review.userId === user?.id ? "border-primary/30 bg-primary/5"
                            : "border-border bg-white"
                          }`}>
                            <div className="flex items-start justify-between mb-2 gap-2 flex-wrap">
                              <div className="flex items-center gap-2 flex-wrap">
                                {isVerified ? (
                                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold bg-orange-100 text-orange-700 border border-orange-200">
                                    <CheckCircle className="w-3 h-3" />已完成合作
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600 border border-gray-200">
                                    一般評價
                                  </span>
                                )}
                                <span className="font-medium text-sm">
                                  {review.userName ?? "匿名使用者"}
                                  {review.userId === user?.id && <span className="ml-1 text-xs text-primary">（我的評價）</span>}
                                </span>
                                <div className="flex gap-0.5">
                                  {[1, 2, 3, 4, 5].map(s => (
                                    <Star key={s} className={`w-3.5 h-3.5 ${review.rating >= s ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground/20"}`} />
                                  ))}
                                </div>
                              </div>
                              <span className="text-xs text-muted-foreground shrink-0">
                                {new Date(review.createdAt).toLocaleDateString("zh-TW")}
                              </span>
                            </div>
                            {isVerified && review.projectName && (
                              <p className="text-xs mb-1.5 font-medium text-orange-700">合作項目：{review.projectName}</p>
                            )}
                            {review.comment && <p className="text-sm text-muted-foreground">{review.comment}</p>}
                            {review.reply && (
                              <div className="mt-2 pl-3 border-l-2 border-orange-200">
                                <p className="text-xs text-orange-700 font-medium mb-0.5">工廠回覆 {review.repliedAt ? `· ${new Date(review.repliedAt).toLocaleDateString("zh-TW")}` : ""}</p>
                                <p className="text-sm text-muted-foreground">{review.reply}</p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>

          </div>
        </div>

        {/* Lightbox */}
        {lightboxIndex !== null && (
          <div
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
            onClick={() => setLightboxIndex(null)}
          >
            <button
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white bg-black/40 rounded-full p-2 hover:bg-black/70"
              onClick={(e) => { e.stopPropagation(); setLightboxIndex(i => i !== null && i > 0 ? i - 1 : photos.length - 1); }}
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <div className="max-w-4xl max-h-[90vh] px-16" onClick={e => e.stopPropagation()}>
              <img src={photos[lightboxIndex].url} alt={photos[lightboxIndex].caption ?? ""} className="max-h-[80vh] max-w-full object-contain rounded" />
              {photos[lightboxIndex].caption && <p className="text-white text-center mt-2 text-sm">{photos[lightboxIndex].caption}</p>}
              <p className="text-white/50 text-center text-xs mt-1">{lightboxIndex + 1} / {photos.length}</p>
            </div>
            <button
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white bg-black/40 rounded-full p-2 hover:bg-black/70"
              onClick={(e) => { e.stopPropagation(); setLightboxIndex(i => i !== null && i < photos.length - 1 ? i + 1 : 0); }}
            >
              <ChevronRight className="w-6 h-6" />
            </button>
            <button className="absolute top-4 right-4 text-white" onClick={() => setLightboxIndex(null)}>
              <X className="w-6 h-6" />
            </button>
          </div>
        )}

        {/* Image preview modal */}
        {previewImages.length > 0 && (
          <div
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
            onClick={() => { setPreviewImages([]); setPreviewIndex(0); }}
          >
            <button
              className="absolute top-4 right-4 text-white bg-black/40 rounded-full p-2 hover:bg-black/70 z-10"
              onClick={() => { setPreviewImages([]); setPreviewIndex(0); }}
            >
              <X className="w-6 h-6" />
            </button>
            {previewImages.length > 1 && (
              <button
                className="absolute left-3 top-1/2 -translate-y-1/2 text-white bg-black/40 rounded-full p-2 hover:bg-black/70 z-10"
                onClick={(e) => { e.stopPropagation(); setPreviewIndex(i => (i - 1 + previewImages.length) % previewImages.length); }}
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
            )}
            <div className="max-w-[95vw] max-h-[90vh] flex flex-col items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <img src={previewImages[previewIndex]} alt="" className="max-w-[95vw] max-h-[85vh] object-contain rounded" />
              {previewImages.length > 1 && <p className="text-white/60 text-xs">{previewIndex + 1} / {previewImages.length}</p>}
            </div>
            {previewImages.length > 1 && (
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white bg-black/40 rounded-full p-2 hover:bg-black/70 z-10"
                onClick={(e) => { e.stopPropagation(); setPreviewIndex(i => (i + 1) % previewImages.length); }}
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            )}
          </div>
        )}

      </div>

      {/* 更新評價確認對話框 */}
      <AlertDialog open={showUpdateConfirm} onOpenChange={setShowUpdateConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確認更新評價？</AlertDialogTitle>
            <AlertDialogDescription>
              您之前給了 {myReview?.rating} 星，現在要改為 {rating} 星。
              更新後工廠的平均評分會重新計算，但仍只算您的一筆評價。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmUpdate}>確認更新</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 檢舉對話框 */}
      <AlertDialog open={showReportDialog} onOpenChange={setShowReportDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>檢舉此工廠</AlertDialogTitle>
            <AlertDialogDescription>
              請說明檢舉原因，我們會盡快審查並處理。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="請描述問題，例如：虛假資訊、詐騙行為、不當內容..."
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            rows={4}
            className="my-2"
          />
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setReportReason("")}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!reportReason.trim()) return;
                submitReport.mutate({ factoryId, reason: reportReason });
              }}
              disabled={!reportReason.trim() || submitReport.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {submitReport.isPending ? "送出中..." : "送出檢舉"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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