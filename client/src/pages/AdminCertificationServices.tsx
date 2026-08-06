import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Plus, Pencil, Trash2, Copy, ArrowUp, ArrowDown, Eye, ShieldCheck,
} from "lucide-react";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import {
  CERTIFICATION_SERVICE_STATUS_LABELS, CERTIFICATION_SERVICE_TYPE_OPTIONS,
  CERTIFICATION_NEED_OPTIONS, type CertificationServiceStatus,
} from "@shared/certificationServices";
import { CERTIFICATION_BADGES, BADGE_CATEGORY_LABELS } from "@shared/badges";

// SelectItem 的 value 不能是空字串（既有慣例），因此「無對應徽章」用這個固定
// sentinel 值代表，送出前才轉換成 null／""。
const NO_BADGE_SENTINEL = "__no_badge__";

export default function AdminCertificationServices() {
  const { user, loading } = useAuth();
  if (loading) return <AppLoading />;
  if (!user || user.role !== "admin") return <div className="flex items-center justify-center min-h-screen text-muted-foreground">無權限</div>;
  return <AdminCertificationServicesContent />;
}

const STATUS_BADGE_CLASS: Record<CertificationServiceStatus, string> = {
  draft: "bg-gray-100 text-gray-600 border-gray-200",
  published: "bg-green-100 text-green-700 border-green-200",
  unpublished: "bg-amber-100 text-amber-700 border-amber-200",
  archived: "bg-red-100 text-red-600 border-red-200",
};

type ItemFormState = {
  code: string;
  badgeCode: string;
  categoryId: number | null;
  name: string;
  type: string;
  shortDescription: string;
  applicableNeeds: string[];
  applicableIndustries: string;
  versionNote: string;
  serviceEnabled: boolean;
  consultEnabled: boolean;
};

const DEFAULT_ITEM_FORM: ItemFormState = {
  code: "", badgeCode: "", categoryId: null, name: "", type: CERTIFICATION_SERVICE_TYPE_OPTIONS[0],
  shortDescription: "", applicableNeeds: [], applicableIndustries: "", versionNote: "",
  serviceEnabled: true, consultEnabled: true,
};

