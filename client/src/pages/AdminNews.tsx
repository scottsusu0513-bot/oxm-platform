import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Newspaper, Star, Trophy, Building2, Send, ArchiveRestore, Archive, RefreshCw } from "lucide-react";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import MarkdownContent, { toMarkdownPreviewText } from "@/components/MarkdownContent";
import { INDUSTRIES } from "@shared/constants";

type FormState = {
  slug: string;
  title: string;
  summary: string;
  content: string;
  isImportant: boolean;
  isCompetition: boolean;
  isExhibition: boolean;
  industryNames: string[];
};
const DEFAULT_FORM: FormState = {
  slug: "", title: "", summary: "", content: "",
  isImportant: false, isCompetition: false, isExhibition: false, industryNames: [],
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

  const utils = trpc.useUtils();
  const { data: items = [], isLoading } = trpc.news.adminList.useQuery();

  const willNotify = form.isImportant || form.industryNames.length > 0;
  const { data: estimate } = trpc.news.estimateRecipients.useQuery(
    { isImportant: form.isImportant, industryNames: form.industryNames },
    { enabled: willNotify },
  );

  const createMut = trpc.news.create.useMutation({
    onSuccess: () => { toast.success("消息已建立"); utils.news.adminList.invalidate(); resetForm(); },
    onError: e => toast.error(e.message),
  });
  const updateMut = trpc.news.update.useMutation({
    onSuccess: () => { toast.success("消息已更新"); utils.news.adminList.invalidate(); resetForm(); },
    onError: e => toast.error(e.message),
  });
  const retryMut = trpc.news.retryNotifications.useMutation({
    onSuccess: (result) => {
      if (result.total === 0) { toast.info("目前沒有待補送的通知"); return; }
      toast.success(`已重試 ${result.total} 筆：Email 成功 ${result.emailRetried}、推播成功 ${result.pushRetried}`);
    },
    onError: e => toast.error(e.message),
  });

  const resetForm = () => { setForm(DEFAULT_FORM); setEditingId(null); setShowForm(false); setSlugTouched(false); };

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

  const handleSaveDraft = () => {
    if (!form.slug.trim() || !form.title.trim() || !form.summary.trim() || !form.content.trim()) {
      toast.error("請填寫網址代稱、標題、摘要與內容");
      return;
    }
    if (editingId) {
      updateMut.mutate({ id: editingId, ...buildPayload(), status: "draft" });
    } else {
      createMut.mutate({ ...buildPayload(), status: "draft" });
    }
  };

  const handlePublish = () => {
    if (!form.slug.trim() || !form.title.trim() || !form.summary.trim() || !form.content.trim()) {
      toast.error("請填寫網址代稱、標題、摘要與內容");
      return;
    }
    if (!confirm(confirmPublishMessage())) return;
    if (editingId) {
      updateMut.mutate({ id: editingId, ...buildPayload(), status: "published" });
    } else {
      createMut.mutate({ ...buildPayload(), status: "published" });
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

              <div>
                <Label>內容 *（支援 Markdown）</Label>
                <Textarea
                  value={form.content}
                  onChange={e => setForm(p => ({ ...p, content: e.target.value }))}
                  placeholder="消息完整內容...（支援 Markdown：**粗體**、# 標題、[連結](https://...)）"
                  rows={8}
                  className="mt-1"
                />
                <div className="mt-2">
                  <Label className="text-xs text-muted-foreground">即時效果</Label>
                  <div className="mt-1 min-h-[80px] rounded-md border border-dashed bg-muted/20 px-3 py-2 overflow-x-hidden break-words">
                    {form.content.trim() ? (
                      <MarkdownContent content={form.content} />
                    ) : (
                      <p className="text-sm text-muted-foreground">輸入內容後，格式效果會顯示在這裡。</p>
                    )}
                  </div>
                </div>
              </div>

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
