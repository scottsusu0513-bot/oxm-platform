import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Building2, MapPin, Check, X } from "lucide-react";

export default function PendingFactoriesList() {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState("pending");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const isAdmin = user?.role === 'admin';
  const { data: pendingData } = trpc.admin.getPendingFactories.useQuery({ page, pageSize }, { enabled: isAdmin });
  const { data: approvedData } = trpc.admin.getApprovedFactories.useQuery({ page, pageSize }, { enabled: isAdmin });

  if (authLoading) return <div className="flex items-center justify-center min-h-screen">載入中...</div>;
  if (!user || user.role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">您沒有權限存取此頁面</div>
      </div>
    );
  }

  const factories = tab === "pending" ? (pendingData?.items || []) : (approvedData?.items || []);
  const total = tab === "pending" ? (pendingData?.total || 0) : (approvedData?.total || 0);
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation("/admin")}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            返回
          </Button>
          <h1 className="text-3xl font-bold text-gray-900">工廠審核管理</h1>
        </div>

        <Tabs value={tab} onValueChange={(value) => { setTab(value); setPage(1); }}>
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="pending">待審核工廠</TabsTrigger>
            <TabsTrigger value="approved">已批准工廠</TabsTrigger>
          </TabsList>

          <TabsContent value={tab} className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>
                  {tab === "pending" ? "待審核工廠" : "已批准工廠"}
                </CardTitle>
                <CardDescription>
                  共 {total} 家工廠 | 第 {page} / {totalPages} 頁
                </CardDescription>
              </CardHeader>
              <CardContent>
                {factories.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    {tab === "pending" ? "沒有待審核的工廠" : "沒有已批准的工廠"}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {factories.map((factory) => (
                      <div
                        key={factory.id}
                        className={`border rounded-lg p-4 transition ${
                          tab === "pending"
                            ? "bg-yellow-50 hover:bg-yellow-100"
                            : "bg-green-50 hover:bg-green-100"
                        }`}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Building2 className="h-4 w-4 text-orange-600" />
                              <h3 className="font-semibold text-lg">{factory.name}</h3>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                              <MapPin className="h-4 w-4" />
                              {factory.region} | {((factory as any).industry as string[] | null)?.join("、") ?? ""}
                            </div>
                            <p className="text-sm text-gray-600 line-clamp-2">{factory.description}</p>
                          </div>
                          <div className="text-right">
                            {tab === "pending" ? (
                              <div className="inline-block px-3 py-1 bg-yellow-200 text-yellow-800 rounded text-xs font-semibold">
                                待審核
                              </div>
                            ) : (
                              <div className="inline-block px-3 py-1 bg-green-200 text-green-800 rounded text-xs font-semibold">
                                已批准
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex justify-between items-center text-xs text-gray-500 mb-3">
                          <span>ID: {factory.id}</span>
                          <span>
                            {factory.submittedAt && (
                              <>送審: {new Date(factory.submittedAt).toLocaleDateString("zh-TW")}</>
                            )}
                          </span>
                        </div>

                        {tab === "pending" && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setLocation(`/admin/factory-review?id=${factory.id}`)}
                              className="flex-1"
                            >
                              查看詳情
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* 分頁 */}
                {totalPages > 1 && (
                  <div className="flex justify-center gap-2 mt-6">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(Math.max(1, page - 1))}
                      disabled={page === 1}
                    >
                      上一頁
                    </Button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => i + 1).map((p) => (
                        <Button
                          key={`page-${p}`}
                          variant={page === p ? "default" : "outline"}
                          size="sm"
                          onClick={() => setPage(p)}
                        >
                          {p}
                        </Button>
                      ))}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(Math.min(totalPages, page + 1))}
                      disabled={page === totalPages}
                    >
                      下一頁
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
