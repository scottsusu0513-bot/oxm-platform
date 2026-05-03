import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, BarChart3, Users, Factory, Zap, MessageSquare, Star, ArrowLeft, ShieldCheck, Shield, HeadphonesIcon, Megaphone, Eye } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState } from "react";

export default function AdminDashboard() {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();

  if (authLoading) return <div className="flex items-center justify-center min-h-screen">載入中...</div>;
  if (!user || user.role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>您沒有權限存取管理員儀表板</AlertDescription>
        </Alert>
      </div>
    );
  }

  return <AdminDashboardContent />;
}

function AdminDashboardContent() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("overview");

  const isAdmin = user?.role === 'admin';

  // 統計數字：一進來就載入
  const statsQuery = trpc.admin.getStats.useQuery(undefined, { enabled: isAdmin });
  const viewStatsQuery = trpc.analytics.getStats.useQuery(undefined, { enabled: isAdmin });

  // 待審核：一進來就載入（重要功能）
  const pendingFactoriesQuery = trpc.admin.getPendingFactories.useQuery(
    { page: 1, pageSize: 10 },
    { enabled: isAdmin }
  );

  // 以下三個：切到對應 Tab 才載入
  const approvedFactoriesQuery = trpc.admin.getApprovedFactories.useQuery(
    { page: 1, pageSize: 10 },
    { enabled: isAdmin && activeTab === 'approved' }
  );

  const usersQuery = trpc.admin.getUsers.useQuery(
    { page: 1, pageSize: 10 },
    { enabled: isAdmin && activeTab === 'users' }
  );

  const adsQuery = trpc.admin.getAds.useQuery(
    { page: 1, pageSize: 10 },
    { enabled: isAdmin && activeTab === 'ads' }
  );

  const approveMutation = trpc.admin.approveFactory.useMutation();
  const rejectMutation = trpc.admin.rejectFactory.useMutation();
  const setCertifiedMutation = trpc.admin.setCertified.useMutation();
  const utils = trpc.useUtils();

  const stats = statsQuery.data;
  const viewStats = viewStatsQuery.data;

  const handleApprove = async (factoryId: number) => {
    try {
      await approveMutation.mutateAsync({ factoryId });
      toast.success("已批准工廠");
      await Promise.all([
        utils.admin.getPendingFactories.invalidate(),
        utils.admin.getApprovedFactories.invalidate(),
        utils.admin.getStats.invalidate(),
        utils.factory.search.invalidate(),
      ]);
    } catch (error: any) {
      toast.error(error.message || "批准失敗");
    }
  };

  const handleReject = async (factoryId: number) => {
    try {
      await rejectMutation.mutateAsync({ factoryId, reason: "" });
      toast.success("已拒絕工廠");
      await Promise.all([
        utils.admin.getPendingFactories.invalidate(),
        utils.admin.getRejectedFactories.invalidate(),
        utils.admin.getStats.invalidate(),
        utils.factory.search.invalidate(),
      ]);
    } catch (error: any) {
      toast.error(error.message || "拒絕失敗");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-gray-900">管理員儀表板</h1>
          <Button variant="outline" onClick={() => window.location.href = "/"} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            返回首頁
          </Button>
        </div>

        {/* 統計卡片 - 永遠顯示 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => setLocation("/admin/users")}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <Users className="h-4 w-4" />總使用者
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.totalUsers || 0}</div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => setLocation("/admin/factories")}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <Factory className="h-4 w-4" />總工廠
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.totalFactories || 0}</div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => setLocation("/admin/products")}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <Zap className="h-4 w-4" />總產品
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.totalProducts || 0}</div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => setLocation("/admin/reviews")}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <Star className="h-4 w-4" />總評價
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.totalReviews || 0}</div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => setLocation("/admin/ads")}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />廣告訂單
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.totalAds || 0}</div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => setLocation("/admin/conversations")}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />對話總數
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.totalMessages || 0}</div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => setLocation("/admin/support")}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <HeadphonesIcon className="h-4 w-4" />客服中心
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-500">→</div>
            </CardContent>
          </Card>

          <Card className="col-span-1 md:col-span-2 lg:col-span-3">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <Eye className="h-4 w-4" />全站不重複訪客數
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-6 mb-4">
                <div className="text-center">
                  <div className="text-2xl font-bold">{viewStats?.today ?? 0}</div>
                  <div className="text-xs text-gray-500">今日</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">{viewStats?.yesterday ?? 0}</div>
                  <div className="text-xs text-gray-500">昨日</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">{viewStats?.last7Days ?? 0}</div>
                  <div className="text-xs text-gray-500">近7天</div>
                </div>
              </div>
              {viewStats?.todayHours && (
                <div>
                  <div className="text-xs text-gray-500 mb-1">今日每小時訪客</div>
                  <div className="flex items-end gap-0.5 h-12">
                    {viewStats.todayHours.map((count: number, hour: number) => {
                      const max = Math.max(...viewStats.todayHours, 1);
                      const height = Math.round((count / max) * 100);
                      return (
                        <div key={hour} className="flex-1 flex flex-col items-center group relative">
                          <div
                            className="w-full bg-orange-400 rounded-sm transition-all"
                            style={{ height: `${height}%`, minHeight: count > 0 ? 2 : 0 }}
                          />
                          <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10">
                            {hour}時: {count}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>0時</span>
                    <span>12時</span>
                    <span>23時</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => setLocation("/admin/announcements")}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <Megaphone className="h-4 w-4" />平台公告
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-500">→</div>
            </CardContent>
          </Card>
        </div>

        {/* Tab 懶載入 */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="overview">待審核</TabsTrigger>
            <TabsTrigger value="approved">已批准</TabsTrigger>
            <TabsTrigger value="users">使用者</TabsTrigger>
            <TabsTrigger value="ads">廣告</TabsTrigger>
          </TabsList>

          {/* 待審核 Tab */}
          <TabsContent value="overview">
            <Card>
              <CardHeader>
                <CardTitle>待審核工廠</CardTitle>
                <CardDescription>需要批准或拒絕的工廠</CardDescription>
              </CardHeader>
              <CardContent>
                {pendingFactoriesQuery.isLoading ? (
                  <div>載入中...</div>
                ) : pendingFactoriesQuery.data?.items.length === 0 ? (
                  <div className="text-gray-500">沒有待審核的工廠</div>
                ) : (
                  <div className="space-y-4">
                    {pendingFactoriesQuery.data?.items.map((factory) => (
                      <div key={factory.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex-1 cursor-pointer hover:bg-gray-50 p-2 rounded" onClick={() => setLocation(`/admin/factory-review?id=${factory.id}`)}>
                          <h3 className="font-semibold">{factory.name}</h3>
                          <p className="text-sm text-gray-600">{((factory as any).industry as string[] | null)?.join("、") ?? ""} - {factory.region}</p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => setLocation(`/admin/factory-review?id=${factory.id}`)}>
                          查看詳情
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 已批准 Tab - 切換才載入 */}
          <TabsContent value="approved">
            <Card>
              <CardHeader>
                <CardTitle>已批准工廠</CardTitle>
                <CardDescription>已通過審核的工廠</CardDescription>
              </CardHeader>
              <CardContent>
                {approvedFactoriesQuery.isLoading ? (
                  <div>載入中...</div>
                ) : approvedFactoriesQuery.data?.items.length === 0 ? (
                  <div className="text-gray-500">沒有已批准的工廠</div>
                ) : (
                  <div className="space-y-2">
                    {approvedFactoriesQuery.data?.items.map((factory) => (
                      <div key={factory.id} className="p-4 border rounded-lg flex items-center justify-between">
                        <div className="flex-1 cursor-pointer hover:bg-gray-50 p-2 rounded" onClick={() => setLocation(`/admin/factory-review?id=${factory.id}`)}>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">{factory.name}</h3>
                            {(factory as any).certified && (
                              <span className="inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                                ✓ 認證工廠
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600">{((factory as any).industry as string[] | null)?.join("、") ?? ""} - {factory.region}</p>
                        </div>
                        <Button
                          size="sm"
                          variant={(factory as any).certified ? "default" : "outline"}
                          className={(factory as any).certified ? "bg-blue-600 hover:bg-blue-700 text-white" : ""}
                          onClick={() => {
                            const newVal = !(factory as any).certified;
                            setCertifiedMutation.mutate(
                              { factoryId: factory.id, certified: newVal },
                              {
                                onSuccess: () => {
                                  toast.success(newVal ? "已設為認證工廠" : "已取消認證");
                                  utils.admin.getApprovedFactories.invalidate();
                                },
                                onError: () => toast.error("操作失敗"),
                              }
                            );
                          }}
                          disabled={setCertifiedMutation.isPending}
                        >
                          {(factory as any).certified
                            ? <><ShieldCheck className="w-4 h-4 mr-1" />已認證</>
                            : <><Shield className="w-4 h-4 mr-1" />授予認證</>}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 使用者 Tab - 切換才載入 */}
          <TabsContent value="users">
            <Card>
              <CardHeader>
                <CardTitle>使用者列表</CardTitle>
                <CardDescription>所有註冊使用者</CardDescription>
              </CardHeader>
              <CardContent>
                {usersQuery.isLoading ? (
                  <div>載入中...</div>
                ) : usersQuery.data?.items.length === 0 ? (
                  <div className="text-gray-500">沒有使用者</div>
                ) : (
                  <div className="space-y-2">
                    {usersQuery.data?.items.map((u) => (
                      <div key={u.id} className="p-4 border rounded-lg flex items-center justify-between">
                        <div>
                          <p className="font-medium">{u.name ?? '未命名'}</p>
                          <p className="text-sm text-gray-500">{u.email}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-gray-400">{u.role}</p>
                          {(u as any).factoryName
                            ? <p className="text-xs text-orange-700 mt-0.5">{(u as any).factoryName}</p>
                            : <p className="text-xs text-gray-300 mt-0.5">無工廠</p>
                          }
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <Button variant="outline" size="sm" className="mt-4" onClick={() => setLocation("/admin/users")}>
                  查看全部使用者
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 廣告 Tab - 切換才載入 */}
          <TabsContent value="ads">
            <Card>
              <CardHeader>
                <CardTitle>廣告列表</CardTitle>
                <CardDescription>所有廣告訂單</CardDescription>
              </CardHeader>
              <CardContent>
                {adsQuery.isLoading ? (
                  <div>載入中...</div>
                ) : adsQuery.data?.items.length === 0 ? (
                  <div className="text-gray-500">沒有廣告</div>
                ) : (
                  <div className="space-y-2">
                    {adsQuery.data?.items.map((ad) => (
                      <div key={ad.id} className="p-4 border rounded-lg">
                        <p className="font-medium">{ad.factoryName}</p>
                        <p className="text-sm text-gray-500">{ad.industry} - {ad.region}</p>
                      </div>
                    ))}
                  </div>
                )}
                <Button variant="outline" size="sm" className="mt-4" onClick={() => setLocation("/admin/ads")}>
                  查看全部廣告
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}