import { imageCropToStyle, type ImageCropData } from "@shared/imageCrop";

// 全站共用「圖片顯示範圍」顯示元件。任何會員／管理員上傳、需要套用使用者
// 自訂顯示範圍的圖片，前台一律透過這個元件渲染，不要各自手刻
// object-fit/object-position——這是「編輯器預覽 = 前台實際顯示」保證的
// 一半（另一半是 ImageCropEditor 的即時預覽），兩邊都呼叫同一支
// imageCropToStyle()，桌機／手機容器尺寸不同時，因為套用的是百分比語意
// （object-position + transform-origin），瀏覽器會自動依當下容器尺寸重新
//計算，不需要為不同裝置分別儲存資料。
//
// crop 為 null／undefined 時（既有圖片沒有裁切資料）會 fallback 成置中顯示，
// 與系統既有的 object-fit: cover 置中行為完全相同，不影響舊圖片外觀。
export function CroppedImage({
  src,
  crop,
  alt = "",
  className,
  loading,
}: {
  src: string;
  crop: ImageCropData | null | undefined;
  alt?: string;
  className?: string;
  loading?: "eager" | "lazy";
}) {
  const style = imageCropToStyle(crop);
  return (
    <img
      src={src}
      alt={alt}
      loading={loading}
      className={className}
      style={{
        width: "100%",
        height: "100%",
        objectFit: style.objectFit,
        objectPosition: style.objectPosition,
        transform: style.transform,
        transformOrigin: style.transformOrigin,
      }}
    />
  );
}
