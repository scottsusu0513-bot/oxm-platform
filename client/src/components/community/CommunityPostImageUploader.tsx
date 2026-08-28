import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { X, ImagePlus, Loader2, Crop } from "lucide-react";
import { toast } from "sonner";
import { CroppedImage } from "@/components/CroppedImage";
import { ImageCropEditor } from "@/components/ImageCropEditor";
import type { ImageCropData } from "@shared/imageCrop";
import { COMMUNITY_IMAGE_MAX_BYTES, COMMUNITY_IMAGE_MAX_MB } from "@shared/const";

// Post images only (CommunityNewPostDialog / CommunityPost edit flow). Bid and
// bid-offer image upload (CommunityBidForm/CommunityBidOfferForm) intentionally
// keep using the plain CommunityImageUploader — Phase 6 scope is post images'
// crop UX, not a bid redesign.
const MAX_IMAGES = 6;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type AllowedMime = (typeof ALLOWED_TYPES)[number];
// Matches the fixed aspect-[4/3] container Community actually renders these
// images in (CommunityPost.tsx post detail grid + this uploader's own
// thumbnails) — keeping this in sync with the real display ratio is what makes
// the crop editor's preview equal the front-end's actual rendering (the whole
// point of shared/imageCrop.ts's imageCropToStyle()).
const IMAGE_ASPECT_RATIO = 4 / 3;

export interface CommunityImage {
  url: string;
  crop: ImageCropData | null;
}

interface Props {
  images: CommunityImage[];
  onChange: (images: CommunityImage[]) => void;
  disabled?: boolean;
  onUploadingChange?: (uploading: boolean) => void;
}

