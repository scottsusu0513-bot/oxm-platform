import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Building2, MapPin, AlertCircle, AlertTriangle, Image, Package, User, ChevronDown, Pencil, Users, Award, X, Trash2, EyeOff, RotateCcw } from "lucide-react";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { useState } from "react";
import { toast } from "sonner";
import { INDUSTRY_OPTIONS } from "@shared/constants";
import { CERTIFICATION_BADGE_MAP, sortBadgeIds } from "@shared/badges";
import { BadgeIcon } from "@/components/badges/BadgeIcon";
import { useCertificationEvidenceViewUrls } from "@/hooks/useCertificationEvidenceViewUrls";

// 修改申請 diff 用：BASIC_DATA_FIELDS 對應的中文標籤（見 server/db.ts）。
// certificationBadges／certificationEvidence 在「徽章系統」分頁單獨處理，
// 不會出現在這份標籤清單裡（一般欄位走文字 diff，徽章走專用的徽章 diff UI）。
const FIELD_LABELS: Record<string, string> = {
  name: "工廠名稱", industry: "主產業", subIndustry: "子產業", mfgModes: "代工模式",
  region: "所在地區", description: "簡介", capitalLevel: "資本額", foundedYear: "成立年份",
  ownerName: "負責人", contactPersonName: "聯絡窗口", phone: "電話", website: "網站",
  contactEmail: "電郵", address: "公廠地址", operationStatus: "接單狀態",
  weekdayHours: "平日營業時間", weekendHours: "假日營業時間", businessNote: "營業備註",
  avatarUrl: "工廠大頭貼",
};
const OPERATION_STATUS_LABELS: Record<string, string> = { normal: "接單中", busy: "產線繁忙", full: "產線滿載" };

function formatFieldValue(field: string, val: unknown): React.ReactNode {
  if (val === null || val === undefined || val === "") return "（空）";
  if (field === "avatarUrl" && typeof val === "string") {
    return <img src={val} alt="" className="w-12 h-12 rounded object-cover" />;
  }
  if (field === "operationStatus" && typeof val === "string") {
    return OPERATION_STATUS_LABELS[val] ?? val;
  }
  if (Array.isArray(val)) return val.length > 0 ? val.join("、") : "（空）";
  return String(val);
}

