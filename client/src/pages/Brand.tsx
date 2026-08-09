import { Helmet } from "react-helmet-async";
import { Package } from "lucide-react";
import { SectionComingSoon } from "@/components/SectionComingSoon";
import { useRemoveServerSeoHead } from "@/hooks/useRemoveServerSeoHead";

const BASE = "https://www.oxmmatch.com";

export default function Brand() {
  useRemoveServerSeoHead();

  return (
    <>
      <Helmet>
        <title>找形象｜企業品牌與數位形象資源｜OXM</title>
        <meta name="description" content="OXM 找形象正在準備中，未來將整合品牌設計、企業形象、商業攝影與相關專業資源，敬請期待。" />
        <link rel="canonical" href={`${BASE}/brand`} />
        <meta name="robots" content="noindex,follow" />
      </Helmet>

      <SectionComingSoon
        title="找形象"
        tagline="企業品牌、內容與數位形象資源入口"
        description="OXM 找形象正在準備中，未來將整合品牌設計、企業形象、商業攝影與相關專業資源。"
        Icon={Package}
        gradientFrom="from-amber-500"
        gradientTo="to-orange-600"
        accentText="text-amber-700"
        accentBorder="border-amber-200"
        accentBg="bg-amber-50"
        secondaryCta={{ label: "先找工廠", href: "/search" }}
      />
    </>
  );
}
