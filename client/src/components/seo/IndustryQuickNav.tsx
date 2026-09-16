import { Link } from "wouter";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Badge } from "@/components/ui/badge";
import { INDUSTRY_SLUGS } from "@shared/constants";
import { getQuickNavSubIndustries, computeSubNavOffset, buildSubIndustryQuickNavHref } from "@shared/subIndustryQuickNav";

export interface IndustryQuickNavProps {
  /** 目前選中的主產業中文名稱（INDUSTRY_SLUGS 的 key），決定主產業列哪一顆是 active。 */
  activeIndustryName: string;
  /** 目前選中的主產業 slug（INDUSTRY_SLUGS 的值），用來過濾子產業、量測 active 項目位置。 */
  activeIndustrySlug: string;
}

// /industry/:industrySlug「自然入口」——主產業列正下方的子產業快速導覽列
// （見「自然入口」任務定案）。原本的主產業列（Badge 橫排）從 IndustryPage.tsx
// 搬進這裡，跟新增的子產業列包在同一個元件裡，因為子產業列的對齊需要量測
// 主產業列裡目前 active 項目的實際 DOM 位置，兩者必須共用同一份 ref／
// 量測邏輯，拆成兩個各自獨立的元件反而要額外傳一堆 ref 出去。
//
// 子產業資料直接 filter 既有 SUB_INDUSTRY_SEARCH_ENTRIES（見
// shared/subIndustryQuickNav.ts 的 getQuickNavSubIndustries），不是第二套
// taxonomy；連結一律導向 canonical /factories/:slug，不是 /search、也不是
// 舊的 /industry/:parent/:sub。
//
// 對齊邏輯（見 shared/subIndustryQuickNav.ts 的 computeSubNavOffset）：
// center／left／right 三種狀態（見任務定案「alignment fallback 邏輯修正」）
// ——優先嘗試讓子產業列以目前 active 主產業中心點置中；置中結果超出主產業
// 按鈕群左邊界就改成整列靠左（第一項對齊按鈕群最左邊）；超出右邊界就改成
// 整列靠右（最後一項對齊按鈕群最右邊，右側主產業如「工業設備／機械」
// 「永續材料」不會被硬拉回左邊）。這個 marginLeft 只在 md（桌機）斷點以上
// 套用（`md:ml-[var(--sub-nav-offset)]`），手機版維持瀏覽器預設的由左開始
// 排列，不套用任何 anchor 邏輯。
export function IndustryQuickNav({ activeIndustryName, activeIndustrySlug }: IndustryQuickNavProps) {
  const mainNavRef = useRef<HTMLDivElement>(null);
  const subNavInnerRef = useRef<HTMLDivElement>(null);
  const [subNavOffset, setSubNavOffset] = useState(0);

  const subIndustries = getQuickNavSubIndustries(activeIndustrySlug);

  useLayoutEffect(() => {
    const mainNav = mainNavRef.current;
    const subNavInner = subNavInnerRef.current;
    if (!mainNav || !subNavInner) return;

    const recompute = () => {
      const badgeEls = Array.from(mainNav.querySelectorAll<HTMLElement>("[data-industry-slug]"));
      const activeEl = mainNav.querySelector<HTMLElement>(`[data-industry-slug="${activeIndustrySlug}"]`);
      if (!activeEl || badgeEls.length === 0) { setSubNavOffset(0); return; }

      // 「主產業導覽容器」量測用主產業列本身（所有主產業項目）的實際視覺
      // 邊界，不是外層 <div> 的 getBoundingClientRect()——外層 div 是
      // block-level 元素，寬度會撐滿父層可用空間，但 flex 項目（Badge）預設
      // 靠左緊縮排列，兩者之間有落差（尤其主產業列右側大多留白），若直接用
      // 外層 div 的寬度當作 zone 判斷基準，最右側的主產業會被誤判成
      // center zone 而非 right zone。改用所有主產業項目座標的
      // min(left)~max(right) 當作邊界，同時也自然涵蓋主產業列在窄螢幕
      // wrap 成多行時的情況（取全部項目座標的聯集，不受列數影響）。
      const badgeRects = badgeEls.map(el => el.getBoundingClientRect());
      const containerLeft = Math.min(...badgeRects.map(r => r.left));
      const containerRight = Math.max(...badgeRects.map(r => r.right));
      const activeRect = activeEl.getBoundingClientRect();
      const { offset } = computeSubNavOffset({
        containerWidth: containerRight - containerLeft,
        activeLeft: activeRect.left - containerLeft,
        activeWidth: activeRect.width,
        innerWidth: subNavInner.scrollWidth,
      });
      setSubNavOffset(offset);
    };

    recompute();

    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(recompute);
    ro.observe(mainNav);
    ro.observe(subNavInner);
    window.addEventListener("resize", recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, [activeIndustrySlug, subIndustries.length]);

  const subNavStyle = { "--sub-nav-offset": `${subNavOffset}px` } as CSSProperties;

  return (
    <>
      <div ref={mainNavRef} className="mt-4 flex flex-wrap gap-2">
        {Object.entries(INDUSTRY_SLUGS).map(([name, s]) => (
          <Link key={s} href={`/industry/${s}`}>
            <Badge
              data-industry-slug={s}
              variant={name === activeIndustryName ? "default" : "outline"}
              className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
            >
              {name}
            </Badge>
          </Link>
        ))}
      </div>

      {subIndustries.length > 0 && (
        <div
          className="mt-1.5 overflow-x-auto [scrollbar-width:thin]"
          data-testid="sub-industry-quick-nav"
        >
          <div
            ref={subNavInnerRef}
            className="inline-flex gap-1 whitespace-nowrap md:ml-[var(--sub-nav-offset)]"
            style={subNavStyle}
          >
            {subIndustries.map((entry) => (
              <Link
                key={entry.slug}
                href={buildSubIndustryQuickNavHref(entry)}
                className="inline-block shrink-0 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                {entry.displayName}
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
