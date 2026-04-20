import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Star, Search } from "lucide-react";

export default function ReviewsList() {
  // 所有 hooks 必須在組件頂部無條件調用
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);

  const isAdmin = user?.role === 'admin';
const reviewsQuery = trpc.admin.getReviews.useQuery({ page, pageSize: 20 }, { enabled: isAdmin });

  // 條件檢查必須在 hooks 之後
  if (authLoading) return <div className="flex items-center justify-center min-h-screen">載入中...</div>;
  if (!user || user.role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">您沒有權限存取此頁面</div>
      </div>
    );
  }

  const reviews = reviewsQuery.data?.items || [];
  const total = reviewsQuery.data?.total || 0;
  const totalPages = Math.ceil(total / 20);

  const filteredReviews = selectedRating
    ? reviews.filter((r: any) => r.rating === selectedRating)
    : reviews;

  const ratingCounts = {
    5: reviews.filter((r: any) => r.rating === 5).length,
    4: reviews.filter((r: any) => r.rating === 4).length,
    3: reviews.filter((r: any) => r.rating === 3).length,
    2: reviews.filter((r: any) => r.rating === 2).length,
    1: reviews.filter((r: any) => r.rating === 1).length,
  };

  const renderStars = (rating: number) => (
    <div className="flex gap-1">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={`h-4 w-4 ${i < rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300"}`}
        />
      ))}
    </div>
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
            <h1 className="text-3xl font-bold text-gray-900">所有評價</h1>
          </div>
          <div className="text-sm text-gray-600">
            共 {total} 則評價
          </div>
        </div>

        {/* 搜尋框 */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
              <Input
                placeholder="搜尋評價內容或工廠名稱..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setPage(1);
                }}
                className="pl-10"
              />
            </div>
          </CardContent>
        </Card>

        {/* 星級篩選 */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
          {[5, 4, 3, 2, 1].map((rating) => (
            <Card
              key={rating}
              className={`cursor-pointer transition-all ${
                selectedRating === rating
                  ? "ring-2 ring-orange-500 bg-orange-50"
                  : "hover:shadow-md"
              }`}
              onClick={() => {
                setSelectedRating(selectedRating === rating ? null : rating);
                setPage(1);
              }}
            >
              <CardContent className="pt-6 text-center">
                <div className="flex justify-center mb-2">
                  {renderStars(rating)}
                </div>
                <div className="text-2xl font-bold">{ratingCounts[rating as keyof typeof ratingCounts]}</div>
                <div className="text-xs text-gray-600">{rating} 星</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 評價列表 */}
        <Card>
          <CardHeader>
            <CardTitle>評價列表</CardTitle>
            <CardDescription>
              顯示 {filteredReviews.length} / {total} 則評價
              {selectedRating && ` (${selectedRating} 星)`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {reviewsQuery.isLoading ? (
              <div className="text-center py-8">載入中...</div>
            ) : filteredReviews.length === 0 ? (
              <div className="text-center py-8 text-gray-500">沒有找到符合的評價</div>
            ) : (
              <div className="space-y-4">
                {filteredReviews.map((review: any) => (
                  <div key={review.id} className="border rounded-lg p-4 hover:bg-gray-50">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="font-semibold text-gray-900">{review.factoryName}</div>
                        <div className="text-sm text-gray-600">評論者: {review.userName || "匿名"}</div>
                      </div>
                      <div className="flex gap-1">
                        {renderStars(review.rating)}
                      </div>
                    </div>
                    <p className="text-gray-700 mb-2">{review.comment}</p>
                    <div className="text-xs text-gray-500">
                      {new Date(review.createdAt).toLocaleString("zh-TW")}
                    </div>
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
