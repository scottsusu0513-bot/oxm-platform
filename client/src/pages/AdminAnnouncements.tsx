import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Plus, Pencil, Trash2, Pin, Zap, Wrench, Newspaper, Megaphone, Bold, Italic, Heading2, Link2, SeparatorHorizontal } from "lucide-react";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import MarkdownContent, { toMarkdownPreviewText } from "@/components/MarkdownContent";

const TYPE_OPTIONS = [
  { value: "news",        label: "平台消息", icon: Newspaper },
  { value: "update",      label: "版本更新", icon: Zap },
  { value: "maintenance", label: "停機維護", icon: Wrench },
] as const;

const TYPE_CONFIG: Record<string, { label: string; className: string }> = {
  update:      { label: "版本更新", className: "bg-blue-100 text-blue-700 border-blue-200" },
  maintenance: { label: "停機維護", className: "bg-red-100 text-red-700 border-red-200" },
  news:        { label: "平台消息", className: "bg-green-100 text-green-700 border-green-200" },
};

type FormState = { title: string; content: string; type: "update" | "maintenance" | "news"; isPinned: boolean };
const DEFAULT_FORM: FormState = { title: "", content: "", type: "news", isPinned: false };

// ── Markdown 工具列 helper：對 textarea 目前選取範圍插入語法 ──────────────
function wrapSelection(
  textarea: HTMLTextAreaElement,
  value: string,
  onChange: (next: string) => void,
  prefix: string,
  suffix: string,
  placeholder: string,
) {
  const start = textarea.selectionStart ?? value.length;
  const end = textarea.selectionEnd ?? value.length;
  const selected = value.slice(start, end);
  const inserted = selected || placeholder;
  const next = value.slice(0, start) + prefix + inserted + suffix + value.slice(end);
  onChange(next);
  requestAnimationFrame(() => {
    textarea.focus();
    const selStart = start + prefix.length;
    textarea.setSelectionRange(selStart, selStart + inserted.length);
  });
}

// 對目前選取涵蓋的每一行開頭加上 prefix（標題／項目符號／編號清單皆是逐行語法）
function prefixLines(
  textarea: HTMLTextAreaElement,
  value: string,
  onChange: (next: string) => void,
  linePrefix: string,
  placeholder: string,
) {
  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? 0;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = value.indexOf("\n", end);
  if (lineEnd === -1) lineEnd = value.length;
  const block = value.slice(lineStart, lineEnd);
  const content = block.trim() === "" ? placeholder : block;
  const prefixed = content.split("\n").map(line => (line ? `${linePrefix}${line}` : line)).join("\n");
  const next = value.slice(0, lineStart) + prefixed + value.slice(lineEnd);
  onChange(next);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(lineStart, lineStart + prefixed.length);
  });
}

function insertLink(textarea: HTMLTextAreaElement, value: string, onChange: (next: string) => void) {
  const start = textarea.selectionStart ?? value.length;
  const end = textarea.selectionEnd ?? value.length;
  const selected = value.slice(start, end);
  const linkText = selected || "連結文字";
  const inserted = `[${linkText}](https://)`;
  const next = value.slice(0, start) + inserted + value.slice(end);
  onChange(next);
  requestAnimationFrame(() => {
    textarea.focus();
    // Select the "https://" placeholder so the admin can immediately type the real URL over it.
    const urlStart = start + `[${linkText}](`.length;
    textarea.setSelectionRange(urlStart, urlStart + "https://".length);
  });
}

// 插入一段純文字到游標位置（有選取則取代選取範圍）；用於分隔線這類不需要「包住文字」的插入。
function insertAtCursor(textarea: HTMLTextAreaElement, value: string, onChange: (next: string) => void, text: string) {
  const start = textarea.selectionStart ?? value.length;
  const end = textarea.selectionEnd ?? value.length;
  const next = value.slice(0, start) + text + value.slice(end);
  onChange(next);
  requestAnimationFrame(() => {
    textarea.focus();
    const cursor = start + text.length;
    textarea.setSelectionRange(cursor, cursor);
  });
}

export default function AdminAnnouncements() {
  const { user, loading } = useAuth();
  if (loading) return <AppLoading />;
  if (!user || user.role !== "admin") return <div className="flex items-center justify-center min-h-screen text-muted-foreground">無權限</div>;
  return <AdminAnnouncementsContent />;
}

