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
import { BadgeRibbon } from "@/components/badges/BadgeRibbon";
import { CroppedImage } from "@/components/CroppedImage";
import type { ImageCropData } from "@shared/imageCrop";

// 這個元件是搜尋結果工廠卡片的共用實作，供 Search.tsx／我的收藏／近期瀏覽等頁面使用。
// （工廠管理後台的「預覽工廠頁面」改為使用 FactoryDetailView 呈現完整公開頁，不再用這個卡片元件。）

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
  /**
   * Phase 6 UI Foundation（見對話中「哪些工廠會被套上橘框」與「為什麼一般
   * /search 永遠不會出現橘框」）：只有從 OXM AI 的「查看完整搜尋結果」進來、
   * 且 server 端真的驗證出這家工廠這次是 AI 排序 tier===2 時才會是 true——
   * 一般搜尋／訪客／手動打關鍵字一律是 undefined／false，不會出現橘框，這個
   * 元件本身不做任何猜測或判斷，完全信任呼叫端傳進來的值。
   */
  aiHighlighted?: boolean;
};

export function FactoryCard({ factory, getFavState, handleFavToggle, cartHas, cartAdd, cartRemove, setCartOpen, isMobile, previewMode, aiHighlighted }: FactoryCardProps) {
  const avatarUrl = factory.avatarUrl as string | null | undefined;
  // 工廠頭貼／Logo 全站統一用同一份 avatarCrop、統一 1:1 顯示範圍（見
  // FactoryDashboard.tsx 的編輯器／FactoryDetailView 的公開頁頭貼），不再用
  // 依圖片原始比例動態切換版面的 isWide 特例——那是舊版「只能 object-contain、
  // 完全無法裁切」架構下的權宜設計；現在工廠主已經能在編輯器裡自行決定寬版
  // Logo 要在 1:1 視窗裡顯示哪一段，不需要卡片再猜一次版面。
  const avatarCrop = (factory.avatarCrop ?? null) as ImageCropData | null;

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

  // 已獲得且選擇公開顯示的徽章（見 shared/badges.ts 的 stripHiddenBadgesForPublic，
  // 公開搜尋 API 只會回傳這個欄位，不含擁有但隱藏／待審的徽章或任何證明資料）。
  const visibleBadgeIds: string[] = Array.isArray(factory.certificationBadgesVisible) ? factory.certificationBadgesVisible : [];

  // 卡片本身不能再用 overflow-hidden（會把跨越上邊界的緞帶勳章切掉），改成
  // 圖片各自的容器自己 overflow-hidden + 對應圓角，視覺上仍是方正的圖片角。
  const cardBody = (
    <Card className={`hover:shadow-md transition-shadow h-full flex flex-col overflow-visible ${previewMode ? "" : "cursor-pointer"} ${aiHighlighted ? "border-2 border-orange-400 ring-1 ring-orange-200" : ""}`}>
      <div className="flex flex-1 min-h-0 flex-row overflow-hidden rounded-xl">
        {/* 頭貼／Logo：固定正方形容器，與編輯器 aspectRatio=1 的預覽窗完全
            一致——工廠主在 FactoryDashboard 調整好的顯示範圍，這裡會如實
            呈現，不會因為卡片版面而顯示成不同的裁切結果。 */}
        <div className="relative w-24 h-24 md:w-32 md:h-32 shrink-0 bg-orange-50/40 overflow-hidden">
          {avatarUrl ? (
            <CroppedImage src={avatarUrl} crop={avatarCrop} alt={factory.name} loading="lazy" />
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
          <FactoryCardContent factory={factory} isMobile={isMobile} aiHighlighted={aiHighlighted} />
        </div>
      </div>
      {cartButton}
    </Card>
  );

  // 外層包一層 relative + 預留上方空間（mt-5／mt-6），緞帶勳章用 absolute
  // 定位在這段預留空間裡並往下壓進卡片一部分，達到「跨越卡片上邊界」的
  // 效果，且不論外部呼叫端的 grid gap 多寬，都不會壓到上一排卡片。
  const wrapped = (
    <div className="relative h-full mt-5 sm:mt-6">
      {visibleBadgeIds.length > 0 && (
        <div className="absolute -top-5 sm:-top-6 left-3 z-20 pointer-events-auto" onClick={(e) => e.preventDefault()}>
          <BadgeRibbon badgeIds={visibleBadgeIds} size={isMobile ? 32 : 40} maxVisible={isMobile ? 3 : 4} />
        </div>
      )}
      {cardBody}
    </div>
  );

  if (previewMode) {
    return wrapped;
  }

  return (
    <Link href={`/factory/${factory.id}`} className="block h-full">
      {wrapped}
    </Link>
  );
}

function FactoryCardContent({ factory, isMobile, aiHighlighted }: { factory: any; isMobile: boolean; aiHighlighted?: boolean }) {
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
  return (
    <>
      {/* 徽章改成別在卡片左上角的緞帶勳章（見外層 wrapped 的 BadgeRibbon），
          這裡不再需要卡片內容區塊自己的徽章列。 */}

      {/* 標題區 */}
      <div className="flex items-start justify-between shrink-0">
        <div className="flex-1 min-w-0 mr-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="font-semibold text-lg leading-tight">{factory.name}</h3>
            {aiHighlighted && (
              <span className="inline-flex items-center gap-1 text-xs text-orange-700 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full shrink-0">
                較符合本次需求
              </span>
            )}
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
