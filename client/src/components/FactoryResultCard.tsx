import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { useState, useEffect } from "react";
import { Star, MapPin, Factory, Heart, Wrench, Plus, Minus } from "lucide-react";
import { isNativeApp } from "@/lib/platform";
import { performLogin } from "@/const";
import { toast } from "sonner";
import { BadgeRow } from "@/components/badges/BadgeRow";

// 這個元件是 Search.tsx 與 FactoryDashboard「預覽搜尋卡片」的唯一共用實作 ——
// 後台預覽必須跟正式搜尋結果卡片長得完全一樣，不能各自維護第二套樣式。

export type CartItem = { id: number; name: string };

function FavButton({ factoryId, initialIsFav, onToggle, previewMode }: {
  factoryId: number;
  initialIsFav: boolean;
  onToggle: (factoryId: number, newState: boolean) => void;
  previewMode?: boolean;
}) {
  const { isAuthenticated } = useAuth();
  const [isFav, setIsFav] = useState(initialIsFav);

  useEffect(() => {
    setIsFav(initialIsFav);
  }, [initialIsFav]);

  const toggleFav = trpc.favorite.toggle.useMutation({
    onSuccess: (data) => {
      setIsFav(data.isFavorited);
      onToggle(factoryId, data.isFavorited);
      toast.success(data.isFavorited ? "已加入收藏" : "已取消收藏");
    },
    onError: () => toast.error("操作失敗"),
  });

  const handleToggleFav = (e: React.MouseEvent) => {
    e.preventDefault();
    if (previewMode) return;
    if (!isAuthenticated) { performLogin(); return; }
    toggleFav.mutate({ factoryId });
  };

  return (
    <Button size="sm" variant={isFav ? "default" : "outline"} onClick={handleToggleFav} disabled={previewMode || toggleFav.isPending}>
      <Heart className={`w-4 h-4 ${isFav ? "fill-current" : ""}`} />
    </Button>
  );
}

function useImageAspectRatio(url: string | null | undefined): number | null {
  const [ratio, setRatio] = useState<number | null>(null);
  useEffect(() => {
    if (!url) { setRatio(null); return; }
    const img = new window.Image();
    img.onload = () => {
      if (img.naturalHeight > 0) setRatio(img.naturalWidth / img.naturalHeight);
    };
    img.onerror = () => setRatio(null);
    img.src = url;
  }, [url]);
  return ratio;
}

export type FactoryCardProps = {
  factory: any;
  getFavState: (id: number) => boolean;
  handleFavToggle: (id: number, newState: boolean) => void;
  cartHas: (id: number) => boolean;
  cartAdd: (item: CartItem) => void;
  cartRemove: (id: number) => void;
  setCartOpen: (open: boolean) => void;
  isMobile: boolean;
  /** 後台「預覽搜尋卡片」模式：不導頁、不觸發收藏／詢價等任何副作用 */
  previewMode?: boolean;
};

export function FactoryCard({ factory, getFavState, handleFavToggle, cartHas, cartAdd, cartRemove, setCartOpen, isMobile, previewMode }: FactoryCardProps) {
  const avatarUrl = factory.avatarUrl as string | null | undefined;
  const ratio = useImageAspectRatio(avatarUrl);
  const isWide = avatarUrl && ratio !== null && ratio >= 2.2;

  const cartButton = (
    <div className="px-4 pt-2 pb-2 shrink-0" onClick={e => e.preventDefault()}>
      <Button
        size="sm"
        variant={cartHas(factory.id) ? "default" : "outline"}
        className="w-full text-sm h-9"
        disabled={previewMode}
        onClick={e => {
          e.preventDefault();
          e.stopPropagation();
          if (previewMode) return;
          if (cartHas(factory.id)) {
            cartRemove(factory.id);
          } else {
            cartAdd({ id: factory.id, name: factory.name });
            setCartOpen(true);
            toast.success(`已加入一鍵詢價：${factory.name}`);
          }
        }}
      >
        {cartHas(factory.id) ? (
          <><Minus className="w-3.5 h-3.5 mr-1" />已加入詢價</>
        ) : (
          <><Plus className="w-3.5 h-3.5 mr-1" />加入一鍵詢價</>
        )}
      </Button>
    </div>
  );

  const cardBody = (
    <Card className={`hover:shadow-md transition-shadow h-full overflow-hidden flex flex-col ${previewMode ? "" : "cursor-pointer"}`}>
      {isWide ? (
        <>
          <div className="relative h-28 shrink-0 bg-orange-50/40 flex items-center justify-center p-3 overflow-hidden">
            <img src={avatarUrl!} alt={factory.name} className="w-full h-full object-contain" loading="lazy" />
            <div className="absolute top-2 right-2" onClick={(e) => e.preventDefault()}>
              <FavButton factoryId={factory.id} initialIsFav={getFavState(factory.id)} onToggle={handleFavToggle} previewMode={previewMode} />
            </div>
          </div>
          <div className="flex-1 min-h-0 p-4 flex flex-col">
            <FactoryCardContent factory={factory} isMobile={isMobile} />
          </div>
          {cartButton}
        </>
      ) : (
        <>
          <div className="flex flex-1 min-h-0 flex-col md:flex-row">
            <div className="relative h-32 md:h-auto md:w-[145px] shrink-0 bg-orange-50/40 flex items-center justify-center p-3">
              {avatarUrl ? (
                <img src={avatarUrl} alt={factory.name} className="max-h-full max-w-full object-contain" loading="lazy" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  {factory.businessType === "studio"
                    ? <Wrench className="w-12 h-12 text-purple-200" />
                    : <Factory className="w-12 h-12 text-orange-200" />}
                </div>
              )}
              <div className="absolute top-2 right-2" onClick={(e) => e.preventDefault()}>
                <FavButton factoryId={factory.id} initialIsFav={getFavState(factory.id)} onToggle={handleFavToggle} previewMode={previewMode} />
              </div>
            </div>
            <div className="flex-1 min-w-0 min-h-0 p-4 flex flex-col">
              <FactoryCardContent factory={factory} isMobile={isMobile} />
            </div>
          </div>
          {cartButton}
        </>
      )}
    </Card>
  );

  if (previewMode) {
    return <div className="h-full">{cardBody}</div>;
  }

  return (
    <div className="h-full">
      <Link href={`/factory/${factory.id}`} className="block h-full">
        {cardBody}
      </Link>
    </div>
  );
}

