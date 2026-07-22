import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/_core/hooks/useAuth";
import { performLogin } from "@/const";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { FactoryCard, FavoriteFactoriesPanel } from "@/components/FavoriteFactoriesPanel";
import { Heart, Clock, X } from "lucide-react";
import { toast } from "sonner";

const RECENT_KEY = "oxm_recent_viewed";

type RecentItem = {
  id: number;
  name: string;
  industry: string | string[];
  region: string;
  businessType: string;
  avatarUrl: string | null;
  avgRating: string | number;
  reviewCount: number;
  viewedAt: number;
};

function readRecent(): RecentItem[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
  }
}

export default function MyFavorites() {
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);

  useEffect(() => {
    setRecentItems(readRecent());
  }, []);

  const handleRemoveRecent = (id: number) => {
    const updated = recentItems.filter(f => f.id !== id);
    setRecentItems(updated);
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
  };

  const handleClearRecent = () => {
    setRecentItems([]);
    localStorage.removeItem(RECENT_KEY);
    toast.success("已清空瀏覽紀錄");
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container py-16 text-center">
          <p className="text-muted-foreground mb-4">請先登入以查看收藏列表</p>
          <Button onClick={() => performLogin()}>登入</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <div className="container py-6">
        <FloatingBackButton fallbackHref="/search" label="返回搜尋" />

        <Tabs defaultValue="favorites">
          <TabsList className="mb-4">
            <TabsTrigger value="favorites" className="flex items-center gap-2">
              <Heart className="w-4 h-4" />我的收藏
            </TabsTrigger>
            <TabsTrigger value="recent" className="flex items-center gap-2">
              <Clock className="w-4 h-4" />最近瀏覽
              {recentItems.length > 0 && <span className="text-xs text-muted-foreground">({recentItems.length})</span>}
            </TabsTrigger>
          </TabsList>

          {/* ── 我的收藏 ── */}
          <TabsContent value="favorites">
            <FavoriteFactoriesPanel />
          </TabsContent>

          {/* ── 最近瀏覽 ── */}
          <TabsContent value="recent">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-muted-foreground" />
                  最近瀏覽
                </CardTitle>
                {recentItems.length > 0 && (
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={handleClearRecent}>
                    清空全部
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {recentItems.length === 0 ? (
                  <div className="text-center py-12">
                    <Clock className="w-12 h-12 mx-auto mb-4 opacity-20" />
                    <p className="text-muted-foreground">還沒有瀏覽紀錄</p>
                    <Button variant="link" onClick={() => navigate("/search")} className="mt-2">去瀏覽工廠</Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {recentItems.map(factory => (
                      <FactoryCard
                        key={factory.id}
                        factory={factory}
                        onRemove={() => handleRemoveRecent(factory.id)}
                        removeIcon={<X className="w-4 h-4 text-muted-foreground" />}
                      />
                    ))}
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

