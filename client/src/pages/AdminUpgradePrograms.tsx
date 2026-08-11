import { useMemo, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  UPGRADE_PROGRAM_VISUAL_KEYS,
  UPGRADE_PROGRAM_VISUAL_LABELS,
  type UpgradeProgramVisualKey,
} from "@shared/upgradePrograms";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

type ProgramFormState = {
  slug: string;
  title: string;
  shortTitle: string;
  description: string;
  targetAudience: string;
  highlightsText: string;
  badge: string;
  statusLabel: string;
  visualKey: UpgradeProgramVisualKey;
  maxFundingLabel: string;
  imageUrl: string;
  ctaLabel: string;
  enabled: boolean;
};

const EMPTY_FORM: ProgramFormState = {
  slug: "",
  title: "",
  shortTitle: "",
  description: "",
  targetAudience: "",
  highlightsText: "",
  badge: "政府補助計畫",
  statusLabel: "",
  visualKey: "funding",
  maxFundingLabel: "",
  imageUrl: "",
  ctaLabel: "免費評估資格",
  enabled: true,
};

export default function AdminUpgradePrograms() {
  const { user, loading } = useAuth();
  if (loading) return <AppLoading />;
  if (!user || user.role !== "admin") {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">無權限</div>;
  }
  return <AdminUpgradeProgramsContent />;
}

