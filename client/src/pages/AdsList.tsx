import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Search, Megaphone } from "lucide-react";

export default function AdsList() {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);

  // 所有 hooks 必須在頂部無條件調用
  const isAdmin = user?.role === 'admin';
const adsQuery = trpc.admin.getAds.useQuery({
  page,
  pageSize: 20
}, { enabled: isAdmin });

  // 條件檢查在 hooks 之後
  if (authLoading) return <div className="flex items-center justify-center min-h-screen">載入中...</div>;
  if (!user || user.role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">您沒有權限存取此頁面</div>
      </div>
    );
  }

  const ads = adsQuery.data?.items || [];
  const total = adsQuery.data?.total || 0;
  const totalPages = Math.ceil(total / 20);

  const filteredAds = ads.filter((ad: any) =>
    !searchTerm || ad.factoryName?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation("/admin")}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              返回
            </Button>
            <h1 className="text-3xl font-bold text-gray-900">廣告訂單</h1>
          </div>
          <div className="text-sm text-gray-600">
            共 {total} 個廣告訂單
          </div>
        </div>

        {/* 搜尋框 */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
              <Input
                placeholder="搜尋工廠名稱..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardContent>
        </Card>

        {/* 廣告列表 */}
        <Card>
          <CardHeader>
            <CardTitle>廣告訂單列表</CardTitle>
            <CardDescription>
              顯示 {filteredAds.length} / {total} 個廣告訂單
            </CardDescription>
          </CardHeader>
          <CardContent>
            {adsQuery.isLoading ? (
              <div className="text-center py-8">載入中...</div>
            ) : filteredAds.length === 0 ? (
              <div className="text-center py-8 text-gray-500">沒有找到符合的廣告訂單</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr>
                      <th className="text-left py-3 px-4 font-semibold">ID</th>
                      <th className="text-left py-3 px-4 font-semibold">工廠</th>
                      <th className="text-left py-3 px-4 font-semibold">產業</th>
                      <th className="text-left py-3 px-4 font-semibold">地區</th>
                      <th className="text-left py-3 px-4 font-semibold">資本額</th>
                      <th className="text-left py-3 px-4 font-semibold">開始日期</th>
                      <th className="text-left py-3 px-4 font-semibold">結束日期</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAds.map((ad: any) => (
                      <tr key={ad.id} className="border-b hover:bg-gray-50">
                        <td className="py-3 px-4">{ad.id}</td>
                        <td className="py-3 px-4 font-medium">{ad.factoryName || "-"}</td>
                        <td className="py-3 px-4">{ad.industry || "-"}</td>
                        <td className="py-3 px-4">{ad.region || "-"}</td>
                        <td className="py-3 px-4">{ad.capitalLevel || "-"}</td>
                        <td className="py-3 px-4 text-gray-600">
                          {new Date(ad.startDate).toLocaleDateString("zh-TW")}
                        </td>
                        <td className="py-3 px-4 text-gray-600">
                          {new Date(ad.endDate).toLocaleDateString("zh-TW")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                <div className="flex items-center gap-2">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => i + 1).map((p) => (
                    <Button
                      key={p}
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
      </div>
    </div>
  );
}
