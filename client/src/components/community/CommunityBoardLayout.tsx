import { lazy, Suspense } from "react";
import { Helmet } from "react-helmet-async";
import { MessageSquareText } from "lucide-react";
import Navbar from "@/components/Navbar";
import { AppLoading } from "@/components/AppLoading";
import { INDUSTRY_SLUGS } from "@shared/constants";
import { COMMUNITY_CROSS_INDUSTRY_NAME, COMMUNITY_CROSS_INDUSTRY_SLUG } from "@shared/const";
import CommunityIndustryTabs from "./CommunityIndustryTabs";
import CommunitySectionTabs from "./CommunitySectionTabs";
import CommunityBidsPage from "./CommunityBidsPage";
import { CommunityHeroArtwork, IndustrialSkyline } from "./CommunityArtwork";

const CommunitySpace = lazy(() => import("./CommunitySpace"));

const slugToName: Record<string, string> = {
  ...Object.fromEntries(Object.entries(INDUSTRY_SLUGS).map(([name, slug]) => [slug, name])),
  [COMMUNITY_CROSS_INDUSTRY_SLUG]: COMMUNITY_CROSS_INDUSTRY_NAME,
};

interface Props {
  spaceCode: string;
  section: "discussions" | "bids";
}

export default function CommunityBoardLayout({ spaceCode, section }: Props) {
  const spaceName = slugToName[spaceCode] ?? spaceCode;

  return (
    <div className="community-page min-h-screen overflow-x-clip bg-slate-50/60 dark:bg-background">
      <Helmet>
        <title>
          {section === "discussions" ? `${spaceName} 討論區` : `${spaceName} 競標區`}｜臺灣傳產論壇｜OXM
        </title>
        <meta
          name="description"
          content={`臺灣傳產論壇．${spaceName} — 交流傳統產業實務經驗、技術問題與合作需求`}
        />
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <Navbar />

      <main className="mx-auto max-w-[1280px] px-4 pb-0 pt-4 sm:px-6 sm:pt-6">
        {/* Compact brand hero: artwork stays secondary to discussion content. */}
        <section className="relative mb-4 overflow-hidden rounded-2xl border border-purple-100/80 bg-gradient-to-br from-white via-purple-50/35 to-orange-50/55 px-5 py-4 shadow-sm dark:border-purple-900/40 dark:from-card dark:via-purple-950/20 dark:to-orange-950/10 sm:px-7">
          <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full border-[28px] border-purple-100/45 dark:border-purple-900/20" aria-hidden="true" />
          <div className="relative grid items-center gap-3 sm:min-h-[174px] sm:grid-cols-[minmax(0,1fr)_300px] sm:gap-7">
            <div className="max-w-2xl py-1">
              <span className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-purple-100 bg-white/80 px-2.5 py-1 text-xs font-semibold tracking-wide text-purple-700 shadow-sm dark:border-purple-900/50 dark:bg-purple-950/30 dark:text-purple-300">
                <MessageSquareText className="h-3.5 w-3.5" />
                OXM 臺灣傳產交流
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-foreground sm:text-3xl">臺灣傳產論壇</h1>
              <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-slate-600 dark:text-muted-foreground sm:text-[15px]">
                依產業切換看板，分享實務經驗、交流技術問題，找到下一個合作機會。
              </p>
            </div>
            <CommunityHeroArtwork className="pointer-events-none mx-auto w-full max-w-[300px] rounded-xl border border-white/80 object-cover shadow-[0_14px_35px_rgba(76,29,149,0.12)] dark:border-purple-900/40" />
          </div>
        </section>

        {/* Industry tab strip */}
        <CommunityIndustryTabs activeSpaceCode={spaceCode} />

        {/* Section tabs: discussions | bids */}
        <CommunitySectionTabs spaceCode={spaceCode} activeSection={section} />

        {/* Content area */}
        <div className="mt-5">
          {section === "discussions" ? (
            <Suspense fallback={<AppLoading />}>
              <CommunitySpace spaceCode={spaceCode} />
            </Suspense>
          ) : (
            <CommunityBidsPage spaceCode={spaceCode} />
          )}
        </div>

        <div className="pointer-events-none mt-7 h-14 overflow-hidden sm:h-16" aria-hidden="true">
          <IndustrialSkyline className="h-full w-full dark:opacity-50" />
        </div>
      </main>
    </div>
  );
}
