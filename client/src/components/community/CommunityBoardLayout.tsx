import { lazy, Suspense } from "react";
import { Helmet } from "react-helmet-async";
import Navbar from "@/components/Navbar";
import { AppLoading } from "@/components/AppLoading";
import { INDUSTRY_SLUGS } from "@shared/constants";
import { COMMUNITY_CROSS_INDUSTRY_NAME, COMMUNITY_CROSS_INDUSTRY_SLUG } from "@shared/const";
import CommunityIndustryTabs from "./CommunityIndustryTabs";
import CommunitySectionTabs from "./CommunitySectionTabs";
import CommunityBidsPage from "./CommunityBidsPage";

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
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>
          {section === "discussions" ? `${spaceName} 討論區` : `${spaceName} 競標區`} — OXM 商案討論區
        </title>
        <meta
          name="description"
          content={`OXM 商案討論區 ${spaceName} — 台灣製造業 B2B 商案交流平台`}
        />
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <Navbar />

      <main className="mx-auto max-w-[1280px] px-4 sm:px-6 py-6">
        {/* Page header */}
        <div className="mb-5">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">商案討論區</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            依產業切換看板，發布需求、交流技術與尋找合作機會
          </p>
        </div>

        {/* Industry tab strip */}
        <CommunityIndustryTabs activeSpaceCode={spaceCode} />

        {/* Section tabs: discussions | bids */}
        <CommunitySectionTabs spaceCode={spaceCode} activeSection={section} />

        {/* Content area */}
        <div className="mt-6">
          {section === "discussions" ? (
            <Suspense fallback={<AppLoading />}>
              <CommunitySpace spaceCode={spaceCode} />
            </Suspense>
          ) : (
            <CommunityBidsPage spaceCode={spaceCode} />
          )}
        </div>
      </main>
    </div>
  );
}
