import { Helmet } from "react-helmet-async";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { useRoute, useLocation } from "wouter";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Star, MapPin, Phone, Globe, Calendar, Building2, DollarSign,
  MessageCircle, Package, Check, X, ArrowLeft, Send, Heart, Wrench, Factory as FactoryIcon, Flag, Clock, ChevronLeft, ChevronRight, Images
} from "lucide-react";

function ProductImageCarousel({ images }: { images: string[] }) {
  const [idx, setIdx] = useState(0);
  if (!images.length) return null;
  const prev = (e: React.MouseEvent) => { e.stopPropagation(); setIdx(i => (i - 1 + images.length) % images.length); };
  const next = (e: React.MouseEvent) => { e.stopPropagation(); setIdx(i => (i + 1) % images.length); };
  return (
    <div className="relative w-28 h-28 shrink-0 rounded-lg overflow-hidden bg-muted">
      <img src={images[idx]} alt="" className="w-full h-full object-cover" loading="lazy" />
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

  const { data: factory, isLoading } = trpc.factory.getById.useQuery({ id: factoryId }, { enabled: !!factoryId });
  const { data: reviewData } = trpc.review.getByFactory.useQuery({ factoryId, page: 1, pageSize: 10 }, { enabled: !!factoryId });
  const { data: isFavData } = trpc.favorite.isLiked.useQuery({ factoryId }, { enabled: !!factoryId && isAuthenticated });
  const { data: myReview } = trpc.review.getMyReviewForFactory.useQuery({ factoryId }, { enabled: !!factoryId && isAuthenticated });
  const { data: photos = [] } = trpc.factory.getPhotos.useQuery({ factoryId }, { enabled: !!factoryId });
  const { data: categories = [] } = trpc.category.getByFactory.useQuery({ factoryId }, { enabled: !!factoryId });

  const [isFav, setIsFav] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [activeCat, setActiveCat] = useState<number | null | "all">("all");

  // Review form
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [showUpdateConfirm, setShowUpdateConfirm] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const utils = trpc.useUtils();
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
    if (!isAuthenticated) { window.location.href = getLoginUrl(); return; }
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
    },
    onError: () => toast.error("操作失敗"),
  });

  const handleToggleFav = () => {
    if (!isAuthenticated) { window.location.href = getLoginUrl(); return; }
    toggleFav.mutate({ factoryId });
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
          <Button variant="link" onClick={() => navigate("/search")}>返回搜尋</Button>
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
  const moq = (factory as any).minOrderQuantity;
  const mfgMode = (factory as any).mfgMode;
  const descBase = factory.description
    ? factory.description.slice(0, 100)
    : `${factoryIndustry}代工廠，位於${factoryRegion}，提供優質 OEM / ODM 服務。`;
  const metaDesc = `${factory.name}｜${factoryRegion}${factoryIndustry}代工廠${mfgMode ? `，${mfgMode}` : ""}${moq ? `，最低訂購量 ${moq}` : ""}。${descBase}`;

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>{`${factory.name}｜${factoryIndustry}代工｜OXM`}</title>
        <meta name="description" content={metaDesc} />
      </Helmet>
      <Navbar />

      <div className="container py-6">
        <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate("/search")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> 返回搜尋
        </Button>

        {/* Factory Header */}
        <Card className="mb-6">
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <h1 className="text-2xl font-bold">{factory.name}</h1>
                  {(factory as any).businessType === "studio" ? (
                    <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100 border-0 text-xs">
                      <Wrench className="w-3 h-3 mr-1" />工作室
                    </Badge>
                  ) : (
                    <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100 border-0 text-xs">
                      <FactoryIcon className="w-3 h-3 mr-1" />代工廠
                    </Badge>
                  )}
                  {(factory as any).certified && (
                    <span className="inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                      ✓ 認證工廠
                    </span>
                  )}
                  {(!(factory as any).operationStatus || (factory as any).operationStatus === "normal") && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />接單中
                    </span>
                  )}
                  {(factory as any).operationStatus === "busy" && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 px-2 py-0.5 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />產線繁忙
                    </span>
                  )}
                  {(factory as any).operationStatus === "full" && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />產線滿載
                    </span>
                  )}
                  <div className="flex items-center gap-1 text-yellow-500">
                    <Star className="w-5 h-5 fill-current" />
                    <span className="font-semibold">{Number(factory.avgRating).toFixed(1)}</span>
                    <span className="text-sm text-muted-foreground">({factory.reviewCount} 則評價)</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mb-4">
                  {factoryIndustryArr.map(ind => <Badge key={ind}>{ind}</Badge>)}
                  {((factory as any).subIndustry as string[] | null)?.map(s => (
                    <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                  ))}
                  {(factory.mfgModes as string[]).map(m => (
                    <Badge key={m} variant="secondary">{m}</Badge>
                  ))}
                  <Badge variant="outline">{factory.capitalLevel}</Badge>
                </div>
                <p className="text-muted-foreground mb-4">{factory.description || "暫無簡介"}</p>

                <div className="grid sm:grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-muted-foreground" /><span>{factory.region}</span></div>
                  {(factory as any).address && <div className="flex items-center gap-2 sm:col-span-2"><MapPin className="w-4 h-4 text-muted-foreground shrink-0" /><span className="text-muted-foreground">{(factory as any).address}</span></div>}
                  {factory.foundedYear && <div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-muted-foreground" /><span>成立於 {factory.foundedYear} 年</span></div>}
                  {factory.ownerName && <div className="flex items-center gap-2"><Building2 className="w-4 h-4 text-muted-foreground" /><span>負責人：{factory.ownerName}</span></div>}
                  {factory.phone && <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-muted-foreground" /><span>{factory.phone}</span></div>}
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <span>{(() => {
                      const h = parseFloat((factory as any).avgResponseHours ?? "");
                      if (isNaN(h)) return "回覆時間未知";
                      if (h < 2) return "通常 2 小時內回覆";
                      if (h < 24) return "通常 24 小時內回覆";
                      return "回覆時間較長";
                    })()}</span>
                  </div>
                  {factory.website && (
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-muted-foreground" />
                      {isValidUrl(factory.website) ? (
                        <a href={factory.website.startsWith("http") ? factory.website : `https://${factory.website}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">
                          {factory.website}
                        </a>
                      ) : (
                        <span className="text-muted-foreground truncate">{factory.website}</span>
                      )}
                    </div>
                  )}
                  {((factory as any).weekdayHours || (factory as any).weekendHours || (factory as any).businessNote) && (
                    <div className="flex items-start gap-2 sm:col-span-2">
                      <Clock className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        {(factory as any).weekdayHours && <p>平日：{(factory as any).weekdayHours}</p>}
                        {(factory as any).weekendHours && <p>假日：{(factory as any).weekendHours}</p>}
                        {(factory as any).businessNote && <p className="text-muted-foreground text-xs mt-0.5">{(factory as any).businessNote}</p>}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-2 shrink-0 flex-wrap">
                <Button size="lg" onClick={() => handleChat()}>
                  <MessageCircle className="w-5 h-5 mr-2" />
                  聯繫工廠
                </Button>
                <Button size="lg" variant={isFav ? "default" : "outline"} onClick={handleToggleFav} disabled={toggleFav.isPending}>
                  <Heart className={`w-5 h-5 mr-2 ${isFav ? "fill-current" : ""}`} />
                  {isFav ? "已收藏" : "收藏"}
                </Button>
                {isAuthenticated && (
                  <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setShowReportDialog(true)}>
                    <Flag className="w-4 h-4 mr-1" />
                    檢舉
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Photo Gallery */}
        {photos.length > 0 && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Images className="w-5 h-5" />
                工廠照片
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
                    <img src={photo.url} alt={photo.caption ?? ""} className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

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
              {photos[lightboxIndex].caption && (
                <p className="text-white text-center mt-2 text-sm">{photos[lightboxIndex].caption}</p>
              )}
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

        {/* Products */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="w-5 h-5" />
              產品列表
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
                          <ProductImageCarousel images={product.images as string[]} />
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
                        <MessageCircle className="w-4 h-4 mr-1" />
                        詢問此產品
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Reviews */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Star className="w-5 h-5" />
              顧客評價
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Review Form */}
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
                  {createReview.isPending || updateReview.isPending
                    ? "送出中..."
                    : myReview ? "更新評價" : "送出評價"}
                </Button>
              </div>
            )}

            {!isAuthenticated && (
              <div className="mb-6 p-4 rounded-lg bg-muted/30 text-center">
                <p className="text-muted-foreground mb-2">登入後即可留下評價</p>
                <a href={getLoginUrl()}><Button size="sm">登入</Button></a>
              </div>
            )}

            <Separator className="mb-4" />

            {/* Review List */}
            {reviewData?.items.length === 0 ? (
              <p className="text-center text-muted-foreground py-6">尚無評價</p>
            ) : (
              <div className="space-y-4">
                {reviewData?.items.map((review: any) => (
                  <div key={review.id} className={`p-4 rounded-lg border ${review.userId === user?.id ? "border-primary/30 bg-primary/5" : ""}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">
                          {review.userName ?? "匿名使用者"}
                          {review.userId === user?.id && (
                            <span className="ml-1 text-xs text-primary">（我的評價）</span>
                          )}
                        </span>
                        <div className="flex gap-0.5">
                          {[1, 2, 3, 4, 5].map(s => (
                            <Star key={s} className={`w-3.5 h-3.5 ${review.rating >= s ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground/20"}`} />
                          ))}
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(review.createdAt).toLocaleDateString("zh-TW")}
                      </span>
                    </div>
                    {review.comment && <p className="text-sm text-muted-foreground">{review.comment}</p>}
                    {/* 工廠回覆 */}
                    {review.reply && (
                      <div className="mt-2 pl-3 border-l-2 border-orange-200">
                        <p className="text-xs text-orange-700 font-medium mb-0.5">工廠回覆 {review.repliedAt ? `· ${new Date(review.repliedAt).toLocaleDateString("zh-TW")}` : ""}</p>
                        <p className="text-sm text-muted-foreground">{review.reply}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
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
      {/* Floating Chat Button */}
      <button
        onClick={() => handleChat()}
        className="fixed bottom-6 right-6 w-14 h-14 bg-primary text-primary-foreground rounded-full shadow-lg hover:shadow-xl transition-all flex items-center justify-center z-50 hover:scale-105"
        title="聯繫工廠"
      >
        <MessageCircle className="w-6 h-6" />
      </button>
    </div>
  );
}