function FactoryCardContent({ factory, isMobile }: { factory: any; isMobile: boolean }) {
  const phoneClickable = isMobile || isNativeApp();
  const displayContact =
    (factory.contactPersonName as string | null)?.trim() ||
    (factory.ownerName as string | null)?.trim() ||
    "無";
  const mfgModes: string[] = Array.isArray(factory.mfgModes) ? factory.mfgModes : [];
  const serviceType = mfgModes.length > 0 ? mfgModes.join("、") : "無";
  const hoursStr =
    factory.weekdayHours || factory.weekendHours
      ? [
          factory.weekdayHours ? `平日 ${factory.weekdayHours}` : null,
          factory.weekendHours ? `假日 ${factory.weekendHours}` : null,
        ].filter(Boolean).join("／")
      : "無";
  const certificationBadges: string[] = Array.isArray(factory.certificationBadges) ? factory.certificationBadges : [];

  return (
    <>
      {/* 徽章列 — 獨立窄列在最上方，向右排列，不與名稱／評分共用同一行避免擠壓 */}
      {certificationBadges.length > 0 && (
        <div className="shrink-0 mb-1.5">
          <BadgeRow badgeIds={certificationBadges} maxVisible={isMobile ? 3 : 5} size={20} />
        </div>
      )}

      {/* 標題區 */}
      <div className="flex items-start justify-between shrink-0">
        <div className="flex-1 min-w-0 mr-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="font-semibold text-lg leading-tight">{factory.name}</h3>
            {factory.operationStatus === "busy" && (
              <span className="inline-flex items-center gap-1 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 px-2 py-0.5 rounded-full shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />產線繁忙
              </span>
            )}
            {factory.operationStatus === "full" && (
              <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />產線滿載
              </span>
            )}
            {(!factory.operationStatus || factory.operationStatus === "normal") && (
              <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />接單中
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 text-yellow-500 shrink-0">
          <Star className="w-4 h-4 fill-current" />
          <span className="font-medium text-sm">{Number(factory.avgRating).toFixed(1)}</span>
          <span className="text-xs text-muted-foreground">({factory.reviewCount})</span>
        </div>
      </div>

      {/* 自我介紹區 - flex-1 吃掉剩餘空間，line-clamp-6 防止溢出 */}
      <div className="mt-2 flex-1 min-h-0">
        {(factory.description as string | null) ? (
          <p className="text-sm leading-5 text-muted-foreground whitespace-pre-line line-clamp-6">
            {factory.description as string}
          </p>
        ) : null}
      </div>

      {/* 基本資料區 - shrink-0 固定在底部 */}
      <div className="shrink-0 mt-3 pt-3 border-t border-border/50 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        {/* 列1：位置 | 成立年份 */}
        <span className="flex items-center gap-1 min-w-0">
          <MapPin className="w-3 h-3 shrink-0" />
          <span className="truncate">位置：{factory.region || "無"}</span>
        </span>
        <span className="min-w-0 truncate">成立年份：{factory.foundedYear ? `${factory.foundedYear} 年` : "無"}</span>

        {/* 列2：地址（整行，完整顯示） */}
        <span className="sm:col-span-2 min-w-0 whitespace-normal break-words">
          地址：{factory.address || "無"}
        </span>

        {/* 列3：聯絡人 | 聯絡電話 */}
        <span className="min-w-0 truncate">聯絡人：{displayContact}</span>
        <span className="min-w-0">
          聯絡電話：{factory.phone
            ? (phoneClickable
              ? <a href={`tel:${(factory.phone as string).replace(/[\s\-\(\)]/g, "")}`} onClick={e => e.stopPropagation()} className="underline underline-offset-2">{factory.phone}</a>
              : <span>{factory.phone}</span>)
            : "無"
          }
        </span>

        {/* 列4：服務類型 | 官方網站 */}
        <span className="min-w-0">服務類型：{serviceType}</span>
        <span className="min-w-0">
          官方網站：{factory.website
            ? <a href={factory.website as string} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline" onClick={e => e.stopPropagation()}>連結</a>
            : "無"
          }
        </span>

        {/* 列5：營業時間（整行） */}
        <span className="sm:col-span-2 min-w-0 whitespace-normal break-words">
          營業時間：{hoursStr}
        </span>
      </div>
    </>
  );
}
