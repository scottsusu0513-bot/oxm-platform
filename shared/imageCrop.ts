// 全站共用「圖片顯示範圍」資料結構與純運算函式。
//
// 設計原則：不烘焙像素、不捨棄原圖。只保存一組小型、與解析度無關的正規化
// 中繼資料（zoom + posX/posY 百分比），前台與編輯器都用「同一個」
// imageCropToStyle() 把中繼資料轉成 CSS style 套用在 <img> 上——因為editor
// 預覽與前台顯示呼叫的是同一支函式，兩邊呈現範圍保證一致，不會有「編輯器
// 看到的跟前台顯示的不一樣」的落差。
//
// 運作原理：object-fit: cover 讓瀏覽器自己算出「覆蓋滿容器」所需的縮放與
// 對齊，object-position 的 X%/Y% 決定用圖片的哪個定位點對齊容器（同語意的
// 百分比在任何容器尺寸、任何裝置下都會被瀏覽器正確重新計算，不需要 JS 知道
// 圖片原始像素尺寸）；再疊加 transform: scale(zoom) 並用相同的百分比當
// transform-origin，就能在「保持同一個定位點為錨點」的前提下繼續放大。
// 這也是為什麼桌機／手機用不同容器尺寸時，同一組 {zoom, posX, posY} 仍然
// 呈現「相同的相對顯示範圍」——因為百分比語意本來就是相對容器尺寸，不是
// 絕對像素。
export type ImageCropData = {
  /** >= 1，1 為「剛好覆蓋滿容器」的基準縮放，>1 表示使用者額外放大 */
  zoom: number;
  /** 0~100，object-position 的水平定位百分比 */
  posX: number;
  /** 0~100，object-position 的垂直定位百分比 */
  posY: number;
};

export const DEFAULT_IMAGE_CROP: ImageCropData = { zoom: 1, posX: 50, posY: 50 };

export const IMAGE_CROP_ZOOM_MIN = 1;
export const IMAGE_CROP_ZOOM_MAX = 3;

/** 把使用者輸入夾在合理範圍內，避免存入不合理或惡意竄改的數值。 */
export function clampImageCrop(crop: Partial<ImageCropData> | null | undefined): ImageCropData {
  const zoom = typeof crop?.zoom === "number" && Number.isFinite(crop.zoom)
    ? Math.min(IMAGE_CROP_ZOOM_MAX, Math.max(IMAGE_CROP_ZOOM_MIN, crop.zoom))
    : DEFAULT_IMAGE_CROP.zoom;
  const posX = typeof crop?.posX === "number" && Number.isFinite(crop.posX)
    ? Math.min(100, Math.max(0, crop.posX))
    : DEFAULT_IMAGE_CROP.posX;
  const posY = typeof crop?.posY === "number" && Number.isFinite(crop.posY)
    ? Math.min(100, Math.max(0, crop.posY))
    : DEFAULT_IMAGE_CROP.posY;
  return { zoom, posX, posY };
}

/**
 * 中繼資料 → CSS style。前台顯示（CroppedImage）與編輯器即時預覽
 * （ImageCropEditor）都呼叫這一支函式，兩邊呈現保證一致。
 * crop 為 null／undefined 時（既有圖片沒有裁切資料）fallback 成置中顯示，
 * 等同於目前系統既有的 object-fit: cover 置中行為，不影響舊圖片的既有外觀。
 */
export function imageCropToStyle(crop: ImageCropData | null | undefined): {
  objectFit: "cover";
  objectPosition: string;
  transform: string;
  transformOrigin: string;
} {
  const c = crop ? clampImageCrop(crop) : DEFAULT_IMAGE_CROP;
  return {
    objectFit: "cover",
    objectPosition: `${c.posX}% ${c.posY}%`,
    transform: `scale(${c.zoom})`,
    transformOrigin: `${c.posX}% ${c.posY}%`,
  };
}

/**
 * 編輯器專用：計算目前縮放下，圖片實際渲染尺寸（cover-fit 基準 × zoom）。
 * 用來判斷某個軸向還有沒有可拖曳的餘裕（renderedSize > containerSize）。
 */
export function computeCoverFitSize(
  naturalW: number,
  naturalH: number,
  containerW: number,
  containerH: number,
  zoom: number,
): { renderedW: number; renderedH: number } {
  if (naturalW <= 0 || naturalH <= 0 || containerW <= 0 || containerH <= 0) {
    return { renderedW: containerW, renderedH: containerH };
  }
  const baseScale = Math.max(containerW / naturalW, containerH / naturalH);
  const scale = baseScale * Math.max(IMAGE_CROP_ZOOM_MIN, zoom);
  return { renderedW: naturalW * scale, renderedH: naturalH * scale };
}

/**
 * 編輯器專用：把一次拖曳的像素位移 (dx, dy) 轉換成 posX/posY 百分比的變化量，
 * 並回傳夾好範圍的新 crop。dx>0（往右拖曳）代表使用者想看到圖片更左邊的
 * 內容，所以 posX 要減少——這是所有圖片裁切工具共通的「拖曳圖片本身」直覺
 * （不是拖曳一個取景窗）。
 *
 * 若某一軸向的渲染尺寸小於等於容器尺寸（沒有可拖曳餘裕），該軸向的位移會
 * 被忽略，避免除以極小值或負值造成不合理的百分比跳動。
 */
export function applyDragDelta(
  current: ImageCropData,
  dx: number,
  dy: number,
  naturalW: number,
  naturalH: number,
  containerW: number,
  containerH: number,
): ImageCropData {
  const { renderedW, renderedH } = computeCoverFitSize(naturalW, naturalH, containerW, containerH, current.zoom);
  const slackX = renderedW - containerW;
  const slackY = renderedH - containerH;

  const percentPerPixelX = slackX > 1 ? 100 / slackX : 0;
  const percentPerPixelY = slackY > 1 ? 100 / slackY : 0;

  return clampImageCrop({
    zoom: current.zoom,
    posX: current.posX - dx * percentPerPixelX,
    posY: current.posY - dy * percentPerPixelY,
  });
}
