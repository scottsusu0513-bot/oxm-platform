import { Link } from "wouter";
import { Star, MapPin, Factory as FactoryIcon, Wrench } from "lucide-react";
import { CroppedImage } from "@/components/CroppedImage";
import type { ImageCropData } from "@shared/imageCrop";

// 工廠詳情頁「相關工廠」推薦卡片（見任務定案「工廠詳情頁底部同類型工廠
// 推薦」）。刻意是一張輕量的 discovery card，不是第二張完整的 Search 結果卡
// （client/src/components/FactoryResultCard.tsx）——不帶收藏／一鍵詢價／
// 購物車等互動狀態，也不顯示電話／官網／長簡介，只給使用者足夠判斷「要不要
// 點進去看」的資訊。版型參考 IndustryPage.tsx 既有的直式卡片（圖片在上、
// 資訊在下），但刻意獨立成元件、不去重構 IndustryPage 本身。
export interface RelatedFactoryCardData {
  id: number;
  name: string;
  avatarUrl?: string | null;
  avatarCrop?: ImageCropData | null;
  businessType?: string | null;
  industry?: string[] | null;
  subIndustry?: string[] | null;
  region?: string | null;
  mfgModes?: string[] | null;
  avgRating?: string | number | null;
  reviewCount?: number | null;
}

export function RelatedFactoryCard({
  factory,
  className = "",
  presentational = false,
}: {
  factory: RelatedFactoryCardData;
  className?: string;
  /**
   * true＝渲染成不可互動的純展示副本（用純 <div> 取代 <Link>，沒有任何
   * <a href>）——專供跑馬燈的「複製軌道」使用（見 RelatedFactoriesMarquee.tsx）。
   * 複製軌道的存在只是為了做出視覺上無縫循環的錯覺，內容跟真正的軌道逐字
   * 重複；如果複製軌道也渲染成真正的連結，螢幕閱讀器與 Tab 鍵盤操作會把
   * 同一批推薦唸兩遍／挑兩遍，因此複製軌道完全不使用 <a>，從根本上避免
   * 這個問題，不需要依賴 inert 屬性或 aria-hidden 加 tabIndex=-1 這類容易
   * 遺漏的變通做法。
   */
  presentational?: boolean;
}) {
  const industryArr = Array.isArray(factory.industry) ? factory.industry : [];
  const subIndustryArr = Array.isArray(factory.subIndustry) ? factory.subIndustry : [];
  const mfgModes = Array.isArray(factory.mfgModes) ? factory.mfgModes : [];
  // 主產業／子產業只各取第一個，維持卡片精簡——完整清單是工廠詳情頁本身的責任。
  const industryLabel = subIndustryArr[0] ?? industryArr[0] ?? null;
  const rating = factory.avgRating != null ? Number(factory.avgRating) : null;
  const hasRating = rating != null && (factory.reviewCount ?? 0) > 0;

  const cardInner = (
    <>
      <div className="relative h-28 bg-gradient-to-br from-orange-100 to-amber-50 overflow-hidden">
        {factory.avatarUrl ? (
          <CroppedImage src={factory.avatarUrl} crop={factory.avatarCrop ?? null} alt={factory.name} loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {factory.businessType === "studio"
              ? <Wrench className="w-10 h-10 text-purple-200" />
              : <FactoryIcon className="w-10 h-10 text-orange-200" />}
          </div>
        )}
      </div>
      <div className="p-3">
        <h3 className="font-semibold text-sm leading-tight line-clamp-1">{factory.name}</h3>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {industryLabel && (
            <span className="inline-block text-xs px-1.5 py-0.5 rounded border bg-muted/50 text-muted-foreground truncate max-w-full">
              {industryLabel}
            </span>
          )}
          {mfgModes.map(m => (
            <span key={m} className="inline-block text-xs px-1.5 py-0.5 rounded border bg-muted/50 text-muted-foreground">
              {m}
            </span>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1 min-w-0">
            <MapPin className="w-3 h-3 shrink-0" />
            <span className="truncate">{factory.region || "—"}</span>
          </span>
          {hasRating && (
            <span className="flex items-center gap-1 shrink-0">
              <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
              {rating!.toFixed(1)}（{factory.reviewCount}）
            </span>
          )}
        </div>
      </div>
    </>
  );

  const sharedClassName = `block shrink-0 rounded-xl border bg-card overflow-hidden ${presentational ? "" : "hover:shadow-md transition-shadow"} ${className}`;

  if (presentational) {
    return <div className={sharedClassName}>{cardInner}</div>;
  }

  return (
    <Link href={`/factory/${factory.id}`} className={sharedClassName}>
      {cardInner}
    </Link>
  );
}
