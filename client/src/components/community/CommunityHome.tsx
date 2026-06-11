import { trpc } from "@/lib/trpc";
import Navbar from "@/components/Navbar";
import { Helmet } from "react-helmet-async";
import { Link } from "wouter";
import { MessageSquare, ChevronRight, Loader2 } from "lucide-react";
import { INDUSTRY_SLUGS } from "@shared/constants";

const CROSS_INDUSTRY_SLUG = "cross-industry";
const CROSS_INDUSTRY_NAME = "跨產業交流區";

const slugToName: Record<string, string> = {
  ...Object.fromEntries(Object.entries(INDUSTRY_SLUGS).map(([name, slug]) => [slug, name])),
  [CROSS_INDUSTRY_SLUG]: CROSS_INDUSTRY_NAME,
};

export default function CommunityHome() {
  const { data, isLoading } = trpc.community.getSpaces.useQuery();

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>OXM 商案討論區</title>
        <meta name="description" content="OXM 商案討論區 — 台灣傳統產業商案交流平台，選擇你的產業空間開始討論。" />
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <Navbar />

      <main className="container py-10 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight mb-1">商案討論區</h1>
          <p className="text-muted-foreground">選擇你的產業空間，發布需求、交流技術、尋找合作機會</p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(data ?? []).map((space) => (
              <Link key={space.code} href={`/community/${space.code}`}>
                <div className={`group flex items-center justify-between p-4 rounded-xl border border-border bg-card hover:border-orange-300 hover:bg-orange-50/40 dark:hover:bg-orange-950/20 transition-colors cursor-pointer ${space.code === CROSS_INDUSTRY_SLUG ? "border-violet-200 dark:border-violet-800 bg-violet-50/40 dark:bg-violet-950/20 sm:col-span-2" : ""}`}>
                  <div>
                    <span className="font-semibold text-sm">{slugToName[space.code] ?? space.code}</span>
                    <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                      <MessageSquare className="w-3 h-3" />
                      <span>{space.postCount} 則討論</span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-orange-500 transition-colors shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