function AdminUpgradeProgramsContent() {
  const utils = trpc.useUtils();
  const listQuery = trpc.upgradePrograms.adminList.useQuery(undefined, { retry: false });
  type Program = NonNullable<typeof listQuery.data>[number];

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ProgramFormState>(EMPTY_FORM);
  const [archiveTarget, setArchiveTarget] = useState<Program | null>(null);

  const programs = listQuery.data ?? [];
  const activePrograms = useMemo(() => programs.filter((program) => !program.archivedAt), [programs]);
  const archivedPrograms = useMemo(() => programs.filter((program) => !!program.archivedAt), [programs]);

  const invalidateLists = async () => {
    await Promise.all([
      utils.upgradePrograms.adminList.invalidate(),
      utils.upgradePrograms.listPublic.invalidate(),
    ]);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const createMutation = trpc.upgradePrograms.create.useMutation({
    onSuccess: async () => {
      toast.success("已新增政府補助方案");
      await invalidateLists();
      closeForm();
    },
    onError: (error) => toast.error(error.message),
  });
  const updateMutation = trpc.upgradePrograms.update.useMutation({
    onSuccess: async () => {
      toast.success("方案內容已更新");
      await invalidateLists();
      closeForm();
    },
    onError: (error) => toast.error(error.message),
  });
  const enabledMutation = trpc.upgradePrograms.setEnabled.useMutation({
    onSuccess: async () => {
      toast.success("公開狀態已更新");
      await invalidateLists();
    },
    onError: (error) => toast.error(error.message),
  });
  const moveMutation = trpc.upgradePrograms.move.useMutation({
    onSuccess: invalidateLists,
    onError: (error) => toast.error(error.message),
  });
  const archiveMutation = trpc.upgradePrograms.archive.useMutation({
    onSuccess: async () => {
      toast.success("方案已封存並從公開頁隱藏");
      setArchiveTarget(null);
      await invalidateLists();
    },
    onError: (error) => toast.error(error.message),
  });
  const restoreMutation = trpc.upgradePrograms.restore.useMutation({
    onSuccess: async () => {
      toast.success("方案已復原，預設維持停用");
      await invalidateLists();
    },
    onError: (error) => toast.error(error.message),
  });

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (program: Program) => {
    setEditingId(program.id);
    setForm({
      slug: program.slug,
      title: program.title,
      shortTitle: program.shortTitle ?? "",
      description: program.description,
      targetAudience: program.targetAudience ?? "",
      highlightsText: (program.highlights ?? []).join("\n"),
      badge: program.badge ?? "",
      statusLabel: program.statusLabel ?? "",
      visualKey: program.visualKey as UpgradeProgramVisualKey,
      maxFundingLabel: program.maxFundingLabel ?? "",
      imageUrl: program.imageUrl ?? "",
      ctaLabel: program.ctaLabel,
      enabled: program.enabled,
    });
    setFormOpen(true);
  };

  const submitForm = () => {
    if (!form.slug.trim() || !/^[a-z0-9-]+$/.test(form.slug.trim())) {
      toast.error("識別代碼為必填，只能包含小寫英文、數字與連字號");
      return;
    }
    if (!form.title.trim()) {
      toast.error("請填寫方案名稱");
      return;
    }
    if (!form.description.trim()) {
      toast.error("請填寫方案說明");
      return;
    }
    if (!form.ctaLabel.trim()) {
      toast.error("請填寫 CTA 文字");
      return;
    }

    const payload = {
      slug: form.slug.trim(),
      title: form.title.trim(),
      shortTitle: form.shortTitle.trim() || null,
      description: form.description.trim(),
      targetAudience: form.targetAudience.trim() || null,
      highlights: form.highlightsText.split(/[\n、,，]/).map((item) => item.trim()).filter(Boolean),
      badge: form.badge.trim() || null,
      statusLabel: form.statusLabel.trim() || null,
      visualKey: form.visualKey,
      maxFundingLabel: form.maxFundingLabel.trim() || null,
      imageUrl: form.imageUrl.trim() || null,
      ctaLabel: form.ctaLabel.trim(),
      enabled: form.enabled,
    };

    if (editingId) updateMutation.mutate({ id: editingId, ...payload });
    else createMutation.mutate(payload);
  };

  const moveProgram = (index: number, direction: -1 | 1) => {
    const target = activePrograms[index + direction];
    const current = activePrograms[index];
    if (!current || !target) return;
    moveMutation.mutate({ idA: current.id, idB: target.id });
  };

  const isFormPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="min-h-screen bg-slate-50 px-4 pb-10 md:px-8 admin-page-top">
      <div className="mx-auto max-w-6xl">
        <div className="mb-7 flex items-center justify-between gap-4">
          <FloatingBackButton fallbackHref="/admin" noNavbar />
          <div className="flex min-w-0 items-center gap-2 text-center">
            <ShieldCheck className="h-6 w-6 shrink-0 text-orange-500" />
            <h1 className="truncate text-xl font-bold md:text-2xl">政府補助方案管理</h1>
          </div>
          <Button onClick={openCreate} size="sm" className="shrink-0 gap-1.5 bg-orange-500 hover:bg-orange-600">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">新增方案</span>
          </Button>
        </div>

        <div className="mb-6 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed text-slate-600">
          這裡只管理政府補助專區的公開方案卡片；企業送件、案件狀態、顧問分派與申請管理維持原流程。停用會暫時隱藏，封存則保留資料但不再公開。
        </div>

        {listQuery.isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">載入方案中…</div>
        ) : listQuery.error ? (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-5 text-sm text-red-700">{listQuery.error.message}</CardContent>
          </Card>
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
              <table className="w-full text-sm">
                <thead className="bg-slate-900 text-left text-xs uppercase tracking-wider text-slate-300">
                  <tr>
                    <th className="w-24 px-4 py-3">排序</th>
                    <th className="px-4 py-3">方案名稱</th>
                    <th className="w-32 px-4 py-3">狀態</th>
                    <th className="w-44 px-4 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activePrograms.map((program, index) => (
                    <tr key={program.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-1">
                          <span className="w-7 text-xs tabular-nums text-slate-400">{String(index + 1).padStart(2, "0")}</span>
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={index === 0 || moveMutation.isPending} onClick={() => moveProgram(index, -1)} aria-label="上移">
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={index === activePrograms.length - 1 || moveMutation.isPending} onClick={() => moveProgram(index, 1)} aria-label="下移">
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-start gap-3">
                          <Badge variant="outline" className="mt-0.5 shrink-0">{program.shortTitle || program.slug}</Badge>
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900">{program.title}</p>
                            <p className="mt-1 line-clamp-1 text-xs text-slate-500">{program.description}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <Switch checked={program.enabled} disabled={enabledMutation.isPending} onCheckedChange={(enabled) => enabledMutation.mutate({ id: program.id, enabled })} />
                          <span className={program.enabled ? "text-emerald-700" : "text-slate-500"}>{program.enabled ? "公開" : "停用"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" className="gap-1" onClick={() => openEdit(program)}><Pencil className="h-3.5 w-3.5" />編輯</Button>
                          <Button variant="ghost" size="sm" className="gap-1 text-red-600 hover:text-red-700" onClick={() => setArchiveTarget(program)}><Trash2 className="h-3.5 w-3.5" />刪除</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 md:hidden">
              {activePrograms.map((program, index) => (
                <Card key={program.id} className="border-slate-200 shadow-sm">
                  <CardContent className="space-y-4 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="text-xs font-bold tabular-nums text-orange-500">{String(index + 1).padStart(2, "0")}</span>
                          <Badge variant="outline">{program.shortTitle || program.slug}</Badge>
                        </div>
                        <p className="font-semibold leading-snug text-slate-900">{program.title}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" disabled={index === 0 || moveMutation.isPending} onClick={() => moveProgram(index, -1)} aria-label="上移"><ArrowUp className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" disabled={index === activePrograms.length - 1 || moveMutation.isPending} onClick={() => moveProgram(index, 1)} aria-label="下移"><ArrowDown className="h-4 w-4" /></Button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        {program.enabled ? <Eye className="h-4 w-4 text-emerald-600" /> : <EyeOff className="h-4 w-4" />}
                        {program.enabled ? "公開顯示" : "目前停用"}
                      </div>
                      <Switch checked={program.enabled} disabled={enabledMutation.isPending} onCheckedChange={(enabled) => enabledMutation.mutate({ id: program.id, enabled })} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" size="sm" className="gap-1" onClick={() => openEdit(program)}><Pencil className="h-3.5 w-3.5" />編輯</Button>
                      <Button variant="outline" size="sm" className="gap-1 text-red-600" onClick={() => setArchiveTarget(program)}><Trash2 className="h-3.5 w-3.5" />刪除</Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {activePrograms.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-14 text-center text-sm text-slate-500">目前沒有可管理的方案</div>
            )}

            {archivedPrograms.length > 0 && (
              <section className="mt-8">
                <h2 className="mb-3 text-sm font-semibold text-slate-700">已封存（不公開）</h2>
                <div className="space-y-2">
                  {archivedPrograms.map((program) => (
                    <div key={program.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 opacity-75">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-700">{program.title}</p>
                        <p className="text-xs text-slate-400">{program.shortTitle || program.slug}</p>
                      </div>
                      <Button variant="outline" size="sm" className="shrink-0 gap-1" disabled={restoreMutation.isPending} onClick={() => restoreMutation.mutate({ id: program.id })}>
                        <RotateCcw className="h-3.5 w-3.5" />復原
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      <Dialog open={formOpen} onOpenChange={(open) => { if (!open && !isFormPending) closeForm(); }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "編輯政府補助方案" : "新增政府補助方案"}</DialogTitle>
            <DialogDescription>必填欄位會直接出現在公開卡片；圖片為選填，未提供時會呈現純文字資訊卡片。</DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 py-2 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="program-slug">識別代碼 *</Label>
              <Input id="program-slug" value={form.slug} onChange={(event) => setForm((value) => ({ ...value, slug: event.target.value }))} placeholder="例如 green-transition" />
              <p className="text-[11px] text-muted-foreground">小寫英文、數字與連字號，供系統穩定識別。</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="program-short-title">短名稱</Label>
              <Input id="program-short-title" value={form.shortTitle} onChange={(event) => setForm((value) => ({ ...value, shortTitle: event.target.value }))} placeholder="例如 SBIR" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="program-title">方案名稱 *</Label>
              <Input id="program-title" value={form.title} onChange={(event) => setForm((value) => ({ ...value, title: event.target.value }))} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="program-description">方案說明 *</Label>
              <Textarea id="program-description" rows={3} value={form.description} onChange={(event) => setForm((value) => ({ ...value, description: event.target.value }))} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="program-audience">適合對象</Label>
              <Textarea id="program-audience" rows={2} value={form.targetAudience} onChange={(event) => setForm((value) => ({ ...value, targetAudience: event.target.value }))} placeholder="選填；只有填寫時才會顯示" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="program-highlights">重點標籤</Label>
              <Textarea id="program-highlights" rows={2} value={form.highlightsText} onChange={(event) => setForm((value) => ({ ...value, highlightsText: event.target.value }))} placeholder="每行一個，例如：研發費用補助" />
            </div>
            <div className="space-y-2">
              <Label>視覺類型 *</Label>
              <Select value={form.visualKey} onValueChange={(visualKey) => setForm((value) => ({ ...value, visualKey: visualKey as UpgradeProgramVisualKey }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UPGRADE_PROGRAM_VISUAL_KEYS.map((key) => <SelectItem key={key} value={key}>{UPGRADE_PROGRAM_VISUAL_LABELS[key]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="program-funding">最高補助金額</Label>
              <Input id="program-funding" value={form.maxFundingLabel} onChange={(event) => setForm((value) => ({ ...value, maxFundingLabel: event.target.value }))} placeholder="例如 1,000 萬元" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="program-badge">類型標籤</Label>
              <Input id="program-badge" value={form.badge} onChange={(event) => setForm((value) => ({ ...value, badge: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="program-status">狀態文字</Label>
              <Input id="program-status" value={form.statusLabel} onChange={(event) => setForm((value) => ({ ...value, statusLabel: event.target.value }))} placeholder="例如 依公告受理" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="program-image">圖片網址</Label>
              <Input id="program-image" value={form.imageUrl} onChange={(event) => setForm((value) => ({ ...value, imageUrl: event.target.value }))} placeholder="選填；https://… 或 /images/…" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="program-cta">CTA 文字 *</Label>
              <Input id="program-cta" value={form.ctaLabel} onChange={(event) => setForm((value) => ({ ...value, ctaLabel: event.target.value }))} />
            </div>
            <div className="flex items-end">
              <div className="flex h-10 w-full items-center justify-between rounded-md border px-3">
                <Label htmlFor="program-enabled">新增／儲存後公開</Label>
                <Switch id="program-enabled" checked={form.enabled} onCheckedChange={(enabled) => setForm((value) => ({ ...value, enabled }))} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeForm} disabled={isFormPending}>取消</Button>
            <Button onClick={submitForm} disabled={isFormPending} className="bg-orange-500 hover:bg-orange-600">{isFormPending ? "儲存中…" : "儲存方案"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!archiveTarget} onOpenChange={(open) => { if (!open && !archiveMutation.isPending) setArchiveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確定要刪除「{archiveTarget?.shortTitle || archiveTarget?.title}」嗎？</AlertDialogTitle>
            <AlertDialogDescription>
              為保護未來可能產生的歷史關聯，此操作會採安全封存：方案立即從公開頁移除，但資料不會永久刪除，也不會影響任何企業申請案件；之後仍可從本頁復原。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiveMutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={archiveMutation.isPending}
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => archiveTarget && archiveMutation.mutate({ id: archiveTarget.id })}
            >
              {archiveMutation.isPending ? "處理中…" : "確認刪除（封存）"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
