import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { performLogin } from "@/const";
import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  Star, MapPin, Phone, Globe, Building2, DollarSign,
  MessageCircle, Package, Check, X, Send, Heart, Wrench, Factory as FactoryIcon, Flag, ChevronLeft, ChevronRight, Images, CheckCircle, Share2
} from "lucide-react";
import LoginDialog from "@/components/LoginDialog";
import { sortBadgeIds, CERTIFICATION_BADGE_MAP } from "@shared/badges";
import { BadgeIcon } from "@/components/badges/BadgeIcon";
import { CroppedImage } from "@/components/CroppedImage";
import type { ImageCropData } from "@shared/imageCrop";

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

function ProductImageCarousel({ images, imageCrops, onImageClick }: { images: string[]; imageCrops?: (ImageCropData | null)[]; onImageClick?: (images: string[], index: number) => void }) {
  const [idx, setIdx] = useState(0);
  if (!images.length) return null;
  const prev = (e: React.MouseEvent) => { e.stopPropagation(); setIdx(i => (i - 1 + images.length) % images.length); };
  const next = (e: React.MouseEvent) => { e.stopPropagation(); setIdx(i => (i + 1) % images.length); };
  return (
    <div className="relative w-28 h-28 shrink-0 rounded-lg overflow-hidden bg-muted">
      <div
        className={`w-full h-full ${onImageClick ? "cursor-pointer" : ""}`}
        onClick={(e) => { e.stopPropagation(); onImageClick?.(images, idx); }}
      >
        <CroppedImage src={images[idx]} crop={imageCrops?.[idx] ?? null} loading="lazy" />
      </div>
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

export interface FactoryDetailViewFactory {
  id: number;
  name: string;
  description?: string | null;
  avatarUrl?: string | null;
  avatarCrop?: ImageCropData | null;
  coverImageUrl?: string | null;
  coverCrop?: ImageCropData | null;
  businessType?: string | null;
  operationStatus?: string | null;
  industry?: string[] | string | null;
  subIndustry?: string[] | null;
  mfgModes?: string[] | null;
  region?: string | null;
  ownerName?: string | null;
  contactPersonName?: string | null;
  phone?: string | null;
  website?: string | null;
  contactEmail?: string | null;
  address?: string | null;
  weekdayHours?: string | null;
  weekendHours?: string | null;
  businessNote?: string | null;
  capitalLevel?: string | null;
  foundedYear?: number | null;
  avgRating?: string | number | null;
  reviewCount?: number | null;
  avgResponseHours?: string | number | null;
  /** 已獲得且選擇公開顯示的徽章（見 shared/badges.ts 的 stripHiddenBadgesForPublic／
   *  summarizeCertificationEvidenceForOwner）——公開頁與預覽一律讀這個欄位，
   *  不會、也不該讀到擁有但隱藏、或待審中的徽章。 */
  certificationBadgesVisible?: string[] | null;
  products: any[];
}

interface FactoryDetailViewProps {
  factory: FactoryDetailViewFactory;
  photos: { id: number | string; url: string; caption?: string | null }[];
  categories: { id: number; name: string }[];
  reviewData: { items: any[] } | undefined;
  myReview?: any | null;
  isAuthenticated: boolean;
  user?: { id: number } | null;
  isFav?: boolean;
  favPending?: boolean;
  reviewSubmitPending?: boolean;
  reportPending?: boolean;
  /**
   * "public"（預設）＝正式 /factory/:id 頁；"preview"＝工廠管理後台的預覽彈窗。
   * 兩種模式渲染完全相同的區塊與內容，唯一差異是 preview 停用所有會送出資料、
   * 觸發導頁或開啟圖片操作 UI 的互動——只保留捲動與（由外層彈窗負責的）關閉。
   */
  mode?: "public" | "preview";
  onChat?: (productId?: number, productName?: string) => void;
  onToggleFav?: () => void;
  onShare?: () => void;
  onSubmitCreateReview?: (rating: number, comment: string) => void;
  onSubmitUpdateReview?: (rating: number, comment: string) => void;
  /** May return a Promise — on resolve the report dialog closes and the reason field
   *  clears (matching pre-refactor behavior where this only happened in the mutation's
   *  onSuccess); on rejection the dialog stays open so the user can retry. */
  onSubmitReport?: (reason: string) => void | Promise<unknown>;
  /** Fires when the lightbox / report dialog opens or closes — lets the host page
   *  suspend pull-to-refresh while an overlay is up, matching pre-refactor behavior. */
  onOverlayOpenChange?: (open: boolean) => void;
}

export function FactoryDetailView({
  factory,
  photos,
  categories,
  reviewData,
  myReview,
  isAuthenticated,
  user,
  isFav = false,
  favPending = false,
  reviewSubmitPending = false,
  reportPending = false,
  mode = "public",
  onChat,
  onToggleFav,
  onShare,
  onSubmitCreateReview,
  onSubmitUpdateReview,
  onSubmitReport,
  onOverlayOpenChange,
}: FactoryDetailViewProps) {
  const isPreview = mode === "preview";
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [activeCat, setActiveCat] = useState<number | null | "all">("all");

  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [showUpdateConfirm, setShowUpdateConfirm] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);

  useEffect(() => {
    if (myReview) {
      setRating(myReview.rating);
      setComment(myReview.comment ?? "");
    }
  }, [myReview]);

  useEffect(() => {
    onOverlayOpenChange?.(lightboxIndex !== null || showReportDialog);
  }, [lightboxIndex, showReportDialog, onOverlayOpenChange]);

  const [activeSection, setActiveSection] = useState("section-basic");
  const activeSectionRef = useRef("section-basic");

  useEffect(() => {
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
  }, [factory.id]);

  const handleChatClick = (productId?: number, productName?: string) => {
    if (!isAuthenticated) { setLoginDialogOpen(true); return; }
    if (isPreview) return;
    onChat?.(productId, productName);
  };

  const handleToggleFavClick = () => {
    if (!isAuthenticated) { performLogin(); return; }
    if (isPreview) return;
    onToggleFav?.();
  };

  const handleShareClick = () => {
    if (isPreview) return;
    onShare?.();
  };

  const handleSubmitReviewClick = () => {
    if (rating === 0) return;
    if (myReview) { setShowUpdateConfirm(true); return; }
    if (isPreview) return;
    onSubmitCreateReview?.(rating, comment);
  };

  const handleConfirmUpdateClick = () => {
    if (!myReview) return;
    setShowUpdateConfirm(false);
    if (isPreview) return;
    onSubmitUpdateReview?.(rating, comment);
  };

  const handleSubmitReportClick = async () => {
    if (!reportReason.trim()) return;
    if (isPreview) { setShowReportDialog(false); setReportReason(""); return; }
    try {
      await onSubmitReport?.(reportReason);
      // 與原本 mutation onSuccess 行為一致：只有送出成功才關閉對話框並清空原因，
      // 失敗時維持開啟讓使用者可以重試（錯誤訊息由呼叫端 mutation 的 onError 顯示）。
      setShowReportDialog(false);
      setReportReason("");
    } catch {
      // onError 已由呼叫端處理 toast，這裡只是避免未處理的 rejection
    }
  };

  // 預覽模式下，電話／網站／信箱一律只顯示文字，不渲染成可點擊連結——避免
  // 觸控／點擊時被瀏覽器直接導去 tel:／mailto:／外部網站，離開預覽畫面。
  const renderTel = (phone: string, className: string) =>
    isPreview ? <span className={className}>{phone}</span>
      : <a href={`tel:${phone.replace(/[\s\-\(\)]/g, "")}`} className={className}>{phone}</a>;
  const renderWebsite = (site: string, className: string) =>
    isPreview ? <span className={className}>{site}</span>
      : <a href={site.startsWith("http") ? site : `https://${site}`} target="_blank" rel="noopener noreferrer" className={className}>{site}</a>;
  const renderMailto = (email: string, className: string) =>
    isPreview ? <span className={className}>{email}</span>
      : <a href={`mailto:${email}`} className={className}>{email}</a>;

  const factoryIndustryArr: string[] = (() => {
    const raw = factory.industry;
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string' && raw) return [raw];
    return [];
  })();
  const factoryIndustry = factoryIndustryArr.join("、");
  const factorySubIndustryArr: string[] = Array.isArray(factory.subIndustry) ? factory.subIndustry : [];
  const factoryMfgModes: string[] = Array.isArray(factory.mfgModes) ? factory.mfgModes : [];

  const factoryBadgeIds = sortBadgeIds((factory.certificationBadgesVisible ?? []) as string[]);

  const tocItems = [
    { id: "section-basic", label: "基本資料" },
    ...(factoryBadgeIds.length > 0 ? [{ id: "section-badges", label: "徽章與認證" }] : []),
    { id: "section-contact", label: "聯絡資訊" },
    ...(photos.length > 0 ? [{ id: "section-photos", label: "工廠照片" }] : []),
    { id: "section-products", label: "商品 / 服務" },
    { id: "section-reviews", label: "評價" },
  ];

  return (
    <>
      <Navbar />

      {/* ── Cover image — full-width on mobile, max-w-7xl centered on desktop ── */}
      <div className="w-full lg:max-w-7xl lg:mx-auto">
        <div className="relative overflow-hidden aspect-[16/5] lg:rounded-b-xl">
          {factory.coverImageUrl ? (
            <CroppedImage
              src={factory.coverImageUrl}
              crop={factory.coverCrop}
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
            className={`w-20 h-20 md:w-24 md:h-24 rounded-2xl border-4 border-white shadow-lg bg-white overflow-hidden shrink-0 -mt-10 md:-mt-12 ${factory.avatarUrl && !isPreview ? "cursor-pointer hover:opacity-90 transition-opacity" : ""}`}
            onClick={() => { if (factory.avatarUrl && !isPreview) { setPreviewImages([factory.avatarUrl]); setPreviewIndex(0); } }}
          >
            {factory.avatarUrl ? (
              <CroppedImage src={factory.avatarUrl} crop={factory.avatarCrop} alt={factory.name} loading="eager" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                {factory.businessType === "studio"
                  ? <Wrench className="w-8 h-8 text-purple-200" />
                  : <FactoryIcon className="w-8 h-8 text-orange-200" />}
              </div>
            )}
          </div>

          {/* Center: name + description */}
          <div className="flex-1 min-w-0 sm:pt-1">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <h1 className="text-xl md:text-2xl font-bold leading-tight">{factory.name}</h1>
            </div>
            {factory.description && (
              <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                {normalizeDescription(factory.description)}
              </p>
            )}
          </div>

          {/* Right: action buttons */}
          <div className="flex gap-2 shrink-0 flex-wrap">
            <Button onClick={() => handleChatClick()} disabled={isPreview}>
              <MessageCircle className="w-4 h-4 mr-1.5" />聯繫工廠
            </Button>
            <Button variant={isFav ? "default" : "outline"} onClick={handleToggleFavClick} disabled={isPreview || favPending}>
              <Heart className={`w-4 h-4 mr-1.5 ${isFav ? "fill-current" : ""}`} />
              {isFav ? "已收藏" : "收藏"}
            </Button>
            <Button variant="outline" onClick={handleShareClick} disabled={isPreview}>
              <Share2 className="w-4 h-4 mr-1.5" />分享
            </Button>
            {isAuthenticated && (
              <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setShowReportDialog(true)} disabled={isPreview}>
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
                    val1={factory.businessType === "studio" ? "工作室" : "工廠"}
                    label2="接單狀態"
                    val2={(() => {
                      const st = factory.operationStatus;
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
                    val2={factory.contactPersonName}
                  />
                  {/* Row 5 */}
                  <InfoRow
                    label1="聯絡電話"
                    val1={factory.phone
                      ? renderTel(factory.phone, "hover:underline underline-offset-2")
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
                    val1={factory.address}
                    label2="營業時間"
                    val2={factory.weekdayHours}
                  />
                  {/* Row 9 */}
                  <InfoRow
                    label1="休假日"
                    val1={factory.weekendHours}
                    label2="休假日其他說明"
                    val2={factory.businessNote}
                  />
                  {/* Row 10 */}
                  <InfoRow
                    label1="回覆時間"
                    val1={(() => {
                      const h = parseFloat(String(factory.avgResponseHours ?? ""));
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
                          ? renderWebsite(factory.website, "text-primary hover:underline break-all")
                          : factory.website)
                      : undefined}
                    label2="社群 / 外部連結"
                    val2={undefined}
                  />
                </CardContent>
              </Card>
            </section>

            {/* ── 徽章與認證：只顯示公開徽章清單與通用說明，絕不顯示工廠私密證明資料 ── */}
            {factoryBadgeIds.length > 0 && (
              <section id="section-badges" className="scroll-mt-20">
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-base">徽章與認證</CardTitle>
                  </CardHeader>
                  <CardContent className="grid sm:grid-cols-2 gap-3 pt-2">
                    {factoryBadgeIds.map(id => {
                      const def = CERTIFICATION_BADGE_MAP[id];
                      if (!def) return null;
                      return (
                        <div key={id} className="flex items-start gap-3 p-3 rounded-lg border">
                          <BadgeIcon badgeId={id} size={36} />
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{def.name}</p>
                            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{def.description}</p>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              </section>
            )}

            {/* ── 聯絡資訊 ── */}
            <section id="section-contact" className="scroll-mt-20">
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-base">聯絡資訊</CardTitle>
                </CardHeader>
                <CardContent className="p-0 divide-y divide-border">
                  {factory.contactPersonName && (
                    <div className="flex items-start gap-3 px-5 py-3">
                      <Building2 className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">聯絡窗口</p>
                        <p className="text-sm">{factory.contactPersonName}</p>
                      </div>
                    </div>
                  )}
                  {factory.phone && (
                    <div className="flex items-start gap-3 px-5 py-3">
                      <Phone className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">聯絡電話</p>
                        {renderTel(factory.phone, "text-sm hover:underline")}
                      </div>
                    </div>
                  )}
                  {factory.address && (
                    <div className="flex items-start gap-3 px-5 py-3">
                      <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">工廠地址</p>
                        <p className="text-sm">{factory.address}</p>
                      </div>
                    </div>
                  )}
                  {factory.website && (
                    <div className="flex items-start gap-3 px-5 py-3">
                      <Globe className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">官方網站</p>
                        {isValidUrl(factory.website) ? (
                          renderWebsite(factory.website, "text-sm text-primary hover:underline break-all")
                        ) : (
                          <p className="text-sm">{factory.website}</p>
                        )}
                      </div>
                    </div>
                  )}
                  {factory.contactEmail && (
                    <div className="flex items-start gap-3 px-5 py-3">
                      <Send className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">聯絡信箱</p>
                        {renderMailto(factory.contactEmail, "text-sm hover:underline break-all")}
                      </div>
                    </div>
                  )}
                  {!factory.contactPersonName && !factory.phone && !factory.address && !factory.website && !factory.contactEmail && (
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
                          className={`aspect-square rounded-lg overflow-hidden bg-muted transition-opacity ${isPreview ? "" : "cursor-pointer hover:opacity-90"}`}
                          onClick={() => { if (!isPreview) setLightboxIndex(idx); }}
                        >
                          <CroppedImage src={photo.url} crop={(photo as any).crop ?? null} alt={photo.caption ?? ""} loading="lazy" />
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
                          <div key={product.id} className="p-4 rounded-lg border hover:bg-muted/30 transition-colors min-w-0">
                            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                              <div className="flex gap-3 flex-1 min-w-0">
                                {product.images && (product.images as string[]).length > 0 && (
                                  <ProductImageCarousel
                                    images={product.images as string[]}
                                    imageCrops={product.imageCrops as (ImageCropData | null)[] | undefined}
                                    onImageClick={isPreview ? undefined : (imgs, i) => { setPreviewImages(imgs); setPreviewIndex(i); }}
                                  />
                                )}
                                <div className="flex-1 min-w-0">
                                  <h4 className="font-medium mb-1 break-words">{product.name}</h4>
                                  {product.description && (
                                    <p className="text-sm text-muted-foreground mb-2 whitespace-pre-wrap break-words">{product.description}</p>
                                  )}
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
                              <Button variant="outline" size="sm" onClick={() => handleChatClick(product.id, product.name)} className="shrink-0" disabled={isPreview}>
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
                        disabled={rating === 0 || reviewSubmitPending || isPreview}
                        onClick={handleSubmitReviewClick}
                      >
                        <Send className="w-4 h-4 mr-1" />
                        {reviewSubmitPending ? "送出中..." : myReview ? "更新評價" : "送出評價"}
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
            <AlertDialogAction onClick={handleConfirmUpdateClick}>確認更新</AlertDialogAction>
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
              onClick={handleSubmitReportClick}
              disabled={!reportReason.trim() || reportPending || isPreview}
              className="bg-destructive hover:bg-destructive/90"
            >
              {reportPending ? "送出中..." : "送出檢舉"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LoginDialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen} />
    </>
  );
}
