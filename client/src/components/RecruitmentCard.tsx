import { Link } from "wouter";
import { Plus } from "lucide-react";

// 工廠詳情頁「相關工廠」推薦區塊的「進駐招募卡」（見任務定案「相關工廠數量
// 不足時不隱藏整個區塊，改用招募卡補位」）。這不是一家假工廠——刻意不顯示
// 星等／地區／產業／mfgModes／任何看起來像真實資料的欄位，視覺上用虛線邊框
// ＋淡橘紫漸層＋「+」圖示，跟 RelatedFactoryCard 的實體照片風格明確區隔，
// 讓使用者一眼就懂「這是一個邀請工廠進駐的空位」，不是「資料還沒填完的
// 工廠」。連結一律導向既有的 /register-factory（FactoryRegister 頁面本身
// 已經處理未登入時的登入導引，這裡不需要另外判斷登入狀態）。
//
// 文案準備了 4 種標題輪替（1 主版 + 3 variation），同一批招募卡出現多張時
// 循環使用，避免使用者看到好幾張逐字相同的卡片。
const RECRUITMENT_TITLES = [
  "此產業等待更多工廠進駐",
  "你的工廠也提供這項服務嗎？",
  "讓更多企業找到你的製造能力",
  "加入 OXM，成為下一個合作夥伴",
];

export function RecruitmentCard({
  className = "",
  presentational = false,
  variationIndex = 0,
}: {
  className?: string;
  /** true＝跑馬燈複製軌道用的非互動展示副本，理由同 RelatedFactoryCard。 */
  presentational?: boolean;
  variationIndex?: number;
}) {
  const title = RECRUITMENT_TITLES[variationIndex % RECRUITMENT_TITLES.length];

  const cardInner = (
    <>
      <div className="relative h-28 bg-gradient-to-br from-orange-50 to-purple-50 flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-dashed border-orange-300 flex items-center justify-center">
          <Plus className="w-5 h-5 text-orange-400" />
        </div>
      </div>
      <div className="p-3">
        <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 font-medium">
          待進駐
        </span>
        <h3 className="mt-1.5 font-semibold text-sm leading-tight line-clamp-2">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
          在 OXM 建立工廠頁，讓有需求的企業更容易找到你。
        </p>
        <span className="mt-2 inline-block text-xs font-medium text-orange-600">
          免費進駐 OXM →
        </span>
      </div>
    </>
  );

  const sharedClassName = `block shrink-0 rounded-xl border border-dashed border-orange-200 bg-orange-50/30 overflow-hidden ${presentational ? "" : "hover:shadow-md hover:border-orange-300 transition-all"} ${className}`;

  if (presentational) {
    return <div className={sharedClassName} data-testid="recruitment-card">{cardInner}</div>;
  }

  return (
    <Link href="/register-factory" className={sharedClassName} data-testid="recruitment-card">
      {cardInner}
    </Link>
  );
}
