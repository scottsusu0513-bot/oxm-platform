import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Textarea } from "@/components/ui/textarea";
import { X, ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { sortBadgeIds, CERTIFICATION_BADGE_MAP, MAX_EVIDENCE_IMAGES_PER_BADGE, MAX_EVIDENCE_IMAGES_TOTAL, MAX_EVIDENCE_DESCRIPTION_LENGTH, type CertificationEvidenceEntry } from "@shared/badges";
import { BadgeIcon } from "./BadgeIcon";

type UploadFn = (file: File) => Promise<string>;
const ACCEPTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_SIZE = 5 * 1024 * 1024;

function getEntry(evidence: CertificationEvidenceEntry[], badgeId: string): CertificationEvidenceEntry {
  return evidence.find(e => e.badgeId === badgeId) ?? { badgeId, description: "", imageUrls: [] };
}

function withEntry(evidence: CertificationEvidenceEntry[], badgeId: string, patch: Partial<CertificationEvidenceEntry>): CertificationEvidenceEntry[] {
  const current = getEntry(evidence, badgeId);
  const next = { ...current, ...patch };
  return [...evidence.filter(e => e.badgeId !== badgeId), next];
}

/**
 * 每個已選徽章的說明文字 + 多張證明圖片上傳／縮圖／移除。
 * 已選徽章清單（badgeIds）與 evidence 陣列由父層 FactoryDashboard 管理。
 *
 * onEvidenceChange 採 React setState 的 functional-updater 慣例（直接傳入
 * useState 的 setter 即可）—— 多檔上傳、跨徽章同時操作都一律以「讀取當下
 * 最新 state 的 updater function」寫回，不依賴呼叫當下閉包裡的 evidence
 * prop，避免同批多張圖片互相覆蓋、只留下最後一張的競態問題。
 */
export function BadgeEvidenceEditor({
  badgeIds,
  evidence,
  onEvidenceChange,
  onUploadImage,
  disabled,
}: {
  badgeIds: string[];
  evidence: CertificationEvidenceEntry[];
  onEvidenceChange: Dispatch<SetStateAction<CertificationEvidenceEntry[]>>;
  onUploadImage: UploadFn;
  disabled?: boolean;
}) {
  const sortedIds = sortBadgeIds(badgeIds);
  const totalImages = evidence.reduce((sum, e) => sum + e.imageUrls.length, 0);

  if (sortedIds.length === 0) {
    return <p className="text-sm text-muted-foreground py-2">尚未選擇任何徽章，請先從上方搜尋並勾選。</p>;
  }

  return (
    <div className="space-y-4">
      {sortedIds.map(badgeId => {
        const def = CERTIFICATION_BADGE_MAP[badgeId];
        if (!def) return null;
        const entry = getEntry(evidence, badgeId);
        return (
          <BadgeEvidenceRow
            key={badgeId}
            badgeId={badgeId}
            name={def.name}
            entry={entry}
            disabled={disabled}
            remainingForBadge={Math.max(0, MAX_EVIDENCE_IMAGES_PER_BADGE - entry.imageUrls.length)}
            remainingTotal={Math.max(0, MAX_EVIDENCE_IMAGES_TOTAL - totalImages)}
            onDescriptionChange={(v) => onEvidenceChange(prev => withEntry(prev, badgeId, { description: v }))}
            onUploadImage={onUploadImage}
            onFilesUploaded={(urls) => onEvidenceChange(prev => {
              const current = getEntry(prev, badgeId);
              const totalNow = prev.reduce((sum, e) => sum + e.imageUrls.length, 0);
              // 寫回當下再次以「最新 state」為準裁切一次，是防止競態的最後一道防線
              // （例如使用者幾乎同時對兩個不同徽章各自上傳，兩邊各自的 updater 都是
              // 以套用當下那一刻的 prev 為準，不會互相覆蓋）。
              const roomForBadge = Math.max(0, MAX_EVIDENCE_IMAGES_PER_BADGE - current.imageUrls.length);
              const roomTotal = Math.max(0, MAX_EVIDENCE_IMAGES_TOTAL - totalNow);
              const accepted = urls.slice(0, Math.min(roomForBadge, roomTotal));
              return withEntry(prev, badgeId, { imageUrls: [...current.imageUrls, ...accepted] });
            })}
            onRemoveImage={(url) => onEvidenceChange(prev => {
              const current = getEntry(prev, badgeId);
              return withEntry(prev, badgeId, { imageUrls: current.imageUrls.filter(u => u !== url) });
            })}
          />
        );
      })}
    </div>
  );
}

function BadgeEvidenceRow({
  badgeId, name, entry, disabled, remainingForBadge, remainingTotal, onDescriptionChange, onUploadImage, onFilesUploaded, onRemoveImage,
}: {
  badgeId: string;
  name: string;
  entry: CertificationEvidenceEntry;
  disabled?: boolean;
  remainingForBadge: number;
  remainingTotal: number;
  onDescriptionChange: (v: string) => void;
  onUploadImage: UploadFn;
  onFilesUploaded: (urls: string[]) => void;
  onRemoveImage: (url: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const canAddMore = remainingForBadge > 0 && remainingTotal > 0;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const allowedCount = Math.min(remainingForBadge, remainingTotal);
    const picked = Array.from(files);

    const validFiles: File[] = [];
    let rejectedFormat = 0;
    let rejectedSize = 0;
    for (const file of picked) {
      if (!ACCEPTED_MIME_TYPES.has(file.type)) { rejectedFormat++; continue; }
      if (file.size > MAX_FILE_SIZE) { rejectedSize++; continue; }
      validFiles.push(file);
    }
    if (rejectedFormat > 0) toast.error(`${rejectedFormat} 張圖片格式不支援，僅接受 JPEG、PNG、WebP`);
    if (rejectedSize > 0) toast.error(`${rejectedSize} 張圖片超過 5MB 上限`);

    if (allowedCount <= 0) {
      if (validFiles.length > 0) toast.error("此徽章證明圖片已達上限，請先移除部分圖片再新增");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const toUpload = validFiles.slice(0, allowedCount);
    if (validFiles.length > toUpload.length) {
      toast.error(`已達上限，僅新增前 ${toUpload.length} 張，其餘 ${validFiles.length - toUpload.length} 張未上傳`);
    }
    if (toUpload.length === 0) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploading(true);
    try {
      // 每張獨立 upload，Promise.allSettled 確保同批中即使有幾張失敗，
      // 其餘已成功上傳的圖片仍會被保留（不會因為其中一張 reject 就整批捨棄）。
      const results = await Promise.allSettled(toUpload.map(file => onUploadImage(file)));
      const succeededUrls: string[] = [];
      let failedCount = 0;
      for (const r of results) {
        if (r.status === "fulfilled") succeededUrls.push(r.value);
        else failedCount++;
      }
      if (failedCount > 0) toast.error(`${failedCount} 張圖片上傳失敗，請重試`);
      if (succeededUrls.length > 0) onFilesUploaded(succeededUrls);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <BadgeIcon badgeId={badgeId} size={28} />
        <p className="font-medium text-sm">{name}</p>
      </div>
      <Textarea
        disabled={disabled}
        value={entry.description}
        onChange={e => { if (e.target.value.length <= MAX_EVIDENCE_DESCRIPTION_LENGTH) onDescriptionChange(e.target.value); }}
        placeholder="說明此徽章／認證的取得情形（選填）"
        rows={2}
        maxLength={MAX_EVIDENCE_DESCRIPTION_LENGTH}
      />
      <div className="flex flex-wrap gap-2">
        {entry.imageUrls.map(url => (
          <div key={url} className="relative w-16 h-16 rounded border overflow-hidden bg-muted group">
            <img src={url} alt="證明圖片" className="w-full h-full object-cover" />
            {!disabled && (
              <button
                type="button"
                onClick={() => onRemoveImage(url)}
                aria-label="移除這張證明圖片"
                className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        {!disabled && canAddMore && (
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="w-16 h-16 rounded border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center text-muted-foreground hover:border-primary hover:text-primary transition-colors"
          >
            {uploading ? <span className="text-[10px]">上傳中</span> : <><ImagePlus className="w-4 h-4" /><span className="text-[10px] mt-0.5">新增</span></>}
          </button>
        )}
      </div>
      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
    </div>
  );
}
