import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { X, ImagePlus, Loader2 } from "lucide-react";
import { toast } from "sonner";

const MAX_IMAGES = 6;
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type AllowedMime = (typeof ALLOWED_TYPES)[number];

interface Props {
  images: string[];
  onChange: (urls: string[]) => void;
  disabled?: boolean;
  onUploadingChange?: (uploading: boolean) => void;
}

export default function CommunityImageUploader({
  images,
  onChange,
  disabled,
  onUploadingChange,
}: Props) {
  const [pendingCount, setPendingCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadMut = trpc.community.uploadPostImage.useMutation({
    onError: (e) => toast.error(`圖片上傳失敗：${e.message}`),
  });

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const available = MAX_IMAGES - images.length;
    if (available <= 0) {
      toast.error(`最多上傳 ${MAX_IMAGES} 張圖片`);
      return;
    }

    const valid: File[] = [];
    for (const file of Array.from(files).slice(0, available)) {
      if (!ALLOWED_TYPES.includes(file.type as AllowedMime)) {
        toast.error(`不支援的格式：${file.name}（支援 jpg / png / webp）`);
      } else if (file.size > MAX_BYTES) {
        toast.error(`${file.name} 超過 8MB 上限`);
      } else {
        valid.push(file);
      }
    }
    if (valid.length === 0) return;

    setPendingCount(valid.length);
    onUploadingChange?.(true);

    const uploaded: string[] = [];
    for (const file of valid) {
      try {
        const base64 = await readAsDataURL(file);
        const { url } = await uploadMut.mutateAsync({
          base64,
          mimeType: file.type as AllowedMime,
        });
        uploaded.push(url);
      } catch {
        // error shown via onError
      }
      setPendingCount((prev) => Math.max(0, prev - 1));
    }

    onUploadingChange?.(false);
    if (uploaded.length > 0) onChange([...images, ...uploaded]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const remove = (idx: number) => onChange(images.filter((_, i) => i !== idx));
  const isUploading = pendingCount > 0;
  const canAdd = images.length < MAX_IMAGES && !disabled && !isUploading;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {images.map((url, i) => (
          <div key={`${url}-${i}`} className="relative w-20 h-20 shrink-0">
            <img
              src={url}
              alt={`圖片 ${i + 1}`}
              className="w-full h-full object-cover rounded-lg border border-border"
            />
            {!disabled && (
              <button
                type="button"
                onClick={() => remove(i)}
                className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-background border border-border flex items-center justify-center hover:bg-destructive hover:text-white hover:border-destructive transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}

        {Array.from({ length: pendingCount }).map((_, i) => (
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
          {images.length + pendingCount} / {MAX_IMAGES} 張
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
