import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { trpc } from "@/lib/trpc";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Plus, Pencil, Newspaper, Star, Trophy, Building2, Globe, Send, ArchiveRestore, Archive, RefreshCw, Image as ImageIcon, FileText as FileTextIcon, Trash2, Eye, ChevronDown, Copy } from "lucide-react";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import MarkdownContent, { toMarkdownPreviewText } from "@/components/MarkdownContent";
import { MarkdownToolbar, insertAtCursor } from "@/components/MarkdownToolbar";
import { OrderDatePicker } from "@/components/OrderDatePicker";
import { formatLocalDate } from "@/lib/orderDateChain";
import { openExternalUrl } from "@/lib/platform";
import { INDUSTRIES } from "@shared/constants";

const COVER_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
/** slug 手動輸入時的即時格式檢查，跟後端 isValidNewsSlug 同一套規則。 */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

type AttachmentExpirationType = "after_publish_30d" | "custom" | "never";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 把日期選擇器的 YYYY-MM-DD 與 <input type="time"> 的 HH:mm 組成一個 Date，
 * 用瀏覽器「本地時區」的年月日時分建構（跟 OrderDatePicker／parseLocalDate
 * 同一套慣例：管理員後台預期在台灣時區操作，Date 物件內部仍是絕對時間，
 * .toISOString() 會正確換算成 UTC，不需要額外的時區換算函式庫）。
 */
function combineDateTimeToISO(dateStr: string, timeStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = (timeStr || "23:59").split(":").map(Number);
  return new Date(year, (month || 1) - 1, day || 1, hour || 0, minute || 0, 0, 0).toISOString();
}

/** 跟後端 isValidNewsSourceUrl 同一套規則的前端即時檢查：只接受完整 http(s) 網址。 */
function isValidSourceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

type StagedFile = { localId: string; file: File };
type FailedFile = { localId: string; file: File; error: string };

