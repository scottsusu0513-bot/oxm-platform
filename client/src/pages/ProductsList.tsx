import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Search, Package } from "lucide-react";

const INDUSTRIES = ["紡織", "金屬加工", "電子零件", "塑膠", "木工", "包裝", "食品", "保健食品", "香氛", "生活用具"];

export default function ProductsList() {
  // 所有 hooks 必須在頂部無條件調用
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const isAdmin = !authLoading && user?.role === 'admin';
  const productsQuery = trpc.admin.getProducts.useQuery({
    page,
    pageSize: 20,
    search: searchTerm || undefined,
    industry: selectedIndustry || undefined,
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

  const products = productsQuery.data?.items || [];
  const total = productsQuery.data?.total || 0;
  const totalPages = Math.ceil(total / 20);
  const filteredProducts = products;

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
            <h1 className="text-3xl font-bold text-gray-900">所有產品</h1>
          </div>
          <div className="text-sm text-gray-600">
            共 {total} 個產品
          </div>
        </div>

        {/* 搜尋和篩選 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card className="md:col-span-2">
            <CardContent className="pt-6">
              <Input
                placeholder="搜尋產品名稱或工廠名稱..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setPage(1);
                }}
                className="w-full"
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <select
                value={selectedIndustry || ""}
                onChange={(e) => {
                  setSelectedIndustry(e.target.value || null);
                  setPage(1);
                }}
                className="w-full px-3 py-2 border rounded-md"
              >
                <option value="">所有產業</option>
                {INDUSTRIES.map(industry => (
                  <option key={industry} value={industry}>{industry}</option>
                ))}
              </select>
            </CardContent>
          </Card>
        </div>

        {/* 產品列表 */}
        <Card>
          <CardHeader>
            <CardTitle>產品列表</CardTitle>
            <CardDescription>
              顯示 {filteredProducts.length} / {total} 個產品
              {selectedIndustry && ` (${selectedIndustry})`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {productsQuery.isLoading ? (
              <div className="text-center py-8">載入中...</div>
            ) : filteredProducts.length === 0 ? (
              <div className="text-center py-8 text-gray-500">沒有找到符合的產品</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr>
                      <th className="text-left py-3 px-4 font-semibold">產品名稱</th>
                      <th className="text-left py-3 px-4 font-semibold">工廠</th>
                      <th className="text-left py-3 px-4 font-semibold">產業</th>
                      <th className="text-left py-3 px-4 font-semibold">價格範圍</th>
                      <th className="text-left py-3 px-4 font-semibold">打樣</th>
                      <th className="text-left py-3 px-4 font-semibold">建立日期</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((p) => (
                      <tr key={p.id} className="border-b hover:bg-gray-50">
                        <td className="py-3 px-4 font-semibold">{p.name}</td>
                        <td className="py-3 px-4">{p.factory?.name || "-"}</td>
                        <td className="py-3 px-4">{p.factory?.industry || "-"}</td>
                        <td className="py-3 px-4">
                          {p.priceMin && p.priceMax
                            ? `$${p.priceMin} - $${p.priceMax}`
                            : "-"}
                        </td>
                        <td className="py-3 px-4">
                          {p.provideSample ? (
                            <span className="text-green-600 font-semibold">是</span>
                          ) : (
                            <span className="text-gray-400">否</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-500">
                          {new Date(p.createdAt).toLocaleDateString("zh-TW")}
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