export default function FactoryReviewDetail() {
  const { user, loading: authLoading } = useAuth();
  const [location, setLocation] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const factoryId = parseInt(searchParams.get("id") || "0");
  const revisionIdParam = searchParams.get("revisionId");
  const revisionId = revisionIdParam ? parseInt(revisionIdParam) : undefined;
  const isRevisionMode = !!revisionId;
  const [rejectionReason, setRejectionReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [industryEdit, setIndustryEdit] = useState<string[] | null>(null);
  const [industryPopoverOpen, setIndustryPopoverOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const isAdmin = !authLoading && user?.role === "admin";
  const { data: factory, isLoading: factoryLoading } = trpc.admin.getFactoryDetail.useQuery(
    { id: factoryId },
    { enabled: isAdmin && !!factoryId }
  );
  const { data: revision, isLoading: revisionLoading } = trpc.admin.getRevisionDetail.useQuery(
    { revisionId: revisionId ?? 0 },
    { enabled: isAdmin && isRevisionMode }
  );
  const { data: photos } = trpc.factory.getPhotos.useQuery(
    { factoryId },
    { enabled: isAdmin && !!factoryId }
  );
  const { data: products } = trpc.product.getByFactory.useQuery(
    { factoryId },
    { enabled: isAdmin && !!factoryId }
  );
  // key 一律由伺服器自己從資料庫目前存的 certificationEvidence／revision 的
  // originalData／proposedData 讀出（見 getCertificationEvidenceViewUrls 的
  // 說明），這裡不需要、也不能傳 key 進去；revisionId 有值時會一併把該筆
  // 修改申請 originalData／proposedData 裡的 key 也收進來換發短效網址。
  const { urls: evidenceViewUrls } = useCertificationEvidenceViewUrls(isAdmin ? factoryId : undefined, revisionId);
  const approveMutation = trpc.admin.approveFactory.useMutation();
  const rejectMutation = trpc.admin.rejectFactory.useMutation();
  const approveRevisionMutation = trpc.admin.approveRevision.useMutation();
  const rejectRevisionMutation = trpc.admin.rejectRevision.useMutation();
  const delistMutation = trpc.admin.delistFactory.useMutation();
  const deleteMutation = trpc.admin.deleteFactory.useMutation();
  const updateIndustryMut = trpc.admin.updateFactoryIndustry.useMutation({
    onSuccess: () => {
      toast.success("產業分類已更新");
      setIndustryEdit(null);
      utils.admin.getFactoryDetail.invalidate({ id: factoryId });
    },
    onError: (err) => toast.error(err.message),
  });
  const utils = trpc.useUtils();

  if (authLoading) return <AppLoading />;
  if (!user || user.role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">您沒有權限存取此頁面</div>
      </div>
    );
  }

  if (factoryLoading || (isRevisionMode && revisionLoading)) return <AppLoading />;
  if (!factory) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">找不到該工廠</div>
      </div>
    );
  }
  if (isRevisionMode && !revision) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">找不到此修改申請（可能已被其他管理員處理）</div>
      </div>
    );
  }

  const originalData = (revision?.originalData as Record<string, any>) ?? {};
  const proposedData = (revision?.proposedData as Record<string, any>) ?? {};
  const changedFields = isRevisionMode
    ? Object.keys(proposedData).filter(k => JSON.stringify(originalData[k]) !== JSON.stringify(proposedData[k]))
    : [];

  const handleApprove = async () => {
    try {
      setIsSubmitting(true);
      if (isRevisionMode && revisionId) {
        await approveRevisionMutation.mutateAsync({ revisionId });
        toast.success("已通過修改申請");
      } else {
        await approveMutation.mutateAsync({ factoryId });
        toast.success("已批准該工廠");
      }
      window.location.href = "/admin";
    } catch (error: any) {
      toast.error(error?.message || "批准失敗");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!rejectionReason.trim()) {
      toast.error("請填寫拒絕原因");
      return;
    }
    try {
      setIsSubmitting(true);
      if (isRevisionMode && revisionId) {
        await rejectRevisionMutation.mutateAsync({ revisionId, reason: rejectionReason });
        toast.success("已拒絕此修改申請");
      } else {
        await rejectMutation.mutateAsync({ factoryId, reason: rejectionReason });
        toast.success("已拒絕該工廠");
      }
      window.location.href = "/admin";
    } catch (error: any) {
      toast.error(error?.message || "拒絕失敗");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelist = async () => {
    try {
      setIsSubmitting(true);
      await delistMutation.mutateAsync({ factoryId });
      toast.success("已下架該工廠");
      window.location.href = "/admin";
    } catch (error: any) {
      toast.error(error?.message || "下架失敗");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRelist = async () => {
    try {
      setIsSubmitting(true);
      await approveMutation.mutateAsync({ factoryId });
      toast.success("已重新上架該工廠");
      window.location.href = "/admin";
    } catch (error: any) {
      toast.error(error?.message || "重新上架失敗");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    try {
      setIsSubmitting(true);
      await deleteMutation.mutateAsync({ factoryId });
      toast.success("已刪除該工廠");
      window.location.href = "/admin";
    } catch (error: any) {
      toast.error(error?.message || "刪除失敗");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 px-4 pb-4 md:px-8 md:pb-8 admin-page-top">
      <div className="max-w-4xl mx-auto">
      <FloatingBackButton fallbackHref="/admin" noNavbar />
        <div className="flex items-center gap-4 mb-2">
          <h1 className="text-3xl font-bold text-gray-900">{isRevisionMode ? "修改申請詳情" : "工廠審核詳情"}</h1>
        </div>
        {isRevisionMode && revision && (
          <div className="mb-8 px-3 py-2 bg-blue-50 border border-blue-100 rounded-md text-sm text-blue-800">
            提交者：{revision.submitterName} · {new Date(revision.submittedAt).toLocaleDateString("zh-TW")}
            {revision.revisionReason && <span> · 申請原因：{revision.revisionReason}</span>}
            {" · "}修改欄位數：{changedFields.filter(f => f !== "certificationBadges" && f !== "certificationEvidence").length + (changedFields.includes("certificationBadges") || changedFields.includes("certificationEvidence") ? 1 : 0)}
          </div>
        )}
        {!isRevisionMode && <div className="mb-8" />}

        <Tabs defaultValue="basic">
          <TabsList className="mb-4 w-full sm:w-fit max-w-full overflow-x-auto justify-start">
            <TabsTrigger value="basic" className="gap-2 shrink-0">
              <Building2 className="h-4 w-4" />基本資料
            </TabsTrigger>
            <TabsTrigger value="photos" className="gap-2">
              <Image className="h-4 w-4" />照片集
              {photos && photos.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">{photos.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="products" className="gap-2">
              <Package className="h-4 w-4" />產品
              {products && products.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">{products.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="badges" className="gap-2">
              <Award className="h-4 w-4" />徽章系統
              {((factory as any).certificationBadges?.length ?? 0) > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">{(factory as any).certificationBadges.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* 基本資訊 */}
          <TabsContent value="basic">
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  {factory.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {((factory as any).ownerAccountName || (factory as any).ownerAccountEmail) && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-md text-sm text-blue-800">
                    <User className="h-4 w-4 shrink-0" />
                    <span className="font-medium">申請帳號：</span>
                    <span>{(factory as any).ownerAccountName ?? ""}{(factory as any).ownerAccountEmail ? ` (${(factory as any).ownerAccountEmail})` : ""}</span>
                  </div>
                )}
                {isRevisionMode ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                      工廠完整基本資料（修改前為紅色、修改後為綠色，未修改欄位為一般顏色）
                    </p>
                    {(["name", "industry", "subIndustry", "mfgModes", "region", "description", "capitalLevel", "foundedYear", "ownerName", "contactPersonName", "phone", "website", "contactEmail", "address", "operationStatus", "weekdayHours", "weekendHours", "businessNote", "avatarUrl"] as const).map(field => {
                      const changed = field in proposedData && JSON.stringify(originalData[field]) !== JSON.stringify(proposedData[field]);
                      const label = FIELD_LABELS[field] ?? field;
                      if (!changed) {
                        return (
                          <div key={field} className="grid grid-cols-[7rem_1fr] gap-2 text-sm border-b py-1.5">
                            <span className="text-gray-500">{label}</span>
                            <span>{formatFieldValue(field, originalData[field])}</span>
                          </div>
                        );
                      }
                      return (
                        <div key={field} className="grid grid-cols-[7rem_1fr_1fr] gap-2 text-sm border-l-2 border-orange-300 pl-2 py-1">
                          <span className="text-gray-500 pt-0.5">{label}</span>
                          <div className="bg-red-50 rounded px-2 py-1 text-red-700 min-h-[28px]">{formatFieldValue(field, originalData[field])}</div>
                          <div className="bg-green-50 rounded px-2 py-1 text-green-700 min-h-[28px]">{formatFieldValue(field, proposedData[field])}</div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-gray-600">產業分類</Label>
                    {industryEdit === null ? (
                      <div className="flex items-center gap-2 mt-0.5">
                        <div className="flex-1">
                          {(() => {
                            const current = (factory as any).industry as string[] | null;
                            const values = Array.isArray(current) ? current : (current ? [current as string] : []);
                            const hasOld = values.some(v => !(INDUSTRY_OPTIONS as readonly string[]).includes(v));
                            return (
                              <>
                                <p className="font-medium">{values.join("、") || "—"}</p>
                                {hasOld && (
                                  <p className="text-xs text-amber-600 mt-0.5">
                                    ⚠ 存在舊產業值：{values.filter(v => !(INDUSTRY_OPTIONS as readonly string[]).includes(v)).join("、")}
                                  </p>
                                )}
                              </>
                            );
                          })()}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 shrink-0"
                          onClick={() => {
                            const current = (factory as any).industry as string[] | null;
                            const values = Array.isArray(current) ? current : (current ? [current as string] : []);
                            const valid = values.filter(v => (INDUSTRY_OPTIONS as readonly string[]).includes(v));
                            setIndustryEdit(valid);
                          }}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div className="mt-1 space-y-2">
                        <Popover open={industryPopoverOpen} onOpenChange={setIndustryPopoverOpen}>
                          <PopoverTrigger asChild>
                            <Button type="button" variant="outline" size="sm" className="w-full justify-between font-normal">
                              <span className="truncate text-sm">
                                {industryEdit.length === 0 ? "請選擇產業" : industryEdit.join("、")}
                              </span>
                              <ChevronDown className="w-3 h-3 shrink-0 opacity-50 ml-1" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-56 p-2" align="start">
                            <div className="space-y-1 max-h-60 overflow-y-auto">
                              {(INDUSTRY_OPTIONS as readonly string[]).map(opt => (
                                <label key={opt} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm">
                                  <Checkbox
                                    checked={industryEdit.includes(opt)}
                                    onCheckedChange={() => {
                                      setIndustryEdit(prev =>
                                        prev!.includes(opt) ? prev!.filter(i => i !== opt) : [...prev!, opt]
                                      );
                                    }}
                                  />
                                  {opt}
                                </label>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={updateIndustryMut.isPending}
                            onClick={() => {
                              if (industryEdit.length === 0) { toast.error("請至少選擇一個產業分類"); return; }
                              updateIndustryMut.mutate({ factoryId, industry: industryEdit });
                            }}
                          >
                            {updateIndustryMut.isPending ? "儲存中…" : "儲存"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setIndustryEdit(null)}>取消</Button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div>
                    <Label className="text-gray-600">地區</Label>
                    <p className="font-medium flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      {factory.region}
                    </p>
                  </div>
                  <div>
                    <Label className="text-gray-600">公廠地址</Label>
                    <p className="font-medium">{factory.address || "未提供"}</p>
                  </div>
                  <div>
                    <Label className="text-gray-600">資本額</Label>
                    <p className="font-medium">{factory.capitalLevel}</p>
                  </div>
                  <div>
                    <Label className="text-gray-600">成立年份</Label>
                    <p className="font-medium">{factory.foundedYear}</p>
                  </div>
                  <div>
                    <Label className="text-gray-600">負責人</Label>
                    <p className="font-medium">{factory.ownerName || "未填寫"}</p>
                  </div>
                  <div>
                    <Label className="text-gray-600">聯絡人</Label>
                    <p className="font-medium">{(factory as any).contactPersonName || "未填寫"}</p>
                  </div>
                  <div>
                    <Label className="text-gray-600">電話</Label>
                    <p className="font-medium">{factory.phone}</p>
                  </div>
                  <div>
                    <Label className="text-gray-600">電郵</Label>
                    <p className="font-medium">{factory.contactEmail}</p>
                  </div>
                  <div>
                    <Label className="text-gray-600">網站</Label>
                    <p className="font-medium">{factory.website || "未提供"}</p>
                  </div>
                </div>
                <div>
                  <Label className="text-gray-600">簡介</Label>
                  <p className="font-medium whitespace-pre-wrap">{factory.description}</p>
                </div>
                <div>
                  <Label className="text-gray-600">代工模式</Label>
                  <p className="font-medium">{factory.mfgModes?.join(", ") || "未提供"}</p>
                </div>
                </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 照片集 */}
          <TabsContent value="photos">
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Image className="h-5 w-5" />照片集
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!photos || photos.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">尚未上傳任何照片</p>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {photos.map((photo) => (
                      <div key={photo.id} className="space-y-1">
                        <img
                          src={photo.url}
                          alt={photo.caption ?? ""}
                          className="w-full h-40 object-cover rounded-md border"
                          loading="lazy"
                        />
                        {photo.caption && (
                          <p className="text-xs text-muted-foreground truncate">{photo.caption}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 產品 */}
          <TabsContent value="products">
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />產品列表
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!products || products.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">尚未新增任何產品</p>
                ) : (
                  <div className="space-y-3">
                    {products.map((product) => (
                      <div key={product.id} className="border rounded-lg p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium">{product.name}</p>
                            {product.description && (
                              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{product.description}</p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            {product.priceType === "fixed" && product.priceMin && (
                              <p className="text-sm font-medium">NT$ {Number(product.priceMin).toLocaleString()}</p>
                            )}
                            {product.priceType === "range" && product.priceMin && product.priceMax && (
                              <p className="text-sm font-medium">NT$ {Number(product.priceMin).toLocaleString()} – {Number(product.priceMax).toLocaleString()}</p>
                            )}
                            {product.priceType === "market" && (
                              <p className="text-sm text-muted-foreground">市價</p>
                            )}
                          </div>
                        </div>
                        {(product.images as string[] | null)?.length ? (
                          <div className="flex gap-2 mt-3 flex-wrap">
                            {(product.images as string[]).slice(0, 4).map((url, i) => (
                              <img key={i} src={url} alt="" className="w-16 h-16 object-cover rounded border" loading="lazy" />
                            ))}
                          </div>
                        ) : null}
                        <div className="flex gap-2 mt-2">
                          {product.acceptSmallOrder && <Badge variant="outline" className="text-xs">接小單</Badge>}
                          {product.provideSample && <Badge variant="outline" className="text-xs">提供樣品</Badge>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 徽章系統 */}
          <TabsContent value="badges">
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Award className="h-5 w-5" />徽章系統
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isRevisionMode ? (() => {
                  const oldBadgeIds = sortBadgeIds((originalData.certificationBadges ?? (factory as any).certificationBadges ?? []) as string[]);
                  const newBadgeIds = "certificationBadges" in proposedData
                    ? sortBadgeIds(proposedData.certificationBadges as string[])
                    : oldBadgeIds;
                  const allBadgeIds = sortBadgeIds(Array.from(new Set([...oldBadgeIds, ...newBadgeIds])));
                  const oldEvidence = (originalData.certificationEvidence ?? []) as Array<{ badgeId: string; description: string; imageKeys: string[] }>;
                  const newEvidence = ("certificationEvidence" in proposedData ? proposedData.certificationEvidence : oldEvidence) as Array<{ badgeId: string; description: string; imageKeys: string[] }>;
                  if (allBadgeIds.length === 0) {
                    return <p className="text-muted-foreground text-center py-8">此修改申請未異動徽章</p>;
                  }
                  const renderEvidenceThumb = (key: string, colorClass: string) => {
                    const viewUrl = evidenceViewUrls[key];
                    if (!viewUrl) {
                      return <div key={key} className={`w-16 h-16 rounded border ${colorClass} flex items-center justify-center text-[10px] text-muted-foreground`}>載入中</div>;
                    }
                    return (
                      <button key={key} type="button" onClick={() => setLightboxUrl(viewUrl)} className={`w-16 h-16 rounded border ${colorClass} overflow-hidden hover:opacity-80 transition-opacity`}>
                        <img src={viewUrl} alt="證明圖片" className="w-full h-full object-cover" loading="lazy" />
                      </button>
                    );
                  };
                  return (
                    <div className="space-y-4">
                      {allBadgeIds.map(id => {
                        const def = CERTIFICATION_BADGE_MAP[id];
                        const isAdded = !oldBadgeIds.includes(id) && newBadgeIds.includes(id);
                        const isRemoved = oldBadgeIds.includes(id) && !newBadgeIds.includes(id);
                        const oldEv = oldEvidence.find(e => e.badgeId === id);
                        const newEv = newEvidence.find(e => e.badgeId === id);
                        const oldKeys = oldEv?.imageKeys ?? [];
                        const newKeys = newEv?.imageKeys ?? [];
                        const addedKeys = newKeys.filter(k => !oldKeys.includes(k));
                        const removedKeys = oldKeys.filter(k => !newKeys.includes(k));
                        const unchangedKeys = newKeys.filter(k => oldKeys.includes(k));
                        const descChanged = (oldEv?.description ?? "") !== (newEv?.description ?? "");
                        return (
                          <div key={id} className={`border rounded-lg p-3 ${isAdded ? "border-green-300 bg-green-50/40" : isRemoved ? "border-red-300 bg-red-50/40" : ""}`}>
                            <div className="flex items-center gap-2">
                              <BadgeIcon badgeId={id} size={32} />
                              <p className="font-medium">{def?.name ?? id}</p>
                              {isAdded && <span className="text-xs text-green-700 bg-green-100 rounded px-1.5 py-0.5">新增</span>}
                              {isRemoved && <span className="text-xs text-red-700 bg-red-100 rounded px-1.5 py-0.5">移除</span>}
                            </div>
                            {descChanged ? (
                              <div className="grid grid-cols-2 gap-2 mt-2">
                                <div className="bg-red-50 rounded px-2 py-1 text-sm text-red-700 min-h-[28px]">{oldEv?.description || "（空）"}</div>
                                <div className="bg-green-50 rounded px-2 py-1 text-sm text-green-700 min-h-[28px]">{newEv?.description || "（空）"}</div>
                              </div>
                            ) : (
                              newEv?.description && <p className="text-sm text-muted-foreground mt-2">{newEv.description}</p>
                            )}
                            {(unchangedKeys.length > 0 || addedKeys.length > 0 || removedKeys.length > 0) && (
                              <div className="flex gap-2 mt-2 flex-wrap">
                                {unchangedKeys.map(k => renderEvidenceThumb(k, "bg-muted"))}
                                {addedKeys.map(k => renderEvidenceThumb(k, "border-green-400 bg-green-50 ring-1 ring-green-300"))}
                                {removedKeys.map(k => renderEvidenceThumb(k, "border-red-400 bg-red-50 ring-1 ring-red-300 opacity-70"))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })() : (() => {
                  const badgeIds = sortBadgeIds((factory as any).certificationBadges ?? []);
                  const evidence = ((factory as any).certificationEvidence ?? []) as Array<{ badgeId: string; description: string; imageKeys: string[] }>;
                  if (badgeIds.length === 0) {
                    return <p className="text-muted-foreground text-center py-8">工廠尚未選擇任何徽章</p>;
                  }
                  return (
                    <div className="space-y-4">
                      {badgeIds.map(id => {
                        const def = CERTIFICATION_BADGE_MAP[id];
                        const ev = evidence.find(e => e.badgeId === id);
                        return (
                          <div key={id} className="border rounded-lg p-3">
                            <div className="flex items-center gap-2">
                              <BadgeIcon badgeId={id} size={32} />
                              <p className="font-medium">{def?.name ?? id}</p>
                            </div>
                            {ev?.description && <p className="text-sm text-muted-foreground mt-2">{ev.description}</p>}
                            {ev?.imageKeys && ev.imageKeys.length > 0 && (
                              <div className="flex gap-2 mt-2 flex-wrap">
                                {ev.imageKeys.map(key => {
                                  const viewUrl = evidenceViewUrls[key];
                                  if (!viewUrl) {
                                    return (
                                      <div key={key} className="w-16 h-16 rounded border bg-muted flex items-center justify-center text-[10px] text-muted-foreground">
                                        載入中
                                      </div>
                                    );
                                  }
                                  return (
                                    <button
                                      key={key}
                                      type="button"
                                      onClick={() => setLightboxUrl(viewUrl)}
                                      title="點擊放大檢視（短效連結，過期需重新整理頁面）"
                                      aria-label={`放大檢視${def?.name ?? id}證明圖片`}
                                    >
                                      <img src={viewUrl} alt="證明圖片" className="w-16 h-16 object-cover rounded border hover:opacity-80 transition-opacity" loading="lazy" />
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* 共同管理員 */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              共同管理員
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!factory.coManagers || factory.coManagers.length === 0 ? (
              <p className="text-muted-foreground text-sm">尚無共同管理員</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {factory.coManagers.map((cm) => (
                  <div
                    key={cm.userId}
                    className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-sm"
                  >
                    <User className="h-4 w-4 shrink-0 text-gray-500" />
                    <span className="font-medium">{cm.name ?? cm.email ?? `使用者 #${cm.userId}`}</span>
                    {cm.name && cm.email && (
                      <span className="text-muted-foreground">({cm.email})</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 審核操作 */}
        {/* 已批准工廠：不合理再顯示拒絕／批准，改為下架／刪除（見任務規則，
            已上線工廠的審核流程已經結束，不應該再回到「批准/拒絕」框架）。
            已下架工廠：提供重新上架／刪除。其餘狀態（草稿／待審核／已拒絕）
            維持既有審核流程不變。修改申請模式（isRevisionMode）也維持不變。 */}
        {!isRevisionMode && factory.status === 'approved' ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <AlertCircle className="h-5 w-5 text-orange-600" />
                工廠管理操作
              </CardTitle>
            </CardHeader>
            <CardContent className="flex gap-4 justify-end">
              <Button variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-50" onClick={handleDelist} disabled={isSubmitting}>
                <EyeOff className="h-4 w-4 mr-1" />下架工廠
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={isSubmitting}>
                    <Trash2 className="h-4 w-4 mr-1" />刪除工廠
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-destructive" />確認刪除「{factory.name}」？
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      這是刪除資料的操作。刪除後此工廠將從管理員列表與所有公開頁面消失，且無法由工廠端自行復原，如需恢復需請管理員協助。確定要繼續嗎？
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete} disabled={isSubmitting}>
                      確認刪除
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        ) : !isRevisionMode && factory.status === 'delisted' ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <AlertCircle className="h-5 w-5 text-orange-600" />
                工廠管理操作
              </CardTitle>
            </CardHeader>
            <CardContent className="flex gap-4 justify-end">
              <Button onClick={handleRelist} disabled={isSubmitting}>
                <RotateCcw className="h-4 w-4 mr-1" />重新上架
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={isSubmitting}>
                    <Trash2 className="h-4 w-4 mr-1" />刪除工廠
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-destructive" />確認刪除「{factory.name}」？
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      這是刪除資料的操作。刪除後此工廠將從管理員列表與所有公開頁面消失，且無法由工廠端自行復原，如需恢復需請管理員協助。確定要繼續嗎？
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete} disabled={isSubmitting}>
                      確認刪除
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <AlertCircle className="h-5 w-5 text-orange-600" />
                審核決定
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="reason">拒絕原因（如選擇拒絕）</Label>
                <Textarea
                  id="reason"
                  placeholder="請填寫拒絕該工廠的原因..."
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  rows={4}
                  className="mt-2"
                />
              </div>
              <div className="flex gap-4 justify-end">
                <Button variant="destructive" onClick={handleReject} disabled={isSubmitting}>拒絕</Button>
                <Button onClick={handleApprove} disabled={isSubmitting}>批准</Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* 圖片放大檢視：只有管理員能看到（本頁本來就是 adminProcedure 保護），
          網址一律來自 evidenceViewUrls（admin 專屬短效簽章），不會是永久公開網址。 */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxUrl(null)}
        >
          <img src={lightboxUrl} alt="證明圖片放大檢視" className="max-h-[85vh] max-w-[90vw] object-contain rounded" onClick={(e) => e.stopPropagation()} />
          <button className="absolute top-4 right-4 text-white bg-black/40 rounded-full p-2 hover:bg-black/70" onClick={() => setLightboxUrl(null)}>
            <X className="w-6 h-6" />
          </button>
        </div>
      )}
    </div>
  );
}
