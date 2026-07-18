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
import { Plus, Pencil, Newspaper, Star, Trophy, Building2, Send, ArchiveRestore, Archive, RefreshCw, Image as ImageIcon, FileText as FileTextIcon, Trash2, Eye } from "lucide-react";
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

type FormState = {
  slug: string;
  title: string;
  summary: string;
  content: string;
  isImportant: boolean;
  isCompetition: boolean;
  isExhibition: boolean;
  industryNames: string[];
  coverImageUrl: string | null;
};
const DEFAULT_FORM: FormState = {
  slug: "", title: "", summary: "", content: "",
  isImportant: false, isCompetition: false, isExhibition: false, industryNames: [],
  coverImageUrl: null,
};

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft:     { label: "草稿",   className: "bg-slate-100 text-slate-600 border-slate-200" },
  published: { label: "已發布", className: "bg-green-100 text-green-700 border-green-200" },
  withdrawn: { label: "已下架", className: "bg-amber-100 text-amber-700 border-amber-200" },
};

/** 標題轉建議 slug：僅供輸入 slug 欄位時的預設值，管理員可自行覆蓋。 */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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
  const [slugTouched, setSlugTouched] = useState(false);
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

  const willNotify = form.isImportant || form.industryNames.length > 0;
  const { data: estimate } = trpc.news.estimateRecipients.useQuery(
    { isImportant: form.isImportant, industryNames: form.industryNames },
    { enabled: willNotify },
  );

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
    setForm(DEFAULT_FORM);
    setEditingId(null);
    setShowForm(false);
    setSlugTouched(false);
    setPdfExpirationType("after_publish_30d");
    setPdfCustomDate("");
    setPdfCustomTime("23:59");
    setEditingExpirationId(null);
  };

  const setContent = (next: string) => setForm(p => ({ ...p, content: next }));

  const handleEdit = (item: (typeof items)[number]) => {
    setForm({
      slug: item.slug,
      title: item.title,
      summary: item.summary,
      content: item.content,
      isImportant: item.isImportant,
      isCompetition: item.isCompetition,
      isExhibition: item.isExhibition,
      industryNames: item.industryNames,
      coverImageUrl: item.coverImageUrl ?? null,
    });
    setEditingId(item.id);
    setSlugTouched(true);
    setShowForm(true);
  };

  const toggleIndustry = (name: string, checked: boolean) => {
    setForm(p => ({
      ...p,
      industryNames: checked ? [...p.industryNames, name] : p.industryNames.filter(n => n !== name),
    }));
  };

  const confirmPublishMessage = () => {
    if (!willNotify) return "確定要發布這則消息嗎？此分類設定不會寄送 Email 或 App 推播通知，只會顯示在網站上。";
    const count = estimate?.count;
    return `確定要發布這則消息嗎？發布後將寄送 Email 與 App 推播通知給約 ${count ?? "…"} 位符合資格的會員（僅在第一次發布時寄送一次，之後編輯不會再次通知）。`;
  };

  const buildPayload = () => ({
    slug: form.slug.trim(),
    title: form.title.trim(),
    summary: form.summary.trim(),
    content: form.content,
    isImportant: form.isImportant,
    isCompetition: form.isCompetition,
    isExhibition: form.isExhibition,
    industryNames: form.industryNames,
  });

  const validateRequired = () => {
    if (!form.slug.trim() || !form.title.trim() || !form.summary.trim() || !form.content.trim()) {
      toast.error("請填寫網址代稱、標題、摘要與內容");
      return false;
    }
    return true;
  };

  // 草稿儲存不重置表單、不關閉編輯區——第一次儲存拿到 newsId 後，封面／內文
  // 圖片／PDF 附件的上傳區塊才會解鎖，讓管理員能接著在同一個畫面繼續操作，
  // 不必重新打開編輯。發布則視為完成編輯，照舊收合表單、回到列表。
  const handleSaveDraft = () => {
    if (!validateRequired()) return;
    if (editingId) {
      updateMut.mutate({ id: editingId, ...buildPayload(), status: "draft" }, {
        onSuccess: () => toast.success("草稿已更新"),
      });
    } else {
      createMut.mutate({ ...buildPayload(), status: "draft" }, {
        onSuccess: (result) => {
          setEditingId(result.id);
          toast.success("草稿已儲存，現在可以上傳封面圖片與 PDF 附件");
        },
      });
    }
  };

  const handlePublish = () => {
    if (!validateRequired()) return;
    if (!confirm(confirmPublishMessage())) return;
    if (editingId) {
      updateMut.mutate({ id: editingId, ...buildPayload(), status: "published" }, {
        onSuccess: () => { toast.success("消息已發布"); resetForm(); },
      });
    } else {
      createMut.mutate({ ...buildPayload(), status: "published" }, {
        onSuccess: () => { toast.success("消息已發布"); resetForm(); },
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

  const validateImageFile = (file: File): string | null => {
    if (!COVER_MIME_TYPES.includes(file.type)) return "僅支援 JPG、PNG、WebP 格式";
    if (file.size > MAX_IMAGE_BYTES) return "圖片大小不得超過 10MB";
    return null;
  };

  const handleCoverFileSelected = async (file: File | undefined) => {
    if (!file || !editingId) return;
    const err = validateImageFile(file);
    if (err) { toast.error(err); return; }
    setCoverUploading(true);
    try {
      const base64 = await fileToBase64(file);
      const result = await uploadCoverMut.mutateAsync({ newsId: editingId, base64, mimeType: file.type });
      setForm(p => ({ ...p, coverImageUrl: result.url }));
      utils.news.adminList.invalidate();
      toast.success("封面已上傳");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "封面上傳失敗");
    } finally {
      setCoverUploading(false);
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  };

  const handleRemoveCover = async () => {
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

  const validatePdfFile = (file: File): string | null => {
    if (file.type !== "application/pdf") return "僅支援 PDF 格式";
    if (file.size > MAX_PDF_BYTES) return "PDF 大小不得超過 25MB";
    return null;
  };

  // 上傳流程：先跟後端要一次性 presigned PUT 網址（storageKey 由後端產生，
  // 前端只能寫入那一個 key），直傳私有 S3，成功後才呼叫 finalize 做二次驗證
  // 並建立附件 metadata——後端會重新檢查檔案大小／型別／PDF magic bytes，
  // 不信任這裡宣稱的 file.type／file.size。
  const handlePdfFileSelected = async (file: File | undefined) => {
    if (!file || !editingId) return;
    const err = validatePdfFile(file);
    if (err) { toast.error(err); return; }
    if (attachments.length >= MAX_ATTACHMENTS) { toast.error(`每篇消息最多只能有 ${MAX_ATTACHMENTS} 份附件`); return; }
    if (pdfExpirationType === "custom" && !pdfCustomDate) { toast.error("請選擇自訂到期日期"); return; }

    setPdfUploading(true);
    try {
      const session = await createPdfUploadSessionMut.mutateAsync({
        newsId: editingId,
        fileName: file.name,
        declaredMimeType: file.type,
        declaredSizeBytes: file.size,
      });
      const putRes = await fetch(session.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      });
      if (!putRes.ok) throw new Error("檔案上傳失敗，請重試");

      await finalizePdfUploadMut.mutateAsync({
        newsId: editingId,
        storageKey: session.storageKey,
        displayName: file.name.replace(/\.pdf$/i, "") || file.name,
        originalFileName: file.name,
        expirationType: pdfExpirationType,
        customDownloadExpiresAt: pdfExpirationType === "custom" ? combineDateTimeToISO(pdfCustomDate, pdfCustomTime) : undefined,
      });
      utils.news.getAdminAttachments.invalidate({ newsId: editingId });
      toast.success("PDF 附件已上傳");
      setPdfExpirationType("after_publish_30d");
      setPdfCustomDate("");
      setPdfCustomTime("23:59");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF 上傳失敗");
    } finally {
      setPdfUploading(false);
      if (pdfInputRef.current) pdfInputRef.current.value = "";
    }
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

  const isPending = createMut.isPending || updateMut.isPending;

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
              {/* 1. 標題與 slug */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label>標題 *</Label>
                  <Input
                    value={form.title}
                    onChange={e => {
                      const title = e.target.value;
                      setForm(p => ({ ...p, title, slug: slugTouched ? p.slug : slugify(title) }));
                    }}
                    placeholder="消息標題"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>網址代稱（slug）*</Label>
                  <Input
                    value={form.slug}
                    onChange={e => { setSlugTouched(true); setForm(p => ({ ...p, slug: e.target.value })); }}
                    placeholder="例如：2026-metal-expo"
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">只能是小寫英數字與連字號，發布後請避免再修改以免舊連結失效。</p>
                </div>
              </div>

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
                {willNotify
                  ? `此設定發布時將寄送 Email 與 App 推播通知，預估約 ${estimate?.count ?? "…"} 位符合資格的會員（僅第一次發布時寄送一次）。`
                  : "此設定（純競賽／純展覽，未勾選重要消息或任何產業）只會顯示在網站上，不會寄送 Email 或 App 推播通知。"}
              </div>

              {/* 4. 封面圖片 */}
              <div>
                <Label>封面圖片（選填）</Label>
                {!editingId ? (
                  <p className="text-xs text-muted-foreground mt-1 rounded-md border border-dashed px-3 py-4 text-center">
                    請先儲存草稿，即可上傳圖片與 PDF 附件
                  </p>
                ) : (
                  <div className="mt-1.5">
                    <div className="relative w-full aspect-video rounded-lg border overflow-hidden bg-muted/30">
                      {form.coverImageUrl ? (
                        <img src={form.coverImageUrl} alt="封面預覽" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground">
                          <ImageIcon className="w-8 h-8 mb-1.5 opacity-40" />
                          <p className="text-xs">尚未上傳封面圖片</p>
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
                        onClick={() => coverInputRef.current?.click()}
                      >
                        {coverUploading ? "處理中..." : form.coverImageUrl ? "更換" : "上傳"}
                      </Button>
                      {form.coverImageUrl && (
                        <Button type="button" size="sm" variant="outline" disabled={coverUploading} className="text-red-500 hover:bg-red-50" onClick={handleRemoveCover}>
                          移除
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">支援 JPG／PNG／WebP，最大 10MB，建議比例 16:9</p>
                  </div>
                )}
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

              {/* 8. PDF 附件 */}
              <div>
                <Label>PDF 附件（選填，最多 {MAX_ATTACHMENTS} 份，單檔最大 25MB）</Label>
                {!editingId ? (
                  <p className="text-xs text-muted-foreground mt-1 rounded-md border border-dashed px-3 py-4 text-center">
                    請先儲存草稿，即可上傳圖片與 PDF 附件
                  </p>
                ) : (
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

                    {attachments.length < MAX_ATTACHMENTS && (
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
                          accept="application/pdf"
                          className="hidden"
                          onChange={e => handlePdfFileSelected(e.target.files?.[0])}
                        />
                        <Button
                          type="button" size="sm" variant="outline" className="mt-2.5" disabled={pdfUploading}
                          onClick={() => pdfInputRef.current?.click()}
                        >
                          {pdfUploading ? "上傳中..." : "上傳 PDF"}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 9. 儲存草稿／發布／取消 */}
              <div className="flex flex-wrap gap-3">
                <Button onClick={handleSaveDraft} disabled={isPending} variant="outline">
                  {isPending ? "儲存中..." : "儲存草稿"}
                </Button>
                <Button onClick={handlePublish} disabled={isPending} className="gap-1.5 bg-indigo-500 hover:bg-indigo-600 text-white border-0">
                  <Send className="w-3.5 h-3.5" />
                  {isPending ? "處理中..." : "發布"}
                </Button>
                <Button variant="ghost" onClick={resetForm}>取消</Button>
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
