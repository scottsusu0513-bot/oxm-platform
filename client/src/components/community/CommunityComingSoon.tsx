import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Helmet } from "react-helmet-async";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { COMMUNITY_FEATURE_STATUS } from "@shared/const";
import { SectionComingSoon } from "@/components/SectionComingSoon";
import { useRemoveServerSeoHead } from "@/hooks/useRemoveServerSeoHead";

function resolveView(status: typeof COMMUNITY_FEATURE_STATUS): "coming_soon" | "maintenance" {
  switch (status) {
    case "coming_soon": return "coming_soon";
    case "maintenance": return "maintenance";
    case "beta":        return "coming_soon";
    case "live":        return "coming_soon";
  }
}

export default function CommunityComingSoon() {
  useRemoveServerSeoHead();
  const view = resolveView(COMMUNITY_FEATURE_STATUS);

  // 維護模式：既有行為維持不變，跟找討論主入口的 Coming Soon 文案／SEO 是
  // 兩回事（不套用本輪新規格），本輪不觸碰這個分支。
  if (view === "maintenance") {
    return (
      <div className="min-h-screen bg-background">
        <Helmet>
          <title>OXM 臺灣傳產論壇｜即將推出</title>
          <meta
            name="description"
            content="臺灣傳產論壇，OXM 為台灣傳統產業設計的產業交流空間。依產業分類討論區與競標區，即將正式推出。"
          />
          <meta name="robots" content="noindex, nofollow" />
          <link rel="canonical" href="https://www.oxmmatch.com/community" />
        </Helmet>

        <Navbar />

        <main className="container py-16 md:py-24">
          <div className="max-w-3xl mx-auto text-center space-y-8">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300 text-sm font-medium select-none">
              <span className="relative flex h-2 w-2">
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
              </span>
              功能維護中
            </div>

            <div className="space-y-3">
              <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">
                <span className="bg-gradient-to-r from-orange-500 via-amber-400 to-violet-500 bg-clip-text text-transparent">
                  OXM 臺灣傳產論壇
                </span>
              </h1>
              <p className="text-xl text-muted-foreground font-medium">系統維護中，請稍後再試</p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <Link href="/">
                <Button variant="outline" className="w-full sm:w-auto">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  返回首頁
                </Button>
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // 找討論主入口的 Coming Soon Landing Page：正式納入七大主入口，沿用既有
  // /community route，改用跟找人才／找形象同一套共用元件與視覺，不再是這個
  // 元件原本自己手刻的一套版面。noindex,follow：內容篇幅較短，暫不索引，
  // 見 server/_core/security.ts 的 NOINDEX_FOLLOW_EXACT_PATHS。
  return (
    <>
      <Helmet>
        <title>臺灣傳產論壇｜產業交流、技術討論與合作需求｜OXM</title>
        <meta name="description" content="臺灣傳產論壇是 OXM 提供給台灣傳統產業交流實務經驗、技術問題與合作需求的產業討論空間。" />
        <link rel="canonical" href="https://www.oxmmatch.com/community" />
        <meta name="robots" content="noindex,follow" />
      </Helmet>

      <SectionComingSoon
        title="臺灣傳產論壇"
        tagline="交流傳產經驗、實務問題與合作需求"
        description="臺灣傳產論壇是 OXM 提供給台灣傳統產業交流實務經驗、技術問題與合作需求的產業討論空間。"
        Icon={MessageSquare}
        gradientFrom="from-rose-500"
        gradientTo="to-pink-600"
        accentText="text-rose-700"
        accentBorder="border-rose-200"
        accentBg="bg-rose-50"
        secondaryCta={{ label: "先找工廠", href: "/search" }}
      />
    </>
  );
}
