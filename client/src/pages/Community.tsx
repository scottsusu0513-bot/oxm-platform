import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Helmet } from "react-helmet-async";
import { ArrowLeft, Search } from "lucide-react";
import { INDUSTRY_OPTIONS } from "@shared/constants";
import { COMMUNITY_FEATURE_STATUS, COMMUNITY_CROSS_INDUSTRY_NAME } from "@shared/const";

const COMMUNITY_SPACES = [...INDUSTRY_OPTIONS, COMMUNITY_CROSS_INDUSTRY_NAME];

// Exhaustive mapping — ensures all 4 statuses are explicitly handled.
// beta/live fall back to "coming_soon" in Phase 0 (actual pages not yet built).
function resolveView(status: typeof COMMUNITY_FEATURE_STATUS): "coming_soon" | "maintenance" {
  switch (status) {
    case "coming_soon": return "coming_soon";
    case "maintenance": return "maintenance";
    case "beta":        return "coming_soon";
    case "live":        return "coming_soon";
  }
}

export default function Community() {
  const view = resolveView(COMMUNITY_FEATURE_STATUS);
  const isMaintenance = view === "maintenance";

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>OXM 商案討論區｜即將推出</title>
        <meta
          name="description"
          content="OXM 商案討論區，專為台灣傳統產業設計的商案交流空間。依產業分類討論區與競標區，即將正式推出。"
        />
        <meta name="robots" content="noindex, nofollow" />
        <link rel="canonical" href="https://www.oxmmatch.com/community" />
      </Helmet>

      <Navbar />

      <main className="container py-16 md:py-24">
        <div className="max-w-3xl mx-auto text-center space-y-8">

          {/* Decorative glow */}
          <div
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 w-[600px] h-[300px] opacity-20 dark:opacity-10 blur-3xl -z-10"
            style={{
              background: "radial-gradient(ellipse at center, oklch(0.65 0.25 30), oklch(0.55 0.25 295) 60%, transparent 80%)",
            }}
            aria-hidden="true"
          />

          {/* Status badge */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300 text-sm font-medium select-none">
            {isMaintenance ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                </span>
                功能維護中
              </>
            ) : (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
                </span>
                功能架設中
              </>
            )}
          </div>

          {/* Main title */}
          <div className="space-y-3">
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">
              <span className="bg-gradient-to-r from-orange-500 via-amber-400 to-violet-500 bg-clip-text text-transparent">
                OXM 商案討論區
              </span>
            </h1>

            {isMaintenance ? (
              <p className="text-xl text-muted-foreground font-medium">系統維護中，請稍後再試</p>
            ) : (
              <p className="text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto">
                我們正在打造一個專屬於台灣傳統產業的商案交流空間。
                <span className="hidden sm:inline"><br /></span>
                未來你可以依產業進入討論區與競標區，發布需求、交流技術問題、
                <span className="hidden sm:inline"><br /></span>
                參與商案競標，並即時接收回覆、提及及競標通知。
              </p>
            )}
          </div>

          {/* Industry nodes grid */}
          {!isMaintenance && (
            <div className="pt-2">
              <p className="text-sm text-muted-foreground mb-4 font-medium">
                即將開放 <span className="text-foreground">{COMMUNITY_SPACES.length}</span> 個產業空間
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-sm">
                {COMMUNITY_SPACES.map((name) => (
                  <div
                    key={name}
                    className={
                      name === COMMUNITY_CROSS_INDUSTRY_NAME
                        ? "px-3 py-2.5 rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50/60 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 font-medium text-center col-span-2 sm:col-span-1"
                        : "px-3 py-2.5 rounded-lg border border-border bg-muted/40 text-muted-foreground text-center"
                    }
                  >
                    {name}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CTA buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Link href="/">
              <Button variant="outline" className="w-full sm:w-auto">
                <ArrowLeft className="w-4 h-4 mr-2" />
                返回首頁
              </Button>
            </Link>
            <Link href="/search">
              <Button className="w-full sm:w-auto bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0">
                <Search className="w-4 h-4 mr-2" />
                瀏覽工廠
              </Button>
            </Link>
          </div>

        </div>
      </main>
    </div>
  );
}
