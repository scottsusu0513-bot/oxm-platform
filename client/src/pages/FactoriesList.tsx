import { useState } from "react";
import { useDebounce } from "@/hooks/useDebounce";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ArrowLeft, Search, MapPin, Building2, Phone, Globe, Star, Clock, User, Users, X, Pencil } from "lucide-react";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { TAIWAN_REGIONS, INDUSTRY_OPTIONS } from "@shared/constants";
import { toast } from "sonner";

type ContactStatus = 'not_called' | 'not_interested' | 'follow_up';

const CONTACT_STATUS_META: Record<ContactStatus, { dot: string; text: string; label: string }> = {
  not_called: { dot: "bg-gray-400", text: "text-gray-500", label: "尚未聯絡" },
  not_interested: { dot: "bg-red-500", text: "text-red-600", label: "沒興趣" },
  follow_up: { dot: "bg-blue-500", text: "text-blue-600", label: "可追蹤" },
};

// 工廠開發 CRM 備註列：低調呈現，點擊開啟小型編輯 Popover。刻意不染色整張
// 卡片、不用大面積背景色——只在這一行呈現狀態顏色，避免搶走工廠資料本身
// 的視覺層級（見任務規則）。
function ContactStatusRow({
  factoryId,
  contactStatus,
  adminNote,
}: {
  factoryId: number;
  contactStatus: ContactStatus;
  adminNote: string | null;
}) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [draftStatus, setDraftStatus] = useState<ContactStatus>(contactStatus);
  const [draftNote, setDraftNote] = useState(adminNote ?? "");

  const updateMut = trpc.admin.updateFactoryContactInfo.useMutation({
    onSuccess: () => {
      toast.success("已更新聯絡狀態");
      setOpen(false);
      utils.admin.getFactories.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const meta = CONTACT_STATUS_META[contactStatus] ?? CONTACT_STATUS_META.not_called;

  return (
    <Popover open={open} onOpenChange={(next) => {
      setOpen(next);
      if (next) { setDraftStatus(contactStatus); setDraftNote(adminNote ?? ""); }
    }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-1.5 min-w-0 text-left mt-1.5 pt-1.5 border-t border-gray-100 group"
        >
          <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
          <span className={`text-[11px] shrink-0 ${meta.text}`}>{meta.label}</span>
          {adminNote && (
            <span className="text-[11px] text-gray-400 truncate min-w-0">{adminNote}</span>
          )}
          <Pencil className="h-3 w-3 text-gray-300 shrink-0 ml-auto opacity-0 group-hover:opacity-100" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-3">
          <div>
            <Label className="text-sm">聯絡狀態</Label>
            <RadioGroup value={draftStatus} onValueChange={(v) => setDraftStatus(v as ContactStatus)} className="mt-2 gap-2">
              {(Object.keys(CONTACT_STATUS_META) as ContactStatus[]).map((key) => (
                <div key={key} className="flex items-center gap-2">
                  <RadioGroupItem value={key} id={`cs-${factoryId}-${key}`} />
                  <label htmlFor={`cs-${factoryId}-${key}`} className="text-sm flex items-center gap-1.5 cursor-pointer">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${CONTACT_STATUS_META[key].dot}`} />
                    {CONTACT_STATUS_META[key].label}
                  </label>
                </div>
              ))}
            </RadioGroup>
          </div>
          <div>
            <Label htmlFor={`note-${factoryId}`} className="text-sm">備註</Label>
            <Textarea
              id={`note-${factoryId}`}
              value={draftNote}
              onChange={(e) => setDraftNote(e.target.value)}
              placeholder="例如：8/13 已致電，老闆不在，下週再打"
              rows={3}
              className="mt-2"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button
              size="sm"
              disabled={updateMut.isPending}
              onClick={() => updateMut.mutate({ factoryId, contactStatus: draftStatus, adminNote: draftNote.trim() ? draftNote : null })}
            >
              {updateMut.isPending ? "儲存中..." : "儲存"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function FactoriesList() {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebounce(searchTerm, 400);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'all' | 'approved' | 'pending' | 'rejected' | 'delisted'>('all');
  const [region, setRegion] = useState<string>('all');
  const [industry, setIndustry] = useState<string>('all');
  const [contactStatus, setContactStatus] = useState<'all' | ContactStatus>('all');

  const isAdmin = user?.role === 'admin';
  const hasLocationFilter = region !== 'all' || industry !== 'all';
  const factoriesQuery = trpc.admin.getFactories.useQuery(
    {
      page,
      pageSize: 10,
      search: debouncedSearchTerm,
      status: status === 'all' ? undefined : status,
      region: region === 'all' ? undefined : region,
      industry: industry === 'all' ? undefined : industry,
      contactStatus: contactStatus === 'all' ? undefined : contactStatus,
    },
    { enabled: isAdmin }
  );
  const factories = factoriesQuery.data?.items || [];
  const total = factoriesQuery.data?.total || 0;
  const totalPages = Math.ceil(total / 10);

  if (authLoading) return <AppLoading />;
  if (!user || user.role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">您沒有權限存取此頁面</div>
      </div>
    );
  }

  const getStatusBadge = (s: string) => {
    const statusMap: Record<string, { bg: string; text: string; label: string }> = {
      approved: { bg: "bg-green-100", text: "text-green-800", label: "已批准" },
      pending: { bg: "bg-yellow-100", text: "text-yellow-800", label: "待審核" },
      rejected: { bg: "bg-red-100", text: "text-red-800", label: "已駁回" },
      delisted: { bg: "bg-gray-200", text: "text-gray-700", label: "已下架" },
    };
    const info = statusMap[s] || { bg: "bg-gray-100", text: "text-gray-800", label: s };
    return <span className={`px-2 py-1 rounded text-xs font-semibold ${info.bg} ${info.text}`}>{info.label}</span>;
  };

  const getOperationBadge = (op: string | null | undefined) => {
    if (!op || op === "normal") return <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full"><span className="w-1.5 h-1.5 rounded-full bg-green-500" />接單中</span>;
    if (op === "busy") return <span className="inline-flex items-center gap-1 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 px-2 py-0.5 rounded-full"><span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />產線繁忙</span>;
    return <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full"><span className="w-1.5 h-1.5 rounded-full bg-red-500" />產線滿載</span>;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 px-4 pb-4 md:px-8 md:pb-8 admin-page-top">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
      <FloatingBackButton fallbackHref="/admin" noNavbar />
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-bold text-gray-900">所有工廠</h1>
          </div>
          <div className="text-sm text-gray-600">共 {total} 家工廠</div>
        </div>

        {/* 狀態篩選 */}
        <div className="mb-6 flex flex-wrap gap-2">
          {(["all", "approved", "pending", "rejected", "delisted"] as const).map((s) => (
            <Button
              key={s}
              variant={status === s ? "default" : "outline"}
              onClick={() => { setStatus(s); setPage(1); }}
            >
              {s === "all" ? "全部" : s === "approved" ? "已審核" : s === "pending" ? "待審核" : s === "rejected" ? "已駁回" : "已下架"}
            </Button>
          ))}
        </div>

        {/* 搜尋框 */}
        <Card className="mb-6">
          <CardContent className="pt-6 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
              <Input
                placeholder="搜尋工廠名稱、產業或地區..."
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
                className="pl-10"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Select value={region} onValueChange={(v) => { setRegion(v); setPage(1); }}>
                <SelectTrigger><SelectValue placeholder="地區" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部地區</SelectItem>
                  {TAIWAN_REGIONS.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={industry} onValueChange={(v) => { setIndustry(v); setPage(1); }}>
                <SelectTrigger><SelectValue placeholder="產業" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部產業</SelectItem>
                  {INDUSTRY_OPTIONS.map((i) => (
                    <SelectItem key={i} value={i}>{i}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={contactStatus} onValueChange={(v) => { setContactStatus(v as typeof contactStatus); setPage(1); }}>
                <SelectTrigger><SelectValue placeholder="聯絡狀態" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">聯絡狀態：全部</SelectItem>
                  {(Object.keys(CONTACT_STATUS_META) as ContactStatus[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {CONTACT_STATUS_META[key].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {hasLocationFilter && (
              <Button
                variant="ghost"
                size="sm"
                className="text-gray-500"
                onClick={() => { setRegion('all'); setIndustry('all'); setPage(1); }}
              >
                <X className="w-3.5 h-3.5 mr-1" />清除地區／產業篩選
              </Button>
            )}
          </CardContent>
        </Card>

        {/* 工廠列表 */}
        <Card>
          <CardHeader>
            <CardTitle>工廠列表</CardTitle>
            <CardDescription>顯示 {factories.length} / {total} 家工廠</CardDescription>
          </CardHeader>
          <CardContent>
            {factoriesQuery.isLoading ? (
              <div className="text-center py-8">載入中...</div>
            ) : factories.length === 0 ? (
              <div className="text-center py-8 text-gray-500">沒有找到符合的工廠</div>
            ) : (
              <div className="space-y-4">
                {factories.map((factory) => {
                  const f = factory as any;
                  return (
                    <div key={factory.id} className="border rounded-lg p-4 hover:bg-gray-50 transition">
                      {/* Header row */}
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Building2 className="h-4 w-4 text-orange-600 shrink-0" />
                          <h3 className="font-semibold text-lg">{factory.name}</h3>
                          {getOperationBadge(f.operationStatus)}
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          {getStatusBadge(factory.status)}
                        </div>
                      </div>

                      {/* Info grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm text-gray-600 mb-2">
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                          <span>{factory.region}{f.address ? ` · ${f.address}` : ""}</span>
                        </div>
                        {f.phone && (
                          <div className="flex items-center gap-1.5">
                            <Phone className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                            <span>{f.phone}</span>
                          </div>
                        )}
                        {f.website && (
                          <div className="flex items-center gap-1.5">
                            <Globe className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                            <a href={f.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate max-w-[200px]">{f.website}</a>
                          </div>
                        )}
                        {f.foundedYear && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-gray-400 text-xs">成立</span>
                            <span>{f.foundedYear} 年</span>
                          </div>
                        )}
                        {f.ownerName && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-gray-400 text-xs">負責人</span>
                            <span>{f.ownerName}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                          {f.ownerAccountName || f.ownerAccountEmail
                            ? <span className="text-blue-700">{f.ownerAccountName ?? ""}{f.ownerAccountEmail ? ` (${f.ownerAccountEmail})` : ""}</span>
                            : <span className="text-gray-400">擁有者：無</span>
                          }
                        </div>
                        {(f.avgRating > 0) && (
                          <div className="flex items-center gap-1.5">
                            <Star className="h-3.5 w-3.5 text-yellow-400 shrink-0" />
                            <span>{Number(f.avgRating).toFixed(1)} ({f.reviewCount ?? 0} 則評價)</span>
                          </div>
                        )}
                      </div>

                      {/* Co-managers */}
                      <div className="flex items-start gap-1.5 mb-2">
                        <Users className="h-3.5 w-3.5 text-purple-400 shrink-0 mt-0.5" />
                        <span className="text-xs text-gray-400 whitespace-nowrap">共同管理員：</span>
                        {f.coManagers && f.coManagers.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {f.coManagers.map((cm: any) => (
                              <span key={cm.userId} className="text-xs text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-full">
                                {cm.name ?? ""}
                                {cm.name && cm.email ? <span className="text-purple-400 ml-1">({cm.email})</span> : null}
                                {!cm.name && cm.email ? cm.email : null}
                                {!cm.name && !cm.email ? `#${cm.userId}` : null}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">無</span>
                        )}
                      </div>

                      {/* Tags */}
                      <div className="flex gap-2 flex-wrap mb-2">
                        {((factory as any).industry as string[] | null)?.map(ind => (
                          <span key={ind} className="text-xs bg-gray-100 px-2 py-1 rounded">{ind}</span>
                        ))}
                        {factory.capitalLevel && (
                          <span className="text-xs bg-blue-50 text-blue-800 px-2 py-1 rounded">資本額: {factory.capitalLevel}</span>
                        )}
                        {f.mfgModes && f.mfgModes.length > 0 && f.mfgModes.map((m: string) => (
                          <span key={m} className="text-xs bg-orange-50 text-orange-700 px-2 py-1 rounded">{m}</span>
                        ))}
                      </div>

                      {/* Business hours */}
                      {(f.weekdayHours || f.weekendHours || f.businessNote) && (
                        <div className="flex flex-wrap gap-3 text-xs text-gray-500 mb-2">
                          <Clock className="h-3.5 w-3.5 text-gray-400 shrink-0 mt-0.5" />
                          {f.weekdayHours && <span>平日 {f.weekdayHours}</span>}
                          {f.weekendHours && <span>假日 {f.weekendHours}</span>}
                          {f.businessNote && <span className="text-gray-400">{f.businessNote}</span>}
                        </div>
                      )}

                      {factory.description && (
                        <p className="text-sm text-gray-600 mb-2 line-clamp-2">{factory.description}</p>
                      )}

                      <div className="flex justify-between items-center text-xs text-gray-400 pt-2 border-t border-gray-100">
                        <span>ID: {factory.id} {factory.submittedAt && <>· 送審: {new Date(factory.submittedAt).toLocaleDateString("zh-TW")}</>}</span>
                        <Button size="sm" variant="outline" onClick={() => setLocation(`/admin/factory-review?id=${factory.id}`)}>
                          查看詳情
                        </Button>
                      </div>
                      <ContactStatusRow
                        factoryId={factory.id}
                        contactStatus={(f.contactStatus as ContactStatus) ?? "not_called"}
                        adminNote={f.adminNote ?? null}
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {/* 分頁 */}
            {totalPages > 1 && (
              <div className="flex justify-center gap-2 mt-6">
                <Button variant="outline" size="sm" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>
                  上一頁
                </Button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => i + 1).map((p) => (
                    <Button key={`page-${p}`} variant={page === p ? "default" : "outline"} size="sm" onClick={() => setPage(p)}>
                      {p}
                    </Button>
                  ))}
                </div>
                <Button variant="outline" size="sm" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}>
                  下一頁
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
