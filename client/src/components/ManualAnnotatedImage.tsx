import type { Annotation } from "@/lib/manual";

interface Props {
  src: string;
  alt: string;
  caption?: string;
  /** 可選：在圖片上疊加標註層（框線、步驟圓圈、點擊位置）
   *  圖片已有 annotated.png 時不需要此 prop；
   *  留給未來需要動態標註的場景使用。 */
  annotations?: Annotation[];
}

export function ManualAnnotatedImage({ src, alt, caption, annotations }: Props) {
  return (
    <div className="space-y-1.5">
      <div className="relative rounded-lg overflow-hidden border border-border bg-muted/30">
        <img
          src={src}
          alt={alt}
          className="w-full h-auto block"
          loading="lazy"
          onError={e => {
            const img = e.currentTarget;
            img.style.display = "none";
            const fb = img.nextElementSibling as HTMLElement | null;
            if (fb) fb.removeAttribute("hidden");
          }}
        />
        {/* 圖片載入失敗 fallback */}
        <div hidden className="px-4 py-8 text-center text-sm text-muted-foreground">
          圖片暫時無法顯示
        </div>

        {/* 標註疊加層（百分比座標，隨圖片縮放自動對齊） */}
        {annotations && annotations.length > 0 && (
          <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
            {annotations.map((ann, i) => {
              if (ann.type === "box") {
                return (
                  <div
                    key={i}
                    className="absolute border-[3px] border-orange-500 rounded"
                    style={{
                      left: `${ann.x ?? 0}%`,
                      top: `${ann.y ?? 0}%`,
                      width: `${ann.width ?? 10}%`,
                      height: `${ann.height ?? 5}%`,
                    }}
                  />
                );
              }
              if (ann.type === "step" || ann.type === "circle") {
                return (
                  <div
                    key={i}
                    className="absolute flex items-center justify-center w-7 h-7 rounded-full bg-orange-500 text-white text-xs font-bold -translate-x-1/2 -translate-y-1/2 shadow-md"
                    style={{
                      left: `${ann.x ?? 0}%`,
                      top: `${ann.y ?? 0}%`,
                    }}
                  >
                    {ann.step ?? ann.label?.slice(0, 2) ?? "•"}
                  </div>
                );
              }
              if (ann.type === "click") {
                return (
                  <div
                    key={i}
                    className="absolute w-5 h-5 rounded-full bg-orange-400/50 border-2 border-orange-500 -translate-x-1/2 -translate-y-1/2"
                    style={{
                      left: `${ann.x ?? 0}%`,
                      top: `${ann.y ?? 0}%`,
                    }}
                  />
                );
              }
              if (ann.type === "arrow") {
                // 箭頭預留：未來可用 SVG 實作
                return null;
              }
              return null;
            })}
          </div>
        )}
      </div>

      {caption && (
        <p className="text-xs text-center text-muted-foreground">{caption}</p>
      )}
    </div>
  );
}