export default function CommunityPostImageUploader({
  images,
  onChange,
  disabled,
  onUploadingChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  // 多張圖片逐張調整顯示範圍：選好的檔案先讀成 base64 佇列，一次只開一個
  // 編輯器，確認或取消都會自動換下一張，直到佇列清空——沿用
  // FactoryDashboard PhotoManager 已驗證過的同一套 queue 模式。
  const [uploadQueue, setUploadQueue] = useState<string[]>([]);
  const [uploadQueueMime, setUploadQueueMime] = useState<AllowedMime[]>([]);
  // 重新調整某一張「已經在 images 裡」的圖片顯示範圍：只更新該筆 crop，不
  // 重新上傳圖片本體。
  const [reeditIndex, setReeditIndex] = useState<number | null>(null);

  const uploadMut = trpc.community.uploadPostImage.useMutation({
    onError: (e) => toast.error(`圖片上傳失敗：${e.message}`),
  });

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const available = MAX_IMAGES - images.length - uploadQueue.length;
    if (available <= 0) {
      toast.error(`最多上傳 ${MAX_IMAGES} 張圖片`);
      return;
    }

    const validFiles: File[] = [];
    for (const file of Array.from(files).slice(0, available)) {
      if (!ALLOWED_TYPES.includes(file.type as AllowedMime)) {
        toast.error(`不支援的格式：${file.name}（支援 jpg / png / webp）`);
      } else if (file.size > COMMUNITY_IMAGE_MAX_BYTES) {
        toast.error(`${file.name} 超過 ${COMMUNITY_IMAGE_MAX_MB}MB 上限`);
      } else {
        validFiles.push(file);
      }
    }
    if (validFiles.length === 0) return;

    const base64List: string[] = [];
    const mimeList: AllowedMime[] = [];
    for (const file of validFiles) {
      try {
        base64List.push(await readAsDataURL(file));
        mimeList.push(file.type as AllowedMime);
      } catch {
        toast.error(`${file.name} 讀取失敗`);
      }
    }
    if (base64List.length === 0) return;

    setUploadQueue((prev) => [...prev, ...base64List]);
    setUploadQueueMime((prev) => [...prev, ...mimeList]);
    if (inputRef.current) inputRef.current.value = "";
  };

  // 佇列裡目前這一張確認顯示範圍後上傳，不論成功與否都往下一張前進，讓多張
  // 圖片的逐張調整流程不會因單張失敗就整個卡住。
  const handleQueueConfirm = async (crop: ImageCropData) => {
    const [current, ...restQueue] = uploadQueue;
    const [currentMime, ...restMime] = uploadQueueMime;
    setUploadQueue(restQueue);
    setUploadQueueMime(restMime);
    if (!current) return;
    onUploadingChange?.(true);
    try {
      const { url } = await uploadMut.mutateAsync({ base64: current, mimeType: currentMime });
      onChange([...images, { url, crop }]);
    } catch {
      // error already shown via uploadMut.onError
    } finally {
      if (restQueue.length === 0) onUploadingChange?.(false);
    }
  };

  const handleQueueCancel = () => {
    setUploadQueue((prev) => {
      const rest = prev.slice(1);
      if (rest.length === 0) onUploadingChange?.(false);
      return rest;
    });
    setUploadQueueMime((prev) => prev.slice(1));
  };

  const handleReeditConfirm = (crop: ImageCropData) => {
    if (reeditIndex == null) return;
    const next = images.map((img, i) => (i === reeditIndex ? { ...img, crop } : img));
    onChange(next);
    setReeditIndex(null);
  };

  const remove = (idx: number) => onChange(images.filter((_, i) => i !== idx));
  const isUploading = uploadQueue.length > 0;
  const canAdd = images.length + uploadQueue.length < MAX_IMAGES && !disabled && !isUploading;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {images.map((img, i) => (
          <div key={`${img.url}-${i}`} className="relative w-20 h-20 shrink-0">
            <div className="w-full h-full rounded-lg overflow-hidden border border-border">
              <CroppedImage src={img.url} crop={img.crop} alt={`圖片 ${i + 1}`} />
            </div>
            {!disabled && (
              <>
                <button
                  type="button"
                  onClick={() => setReeditIndex(i)}
                  className="absolute -top-1.5 -left-1.5 h-5 w-5 rounded-full bg-background border border-border flex items-center justify-center hover:bg-orange-500 hover:text-white hover:border-orange-500 transition-colors"
                  title="調整顯示範圍"
                >
                  <Crop className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-background border border-border flex items-center justify-center hover:bg-destructive hover:text-white hover:border-destructive transition-colors"
                  title="移除圖片"
                >
                  <X className="w-3 h-3" />
                </button>
              </>
            )}
          </div>
        ))}

        {uploadQueue.map((_, i) => (
          <div
            key={`pending-${i}`}
            className="w-20 h-20 rounded-lg border border-dashed border-border flex items-center justify-center bg-muted/30 shrink-0"
          >
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ))}

        {canAdd && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="w-20 h-20 rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-orange-400 hover:text-orange-500 transition-colors shrink-0"
          >
            <ImagePlus className="w-5 h-5" />
            <span className="text-[10px]">新增圖片</span>
          </button>
        )}
      </div>

      {(images.length > 0 || isUploading) && (
        <p className="text-xs text-muted-foreground mt-1.5">
          {images.length + uploadQueue.length} / {MAX_IMAGES} 張
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={disabled}
      />

      {uploadQueue.length > 0 && (
        <ImageCropEditor
          key={uploadQueue.length}
          open={true}
          onOpenChange={(open) => { if (!open) handleQueueCancel(); }}
          imageSrc={uploadQueue[0]}
          aspectRatio={IMAGE_ASPECT_RATIO}
          initialCrop={null}
          title={uploadQueue.length > 1 ? `調整圖片顯示範圍（還剩 ${uploadQueue.length} 張）` : "調整圖片顯示範圍"}
          onConfirm={handleQueueConfirm}
        />
      )}

      {reeditIndex != null && images[reeditIndex] && (
        <ImageCropEditor
          open={true}
          onOpenChange={(open) => { if (!open) setReeditIndex(null); }}
          imageSrc={images[reeditIndex].url}
          aspectRatio={IMAGE_ASPECT_RATIO}
          initialCrop={images[reeditIndex].crop}
          title="調整圖片顯示範圍"
          onConfirm={handleReeditConfirm}
        />
      )}
    </div>
  );
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("讀取檔案失敗"));
    reader.readAsDataURL(file);
  });
}
