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
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem } from "@/components/ui/command";
import { trpc } from "@/lib/trpc";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Plus, Pencil, Trash2, Pin, Zap, Wrench, Newspaper, Megaphone, LogIn, Check, ChevronsUpDown, AlertTriangle } from "lucide-react";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import MarkdownContent, { toMarkdownPreviewText } from "@/components/MarkdownContent";
import { MarkdownToolbar } from "@/components/MarkdownToolbar";

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

type FormState = { title: string; content: string; type: "update" | "maintenance" | "news"; isPinned: boolean; actionUrl: string; sendEmail: boolean };
const DEFAULT_FORM: FormState = { title: "", content: "", type: "news", isPinned: false, actionUrl: "", sendEmail: false };

export default function AdminAnnouncements() {
  const { user, loading } = useAuth();
  if (loading) return <AppLoading />;
  if (!user || user.role !== "admin") return <div className="flex items-center justify-center min-h-screen text-muted-foreground">無權限</div>;
  return <AdminAnnouncementsContent />;
}

function AdminAnnouncementsContent() {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<"announcements" | "loginPopup">("announcements");
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const setContent = (next: string) => setForm(p => ({ ...p, content: next }));

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
    setForm({
      title: item.title,
      content: item.content,
      type: item.type,
      isPinned: item.isPinned,
      // 非 news 公告即使資料庫因舊資料異常殘留 actionUrl，表單也一律以空字串
      // 呈現（欄位本來就只在 news 時顯示），避免使用者誤以為那是目前生效的值。
      actionUrl: item.type === "news" ? (item.actionUrl ?? "") : "",
      // 編輯既有公告不重新發送任何通知，sendEmail 欄位在編輯模式下不顯示也
      // 不會被送出（見 handleSubmit），這裡固定為 false 只是滿足 state 型別。
      sendEmail: false,
    });
    setEditingId(item.id);
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!form.title.trim()) { toast.error("請填寫標題"); return; }
    if (!form.content.trim()) { toast.error("請填寫內容"); return; }
    // 後端仍是最終驗證依據；這裡只是確保非 news 公告不會把欄位裡殘留的舊網址
    // 送出去，即使切換類型時的 state 清空邏輯有任何遺漏也有這一層防線。
    const actionUrl = form.type === "news" ? (form.actionUrl.trim() || null) : null;
    if (editingId) {
      // 編輯既有公告不具備重新寄信的入口：不傳 sendEmail，後端也不會因此
      // 觸發 Email 廣播（announcement.update 本來就沒有這個欄位／流程）。
      updateMut.mutate({ id: editingId, title: form.title, content: form.content, type: form.type, isPinned: form.isPinned, actionUrl });
    } else {
      createMut.mutate({ title: form.title, content: form.content, type: form.type, isPinned: form.isPinned, actionUrl, sendEmail: form.sendEmail });
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
          {tab === "announcements" && !showForm && (
            <Button onClick={() => setShowForm(true)} className="gap-2 bg-orange-500 hover:bg-orange-600 text-white border-0">
              <Plus className="w-4 h-4" />新增公告
            </Button>
          )}
        </div>

        <Tabs value={tab} onValueChange={v => setTab(v as "announcements" | "loginPopup")} className="mb-6">
          <TabsList>
            <TabsTrigger value="announcements" className="gap-1.5"><Megaphone className="w-3.5 h-3.5" />平台公告</TabsTrigger>
            <TabsTrigger value="loginPopup" className="gap-1.5"><LogIn className="w-3.5 h-3.5" />登入彈窗管理</TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === "loginPopup" ? (
          <LoginPopupManager />
        ) : (
        <>
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
                  <Select
                    value={form.type}
                    onValueChange={v => setForm(p => ({
                      ...p,
                      type: v as FormState["type"],
                      // 離開 news 時同一次 setState 內立即清空，不留下「欄位已
                      // 隱藏但 state 還殘留舊網址」的中間狀態；儲存時也不會把
                      // 舊網址送到後端（見 handleSubmit 的第二層防線）。
                      actionUrl: v === "news" ? p.actionUrl : "",
                    }))}
                  >
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
              {form.type === "news" && (
                <div>
                  <Label>相關內容連結（選填）</Label>
                  <Input
                    value={form.actionUrl}
                    onChange={e => setForm(p => ({ ...p, actionUrl: e.target.value }))}
                    placeholder="例如：/upgrade-center 或 https://example.com/page"
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    填寫後，使用者可在完整公告下方點選「了解更多」前往相關頁面。
                  </p>
                </div>
              )}
              {/* 通知方式：只有新增公告時顯示。編輯既有公告不重新發送任何通知，
                  因此這裡完全不渲染（也就不會有 Email 勾選入口）。 */}
              {!editingId && (
                <div className="rounded-md border border-dashed p-3 space-y-2 bg-muted/20">
                  <Label>通知方式</Label>
                  <p className="text-xs text-muted-foreground">平台內通知：發布時固定發送</p>
                  <p className="text-xs text-muted-foreground">APP 推播：發布時依會員通知設定發送</p>
                  <div className="flex items-center gap-2 pt-1">
                    <Checkbox
                      id="sendEmail"
                      checked={form.sendEmail}
                      onCheckedChange={v => setForm(p => ({ ...p, sendEmail: v === true }))}
                    />
                    <Label htmlFor="sendEmail" className="font-normal cursor-pointer">同步發送 Email 通知</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    勾選後，公告發布時將寄送給已開啟「平台公告 Email」的會員；Email 寄出後無法撤回。
                  </p>
                </div>
              )}
              <div>
                <Label>內容 *</Label>

                <MarkdownToolbar contentRef={contentRef} content={form.content} onChange={setContent} />

                <Textarea
                  ref={contentRef}
                  value={form.content}
                  onChange={e => setForm(p => ({ ...p, content: e.target.value }))}
                  placeholder="公告內容...（支援 Markdown：**粗體**、# 標題、[連結](https://...)）"
                  rows={5}
                />
                <p className="text-xs text-muted-foreground mt-1">支援 Markdown：粗體、斜體、標題、連結、分隔線與字體大小（選取文字後點擊字級工具套用）</p>

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
        </>
        )}
      </div>
    </div>
  );
}