type FormState = {
  slug: string;
  title: string;
  summary: string;
  content: string;
  isImportant: boolean;
  isCompetition: boolean;
  isExhibition: boolean;
  isCrossIndustry: boolean;
  industryNames: string[];
  coverImageUrl: string | null;
  sourceName: string;
  sourceUrl: string;
};
const DEFAULT_FORM: FormState = {
  slug: "", title: "", summary: "", content: "",
  isImportant: false, isCompetition: false, isExhibition: false, isCrossIndustry: false, industryNames: [],
  coverImageUrl: null,
  sourceName: "", sourceUrl: "",
};

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft:     { label: "草稿",   className: "bg-slate-100 text-slate-600 border-slate-200" },
  published: { label: "已發布", className: "bg-green-100 text-green-700 border-green-200" },
  withdrawn: { label: "已下架", className: "bg-amber-100 text-amber-700 border-amber-200" },
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function newLocalId(file: File): string {
  return `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function AdminNews() {
  const { user, loading } = useAuth();
  if (loading) return <AppLoading />;
  if (!user || user.role !== "admin") return <div className="flex items-center justify-center min-h-screen text-muted-foreground">無權限</div>;
  return <AdminNewsContent />;
}

function AdminNewsContent() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [savedSlugPreview, setSavedSlugPreview] = useState<string | null>(null);
  const [savingProgress, setSavingProgress] = useState<string | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [contentImageUploading, setContentImageUploading] = useState(false);
  const [pdfUploading, setPdfUploading] = useState(false);
  const [pdfExpirationType, setPdfExpirationType] = useState<AttachmentExpirationType>("after_publish_30d");
  const [pdfCustomDate, setPdfCustomDate] = useState("");
  const [pdfCustomTime, setPdfCustomTime] = useState("23:59");
  const [editingExpirationId, setEditingExpirationId] = useState<number | null>(null);
  const [previewingId, setPreviewingId] = useState<number | null>(null);
  const [rowExpirationType, setRowExpirationType] = useState<AttachmentExpirationType>("after_publish_30d");
  const [rowCustomDate, setRowCustomDate] = useState("");
  const [rowCustomTime, setRowCustomTime] = useState("23:59");

  // 尚未儲存草稿（沒有 newsId）時，選擇的封面/PDF 只暫存在前端記憶體，不會
  // 提前上傳；第一次「儲存草稿」成功拿到 newsId 後才依序自動上傳，見
  // uploadStagedFilesAfterCreate。已經有 newsId 時選檔則沿用既有的立即上傳。
  const [stagedCoverFile, setStagedCoverFile] = useState<File | null>(null);
  const [stagedCoverPreviewUrl, setStagedCoverPreviewUrl] = useState<string | null>(null);
  const [stagedPdfFiles, setStagedPdfFiles] = useState<StagedFile[]>([]);
  const [failedPdfFiles, setFailedPdfFiles] = useState<FailedFile[]>([]);

  const contentRef = useRef<HTMLTextAreaElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const contentImageInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();
  const { data: items = [], isLoading } = trpc.news.adminList.useQuery();
  const { data: attachments = [] } = trpc.news.getAdminAttachments.useQuery(
    { newsId: editingId ?? 0 },
    { enabled: !!editingId },
  );
  const editingItem = items.find(i => i.id === editingId);
  // 一旦發布過，slug 就已經可能流通出去，後端 updateNews 會直接拒絕修改
  // （見 server/db.ts）；前端這裡只是提早把欄位鎖起來，不是唯一防線。
  const slugLocked = !!editingItem?.firstPublishedAt;

  // 看板訂閱上線後，任何分類設定都可能有人明確訂閱了「全部最新」或這篇消息
  // 對應的看板（包含純競賽／純展覽），不再有「這個分類設定保證 0 收件人」的
  // 情況，所以一律查詢預估，不再靠 isImportant／industryNames 判斷要不要查。
  const { data: estimate } = trpc.news.estimateRecipients.useQuery({
    isImportant: form.isImportant,
    isCompetition: form.isCompetition,
    isExhibition: form.isExhibition,
    isCrossIndustry: form.isCrossIndustry,
    industryNames: form.industryNames,
  });

  const createMut = trpc.news.create.useMutation({
    onSuccess: () => { utils.news.adminList.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const updateMut = trpc.news.update.useMutation({
    onSuccess: () => { utils.news.adminList.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const retryMut = trpc.news.retryNotifications.useMutation({
    onSuccess: (result) => {
      if (result.total === 0) { toast.info("目前沒有待補送的通知"); return; }
      toast.success(`已重試 ${result.total} 筆：Email 成功 ${result.emailRetried}、推播成功 ${result.pushRetried}`);
    },
    onError: e => toast.error(e.message),
  });
  const uploadCoverMut = trpc.news.uploadCoverImage.useMutation();
  const removeCoverMut = trpc.news.removeCoverImage.useMutation();
  const uploadContentImageMut = trpc.news.uploadContentImage.useMutation();
  const createPdfUploadSessionMut = trpc.news.createPdfUploadSession.useMutation();
  const finalizePdfUploadMut = trpc.news.finalizePdfUpload.useMutation();
  const updateAttachmentExpirationMut = trpc.news.updateAttachmentExpiration.useMutation();
  const deleteAttachmentMut = trpc.news.deleteAttachment.useMutation();
  const getPdfDownloadUrlMut = trpc.news.getPdfDownloadUrl.useMutation();

  const resetForm = () => {
    if (stagedCoverPreviewUrl) URL.revokeObjectURL(stagedCoverPreviewUrl);
    setForm(DEFAULT_FORM);
    setEditingId(null);
    setShowForm(false);
    setAdvancedOpen(false);
    setSavedSlugPreview(null);
    setSavingProgress(null);
    setPdfExpirationType("after_publish_30d");
    setPdfCustomDate("");
    setPdfCustomTime("23:59");
    setEditingExpirationId(null);
    setStagedCoverFile(null);
    setStagedCoverPreviewUrl(null);
    setStagedPdfFiles([]);
    setFailedPdfFiles([]);
  };

  const setContent = (next: string) => setForm(p => ({ ...p, content: next }));

  const handleEdit = (item: (typeof items)[number]) => {
    if (stagedCoverPreviewUrl) URL.revokeObjectURL(stagedCoverPreviewUrl);
    setForm({
      slug: item.slug,
      title: item.title,
      summary: item.summary,
      content: item.content,
      isImportant: item.isImportant,
      isCompetition: item.isCompetition,
      isExhibition: item.isExhibition,
      isCrossIndustry: item.isCrossIndustry,
      industryNames: item.industryNames,
      coverImageUrl: item.coverImageUrl ?? null,
      sourceName: item.sourceName ?? "",
      sourceUrl: item.sourceUrl ?? "",
    });
    setEditingId(item.id);
    setSavedSlugPreview(item.slug);
    setStagedCoverFile(null);
    setStagedCoverPreviewUrl(null);
    setStagedPdfFiles([]);
    setFailedPdfFiles([]);
    setShowForm(true);
  };

  const toggleIndustry = (name: string, checked: boolean) => {
    setForm(p => ({
      ...p,
      industryNames: checked ? [...p.industryNames, name] : p.industryNames.filter(n => n !== name),
    }));
  };

  const confirmPublishMessage = () => {
    if (!estimate) return "確定要發布這則消息嗎？";
    if (estimate.inAppCount === 0) return "確定要發布這則消息嗎？目前沒有會員訂閱這則消息適用的看板，不會建立站內通知或寄送 Email／App 推播，只會顯示在網站上。";
    return `確定要發布這則消息嗎？預計通知 ${estimate.inAppCount} 位會員：站內通知 ${estimate.inAppCount}、Email ${estimate.emailCount}、App 推播 ${estimate.pushCount}（僅在第一次發布時建立一次，之後編輯不會再次通知）。`;
  };

  const buildPayload = () => ({
    slug: form.slug.trim() || undefined,
    title: form.title.trim(),
    summary: form.summary.trim(),
    content: form.content,
    isImportant: form.isImportant,
    isCompetition: form.isCompetition,
    isExhibition: form.isExhibition,
    isCrossIndustry: form.isCrossIndustry,
    industryNames: form.industryNames,
    sourceName: form.sourceName.trim() || null,
    sourceUrl: form.sourceUrl.trim() || null,
  });

  const validateRequired = () => {
    if (!form.title.trim() || !form.summary.trim() || !form.content.trim()) {
      toast.error("請填寫標題、摘要與內容");
      return false;
    }
    if (form.slug.trim() && !SLUG_PATTERN.test(form.slug.trim())) {
      toast.error("網址代稱只能是小寫英文、數字與連字號");
      return false;
    }
    if (form.sourceName.trim() && !form.sourceUrl.trim()) {
      toast.error("請填寫原始消息網址");
      return false;
    }
    if (form.sourceUrl.trim() && !isValidSourceUrl(form.sourceUrl.trim())) {
      toast.error("原始消息網址格式不正確，僅接受 http(s) 開頭的完整網址");
      return false;
    }
    return true;
  };

  const validateImageFile = (file: File): string | null => {
    if (!COVER_MIME_TYPES.includes(file.type)) return "僅支援 JPG、PNG、WebP 格式";
    if (file.size > MAX_IMAGE_BYTES) return "圖片大小不得超過 10MB";
    return null;
  };

  const validatePdfFile = (file: File): string | null => {
    if (file.type !== "application/pdf") return "僅支援 PDF 格式";
    if (file.size > MAX_PDF_BYTES) return "PDF 大小不得超過 25MB";
    return null;
  };

  /** 真正呼叫後端上傳封面（base64 in、URL out），editingId 一定已存在才會呼叫這個函式。 */
  const uploadCoverNow = async (newsId: number, file: File): Promise<boolean> => {
    setCoverUploading(true);
    try {
      const base64 = await fileToBase64(file);
      const result = await uploadCoverMut.mutateAsync({ newsId, base64, mimeType: file.type });
      setForm(p => ({ ...p, coverImageUrl: result.url }));
      utils.news.adminList.invalidate();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "封面上傳失敗");
      return false;
    } finally {
      setCoverUploading(false);
    }
  };

  const handleCoverFileSelected = (file: File | undefined) => {
    if (coverInputRef.current) coverInputRef.current.value = "";
    if (!file) return;
    const err = validateImageFile(file);
    if (err) { toast.error(err); return; }
    if (!editingId) {
      // 尚未儲存草稿：只暫存在前端記憶體＋顯示本機預覽，不提前上傳。
      if (stagedCoverPreviewUrl) URL.revokeObjectURL(stagedCoverPreviewUrl);
      setStagedCoverFile(file);
      setStagedCoverPreviewUrl(URL.createObjectURL(file));
      return;
    }
    void uploadCoverNow(editingId, file);
  };

  const handleRemoveCover = async () => {
    if (stagedCoverFile) {
      if (stagedCoverPreviewUrl) URL.revokeObjectURL(stagedCoverPreviewUrl);
      setStagedCoverFile(null);
      setStagedCoverPreviewUrl(null);
      return;
    }
    if (!editingId) return;
    setCoverUploading(true);
    try {
      await removeCoverMut.mutateAsync({ newsId: editingId });
      setForm(p => ({ ...p, coverImageUrl: null }));
      utils.news.adminList.invalidate();
      toast.success("封面已移除");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "移除失敗");
    } finally {
      setCoverUploading(false);
    }
  };

  const handleContentImageSelected = async (file: File | undefined) => {
    if (!file || !editingId) return;
    const err = validateImageFile(file);
    if (err) { toast.error(err); return; }
    setContentImageUploading(true);
    try {
      const base64 = await fileToBase64(file);
      const result = await uploadContentImageMut.mutateAsync({ newsId: editingId, base64, mimeType: file.type, fileName: file.name });
      const markdown = `![${result.altText}](${result.url})`;
      if (contentRef.current) {
        insertAtCursor(contentRef.current, form.content, setContent, markdown);
      } else {
        setContent(`${form.content}\n${markdown}\n`);
      }
      toast.success("圖片已插入內容");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "圖片上傳失敗");
    } finally {
      setContentImageUploading(false);
      if (contentImageInputRef.current) contentImageInputRef.current.value = "";
    }
  };

  /**
   * 真正呼叫後端上傳一份 PDF（presigned 直傳 S3 → finalize 二次驗證），
   * editingId 一定已存在才會呼叫。回傳結果、不丟出例外，方便呼叫端決定要
   * 立即 toast 還是放進待重試佇列。
   */
  const uploadPdfNow = async (newsId: number, file: File): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      const session = await createPdfUploadSessionMut.mutateAsync({
        newsId, fileName: file.name, declaredMimeType: file.type, declaredSizeBytes: file.size,
      });
      const putRes = await fetch(session.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      });
      if (!putRes.ok) throw new Error("檔案上傳失敗，請重試");

      await finalizePdfUploadMut.mutateAsync({
        newsId,
        storageKey: session.storageKey,
        displayName: file.name.replace(/\.pdf$/i, "") || file.name,
        originalFileName: file.name,
        expirationType: pdfExpirationType,
        customDownloadExpiresAt: pdfExpirationType === "custom" ? combineDateTimeToISO(pdfCustomDate, pdfCustomTime) : undefined,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "PDF 上傳失敗" };
    }
  };

  const uploadPdfImmediately = async (newsId: number, file: File) => {
    setPdfUploading(true);
    const result = await uploadPdfNow(newsId, file);
    setPdfUploading(false);
    if (result.ok) {
      utils.news.getAdminAttachments.invalidate({ newsId });
      toast.success(`${file.name} 已上傳`);
    } else {
      // 保留失敗檔案讓管理員重試，不是提示完就把檔案丟掉。
      setFailedPdfFiles(prev => [...prev, { localId: newLocalId(file), file, error: result.error }]);
      toast.error(`${file.name}：${result.error}`);
    }
  };

  const handlePdfFilesSelected = (fileList: FileList | null) => {
    const resetInput = () => { if (pdfInputRef.current) pdfInputRef.current.value = ""; };
    if (!fileList || fileList.length === 0) { resetInput(); return; }
    const files = Array.from(fileList);

    const currentCount = attachments.length + stagedPdfFiles.length + failedPdfFiles.length;
    const room = MAX_ATTACHMENTS - currentCount;
    if (room <= 0) {
      toast.error(`每篇消息最多只能有 ${MAX_ATTACHMENTS} 份附件`);
      resetInput();
      return;
    }
    if (pdfExpirationType === "custom" && !pdfCustomDate && editingId) {
      toast.error("請先選擇自訂到期日期，再選擇 PDF 檔案");
      resetInput();
      return;
    }

    const accepted = files.slice(0, room);
    if (files.length > accepted.length) {
      toast.error(`最多還能選 ${room} 份，已自動只加入前 ${accepted.length} 份`);
    }

    for (const file of accepted) {
      const err = validatePdfFile(file);
      if (err) { toast.error(`${file.name}：${err}`); continue; }
      if (!editingId) {
        // 尚未儲存草稿：先暫存檔名/大小，等第一次「儲存草稿」成功後才依序上傳。
        setStagedPdfFiles(prev => [...prev, { localId: newLocalId(file), file }]);
      } else {
        void uploadPdfImmediately(editingId, file);
      }
    }
    resetInput();
  };

  const removeStagedPdf = (localId: string) => setStagedPdfFiles(prev => prev.filter(f => f.localId !== localId));
  const removeFailedPdf = (localId: string) => setFailedPdfFiles(prev => prev.filter(f => f.localId !== localId));

  const retryFailedPdf = async (localId: string) => {
    if (!editingId) return;
    const target = failedPdfFiles.find(f => f.localId === localId);
    if (!target) return;
    setPdfUploading(true);
    const result = await uploadPdfNow(editingId, target.file);
    setPdfUploading(false);
    if (result.ok) {
      setFailedPdfFiles(prev => prev.filter(f => f.localId !== localId));
      utils.news.getAdminAttachments.invalidate({ newsId: editingId });
      toast.success(`${target.file.name} 已上傳`);
    } else {
      setFailedPdfFiles(prev => prev.map(f => (f.localId === localId ? { ...f, error: result.error } : f)));
      toast.error(`${target.file.name}：${result.error}`);
    }
  };

  /**
   * 第一次「儲存草稿」拿到 newsId 後（或既有草稿還留有上次沒上傳完的暫存
   * 檔案時），依序自動上傳已選的封面／PDF。成功一份就從待上傳佇列移除，
   * 不會因為重試整個流程而重複建立附件；失敗的檔案移到 failedPdfFiles
   * 讓管理員可以個別重試，不影響已經成功的檔案，也不會讓草稿被視為建立失敗。
   */
  const uploadStagedFilesAfterCreate = async (newsId: number): Promise<{ coverFailed: boolean; pdfFailedCount: number; pdfTotal: number }> => {
    let coverFailed = false;
    if (stagedCoverFile) {
      setSavingProgress("正在上傳封面圖片…");
      const ok = await uploadCoverNow(newsId, stagedCoverFile);
      if (ok) {
        if (stagedCoverPreviewUrl) URL.revokeObjectURL(stagedCoverPreviewUrl);
        setStagedCoverFile(null);
        setStagedCoverPreviewUrl(null);
      } else {
        coverFailed = true;
      }
    }

    const queue = stagedPdfFiles;
    let pdfFailedCount = 0;
    for (let i = 0; i < queue.length; i++) {
      setSavingProgress(`正在上傳 PDF（${i + 1}/${queue.length}）…`);
      const result = await uploadPdfNow(newsId, queue[i].file);
      if (result.ok) {
        setStagedPdfFiles(prev => prev.filter(f => f.localId !== queue[i].localId));
      } else {
        pdfFailedCount++;
        setStagedPdfFiles(prev => prev.filter(f => f.localId !== queue[i].localId));
        setFailedPdfFiles(prev => [...prev, { ...queue[i], error: result.error }]);
      }
    }
    if (queue.length > 0) {
      utils.news.getAdminAttachments.invalidate({ newsId });
    }
    setSavingProgress(null);
    return { coverFailed, pdfFailedCount, pdfTotal: queue.length };
  };

  const reportUploadOutcome = (baseMessage: string, coverFailed: boolean, pdfFailedCount: number, pdfTotal: number) => {
    if (pdfTotal > 0 && pdfFailedCount > 0) {
      toast.error(`${baseMessage}，但有 ${pdfFailedCount}/${pdfTotal} 份 PDF 上傳失敗，請重試`);
    } else if (coverFailed) {
      toast.error(`${baseMessage}，但封面圖片上傳失敗，請重試`);
    } else {
      toast.success(baseMessage);
    }
  };

  // 草稿儲存不重置表單、不關閉編輯區——第一次儲存拿到 newsId 後，會自動依序
  // 上傳已選的封面／PDF（見 uploadStagedFilesAfterCreate），管理員能接著在
  // 同一個畫面繼續操作，不必重新打開編輯。
  const handleSaveDraft = () => {
    if (!validateRequired()) return;
    if (editingId) {
      setSavingProgress("儲存草稿中…");
      updateMut.mutate({ id: editingId, ...buildPayload(), status: "draft" }, {
        onSuccess: async () => {
          setSavedSlugPreview(form.slug.trim() || editingItem?.slug || savedSlugPreview);
          const { coverFailed, pdfFailedCount, pdfTotal } = await uploadStagedFilesAfterCreate(editingId);
          reportUploadOutcome("草稿已更新", coverFailed, pdfFailedCount, pdfTotal);
        },
        onError: () => setSavingProgress(null),
      });
    } else {
      setSavingProgress("建立草稿中…");
      createMut.mutate({ ...buildPayload(), status: "draft" }, {
        onSuccess: async (result) => {
          setEditingId(result.id);
          setSavedSlugPreview(result.slug || null);
          const { coverFailed, pdfFailedCount, pdfTotal } = await uploadStagedFilesAfterCreate(result.id);
          reportUploadOutcome("草稿已儲存", coverFailed, pdfFailedCount, pdfTotal);
        },
        onError: () => setSavingProgress(null),
      });
    }
  };

  const handlePublish = () => {
    if (!validateRequired()) return;
    if (!confirm(confirmPublishMessage())) return;
    if (editingId) {
      setSavingProgress("發布中…");
      updateMut.mutate({ id: editingId, ...buildPayload(), status: "published" }, {
        onSuccess: async () => {
          const { coverFailed, pdfFailedCount, pdfTotal } = await uploadStagedFilesAfterCreate(editingId);
          if (pdfFailedCount > 0 || coverFailed) {
            reportUploadOutcome("消息已發布", coverFailed, pdfFailedCount, pdfTotal);
          } else {
            toast.success("消息已發布");
            resetForm();
          }
        },
        onError: () => setSavingProgress(null),
      });
    } else {
      setSavingProgress("發布中…");
      createMut.mutate({ ...buildPayload(), status: "published" }, {
        onSuccess: async (result) => {
          setEditingId(result.id);
          setSavedSlugPreview(result.slug || null);
          const { coverFailed, pdfFailedCount, pdfTotal } = await uploadStagedFilesAfterCreate(result.id);
          if (pdfFailedCount > 0 || coverFailed) {
            reportUploadOutcome("消息已發布", coverFailed, pdfFailedCount, pdfTotal);
          } else {
            toast.success("消息已發布");
            resetForm();
          }
        },
        onError: () => setSavingProgress(null),
      });
    }
  };

  const handleWithdraw = (id: number) => {
    if (!confirm("確定要下架這則消息嗎？下架後不會在網站上顯示，重新發布不會再次寄送通知。")) return;
    updateMut.mutate({ id, status: "withdrawn" });
  };

  const handleRepublish = (id: number) => {
    if (!confirm("確定要重新發布這則消息嗎？（此消息已發布過，重新發布不會再次寄送 Email／推播通知）")) return;
    updateMut.mutate({ id, status: "published" });
  };

  const handleDeleteAttachment = (id: number) => {
    if (!editingId) return;
    if (!confirm("確定要刪除這份附件嗎？刪除後無法復原，已下載過的會員不受影響。")) return;
    deleteAttachmentMut.mutate({ id }, {
      onSuccess: () => {
        utils.news.getAdminAttachments.invalidate({ newsId: editingId });
        toast.success("附件已刪除");
      },
      onError: e => toast.error(e.message),
    });
  };

  // 管理員預覽：呼叫跟公開頁完全相同的 news.getPdfDownloadUrl，後端會用
  // ctx.user.role==='admin' 判斷放行「已過期但實體檔案尚未被 Cron 清除」的
  // 附件；storageDeletedAt 有值的附件連這個入口都不會出現按鈕（見上面 UI
  // 條件），後端也一律拒絕，管理員無法繞過。回傳的 signed URL 一樣最長 5 分鐘。
  const handleAdminPreview = async (attachmentId: number) => {
    setPreviewingId(attachmentId);
    try {
      const result = await getPdfDownloadUrlMut.mutateAsync({ attachmentId });
      await openExternalUrl(result.url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "取得預覽連結失敗");
    } finally {
      setPreviewingId(null);
    }
  };

  const startEditExpiration = (att: (typeof attachments)[number]) => {
    setEditingExpirationId(att.id);
    setRowExpirationType(att.expirationType as AttachmentExpirationType);
    if (att.downloadExpiresAt) {
      const d = new Date(att.downloadExpiresAt);
      setRowCustomDate(formatLocalDate(d));
      setRowCustomTime(format(d, "HH:mm"));
    } else {
      setRowCustomDate("");
      setRowCustomTime("23:59");
    }
  };

  const handleApplyExpiration = (id: number) => {
    if (!editingId) return;
    if (rowExpirationType === "custom" && !rowCustomDate) { toast.error("請選擇自訂到期日期"); return; }
    updateAttachmentExpirationMut.mutate({
      id,
      expirationType: rowExpirationType,
      customDownloadExpiresAt: rowExpirationType === "custom" ? combineDateTimeToISO(rowCustomDate, rowCustomTime) : undefined,
    }, {
      onSuccess: () => {
        utils.news.getAdminAttachments.invalidate({ newsId: editingId });
        setEditingExpirationId(null);
        toast.success("到期規則已更新");
      },
      onError: e => toast.error(e.message),
    });
  };

  const handleCopySlugUrl = () => {
    if (!savedSlugPreview) return;
    const url = `${window.location.origin}/news/${savedSlugPreview}`;
    navigator.clipboard.writeText(url).then(
      () => toast.success("已複製網址"),
      () => toast.error("複製失敗，請手動複製"),
    );
  };

  const isBusy = createMut.isPending || updateMut.isPending || savingProgress !== null;
  const coverPreviewSrc = stagedCoverPreviewUrl ?? form.coverImageUrl;
  const totalPdfCount = attachments.length + stagedPdfFiles.length + failedPdfFiles.length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-blue-50 px-4 pb-4 md:px-8 md:pb-8 admin-page-top">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <FloatingBackButton fallbackHref="/admin" noNavbar />
          <div className="flex items-center gap-2">
            <Newspaper className="w-6 h-6 text-indigo-500" />
            <h1 className="text-2xl font-bold">消息管理</h1>
          </div>
          {!showForm && (
            <Button onClick={() => setShowForm(true)} className="gap-2 bg-indigo-500 hover:bg-indigo-600 text-white border-0">
              <Plus className="w-4 h-4" />新增消息
            </Button>
          )}
        </div>

        {showForm && (
          <Card className="mb-6 border-indigo-200">
            <CardHeader>
              <CardTitle className="text-lg">{editingId ? "編輯消息" : "新增消息"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 1. 標題 */}
              <div>
                <Label>標題 *</Label>
                <Input
                  value={form.title}
                  onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                  placeholder="消息標題"
                  className="mt-1"
                />
              </div>

              {/* 進階設定：網址代稱（slug）。預設由後端自動產生，管理員可在第一次
                  發布前自訂；發布後後端一律拒絕修改，這裡的 disabled 只是提早
                  給出視覺提示。 */}
              <div className="border rounded-md">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen(v => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                  aria-expanded={advancedOpen}
                >
                  進階設定
                  <ChevronDown className={`w-4 h-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
                </button>
                {advancedOpen && (
                  <div className="px-3 pb-3 pt-0.5 border-t">
                    <Label className="text-xs">網址代稱（slug）</Label>
                    {slugLocked ? (
                      <>
                        <Input value={form.slug} disabled className="mt-1 bg-muted/50" />
                        <p className="text-xs text-muted-foreground mt-1">此消息已發布過，網址代稱無法修改。</p>
                      </>
                    ) : (
                      <>
                        <Input
                          value={form.slug}
                          onChange={e => setForm(p => ({ ...p, slug: e.target.value }))}
                          placeholder="系統將自動產生網址"
                          className="mt-1"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          留空由系統自動產生；只能是小寫英文、數字與連字號，第一次發布後將無法再修改。
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* 儲存草稿後的網址預覽＋複製按鈕 */}
              {savedSlugPreview && (
                <div className="flex items-center gap-2 text-xs bg-muted/50 border rounded-md px-3 py-2">
                  <span className="text-muted-foreground shrink-0">網址：</span>
                  <code className="flex-1 truncate">{`${window.location.origin}/news/${savedSlugPreview}`}</code>
                  <Button type="button" size="sm" variant="ghost" className="h-6 px-2 shrink-0" onClick={handleCopySlugUrl} aria-label="複製網址">
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}

              {/* 2. 摘要 */}
              <div>
                <Label>摘要 *</Label>
                <Textarea
                  value={form.summary}
                  onChange={e => setForm(p => ({ ...p, summary: e.target.value }))}
                  placeholder="列表頁與 Email 通知會顯示這段摘要（建議 2-3 句話）"
                  rows={2}
                  className="mt-1"
                />
              </div>

              {/* 3. 分類與產業 */}
              <div>
                <Label>分類</Label>
                <div className="flex flex-wrap gap-4 mt-2">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={form.isImportant} onCheckedChange={v => setForm(p => ({ ...p, isImportant: v === true }))} />
                    <Star className="w-3.5 h-3.5 text-amber-500" />重要消息
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={form.isCompetition} onCheckedChange={v => setForm(p => ({ ...p, isCompetition: v === true }))} />
                    <Trophy className="w-3.5 h-3.5 text-orange-500" />競賽消息
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={form.isExhibition} onCheckedChange={v => setForm(p => ({ ...p, isExhibition: v === true }))} />
                    <Building2 className="w-3.5 h-3.5 text-blue-500" />展覽消息
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={form.isCrossIndustry} onCheckedChange={v => setForm(p => ({ ...p, isCrossIndustry: v === true }))} />
                    <Globe className="w-3.5 h-3.5 text-teal-500" />跨產業資訊
                  </label>
                </div>
              </div>

              <div>
                <Label>產業（可複選，同時決定會出現在哪些產業分類，也決定產業會員通知）</Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2 max-h-48 overflow-y-auto border rounded-md p-3">
                  {INDUSTRIES.map(ind => (
                    <label key={ind.name} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={form.industryNames.includes(ind.name)}
                        onCheckedChange={v => toggleIndustry(ind.name, v === true)}
                      />
                      {ind.name}
                    </label>
                  ))}
                </div>
              </div>

              <div className="text-xs rounded-md px-3 py-2 bg-muted/50 border">
                {estimate && estimate.inAppCount > 0
                  ? `此設定發布時（僅第一次發布）預計通知 ${estimate.inAppCount} 位會員：站內通知 ${estimate.inAppCount}、Email ${estimate.emailCount}、App 推播 ${estimate.pushCount}。看板訂閱者才會收到，不是所有會員。`
                  : "此設定目前沒有會員訂閱對應看板，發布後不會建立站內通知，也不會寄送 Email 或 App 推播（只會顯示在網站上）。"}
              </div>

              {/* 4. 封面圖片：獨立於下方檔案附件區塊的另一組上傳元件 */}
              <div>
                <Label>封面圖片（選填）</Label>
                <div className="mt-1.5">
                  <div className="relative w-full aspect-video rounded-lg border overflow-hidden bg-muted/30">
                    {coverPreviewSrc ? (
                      <img src={coverPreviewSrc} alt="封面預覽" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground">
                        <ImageIcon className="w-8 h-8 mb-1.5 opacity-40" />
                        <p className="text-xs">尚未選擇圖片</p>
                      </div>
                    )}
                  </div>
                  <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={e => handleCoverFileSelected(e.target.files?.[0])}
                  />
                  <div className="flex gap-2 mt-2">
                    <Button
                      type="button" size="sm" variant="outline" disabled={coverUploading}
                      aria-label="從電腦選擇圖片"
                      onClick={() => coverInputRef.current?.click()}
                    >
                      {coverUploading ? "處理中..." : "從電腦選擇圖片"}
                    </Button>
                    {(coverPreviewSrc) && (
                      <Button type="button" size="sm" variant="outline" disabled={coverUploading} className="text-red-500 hover:bg-red-50" onClick={handleRemoveCover}>
                        移除
                      </Button>
                    )}
                  </div>
                  {stagedCoverFile && (
                    <p className="text-xs text-indigo-600 mt-1">尚未儲存草稿，儲存後會自動上傳這張圖片。</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">支援 JPG／PNG／WebP，最大 10MB，建議比例 16:9</p>
                </div>
              </div>

              {/* 5+6. Markdown 工具列與內容 */}
              <div>
                <Label>內容 *（支援 Markdown）</Label>
                <MarkdownToolbar
                  contentRef={contentRef}
                  content={form.content}
                  onChange={setContent}
                  extraButtons={
                    <>
                      <div className="w-px h-4 bg-border mx-0.5" />
                      <input
                        ref={contentImageInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={e => handleContentImageSelected(e.target.files?.[0])}
                      />
                      <button
                        type="button"
                        title={editingId ? "上傳圖片" : "請先儲存草稿才能上傳圖片"}
                        aria-label="上傳圖片"
                        disabled={!editingId || contentImageUploading}
                        onClick={() => contentImageInputRef.current?.click()}
                        className="flex items-center gap-1 p-1.5 rounded hover:bg-white hover:shadow-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                      >
                        <ImageIcon className="w-3.5 h-3.5" />
                        {contentImageUploading && <span className="text-[10px]">上傳中…</span>}
                      </button>
                    </>
                  }
                />
                <Textarea
                  ref={contentRef}
                  value={form.content}
                  onChange={e => setForm(p => ({ ...p, content: e.target.value }))}
                  placeholder="消息完整內容...（支援 Markdown：**粗體**、# 標題、[連結](https://...)）"
                  rows={8}
                  className="mt-1"
                />
                {/* 7. 即時預覽 */}
                <div className="mt-2">
                  <Label className="text-xs text-muted-foreground">即時效果</Label>
                  <div className="mt-1 min-h-[80px] rounded-md border border-dashed bg-muted/20 px-3 py-2 overflow-x-hidden break-words">
                    {form.content.trim() ? (
                      <MarkdownContent content={form.content} allowImages />
                    ) : (
                      <p className="text-sm text-muted-foreground">輸入內容後，格式效果會顯示在這裡。</p>
                    )}
                  </div>
                </div>
              </div>

              {/* 原始消息來源（選填） */}
              <div>
                <Label className="text-sm font-medium">原始消息來源（選填）</Label>
                <div className="grid sm:grid-cols-2 gap-4 mt-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">來源單位</Label>
                    <Input
                      value={form.sourceName}
                      onChange={e => setForm(p => ({ ...p, sourceName: e.target.value }))}
                      placeholder="例如：經濟部中小及新創企業署"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">原始消息網址</Label>
                    <Input
                      value={form.sourceUrl}
                      onChange={e => setForm(p => ({ ...p, sourceUrl: e.target.value }))}
                      placeholder="https://www.example.gov.tw/..."
                      className="mt-1"
                    />
                    {form.sourceName.trim() && !form.sourceUrl.trim() && (
                      <p className="text-xs text-red-500 mt-1">請填寫原始消息網址</p>
                    )}
                  </div>
                </div>
              </div>

              {/* 8. PDF 附件：跟封面完全獨立的區塊 */}
              <div>
                <Label>PDF 附件（選填，最多 {MAX_ATTACHMENTS} 份，單檔最大 25MB）</Label>
                <div className="mt-1.5 space-y-2.5">
                  {attachments.map(att => (
                    <div key={att.id} className="rounded-md border px-3 py-2.5 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileTextIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
                          <span className="truncate font-medium">{att.displayName}</span>
                          <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(att.sizeBytes)}</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {!att.isStorageDeleted && (
                            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => startEditExpiration(att)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-red-500 hover:bg-red-50" onClick={() => handleDeleteAttachment(att.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>

                      {att.isStorageDeleted ? (
                        <p className="text-xs text-amber-600 mt-1.5">檔案已從儲存空間刪除，如需重新提供，請重新上傳。</p>
                      ) : editingExpirationId === att.id ? (
                        <div className="mt-2 rounded-md bg-muted/30 p-2.5 space-y-2">
                          <RadioGroup value={rowExpirationType} onValueChange={v => setRowExpirationType(v as AttachmentExpirationType)} className="gap-1.5">
                            <label className="flex items-start gap-2 text-xs">
                              <RadioGroupItem value="after_publish_30d" className="mt-0.5" />
                              <span>發布後 30 天</span>
                            </label>
                            <label className="flex items-start gap-2 text-xs">
                              <RadioGroupItem value="custom" className="mt-0.5" />
                              <span>自訂到期時間</span>
                            </label>
                            <label className="flex items-start gap-2 text-xs">
                              <RadioGroupItem value="never" className="mt-0.5" />
                              <span>永久有效</span>
                            </label>
                          </RadioGroup>
                          {rowExpirationType === "custom" && (
                            <div className="flex gap-2">
                              <OrderDatePicker value={rowCustomDate} onChange={setRowCustomDate} minDate={formatLocalDate(new Date())} className="flex-1" />
                              <input
                                type="time"
                                value={rowCustomTime}
                                onChange={e => setRowCustomTime(e.target.value)}
                                className="border rounded-md px-2 text-sm bg-background"
                              />
                            </div>
                          )}
                          <div className="flex gap-2">
                            <Button size="sm" disabled={updateAttachmentExpirationMut.isPending} onClick={() => handleApplyExpiration(att.id)}>
                              套用
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingExpirationId(null)}>取消</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-1">
                          <p className="text-xs text-muted-foreground">
                            {att.expirationType === "never" && "永久有效，自動清理排程不會刪除這份檔案"}
                            {att.expirationType === "after_publish_30d" && !att.downloadExpiresAt && "發布後 30 天到期（尚未發布，發布後才開始計算）"}
                            {att.downloadExpiresAt && (
                              <span className={att.isExpired ? "text-red-500" : undefined}>
                                {att.isExpired ? "已於 " : "下載期限："}
                                {format(new Date(att.downloadExpiresAt), "yyyy/MM/dd HH:mm")}
                                {att.isExpired && " 到期"}
                              </span>
                            )}
                          </p>
                          {/* 管理員預覽：僅限「已過期但實體檔案尚未被 Cron 清除」的附件，
                              跟公開 NewsDetail 頁面完全分開的獨立入口，不影響一般會員/
                              公開頁的期限規則。storageDeletedAt 有值時（上面 isStorageDeleted
                              分支）已經整個不會走到這裡，連管理員也拿不到預覽按鈕。 */}
                          {att.isExpired && (
                            <Button
                              size="sm" variant="outline" className="mt-1.5 h-7 text-xs gap-1"
                              disabled={previewingId === att.id}
                              onClick={() => handleAdminPreview(att.id)}
                            >
                              <Eye className="w-3.5 h-3.5" />
                              {previewingId === att.id ? "取得連結中..." : "管理員預覽（5 分鐘有效）"}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* 尚未儲存草稿前選的檔案：只在本機記憶體暫存，還沒真的上傳 */}
                  {stagedPdfFiles.map(sf => (
                    <div key={sf.localId} className="rounded-md border border-dashed px-3 py-2.5 text-sm flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileTextIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{sf.file.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(sf.file.size)}</span>
                        <Badge variant="outline" className="text-[10px] shrink-0 whitespace-nowrap">待儲存草稿後上傳</Badge>
                      </div>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-red-500 hover:bg-red-50 shrink-0" onClick={() => removeStagedPdf(sf.localId)} aria-label={`移除 ${sf.file.name}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}

                  {/* 上傳失敗、保留讓管理員重試的檔案 */}
                  {failedPdfFiles.map(ff => (
                    <div key={ff.localId} className="rounded-md border border-red-200 bg-red-50/50 px-3 py-2.5 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileTextIcon className="w-4 h-4 shrink-0 text-red-500" />
                          <span className="truncate">{ff.file.name}</span>
                          <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(ff.file.size)}</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={pdfUploading || !editingId} onClick={() => retryFailedPdf(ff.localId)}>
                            重試
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-red-500 hover:bg-red-50" onClick={() => removeFailedPdf(ff.localId)} aria-label={`移除 ${ff.file.name}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-red-500 mt-1">{ff.error}</p>
                    </div>
                  ))}

                  {totalPdfCount < MAX_ATTACHMENTS && (
                    <div className="rounded-md border border-dashed px-3 py-3.5 bg-muted/10">
                      <Label className="text-xs">下載期限</Label>
                      <RadioGroup value={pdfExpirationType} onValueChange={v => setPdfExpirationType(v as AttachmentExpirationType)} className="mt-1.5 gap-1.5">
                        <label className="flex items-start gap-2 text-xs">
                          <RadioGroupItem value="after_publish_30d" className="mt-0.5" />
                          <span>發布後 30 天（草稿階段上傳的話，從這篇消息第一次正式發布當下開始算 30 天；若消息已經發布過才補上傳，則從上傳完成時間起算 30 天）</span>
                        </label>
                        <label className="flex items-start gap-2 text-xs">
                          <RadioGroupItem value="custom" className="mt-0.5" />
                          <span>自訂到期時間（時間顯示為台灣時間；到了指定時間立即停止下載，跟消息本身是否發布無關）</span>
                        </label>
                        <label className="flex items-start gap-2 text-xs">
                          <RadioGroupItem value="never" className="mt-0.5" />
                          <span>永久有效（自動清理排程不會刪除這份檔案）</span>
                        </label>
                      </RadioGroup>
                      {pdfExpirationType === "custom" && (
                        <div className="flex gap-2 mt-2">
                          <OrderDatePicker value={pdfCustomDate} onChange={setPdfCustomDate} minDate={formatLocalDate(new Date())} className="flex-1" />
                          <input
                            type="time"
                            value={pdfCustomTime}
                            onChange={e => setPdfCustomTime(e.target.value)}
                            className="border rounded-md px-2 text-sm bg-background"
                          />
                        </div>
                      )}
                      <input
                        ref={pdfInputRef}
                        type="file"
                        accept=".pdf,application/pdf"
                        multiple
                        className="hidden"
                        onChange={e => handlePdfFilesSelected(e.target.files)}
                      />
                      <Button
                        type="button" size="sm" variant="outline" className="mt-2.5" disabled={pdfUploading}
                        aria-label="從電腦選擇 PDF"
                        onClick={() => pdfInputRef.current?.click()}
                      >
                        {pdfUploading ? "上傳中..." : "從電腦選擇 PDF"}
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* 9. 儲存草稿／發布／取消 */}
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={handleSaveDraft} disabled={isBusy} variant="outline">
                  {isBusy && savingProgress ? savingProgress : "儲存草稿"}
                </Button>
                <Button onClick={handlePublish} disabled={isBusy} className="gap-1.5 bg-indigo-500 hover:bg-indigo-600 text-white border-0">
                  <Send className="w-3.5 h-3.5" />
                  {isBusy && savingProgress ? savingProgress : "發布"}
                </Button>
                <Button variant="ghost" onClick={resetForm} disabled={isBusy}>取消</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">載入中...</div>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              <Newspaper className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>尚無消息，點擊「新增消息」開始建立</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {items.map(item => {
              const statusCfg = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.draft;
              return (
                <Card key={item.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Badge className={`${statusCfg.className} border text-xs`}>{statusCfg.label}</Badge>
                          {item.isImportant && <Badge variant="outline" className="text-xs gap-1"><Star className="w-3 h-3" />重要</Badge>}
                          {item.isCompetition && <Badge variant="outline" className="text-xs gap-1"><Trophy className="w-3 h-3" />競賽</Badge>}
                          {item.isExhibition && <Badge variant="outline" className="text-xs gap-1"><Building2 className="w-3 h-3" />展覽</Badge>}
                          {item.isCrossIndustry && <Badge variant="outline" className="text-xs gap-1"><Globe className="w-3 h-3" />跨產業</Badge>}
                          {item.industryNames.map(n => <Badge key={n} variant="outline" className="text-xs">{n}</Badge>)}
                          <span className="text-xs text-muted-foreground">/news/{item.slug}</span>
                        </div>
                        <p className="font-semibold text-sm">{item.title}</p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{toMarkdownPreviewText(item.summary, 120)}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button size="sm" variant="outline" onClick={() => handleEdit(item)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        {item.status === "published" && (
                          <Button
                            size="sm"
                            variant="outline"
                            title="重試這則消息目前寄送失敗或卡住的 Email／推播通知"
                            disabled={retryMut.isPending}
                            onClick={() => retryMut.mutate({ id: item.id })}
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {item.status === "published" && (
                          <Button size="sm" variant="outline" className="text-amber-600 hover:bg-amber-50" onClick={() => handleWithdraw(item.id)}>
                            <Archive className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {(item.status === "draft" || item.status === "withdrawn") && (
                          <Button size="sm" variant="outline" className="text-green-600 hover:bg-green-50" onClick={() => handleRepublish(item.id)}>
                            <ArchiveRestore className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
