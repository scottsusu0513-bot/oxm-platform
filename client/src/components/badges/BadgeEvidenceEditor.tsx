import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Textarea } from "@/components/ui/textarea";
import { ImagePlus, Check } from "lucide-react";
import { toast } from "sonner";
import { sortBadgeIds, CERTIFICATION_BADGE_MAP, MAX_EVIDENCE_IMAGES_PER_BADGE, MAX_EVIDENCE_IMAGES_TOTAL, MAX_EVIDENCE_DESCRIPTION_LENGTH, type CertificationEvidenceSummaryEntry } from "@shared/badges";
import { BadgeIcon } from "./BadgeIcon";

/**
 * 上傳單張證明圖片。object key 全程只存在伺服器端（上傳成功當下就直接
 * 綁定進 certificationEvidence，見 server/routers.ts 的 uploadBadgeEvidence
 * ／server/db.ts 的 appendFactoryCertificationEvidenceImage），這裡只拿得到
 * 安全的統計數字，絕不會拿到 key、imageKeys 或任何網址。
 */
type UploadFn = (file: File, badgeId: string) => Promise<{ imageCount: number; hasEvidence: boolean }>;
const ACCEPTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_SIZE = 5 * 1024 * 1024;

function getEntry(evidence: CertificationEvidenceSummaryEntry[], badgeId: string): CertificationEvidenceSummaryEntry {
  const found = evidence.find(e => e.badgeId === badgeId);
  return found ?? { badgeId, description: "", hasEvidence: false, imageCount: 0 };
}

function withEntry(evidence: CertificationEvidenceSummaryEntry[], badgeId: string, patch: Partial<CertificationEvidenceSummaryEntry>): CertificationEvidenceSummaryEntry[] {
  const current = getEntry(evidence, badgeId);
  const next = { ...current, ...patch };
  return [...evidence.filter(e => e.badgeId !== badgeId), next];
}

/**
 * 每個已選徽章的說明文字 + 多張證明圖片上傳。
 * 已選徽章清單（badgeIds）與 evidence 摘要陣列由父層 FactoryDashboard 管理。
 *
 * 圖片上傳成功「當下」就直接在伺服器端綁定完成（見 uploadBadgeEvidence），
 * 不是「先暫存、等按下儲存才送出」的流程——因此這裡完全不經手、也不持有
 * 任何 object key，只顯示伺服器回傳的安全統計數字（是否已上傳／張數）。
 * 送出後工廠端不得再看到圖片縮圖或原圖（只有管理員能透過獨立的
 * getCertificationEvidenceViewUrls API 查看）。上傳前的縮圖預覽一律用瀏覽器
 * 本機 blob URL（URL.createObjectURL，零伺服器成本、不外流），上傳成功
 * 「當下」就立刻捨棄該預覽並 revoke，之後只顯示一個通用的「已上傳」勾選
 * 圖示，不再顯示任何圖片內容。
 *
 * 因為 key 完全不經過工廠端，這裡不再提供「移除已上傳圖片」功能——上傳即
 * 綁定完成，沒有「送出前可撤回」的中繼狀態。
 *
 * onEvidenceChange 採 React setState 的 functional-updater 慣例（直接傳入
 * useState 的 setter 即可）。
 */
export function BadgeEvidenceEditor({
  badgeIds,
  evidence,
  onEvidenceChange,
  onUploadImage,
  disabled,
}: {
  badgeIds: string[];
  evidence: CertificationEvidenceSummaryEntry[];
  onEvidenceChange: Dispatch<SetStateAction<CertificationEvidenceSummaryEntry[]>>;
  onUploadImage: UploadFn;
  disabled?: boolean;
}) {
  const sortedIds = sortBadgeIds(badgeIds);
  const totalImages = evidence.reduce((sum, e) => sum + e.imageCount, 0);

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
            remainingForBadge={Math.max(0, MAX_EVIDENCE_IMAGES_PER_BADGE - entry.imageCount)}
            remainingTotal={Math.max(0, MAX_EVIDENCE_IMAGES_TOTAL - totalImages)}
            onDescriptionChange={(v) => onEvidenceChange(prev => withEntry(prev, badgeId, { description: v }))}
            onUploadImage={onUploadImage}
            onUploaded={(result) => onEvidenceChange(prev => withEntry(prev, badgeId, {
              hasEvidence: result.hasEvidence,
              imageCount: result.imageCount,
            }))}
          />
        );
      })}
    </div>
  );
}