function AdminAnnouncementsContent() {
  const [, navigate] = useLocation();
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const setContent = (next: string) => setForm(p => ({ ...p, content: next }));
  const toolbarActions: Array<{ icon: typeof Bold; label: string; onClick: () => void }> = [
    { icon: Bold, label: "粗體", onClick: () => contentRef.current && wrapSelection(contentRef.current, form.content, setContent, "**", "**", "粗體文字") },
    { icon: Italic, label: "斜體", onClick: () => contentRef.current && wrapSelection(contentRef.current, form.content, setContent, "*", "*", "斜體文字") },
    { icon: Heading2, label: "標題", onClick: () => contentRef.current && prefixLines(contentRef.current, form.content, setContent, "## ", "標題文字") },
    { icon: Link2, label: "連結", onClick: () => contentRef.current && insertLink(contentRef.current, form.content, setContent) },
    { icon: SeparatorHorizontal, label: "分隔線", onClick: () => contentRef.current && insertAtCursor(contentRef.current, form.content, setContent, "\n\n---\n\n") },
  ];

  const utils = trpc.useUtils();
  const { data: items = [], isLoading } = trpc.announcement.list.useQuery({ limit: 100 });

  const createMut = trpc.announcement.create.useMutation({
    onSuccess: () => { toast.success("公告已發布"); utils.announcement.list.invalidate(); resetForm(); },
    onError: e => toast.error(e.message),
  });
  const updateMut = trpc.announcement.update.useMutation({
    onSuccess: () => { toast.success("公告已更新"); utils.announcement.list.invalidate(); resetForm(); },
    onError: e => toast.error(e.message),
  });
  const deleteMut = trpc.announcement.delete.useMutation({
    onSuccess: () => { toast.success("已刪除"); utils.announcement.list.invalidate(); },
    onError: e => toast.error(e.message),
  });

  const resetForm = () => { setForm(DEFAULT_FORM); setEditingId(null); setShowForm(false); };

  const handleEdit = (item: typeof items[0]) => {
    setForm({ title: item.title, content: item.content, type: item.type, isPinned: item.isPinned });
    setEditingId(item.id);
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!form.title.trim()) { toast.error("請填寫標題"); return; }
    if (!form.content.trim()) { toast.error("請填寫內容"); return; }
    if (editingId) {
      updateMut.mutate({ id: editingId, ...form });
    } else {
      createMut.mutate(form);
    }
  };

  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 px-4 pb-4 md:px-8 md:pb-8 admin-page-top">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
      <FloatingBackButton fallbackHref="/admin" noNavbar />
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Megaphone className="w-6 h-6 text-orange-500" />
              <h1 className="text-2xl font-bold">平台公告管理</h1>
            </div>
          </div>
          {!showForm && (
            <Button onClick={() => setShowForm(true)} className="gap-2 bg-orange-500 hover:bg-orange-600 text-white border-0">
              <Plus className="w-4 h-4" />新增公告
            </Button>
          )}
        </div>

        {/* 新增 / 編輯表單 */}
        {showForm && (
          <Card className="mb-6 border-orange-200">
            <CardHeader>
              <CardTitle className="text-lg">{editingId ? "編輯公告" : "新增公告"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>標題 *</Label>
                <Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="公告標題" className="mt-1" />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label>類型</Label>
                  <Select value={form.type} onValueChange={v => setForm(p => ({ ...p, type: v as FormState["type"] }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TYPE_OPTIONS.map(o => (
                        <SelectItem key={o.value} value={o.value}>
                          <span className="flex items-center gap-2"><o.icon className="w-4 h-4" />{o.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-3 mt-6">
                  <Switch checked={form.isPinned} onCheckedChange={v => setForm(p => ({ ...p, isPinned: v }))} />
                  <span className="text-sm flex items-center gap-1"><Pin className="w-3.5 h-3.5" />置頂公告</span>
                </div>
              </div>
              <div>
                <Label>內容 *</Label>

                <div className="flex flex-wrap gap-1 mt-1 mb-1.5 p-1.5 bg-muted/40 rounded-md border">
                  {toolbarActions.map(a => (
                    <button
                      key={a.label}
                      type="button"
                      title={a.label}
                      onClick={a.onClick}
                      className="p-1.5 rounded hover:bg-white hover:shadow-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <a.icon className="w-3.5 h-3.5" />
                    </button>
                  ))}
                </div>

                <Textarea
                  ref={contentRef}
                  value={form.content}
                  onChange={e => setForm(p => ({ ...p, content: e.target.value }))}
                  placeholder="公告內容...（支援 Markdown：**粗體**、# 標題、[連結](https://...)）"
                  rows={5}
                />
                <p className="text-xs text-muted-foreground mt-1">支援 Markdown：粗體、斜體、標題、連結與分隔線</p>

                <div className="mt-2">
                  <Label className="text-xs text-muted-foreground">即時效果</Label>
                  <div className="mt-1 min-h-[80px] rounded-md border border-dashed bg-muted/20 px-3 py-2 overflow-x-hidden break-words">
                    {form.content.trim() ? (
                      <MarkdownContent content={form.content} />
                    ) : (
                      <p className="text-sm text-muted-foreground">輸入公告內容後，格式效果會顯示在這裡。</p>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex gap-3">
                <Button onClick={handleSubmit} disabled={isPending} className="bg-orange-500 hover:bg-orange-600 text-white border-0">
                  {isPending ? "儲存中..." : editingId ? "儲存更新" : "發布公告"}
                </Button>
                <Button variant="outline" onClick={resetForm}>取消</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 公告列表 */}
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">載入中...</div>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              <Megaphone className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>尚無公告，點擊「新增公告」開始發布</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {items.map(item => {
              const cfg = TYPE_CONFIG[item.type] ?? TYPE_CONFIG.news;
              return (
                <Card key={item.id} className={item.isPinned ? "border-orange-200" : ""}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {item.isPinned && <span className="text-xs text-orange-600 font-medium flex items-center gap-0.5"><Pin className="w-3 h-3" />置頂</span>}
                          <Badge className={`${cfg.className} border text-xs`}>{cfg.label}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(item.createdAt).toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" })}
                          </span>
                        </div>
                        <p className="font-semibold text-sm">{item.title}</p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{toMarkdownPreviewText(item.content, 120)}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button size="sm" variant="outline" onClick={() => handleEdit(item)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="sm" variant="outline" className="text-red-500 hover:bg-red-50"
                          onClick={() => { if (confirm("確定刪除此公告？")) deleteMut.mutate({ id: item.id }); }}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
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