// ── 登入彈窗管理 ──────────────────────────────────────────────────────────
// 登入彈窗不是獨立公告系統，只是既有「平台消息」公告的登入曝光入口，因此這裡
// 完全不提供自由輸入 announcementId／URL 的欄位，只能透過下方可搜尋選擇器從
// 「已發布、類型為平台消息」的公告中挑選（見 loginPopup.announcementOptions）。

type PopupFormState = {
  title: string;
  summary: string;
  announcementId: number | null;
  isActive: boolean;
};
const DEFAULT_POPUP_FORM: PopupFormState = { title: "", summary: "", announcementId: null, isActive: false };

function LoginPopupManager() {
  const utils = trpc.useUtils();
  const { data: items = [], isLoading } = trpc.loginPopup.adminList.useQuery();

  const [form, setForm] = useState<PopupFormState>(DEFAULT_POPUP_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [selectedAnnouncementTitle, setSelectedAnnouncementTitle] = useState("");

  const { data: announcementOptions = [] } = trpc.loginPopup.announcementOptions.useQuery({ keyword: keyword || undefined });

  const resetForm = () => {
    setForm(DEFAULT_POPUP_FORM);
    setEditingId(null);
    setShowForm(false);
    setSelectedAnnouncementTitle("");
    setKeyword("");
  };

  // 同時最多 5 則登入彈窗可以啟用，這條規則由後端保證（enforceMaxFiveActiveLoginPopups）。
  // 若這次操作導致舊的啟用彈窗被自動停用，後端會回傳 deactivatedCount，這裡只是
  // 把後端已經做完的事情告知管理員，不是前端自己判斷或執行停用。
  const notifyAutoDeactivation = (deactivatedCount: number) => {
    if (deactivatedCount > 0) {
      toast.info(`已超過 5 則啟用上限，較舊消息已自動停用（${deactivatedCount} 則）`);
    }
  };

  const createMut = trpc.loginPopup.create.useMutation({
    onSuccess: (result) => {
      toast.success("登入彈窗已建立");
      notifyAutoDeactivation(result.deactivatedCount);
      utils.loginPopup.adminList.invalidate();
      resetForm();
    },
    onError: e => toast.error(e.message),
  });
  const updateMut = trpc.loginPopup.update.useMutation({
    onSuccess: (result) => {
      toast.success("已更新");
      notifyAutoDeactivation(result.deactivatedCount);
      utils.loginPopup.adminList.invalidate();
      resetForm();
    },
    onError: e => toast.error(e.message),
  });
  const toggleMut = trpc.loginPopup.update.useMutation({
    onSuccess: (result) => {
      toast.success("已更新啟用狀態");
      notifyAutoDeactivation(result.deactivatedCount);
      utils.loginPopup.adminList.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const handleEdit = (item: (typeof items)[number]) => {
    setForm({
      title: item.title,
      summary: item.summary,
      announcementId: item.announcementId,
      isActive: item.isActive,
    });
    setSelectedAnnouncementTitle(item.boundAnnouncementTitle ?? "");
    setEditingId(item.id);
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!form.title.trim()) { toast.error("請填寫彈窗標題"); return; }
    if (!form.summary.trim()) { toast.error("請填寫彈窗短文"); return; }
    if (!form.announcementId) { toast.error("請選擇要綁定的平台公告"); return; }

    const payload = {
      title: form.title,
      summary: form.summary,
      announcementId: form.announcementId,
      isActive: form.isActive,
    };

    if (editingId) {
      updateMut.mutate({ id: editingId, ...payload });
    } else {
      createMut.mutate(payload);
    }
  };

  const handleToggleActive = (item: (typeof items)[number]) => {
    if (!item.isActive && !item.boundAnnouncementValid) {
      toast.error("綁定公告已失效，請先重新綁定有效的平台消息公告");
      return;
    }
    toggleMut.mutate({ id: item.id, isActive: !item.isActive });
  };

  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <div>
      <div className="flex justify-end mb-4">
        {!showForm && (
          <Button onClick={() => setShowForm(true)} className="gap-2 bg-purple-500 hover:bg-purple-600 text-white border-0">
            <Plus className="w-4 h-4" />新增登入彈窗
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="mb-6 border-purple-200">
          <CardHeader>
            <CardTitle className="text-lg">{editingId ? "編輯登入彈窗" : "新增登入彈窗"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>彈窗標題 *</Label>
              <Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="登入彈窗標題" className="mt-1" />
            </div>
            <div>
              <Label>彈窗短文 *</Label>
              <Textarea value={form.summary} onChange={e => setForm(p => ({ ...p, summary: e.target.value }))} placeholder="顯示在彈窗中的短文摘要" rows={3} className="mt-1" />
            </div>
            <div>
              <Label>綁定平台公告 *</Label>
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" aria-expanded={pickerOpen} className="w-full justify-between mt-1 font-normal">
                    <span className="truncate">{selectedAnnouncementTitle || "選擇平台消息公告..."}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[420px] max-w-[calc(100vw-2rem)] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput placeholder="搜尋公告標題..." value={keyword} onValueChange={setKeyword} />
                    <CommandList>
                      <CommandEmpty>沒有符合的平台消息公告</CommandEmpty>
                      {announcementOptions.map(opt => (
                        <CommandItem
                          key={opt.id}
                          value={String(opt.id)}
                          onSelect={() => {
                            setForm(p => ({ ...p, announcementId: opt.id }));
                            setSelectedAnnouncementTitle(opt.title);
                            setPickerOpen(false);
                          }}
                        >
                          <Check className={`mr-2 h-4 w-4 ${form.announcementId === opt.id ? "opacity-100" : "opacity-0"}`} />
                          <div className="flex flex-col overflow-hidden">
                            <span className="truncate">{opt.title}</span>
                            <span className="text-xs text-muted-foreground">
                              平台消息・{new Date(opt.createdAt).toLocaleDateString("zh-TW")}
                            </span>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <p className="text-xs text-muted-foreground mt-1">只能選擇已發布、類型為「平台消息」的公告</p>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.isActive} onCheckedChange={v => setForm(p => ({ ...p, isActive: v }))} />
              <span className="text-sm">啟用（啟用後立即生效，停用後立即停止顯示）</span>
            </div>
            <div className="flex gap-3">
              <Button onClick={handleSubmit} disabled={isPending} className="bg-purple-500 hover:bg-purple-600 text-white border-0">
                {isPending ? "儲存中..." : editingId ? "儲存更新" : "建立登入彈窗"}
              </Button>
              <Button variant="outline" onClick={resetForm}>取消</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">載入中...</div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <LogIn className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>尚無登入彈窗，點擊「新增登入彈窗」開始設定</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <Card key={item.id} className={!item.boundAnnouncementValid ? "border-red-200" : item.isActive ? "border-green-200" : ""}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge className={item.isActive ? "bg-green-100 text-green-700 border-green-200 border text-xs" : "bg-gray-100 text-gray-600 border-gray-200 border text-xs"}>
                        {item.isActive ? "啟用中" : "已停用"}
                      </Badge>
                      {item.isActive && item.activeRank != null && (
                        <Badge className="bg-purple-100 text-purple-700 border-purple-200 border text-xs">
                          目前第 {item.activeRank} 順位
                        </Badge>
                      )}
                      {!item.boundAnnouncementValid && (
                        <Badge className="bg-red-100 text-red-700 border-red-200 border text-xs gap-1">
                          <AlertTriangle className="w-3 h-3" />綁定公告已失效
                        </Badge>
                      )}
                    </div>
                    <p className="font-semibold text-sm">{item.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.summary}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      綁定公告：{item.boundAnnouncementTitle ?? "（已失效或不存在）"}
                      {item.boundAnnouncementCreatedAt && (
                        <> ・發布於 {new Date(item.boundAnnouncementCreatedAt).toLocaleDateString("zh-TW")}</>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => handleEdit(item)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!item.isActive && !item.boundAnnouncementValid}
                      className={item.isActive ? "text-red-500 hover:bg-red-50" : "text-green-600 hover:bg-green-50"}
                      onClick={() => handleToggleActive(item)}
                    >
                      {item.isActive ? "停用" : "啟用"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
