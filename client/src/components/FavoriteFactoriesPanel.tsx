import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useIsMobile } from "@/hooks/useMobile";
import { Star, MapPin, Heart, Trash2, Factory, Wrench, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { CroppedImage } from "@/components/CroppedImage";
import type { ImageCropData } from "@shared/imageCrop";

export const MOBILE_FAVORITES_PAGE_SIZE = 4;
export const DESKTOP_FAVORITES_PAGE_SIZE = 8;

export function FactoryCard({ factory, onRemove, removeIcon }: {
  factory: any;
  onRemove: () => void;
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
              <div className="w-8 h-8 rounded-full border shrink-0 overflow-hidden">
                <CroppedImage src={factory.avatarUrl} crop={(factory.avatarCrop ?? null) as ImageCropData | null} alt={factory.name} loading="lazy" />
              </div>
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
              <Factory className="w-3 h-3 mr-1" />工廠
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

// 收藏工廠清單，供 MemberCenter 與 MyFavorites 共用；分頁大小依 useIsMobile 決定單一資料 slice
export function FavoriteFactoriesPanel() {
  const [, navigate] = useLocation();
  const isMobile = useIsMobile();
  const pageSize = isMobile ? MOBILE_FAVORITES_PAGE_SIZE : DESKTOP_FAVORITES_PAGE_SIZE;
  const [selectedIndustry, setSelectedIndustry] = useState<string>("all");
  const [page, setPage] = useState(1);

  const { data: favData, isLoading, isError, refetch } = trpc.favorite.getByUser.useQuery({ page: 1, pageSize: 100 });
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

  // 目前選中的產業已不在最新收藏清單中（例如取消收藏該產業最後一間）時，篩選回到「全部」
  useEffect(() => {
    if (selectedIndustry !== "all" && !industries.includes(selectedIndustry)) {
      setSelectedIndustry("all");
    }
  }, [industries, selectedIndustry]);

  const filteredItems = useMemo(() => {
    if (!favData?.items) return [];
    if (selectedIndustry === "all") return favData.items;
    return favData.items.filter((f: any) =>
      (Array.isArray((f as any).industry) ? (f as any).industry as string[] : typeof (f as any).industry === 'string' ? [(f as any).industry] : []).includes(selectedIndustry)
    );
  }, [favData?.items, selectedIndustry]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));

  // 篩選條件或頁面大小（手機/電腦切換）改變時回到第一頁
  useEffect(() => {
    setPage(1);
  }, [selectedIndustry, pageSize]);

  // 收藏清單筆數改變（例如取消收藏刪掉當頁最後一筆）時，若目前頁超出範圍就退回最後一個有效頁
  useEffect(() => {
    setPage(p => (p > totalPages ? totalPages : p));
  }, [totalPages]);

  const pageItems = filteredItems.slice((page - 1) * pageSize, page * pageSize);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Heart className="w-5 h-5 fill-current text-red-500" />
          我的收藏
        </CardTitle>
        {favData && <CardDescription>共 {favData.items.length} 家收藏工廠</CardDescription>}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(pageSize)].map((_, i) => <Skeleton key={i} className="h-48" />)}
          </div>
        ) : isError ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">載入收藏清單時發生錯誤，請稍後再試</p>
            <Button variant="outline" onClick={() => refetch()}>重新載入</Button>
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
              {pageItems.map((factory: any) => (
                <FactoryCard
                  key={factory.id}
                  factory={factory}
                  onRemove={() => toggleFav.mutate({ factoryId: factory.id })}
                  removeIcon={<Trash2 className="w-4 h-4 text-destructive" />}
                />
              ))}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-6">
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="上一頁"
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="w-4 h-4" />
                  上一頁
                </Button>
                <span className="text-sm text-muted-foreground" aria-live="polite">
                  第 {page} / {totalPages} 頁
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="下一頁"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                >
                  下一頁
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
