import { useAuth } from "@/_core/hooks/useAuth";
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
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Plus, Pencil, Trash2, Pin, Zap, Wrench, Newspaper, Megaphone } from "lucide-react";

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

export default function AdminAnnouncements() {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center min-h-screen">載入中...</div>;
  if (!user || user.role !== "admin") return <div className="flex items-center justify-center min-h-screen text-muted-foreground">無權限</div>;
  return <AdminAnnouncementsContent />;
}

function AdminAnnouncementsContent() {
  const [, navigate] = useLocation();
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);

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
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => navigate("/admin")} className="gap-1">
              <ArrowLeft className="w-4 h-4" />返回
            </Button>
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
                <Textarea value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))} placeholder="公告內容..." rows={5} className="mt-1" />
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
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2 whitespace-pre-wrap">{item.content}</p>
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