function AdminCertificationServicesContent() {
  const [tab, setTab] = useState<"items" | "categories">("items");
  const utils = trpc.useUtils();

  const { data: categories = [], isLoading: categoriesLoading } = trpc.admin.certificationServices.listCategories.useQuery();
  const { data: items = [], isLoading: itemsLoading } = trpc.admin.certificationServices.listItems.useQuery();

  // ── 分類管理 ──
  const [newCategoryCode, setNewCategoryCode] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");

  const createCategoryMut = trpc.admin.certificationServices.createCategory.useMutation({
    onSuccess: () => { toast.success("已新增分類"); utils.admin.certificationServices.listCategories.invalidate(); setNewCategoryCode(""); setNewCategoryName(""); },
    onError: e => toast.error(e.message),
  });
  const updateCategoryMut = trpc.admin.certificationServices.updateCategory.useMutation({
    onSuccess: () => { toast.success("已更新"); utils.admin.certificationServices.listCategories.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const moveCategoryMut = trpc.admin.certificationServices.moveCategory.useMutation({
    onSuccess: () => { utils.admin.certificationServices.listCategories.invalidate(); },
    onError: e => toast.error(e.message),
  });

  // ── 服務項目管理 ──
  const [showItemForm, setShowItemForm] = useState(false);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [previewItem, setPreviewItem] = useState<(typeof items)[number] | null>(null);
  const [itemForm, setItemForm] = useState<ItemFormState>(DEFAULT_ITEM_FORM);

  const resetItemForm = () => { setItemForm(DEFAULT_ITEM_FORM); setEditingItemId(null); setShowItemForm(false); };

  const createItemMut = trpc.admin.certificationServices.createItem.useMutation({
    onSuccess: () => { toast.success("已新增服務項目（草稿）"); utils.admin.certificationServices.listItems.invalidate(); resetItemForm(); },
    onError: e => toast.error(e.message),
  });
  const updateItemMut = trpc.admin.certificationServices.updateItem.useMutation({
    onSuccess: () => { toast.success("已更新"); utils.admin.certificationServices.listItems.invalidate(); resetItemForm(); },
    onError: e => toast.error(e.message),
  });
  const duplicateItemMut = trpc.admin.certificationServices.duplicateItem.useMutation({
    onSuccess: () => { toast.success("已複製為新草稿"); utils.admin.certificationServices.listItems.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const moveItemMut = trpc.admin.certificationServices.moveItem.useMutation({
    onSuccess: () => { utils.admin.certificationServices.listItems.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const setStatusMut = trpc.admin.certificationServices.setStatus.useMutation({
    onSuccess: () => { toast.success("狀態已更新"); utils.admin.certificationServices.listItems.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const deleteItemMut = trpc.admin.certificationServices.deleteItem.useMutation({
    onSuccess: () => { toast.success("已刪除"); utils.admin.certificationServices.listItems.invalidate(); },
    onError: e => toast.error(e.message),
  });

  const handleEditItem = (item: (typeof items)[number]) => {
    setItemForm({
      code: item.code,
      badgeCode: item.badgeCode ?? "",
      categoryId: item.categoryId,
      name: item.name,
      type: item.type,
      shortDescription: item.shortDescription,
      applicableNeeds: (item.applicableNeeds as string[]) ?? [],
      applicableIndustries: ((item.applicableIndustries as string[]) ?? []).join("、"),
      versionNote: item.versionNote ?? "",
      serviceEnabled: item.serviceEnabled,
      consultEnabled: item.consultEnabled,
    });
    setEditingItemId(item.id);
    setShowItemForm(true);
  };

  const handleSubmitItem = () => {
    if (!itemForm.code.trim() || !/^[a-z0-9-]+$/.test(itemForm.code.trim())) {
      toast.error("代碼為必填，只能包含小寫英文、數字與連字號"); return;
    }
    if (!itemForm.categoryId) { toast.error("請選擇分類"); return; }
    if (!itemForm.name.trim()) { toast.error("請填寫顯示名稱"); return; }
    if (!itemForm.shortDescription.trim()) { toast.error("請填寫短說明"); return; }

    const payload = {
      badgeCode: itemForm.badgeCode.trim() || null,
      categoryId: itemForm.categoryId,
      name: itemForm.name.trim(),
      type: itemForm.type,
      shortDescription: itemForm.shortDescription.trim(),
      applicableNeeds: itemForm.applicableNeeds,
      applicableIndustries: itemForm.applicableIndustries.split(/[、,，]/).map(s => s.trim()).filter(Boolean),
      versionNote: itemForm.versionNote.trim() || null,
      serviceEnabled: itemForm.serviceEnabled,
      consultEnabled: itemForm.consultEnabled,
    };

    if (editingItemId) {
      updateItemMut.mutate({ id: editingItemId, ...payload });
    } else {
      createItemMut.mutate({ code: itemForm.code.trim(), ...payload });
    }
  };

  const toggleNeed = (need: string) => {
    setItemForm(p => ({
      ...p,
      applicableNeeds: p.applicableNeeds.includes(need)
        ? p.applicableNeeds.filter(n => n !== need)
        : [...p.applicableNeeds, need],
    }));
  };

  const isItemPending = createItemMut.isPending || updateItemMut.isPending;

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-purple-50 px-4 pb-4 md:px-8 md:pb-8 admin-page-top">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <FloatingBackButton fallbackHref="/admin" noNavbar />
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-orange-500" />
            <h1 className="text-2xl font-bold">認證服務管理</h1>
          </div>
          <div />
        </div>
        <p className="text-xs text-muted-foreground mb-6">
          管理「ISO 與低碳認證專區」的分類與服務項目。此頁面僅供管理員使用，不影響既有工廠徽章系統的申請、審核或公開顯示。
        </p>

        <Tabs value={tab} onValueChange={v => setTab(v as "items" | "categories")} className="mb-6">
          <TabsList>
            <TabsTrigger value="items">服務項目</TabsTrigger>
            <TabsTrigger value="categories">分類管理</TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === "categories" && (
          <div className="space-y-4">
            <Card>
              <CardContent className="p-4 space-y-3">
                <p className="text-sm font-semibold">新增分類</p>
                <div className="grid sm:grid-cols-3 gap-3">
                  <Input placeholder="代碼（如 iso-management）" value={newCategoryCode} onChange={e => setNewCategoryCode(e.target.value)} />
                  <Input placeholder="顯示名稱" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} />
                  <Button
                    disabled={createCategoryMut.isPending}
                    onClick={() => {
                      if (!newCategoryCode.trim() || !/^[a-z0-9-]+$/.test(newCategoryCode.trim())) { toast.error("代碼只能包含小寫英文、數字與連字號"); return; }
                      if (!newCategoryName.trim()) { toast.error("請填寫顯示名稱"); return; }
                      createCategoryMut.mutate({ code: newCategoryCode.trim(), name: newCategoryName.trim() });
                    }}
                    className="gap-1"
                  ><Plus className="w-4 h-4" />新增</Button>
                </div>
              </CardContent>
            </Card>

            {categoriesLoading ? (
              <div className="text-center py-8 text-muted-foreground text-sm">載入中...</div>
            ) : (
              <div className="space-y-2">
                {categories.map((cat, idx) => (
                  <Card key={cat.id}>
                    <CardContent className="p-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <Badge variant="outline" className="text-xs shrink-0">{cat.code}</Badge>
                        <Input
                          value={cat.name}
                          onChange={e => updateCategoryMut.mutate({ id: cat.id, name: e.target.value })}
                          className="max-w-xs h-8 text-sm"
                        />
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center gap-1.5">
                          <Switch checked={cat.isActive} onCheckedChange={v => updateCategoryMut.mutate({ id: cat.id, isActive: v })} />
                          <span className="text-xs text-muted-foreground">{cat.isActive ? "啟用" : "停用"}</span>
                        </div>
                        <Button size="sm" variant="outline" disabled={idx === 0} onClick={() => moveCategoryMut.mutate({ idA: cat.id, idB: categories[idx - 1].id })}>
                          <ArrowUp className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="sm" variant="outline" disabled={idx === categories.length - 1} onClick={() => moveCategoryMut.mutate({ idA: cat.id, idB: categories[idx + 1].id })}>
                          <ArrowDown className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "items" && (
          <div className="space-y-4">
            <div className="flex justify-end">
              {!showItemForm && (
                <Button onClick={() => setShowItemForm(true)} className="gap-2 bg-orange-500 hover:bg-orange-600 text-white border-0">
                  <Plus className="w-4 h-4" />新增服務項目
                </Button>
              )}
            </div>

            {showItemForm && (
              <Card className="border-orange-200">
                <CardContent className="p-4 space-y-4">
                  <p className="text-sm font-semibold">{editingItemId ? "編輯服務項目" : "新增服務項目"}</p>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <Label>穩定代碼 *{editingItemId && <span className="text-muted-foreground font-normal"> （建立後不可修改）</span>}</Label>
                      <Input disabled={!!editingItemId} value={itemForm.code} onChange={e => setItemForm(p => ({ ...p, code: e.target.value }))} placeholder="例：iso-9001" className="mt-1" />
                    </div>
                    <div>
                      <Label>對應徽章代碼</Label>
                      {/* 只能從既有徽章清單選擇或選「無對應徽章」，不開放自由輸入文字
                          ——伺服器端（certificationServiceBadgeCodeSchema）仍會再驗證一次，
                          這裡只是避免管理員手動打錯字或填入不存在的代碼。SelectItem 的
                          value 不能是空字串（既有慣例），因此「無對應徽章」用固定的
                          NO_BADGE_SENTINEL 代表，送出前才轉換成 null。 */}
                      <Select
                        value={itemForm.badgeCode || NO_BADGE_SENTINEL}
                        onValueChange={v => setItemForm(p => ({ ...p, badgeCode: v === NO_BADGE_SENTINEL ? "" : v }))}
                      >
                        <SelectTrigger className="mt-1"><SelectValue placeholder="請選擇對應徽章" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_BADGE_SENTINEL}>無對應徽章</SelectItem>
                          {CERTIFICATION_BADGES.map(b => (
                            <SelectItem key={b.id} value={b.id}>{b.name}（{BADGE_CATEGORY_LABELS[b.category]}）</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>分類 *</Label>
                      <Select value={itemForm.categoryId ? String(itemForm.categoryId) : ""} onValueChange={v => setItemForm(p => ({ ...p, categoryId: Number(v) }))}>
                        <SelectTrigger className="mt-1"><SelectValue placeholder="請選擇分類" /></SelectTrigger>
                        <SelectContent>
                          {categories.map(cat => <SelectItem key={cat.id} value={String(cat.id)}>{cat.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>類型 *</Label>
                      <Select value={itemForm.type} onValueChange={v => setItemForm(p => ({ ...p, type: v }))}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CERTIFICATION_SERVICE_TYPE_OPTIONS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label>顯示名稱 *</Label>
                    <Input value={itemForm.name} onChange={e => setItemForm(p => ({ ...p, name: e.target.value }))} placeholder="例：ISO 9001 品質管理系統" className="mt-1" />
                  </div>
                  <div>
                    <Label>短說明 *</Label>
                    <Textarea value={itemForm.shortDescription} onChange={e => setItemForm(p => ({ ...p, shortDescription: e.target.value }))} rows={3} className="mt-1" />
                  </div>
                  <div>
                    <Label>適用需求</Label>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {CERTIFICATION_NEED_OPTIONS.map(need => (
                        <button
                          key={need}
                          type="button"
                          onClick={() => toggleNeed(need)}
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${itemForm.applicableNeeds.includes(need) ? "bg-orange-500 text-white border-orange-500" : "bg-white text-muted-foreground border-border"}`}
                        >{need}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label>適用產業（以頓號分隔）</Label>
                    <Input value={itemForm.applicableIndustries} onChange={e => setItemForm(p => ({ ...p, applicableIndustries: e.target.value }))} placeholder="例：製造業、電子業、紡織業" className="mt-1" />
                  </div>
                  <div>
                    <Label>版本或過渡提醒（可留空）</Label>
                    <Input value={itemForm.versionNote} onChange={e => setItemForm(p => ({ ...p, versionNote: e.target.value }))} className="mt-1" />
                  </div>
                  <div className="flex gap-6">
                    <div className="flex items-center gap-2">
                      <Switch checked={itemForm.serviceEnabled} onCheckedChange={v => setItemForm(p => ({ ...p, serviceEnabled: v }))} />
                      <span className="text-sm">是否提供認證服務</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={itemForm.consultEnabled} onCheckedChange={v => setItemForm(p => ({ ...p, consultEnabled: v }))} />
                      <span className="text-sm">是否開放諮詢</span>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Button onClick={handleSubmitItem} disabled={isItemPending} className="bg-orange-500 hover:bg-orange-600 text-white border-0">
                      {isItemPending ? "儲存中..." : editingItemId ? "儲存更新" : "建立草稿"}
                    </Button>
                    <Button variant="outline" onClick={resetItemForm}>取消</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {itemsLoading ? (
              <div className="text-center py-8 text-muted-foreground text-sm">載入中...</div>
            ) : items.length === 0 ? (
              <Card><CardContent className="p-12 text-center text-muted-foreground text-sm">尚無服務項目</CardContent></Card>
            ) : (
              <div className="space-y-2">
                {items.map((item, idx) => {
                  const sameCategoryItems = items.filter(i => i.categoryId === item.categoryId);
                  const posInCategory = sameCategoryItems.findIndex(i => i.id === item.id);
                  const prevInCategory = sameCategoryItems[posInCategory - 1];
                  const nextInCategory = sameCategoryItems[posInCategory + 1];
                  return (
                    <Card key={item.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <Badge className={`${STATUS_BADGE_CLASS[item.status as CertificationServiceStatus]} border text-xs`}>
                                {CERTIFICATION_SERVICE_STATUS_LABELS[item.status as CertificationServiceStatus]}
                              </Badge>
                              <Badge variant="outline" className="text-xs">{item.categoryName}</Badge>
                              <Badge variant="outline" className="text-xs">{item.type}</Badge>
                              <span className="text-xs text-muted-foreground font-mono">{item.code}</span>
                              {!item.serviceEnabled && <Badge variant="outline" className="text-xs text-red-500 border-red-200">未提供認證服務</Badge>}
                            </div>
                            <p className="font-semibold text-sm">{item.name}</p>
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.shortDescription}</p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                            <Button size="sm" variant="outline" onClick={() => setPreviewItem(item)} title="預覽"><Eye className="w-3.5 h-3.5" /></Button>
                            <Button size="sm" variant="outline" onClick={() => handleEditItem(item)} title="編輯"><Pencil className="w-3.5 h-3.5" /></Button>
                            <Button size="sm" variant="outline" onClick={() => duplicateItemMut.mutate({ id: item.id })} title="複製"><Copy className="w-3.5 h-3.5" /></Button>
                            <Button size="sm" variant="outline" disabled={!prevInCategory} onClick={() => prevInCategory && moveItemMut.mutate({ idA: item.id, idB: prevInCategory.id })}><ArrowUp className="w-3.5 h-3.5" /></Button>
                            <Button size="sm" variant="outline" disabled={!nextInCategory} onClick={() => nextInCategory && moveItemMut.mutate({ idA: item.id, idB: nextInCategory.id })}><ArrowDown className="w-3.5 h-3.5" /></Button>
                            {item.status === "draft" && (
                              <>
                                <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white border-0" onClick={() => setStatusMut.mutate({ id: item.id, status: "published" })}>上架</Button>
                                <Button size="sm" variant="outline" className="text-red-500 hover:bg-red-50" onClick={() => { if (confirm("確定永久刪除此草稿？")) deleteItemMut.mutate({ id: item.id }); }}><Trash2 className="w-3.5 h-3.5" /></Button>
                              </>
                            )}
                            {item.status === "published" && (
                              <>
                                <Button size="sm" variant="outline" onClick={() => setStatusMut.mutate({ id: item.id, status: "unpublished" })}>下架</Button>
                                <Button size="sm" variant="outline" className="text-red-500 hover:bg-red-50" onClick={() => setStatusMut.mutate({ id: item.id, status: "archived" })}>封存</Button>
                              </>
                            )}
                            {item.status === "unpublished" && (
                              <>
                                <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white border-0" onClick={() => setStatusMut.mutate({ id: item.id, status: "published" })}>上架</Button>
                                <Button size="sm" variant="outline" className="text-red-500 hover:bg-red-50" onClick={() => setStatusMut.mutate({ id: item.id, status: "archived" })}>封存</Button>
                              </>
                            )}
                            {item.status === "archived" && (
                              <Button size="sm" variant="outline" onClick={() => setStatusMut.mutate({ id: item.id, status: "unpublished" })}>復原</Button>
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
        )}
      </div>

      {previewItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setPreviewItem(null)}>
          <Card className="max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <CardContent className="p-5">
              <Badge variant="outline" className="text-[11px] mb-2">{previewItem.type}</Badge>
              <h3 className="font-semibold text-sm mb-1.5">{previewItem.name}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed mb-3">{previewItem.shortDescription}</p>
              {(previewItem.applicableNeeds as string[])?.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {(previewItem.applicableNeeds as string[]).map(n => <span key={n} className="text-[11px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-700">{n}</span>)}
                </div>
              )}
              {(previewItem.applicableIndustries as string[])?.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {(previewItem.applicableIndustries as string[]).map(n => <span key={n} className="text-[11px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700">{n}</span>)}
                </div>
              )}
              {previewItem.versionNote && <p className="text-[11px] text-amber-600 mb-2">{previewItem.versionNote}</p>}
              <Button size="sm" className="w-full mt-2" onClick={() => setPreviewItem(null)}>關閉預覽</Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
