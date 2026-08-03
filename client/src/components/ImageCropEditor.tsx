import { useEffect, useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ZoomIn } from "lucide-react";
import {
  applyDragDelta, clampImageCrop, imageCropToStyle,
  DEFAULT_IMAGE_CROP, IMAGE_CROP_ZOOM_MIN, IMAGE_CROP_ZOOM_MAX,
  type ImageCropData,
} from "@shared/imageCrop";

// 全站共用「圖片顯示範圍」編輯器。任何新增圖片上傳／既有圖片重新調整顯示
// 範圍的流程，都應該開這個對話框，不要各自手刻一套拖曳/縮放邏輯。
//
// 關鍵保證：這裡的即時預覽呼叫的是與 CroppedImage 完全相同的
// imageCropToStyle()，所以使用者在這裡看到的裁切範圍，就是前台實際顯示的
// 範圍——不會有「編輯器看正方形、前台卻裁成橫式」這種落差，因為兩邊用的是
// 同一個 aspectRatio 容器比例與同一個樣式轉換函式。
//
// 使用者「取消」時，onOpenChange(false) 會被呼叫，呼叫端不應該做任何寫入，
// 圖片與原本設定維持不變；只有按下「確認顯示範圍」才會呼叫 onConfirm。
export function ImageCropEditor({
  open,
  onOpenChange,
  imageSrc,
  aspectRatio,
  initialCrop,
  title = "調整顯示範圍",
  confirmLabel = "確認顯示範圍",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageSrc: string;
  /** 寬 / 高，例如 16/5、1（正方形）、4/3 */
  aspectRatio: number;
  initialCrop?: ImageCropData | null;
  title?: string;
  confirmLabel?: string;
  onConfirm: (crop: ImageCropData) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [natSize, setNatSize] = useState({ w: 0, h: 0 });
  const [crop, setCrop] = useState<ImageCropData>(() => clampImageCrop(initialCrop ?? DEFAULT_IMAGE_CROP));
  const dragState = useRef<{ lastX: number; lastY: number } | null>(null);

  // 每次開啟都重置成傳入的既有設定（或預設置中），避免上一張圖片的拖曳狀態
  // 殘留到下一張。
  useEffect(() => {
    if (open) {
      setCrop(clampImageCrop(initialCrop ?? DEFAULT_IMAGE_CROP));
      setNatSize({ w: 0, h: 0 });
    }
  }, [open, imageSrc, initialCrop]);

  const handleImgLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    setNatSize({ w: img.naturalWidth, h: img.naturalHeight });
  };

  const getContainerSize = () => {
    const el = containerRef.current;
    if (!el) return { cw: 0, ch: 0 };
    const cw = el.clientWidth;
    return { cw, ch: cw / aspectRatio };
  };

  const startDrag = (clientX: number, clientY: number) => {
    dragState.current = { lastX: clientX, lastY: clientY };
  };

  const moveDrag = (clientX: number, clientY: number) => {
    if (!dragState.current || !natSize.w) return;
    const dx = clientX - dragState.current.lastX;
    const dy = clientY - dragState.current.lastY;
    dragState.current = { lastX: clientX, lastY: clientY };
    const { cw, ch } = getContainerSize();
    setCrop(prev => applyDragDelta(prev, dx, dy, natSize.w, natSize.h, cw, ch));
  };

  const endDrag = () => { dragState.current = null; };

  useEffect(() => {
    if (!open) return;
    const onMouseMove = (e: MouseEvent) => moveDrag(e.clientX, e.clientY);
    const onMouseUp = () => endDrag();
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) moveDrag(e.touches[0].clientX, e.touches[0].clientY);
    };
    const onTouchEnd = () => endDrag();
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, natSize.w, natSize.h]);

  const style = imageCropToStyle(crop);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div
            ref={containerRef}
            className="relative w-full rounded-lg overflow-hidden bg-black select-none"
            style={{ aspectRatio: String(aspectRatio), cursor: dragState.current ? "grabbing" : "grab" }}
            onMouseDown={e => { e.preventDefault(); startDrag(e.clientX, e.clientY); }}
            onTouchStart={e => { if (e.touches[0]) startDrag(e.touches[0].clientX, e.touches[0].clientY); }}
          >
            <img
              ref={imgRef}
              src={imageSrc}
              alt=""
              onLoad={handleImgLoad}
              draggable={false}
              style={{
                width: "100%",
                height: "100%",
                objectFit: style.objectFit,
                objectPosition: style.objectPosition,
                transform: style.transform,
                transformOrigin: style.transformOrigin,
                pointerEvents: "none",
                userSelect: "none",
              }}
            />
            <div className="absolute inset-0 border-2 border-white/60 rounded-lg pointer-events-none" />
          </div>

          <div className="flex items-center gap-3">
            <ZoomIn className="w-4 h-4 text-muted-foreground shrink-0" />
            <Slider
              value={[crop.zoom]}
              min={IMAGE_CROP_ZOOM_MIN}
              max={IMAGE_CROP_ZOOM_MAX}
              step={0.01}
              onValueChange={([z]) => setCrop(prev => clampImageCrop({ ...prev, zoom: z }))}
              className="flex-1"
            />
          </div>
          <p className="text-xs text-muted-foreground text-center">拖曳圖片調整位置，滑桿調整縮放</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={() => onConfirm(crop)}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
