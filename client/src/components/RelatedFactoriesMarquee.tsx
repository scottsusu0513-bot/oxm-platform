import type { CSSProperties } from "react";
import { RelatedFactoryCard, type RelatedFactoryCardData } from "@/components/RelatedFactoryCard";
import { RecruitmentCard } from "@/components/RecruitmentCard";
import "./RelatedFactoriesMarquee.css";

// 工廠詳情頁「相關工廠」跑馬燈容器（見任務定案「工廠詳情頁底部同類型工廠
// 推薦」／「相關工廠數量不足時用招募卡補位，不再整區隱藏」／「修正 desktop
// 尾端空白」）。
//
// 「要不要跑動畫」「desktop 固定視窗寬度」全部交給 CSS 完成（見
// RelatedFactoriesMarquee.css 的完整說明），這個元件只負責：
// 1. 組出實際要顯示的清單：真實工廠優先，數量不足 MARQUEE_TARGET_COUNT
//    （目標 track 長度，讓動畫循環自然）時，用招募卡補到剛好
//    MARQUEE_TARGET_COUNT 筆——不是為了湊數重複同一家真實工廠，招募卡本身
//    也清楚標示不是真工廠（見 RecruitmentCard.tsx）。真實工廠達到或超過
//    MARQUEE_TARGET_COUNT 時（後端上限 12），全部使用真實工廠，不需要
//    招募卡。
// 2. 依「最終顯示清單」總數（真實 + 招募卡）決定要不要渲染複製軌道——複製
//    軌道只負責讓動畫視覺上無縫循環，本身不是新的推薦資料，內容跟真實軌道
//    逐項重複。
// 3. 複製軌道一律用 presentational 模式渲染（真實卡與招募卡都一樣，沒有
//    <a href>），並整段包 aria-hidden="true"，確保螢幕閱讀器與 Tab 鍵盤
//    操作都不會把同一批內容重複讀出/選取兩次。
const MARQUEE_TARGET_COUNT = 8;
const MARQUEE_ELIGIBLE_COUNT = 6;
// 用 flex-basis（不是 width）固定卡片外框尺寸：flex-grow/flex-shrink 都是 0，
// 卡片絕對不會被內容撐寬或被 flex 容器壓縮，跟 RelatedFactoriesMarquee.css
// 的 4 張卡片寬度計算（280px + 1rem gap）、動畫位移距離用的 280px 對應同一份
// 尺寸，三處都改的話要一起改。min-w-0 是必要的保底：flex item 預設
// min-width:auto（等同 min-content），沒有這行，卡片內如果出現不會換行的
// 長內容，仍然可能把卡片撐寬過 flex-basis，造成同一排卡片寬度不一致。
const CARD_WIDTH_CLASS = "flex-[0_0_240px] sm:flex-[0_0_280px] min-w-0";

type DisplayItem =
  | { kind: "factory"; factory: RelatedFactoryCardData }
  | { kind: "recruitment"; variationIndex: number };

function buildDisplayItems(factories: RelatedFactoryCardData[]): DisplayItem[] {
  const items: DisplayItem[] = factories.map(factory => ({ kind: "factory", factory }));
  if (items.length >= MARQUEE_TARGET_COUNT) return items;
  const recruitmentCount = MARQUEE_TARGET_COUNT - items.length;
  for (let i = 0; i < recruitmentCount; i++) {
    items.push({ kind: "recruitment", variationIndex: i });
  }
  return items;
}

function renderItem(item: DisplayItem, key: string, presentational: boolean) {
  if (item.kind === "factory") {
    return <RelatedFactoryCard key={key} factory={item.factory} className={CARD_WIDTH_CLASS} presentational={presentational} />;
  }
  return <RecruitmentCard key={key} className={CARD_WIDTH_CLASS} presentational={presentational} variationIndex={item.variationIndex} />;
}

export function RelatedFactoriesMarquee({ factories }: { factories: RelatedFactoryCardData[] }) {
  const items = buildDisplayItems(factories);
  const eligible = items.length >= MARQUEE_ELIGIBLE_COUNT;

  return (
    <div className={`related-marquee-viewport ${eligible ? "related-marquee-eligible" : ""}`}>
      <div
        className="related-marquee-row"
        style={{ "--related-marquee-count": items.length } as CSSProperties}
      >
        <div className="related-marquee-track">
          {items.map((item, i) => renderItem(item, `real-${i}`, false))}
        </div>
        {eligible && (
          <div className="related-marquee-track related-marquee-track-duplicate" aria-hidden="true">
            {items.map((item, i) => renderItem(item, `dup-${i}`, true))}
          </div>
        )}
      </div>
    </div>
  );
}
