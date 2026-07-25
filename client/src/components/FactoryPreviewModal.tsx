import { createPortal } from "react-dom";
import { useEffect, useRef, type ComponentProps } from "react";
import { X } from "lucide-react";
import { FactoryDetailView, type FactoryDetailViewFactory } from "@/components/FactoryDetailView";

type ViewProps = ComponentProps<typeof FactoryDetailView>;

interface FactoryPreviewModalProps {
  open: boolean;
  onClose: () => void;
  factory: FactoryDetailViewFactory;
  photos: ViewProps["photos"];
  categories: ViewProps["categories"];
  reviewData: ViewProps["reviewData"];
  myReview?: ViewProps["myReview"];
  isAuthenticated: boolean;
  user?: ViewProps["user"];
  isFav?: boolean;
}

// 工廠管理後台「預覽工廠頁面」的大型彈窗外殼。只負責彈窗本身的呈現／捲動鎖定／關閉方式，
// 公開頁內容一律透過 FactoryDetailView 呈現，避免另外維護第二套工廠頁 UI。
export function FactoryPreviewModal({
  open,
  onClose,
  factory,
  photos,
  categories,
  reviewData,
  myReview,
  isAuthenticated,
  user,
  isFav,
}: FactoryPreviewModalProps) {
  const scrollYRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // 鎖定背景頁面捲動：用 position:fixed + 負值 top 記住原本捲動位置，關閉時還原，
  // 避免一般 overflow:hidden 做法在 iOS Safari 上仍可透過觸控滑動背景的問題。
  useEffect(() => {
    if (!open) return;
    const scrollY = window.scrollY;
    scrollYRef.current = scrollY;
    const body = document.body;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollYRef.current);
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="工廠頁面預覽"
      // z-[300]：高於站內所有既有固定元件（Navbar z-50、手機底部導覽 z-[60]、
      // 品牌下拉選單 z-[70]、管理下拉選單 z-[200]），但低於全站級的離線提示
      // NetworkStatusOverlay（z-[9999]），讓那類全域警示仍能蓋過預覽彈窗。
      // 內部照片燈箱（FactoryDetailView 內 fixed z-50、無獨立高 z-index 的外殼）
      // 因為工具列／捲動容器都沒有設定 position + z-index，不會形成新的
      // stacking context 把燈箱「困」在較低層，所以燈箱仍會正確蓋在此彈窗之上。
      className="fixed inset-0 z-[300] bg-black/60 flex items-center justify-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative flex flex-col w-full h-full sm:w-[95vw] sm:h-[94vh] bg-background overflow-hidden sm:rounded-2xl sm:shadow-2xl">
        {/* 固定工具列：不設 position/z-index，靠 flex 版面固定在彈窗頂部，
            內容區塊獨立捲動；工具列本身也不會攔在照片燈箱之上（見上方說明）。 */}
        <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b bg-background">
          <h2 className="text-base font-semibold">工廠頁面預覽</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉預覽"
            className="inline-flex items-center gap-1.5 rounded-full bg-orange-500 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-orange-600 active:scale-95 shrink-0"
          >
            <X className="w-4 h-4" />關閉預覽
          </button>
        </div>

        {/* 內容區：獨立上下捲動，寬度受 overflow-hidden 限制不會左右溢出 */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain">
          <FactoryDetailView
            factory={factory}
            photos={photos}
            categories={categories}
            reviewData={reviewData}
            myReview={myReview}
            isAuthenticated={isAuthenticated}
            user={user}
            isFav={isFav}
            previewMode
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
