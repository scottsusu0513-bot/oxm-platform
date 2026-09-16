import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Factory, Wrench, Star, MapPin, Search } from "lucide-react";
import type { ReactNode } from "react";

// 供 /factories/* 系列 SEO landing page（地區×主產業／全台子產業／地區×
// 子產業）共用的搜尋結果呈現——原本是 RegionIndustryPage.tsx 內建的一段
// JSX，抽出來避免每新增一種頁面就複製貼上一份幾乎一樣的卡片列表／loading
// skeleton／empty state（見任務定案「不要複製一大份幾乎一樣的頁面」）。
// 純呈現元件，不查 DB、不知道自己在哪個路由，factories／total 全部由
// 呼叫端算好傳入。
export interface FactoriesLandingResultsProps {
  isLoading: boolean;
  factories: any[];
  total: number;
  viewAllHref: string;
  viewAllLabel: string;
  /** 0 筆結果時，在既有「目前尚無符合條件的公開工廠」文字下方額外顯示的
   *  內容（例如「查看全台該子產業」「返回主產業」等引導連結）。留空
   *  （undefined）時畫面跟原本 RegionIndustryPage.tsx 的 empty state 完全
   *  一樣，不影響既有地區 × 主產業頁的輸出。 */
  emptyStateExtra?: ReactNode;
}

export function FactoriesLandingResults({
  isLoading, factories, total, viewAllHref, viewAllLabel, emptyStateExtra,
}: FactoriesLandingResultsProps) {
  return (
    <>
      {isLoading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-32" /></CardContent></Card>
          ))}
        </div>
      ) : factories.length === 0 ? (
        <Card className="mb-8">
          <CardContent className="p-12 text-center text-muted-foreground">
            <Factory className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p>目前尚無符合條件的公開工廠</p>
            {emptyStateExtra}
          </CardContent>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {factories.map((factory) => (
            <Link key={factory.id} href={`/factory/${factory.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full overflow-hidden">
                <div className="relative h-32 bg-gradient-to-br from-orange-100 to-amber-50 overflow-hidden">
                  {(factory as any).avatarUrl ? (
                    <img
                      src={(factory as any).avatarUrl}
                      alt={factory.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      {(factory as any).businessType === "studio"
                        ? <Wrench className="w-12 h-12 text-purple-200" />
                        : <Factory className="w-12 h-12 text-orange-200" />}
                    </div>
                  )}
                </div>
                <CardContent className="p-4">
                  <h2 className="font-semibold text-base mb-1 line-clamp-1">{factory.name}</h2>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {((factory as any).industry as string[] | null)?.map(ind => (
                      <Badge key={ind} variant="outline" className="text-xs">{ind}</Badge>
                    ))}
                    {(factory.mfgModes as string[]).map(m => (
                      <Badge key={m} variant="secondary" className="text-xs">{m}</Badge>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{factory.region}</span>
                    <span className="flex items-center gap-1">
                      <Star className="w-3 h-3 text-yellow-500" />
                      {Number(factory.avgRating).toFixed(1)}（{factory.reviewCount}）
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* 查看更多：超過單頁 20 筆時導去既有 Search（不在這個 SEO 頁面上
          自建分頁控制項，維持這頁只做「單一意圖 landing page」的最小範圍）。 */}
      {total > 20 && (
        <div className="text-center mb-10">
          <Link href={viewAllHref}>
            <Button variant="outline" className="gap-2">
              <Search className="w-4 h-4" />{viewAllLabel}
            </Button>
          </Link>
        </div>
      )}
    </>
  );
}