interface PendingPreview {
  id: string;
  objectUrl: string;
  status: "uploading" | "error";
}

function BadgeEvidenceRow({
  badgeId, name, entry, disabled, remainingForBadge, remainingTotal, onDescriptionChange, onUploadImage, onUploaded,
}: {
  badgeId: string;
  name: string;
  entry: CertificationEvidenceSummaryEntry;
  disabled?: boolean;
  remainingForBadge: number;
  remainingTotal: number;
  onDescriptionChange: (v: string) => void;
  onUploadImage: UploadFn;
  onUploaded: (result: { imageCount: number; hasEvidence: boolean }) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // 上傳中的本機預覽（blob URL）。上傳完成（無論成功或失敗）就立刻從這裡
  // 移除並 revoke，絕不會跟「已上傳」狀態混在一起顯示。
  const [pendingPreviews, setPendingPreviews] = useState<PendingPreview[]>([]);
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

    // 上傳前的本機預覽：純瀏覽器端 blob URL，讓使用者確認有沒有選對圖片，
    // 不經過伺服器。一律在這批上傳結束（無論成功或失敗）後立刻 revoke 並清空，
    // 不會殘留成可持續查看的縮圖。
    const previews: PendingPreview[] = toUpload.map((file, i) => ({
      id: `${Date.now()}-${i}`,
      objectUrl: URL.createObjectURL(file),
      status: "uploading",
    }));
    setPendingPreviews(previews);

    setUploading(true);
    try {
      // 伺服器端每次上傳都用 row lock 依序附加（見 appendFactoryCertificationEvidenceImage），
      // 但這裡仍依序（非並行）送出，避免同一批多檔在極短時間內互相搶著讀取
      // 「目前已達上限」的狀態，導致部分張數被判定超過上限而中途失敗。
      let lastResult: { imageCount: number; hasEvidence: boolean } | null = null;
      let succeededCount = 0;
      const failedReasons: string[] = [];
      for (const file of toUpload) {
        try {
          lastResult = await onUploadImage(file, badgeId);
          succeededCount++;
        } catch (err) {
          failedReasons.push(err instanceof Error ? err.message : "上傳失敗");
        }
      }
      if (failedReasons.length > 0) {
        // 顯示實際失敗原因（例如「請求過於頻繁，請稍後再試」）而非固定的通用文字，
        // 讓使用者能分辨是暫時性限流／格式錯誤，還是真的需要重新上傳。
        const uniqueReasons = Array.from(new Set(failedReasons));
        const detail = uniqueReasons.length === 1 ? uniqueReasons[0] : `${uniqueReasons.length} 種錯誤`;
        toast.error(`${failedReasons.length} 張圖片上傳失敗：${detail}`);
      }
      if (succeededCount > 0 && lastResult) onUploaded(lastResult);
    } finally {
      // 無論成功或失敗，本機預覽一律捨棄——成功的圖片改用下方的「已上傳」
      // 勾選圖示呈現，不再顯示圖片本身；失敗的也不該留下任何殘影。
      previews.forEach(p => URL.revokeObjectURL(p.objectUrl));
      setPendingPreviews([]);
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
        {/* 上傳前／上傳中：瀏覽器本機預覽，只在這批上傳完成前短暫存在 */}
        {pendingPreviews.map(p => (
          <div key={p.id} className="relative w-16 h-16 rounded border overflow-hidden bg-muted">
            <img src={p.objectUrl} alt="預覽中" className="w-full h-full object-cover opacity-70" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <span className="text-[10px] text-white">上傳中</span>
            </div>
          </div>
        ))}
        {/* 已送出成功：只顯示通用的「已上傳」勾選圖示與張數，不顯示圖片內容或
            任何網址／key。送出後工廠端無法、也不應該再看到這些圖片本身。 */}
        {entry.hasEvidence && (
          <div className="relative w-16 h-16 rounded border bg-green-50 flex flex-col items-center justify-center gap-0.5">
            <Check className="w-5 h-5 text-green-600" />
            <span className="text-[9px] text-green-700">已上傳 {entry.imageCount}</span>
          </div>
        )}
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
