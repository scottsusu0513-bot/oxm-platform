import { useState } from "react";
import { useDebounce } from "@/hooks/useDebounce";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Search, MapPin, Building2, Phone, Globe, Star, Shield, ShieldCheck, Clock, User } from "lucide-react";
import { toast } from "sonner";

export default function FactoriesList() {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebounce(searchTerm, 400);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'all' | 'approved' | 'pending' | 'rejected'>('all');

  const isAdmin = user?.role === 'admin';
  const utils = trpc.useUtils();
  const factoriesQuery = trpc.admin.getFactories.useQuery(
    { page, pageSize: 10, search: debouncedSearchTerm, status: status === 'all' ? undefined : status },
    { enabled: isAdmin }
  );
  const setCertifiedMutation = trpc.admin.setCertified.useMutation({
    onSuccess: () => {
      utils.admin.getFactories.invalidate();
    },
  });

  const factories = factoriesQuery.data?.items || [];
  const total = factoriesQuery.data?.total || 0;
  const totalPages = Math.ceil(total / 10);

  if (authLoading) return <div className="flex items-center justify-center min-h-screen">載入中...</div>;
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
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" onClick={() => setLocation("/admin")} className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              返回
            </Button>
            <h1 className="text-3xl font-bold text-gray-900">所有工廠</h1>
          </div>
          <div className="text-sm text-gray-600">共 {total} 家工廠</div>
        </div>

        {/* 狀態篩選 */}
        <div className="mb-6 flex gap-2">
          {(["all", "approved", "pending", "rejected"] as const).map((s) => (
            <Button
              key={s}
              variant={status === s ? "default" : "outline"}
              onClick={() => { setStatus(s); setPage(1); }}
            >
              {s === "all" ? "全部" : s === "approved" ? "已審核" : s === "pending" ? "待審核" : "已駁回"}
            </Button>
          ))}
        </div>

        {/* 搜尋框 */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
              <Input
                placeholder="搜尋工廠名稱、產業或地區..."
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
                className="pl-10"
              />
            </div>
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
                          {f.certified && (
                            <span className="inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                              <ShieldCheck className="w-3 h-3" />認證工廠
                            </span>
                          )}
                          {getOperationBadge(f.operationStatus)}
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          {getStatusBadge(factory.status)}
                          <Button
                            size="sm"
                            variant={f.certified ? "default" : "outline"}
                            className={f.certified ? "bg-blue-600 hover:bg-blue-700 text-white" : ""}
                            disabled={setCertifiedMutation.isPending}
                            onClick={() => {
                              const newVal = !f.certified;
                              setCertifiedMutation.mutate(
                                { factoryId: factory.id, certified: newVal },
                                {
                                  onSuccess: () => {
                                    toast.success(`${newVal ? "已授予認證" : "已取消認證"}：${factory.name}`);
                                  },
                                }
                              );
                            }}
                          >
                            {f.certified ? (
                              <><ShieldCheck className="w-3.5 h-3.5 mr-1" />已認證</>
                            ) : (
                              <><Shield className="w-3.5 h-3.5 mr-1" />授予認證</>
                            )}
                          </Button>
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
