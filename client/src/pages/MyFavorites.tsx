import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import Navbar from "@/components/Navbar";
import { Star, MapPin, ArrowLeft, Heart, Trash2, Factory, Wrench, Clock, X } from "lucide-react";
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

function FactoryCard({ factory, onRemove, removeLabel, removeIcon }: {
  factory: any;
  onRemove: () => void;
  removeLabel?: string;
  removeIcon: React.ReactNode;
}) {
  const [, navigate] = useLocation();
  return (
    <Card
      className="cursor-pointer hover:shadow-lg transition-shadow"
      onClick={() => navigate(`/factory/${factory.id}`)}
    >
      <CardContent className="p-4">
        <div className="flex justify-between items-start mb-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {factory.avatarUrl ? (
              <img src={factory.avatarUrl} alt={factory.name} className="w-8 h-8 rounded-full object-cover border shrink-0" loading="lazy" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                {factory.businessType === "studio"
                  ? <Wrench className="w-4 h-4 text-purple-500" />
                  : <Factory className="w-4 h-4 text-orange-500" />}
              </div>
            )}
            <h3 className="font-semibold text-base truncate">{factory.name}</h3>
          </div>
          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
            {removeIcon}
          </Button>
        </div>

        <div className="flex items-center gap-2 mb-2">
          <Star className="w-4 h-4 fill-yellow-500 text-yellow-500" />
          <span className="font-semibold">{Number(factory.avgRating).toFixed(1)}</span>
          <span className="text-sm text-muted-foreground">({factory.reviewCount})</span>
        </div>

        <div className="flex flex-wrap gap-1 mb-2">
          {factory.businessType === "studio" ? (
            <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100 border-0 text-xs">
              <Wrench className="w-3 h-3 mr-1" />工作室
            </Badge>
          ) : (
            <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100 border-0 text-xs">
              <Factory className="w-3 h-3 mr-1" />代工廠
            </Badge>
          )}
          {(Array.isArray((factory as any).industry)
            ? (factory as any).industry as string[]
            : typeof (factory as any).industry === 'string' && (factory as any).industry
              ? [(factory as any).industry as string]
              : []
          ).map((ind: string) => <Badge key={ind} className="text-xs">{ind}</Badge>)}
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPin className="w-4 h-4" />
          <span>{factory.region}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MyFavorites() {
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();
  const [selectedIndustry, setSelectedIndustry] = useState<string>("all");
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);

  useEffect(() => {
    setRecentItems(readRecent());
  }, []);

  const { data: favData, isLoading } = trpc.favorite.getByUser.useQuery(
    { page: 1, pageSize: 100 },
    { enabled: isAuthenticated }
  );
  const utils = trpc.useUtils();
  const toggleFav = trpc.favorite.toggle.useMutation({
    onSuccess: () => {
      toast.success("已取消收藏");
      utils.favorite.getByUser.invalidate();
    },
    onError: () => toast.error("操作失敗"),
  });

  const industries = useMemo(() => {
    if (!favData?.items) return [];
    const set = new Set(favData.items.flatMap((f: any) => {
      const ind = f.industry;
      if (Array.isArray(ind)) return ind as string[];
      if (typeof ind === 'string' && ind) return [ind];
      return [];
    }));
    return Array.from(set).sort() as string[];
  }, [favData?.items]);

  const filteredItems = useMemo(() => {
    if (!favData?.items) return [];
    if (selectedIndustry === "all") return favData.items;
    return favData.items.filter((f: any) =>
      (Array.isArray((f as any).industry) ? (f as any).industry as string[] : typeof (f as any).industry === 'string' ? [(f as any).industry] : []).includes(selectedIndustry)
    );
  }, [favData?.items, selectedIndustry]);

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
          <Button onClick={() => window.location.href = getLoginUrl()}>登入</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <div className="container py-6">
        <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate("/search")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> 返回搜尋
        </Button>

        <Tabs defaultValue="favorites">
          <TabsList className="mb-4">
            <TabsTrigger value="favorites" className="flex items-center gap-2">
              <Heart className="w-4 h-4" />我的收藏
              {favData && <span className="text-xs text-muted-foreground">({favData.items.length})</span>}
            </TabsTrigger>
            <TabsTrigger value="recent" className="flex items-center gap-2">
              <Clock className="w-4 h-4" />最近瀏覽
              {recentItems.length > 0 && <span className="text-xs text-muted-foreground">({recentItems.length})</span>}
            </TabsTrigger>
          </TabsList>

          {/* ── 我的收藏 ── */}
          <TabsContent value="favorites">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Heart className="w-5 h-5 fill-current text-red-500" />
                  我的收藏
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-48" />)}
                  </div>
                ) : !favData || favData.items.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-muted-foreground">還沒有收藏任何工廠</p>
                    <Button variant="link" onClick={() => navigate("/search")} className="mt-2">去搜尋工廠</Button>
                  </div>
                ) : (
                  <>
                    {industries.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-6">
                        <Button size="sm" variant={selectedIndustry === "all" ? "default" : "outline"} onClick={() => setSelectedIndustry("all")}>
                          全部（{favData.items.length}）
                        </Button>
                        {industries.map(industry => {
                          const count = favData.items.filter((f: any) =>
                            (Array.isArray((f as any).industry) ? (f as any).industry as string[] : typeof (f as any).industry === 'string' ? [(f as any).industry] : []).includes(industry)
                          ).length;
                          return (
                            <Button key={industry} size="sm" variant={selectedIndustry === industry ? "default" : "outline"} onClick={() => setSelectedIndustry(industry)}>
                              {industry}（{count}）
                            </Button>
                          );
                        })}
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {filteredItems.map((factory: any) => (
                        <FactoryCard
                          key={factory.id}
                          factory={factory}
                          onRemove={() => toggleFav.mutate({ factoryId: factory.id })}
                          removeIcon={<Trash2 className="w-4 h-4 text-destructive" />}
                        />
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
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
