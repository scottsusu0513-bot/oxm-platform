import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { Link, useLocation } from "wouter";
import { Star, ArrowLeft, MessageCircle } from "lucide-react";

export default function MyReviews() {
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  const { data, isLoading } = trpc.review.myReviews.useQuery(
    { page: 1, pageSize: 50 },
    { enabled: isAuthenticated }
  );

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container py-16 text-center">
          <Star className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground mb-4">請先登入以查看您的評價</p>
          <a href={getLoginUrl()}><Button>登入</Button></a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container py-6 max-w-3xl">
        <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate("/")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> 返回首頁
        </Button>

        <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
          <Star className="w-6 h-6" />
          我的評價
        </h1>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}><CardContent className="p-4"><Skeleton className="h-20" /></CardContent></Card>
            ))}
          </div>
        ) : data?.items.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              <Star className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p>您尚未留下任何評價</p>
              <Button variant="link" onClick={() => navigate("/search")}>瀏覽工廠並留下評價</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {data?.items.map((review) => (
              <Link key={review.id} href={`/factory/${review.factoryId}`}>
                <Card className="hover:shadow-sm transition-shadow cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium">{review.factoryName ?? "未知工廠"}</p>
                        <div className="flex gap-0.5 mt-1">
                          {[1, 2, 3, 4, 5].map(s => (
                            <Star key={s} className={`w-4 h-4 ${review.rating >= s ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground/20"}`} />
                          ))}
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(review.createdAt).toLocaleDateString("zh-TW")}
                      </span>
                    </div>
                    {review.comment && (
                      <p className="text-sm text-muted-foreground mt-2">{review.comment}</p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
