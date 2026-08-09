import { Helmet } from "react-helmet-async";
import { Users } from "lucide-react";
import { SectionComingSoon } from "@/components/SectionComingSoon";
import { useRemoveServerSeoHead } from "@/hooks/useRemoveServerSeoHead";

const BASE = "https://www.oxmmatch.com";

export default function Talent() {
  useRemoveServerSeoHead();

  return (
    <>
      <Helmet>
        <title>找人才｜傳統產業人才媒合｜OXM</title>
        <meta name="description" content="OXM 找人才正在準備中，未來將整合技能訓練、人才媒合與傳統產業就業資源，敬請期待。" />
        <link rel="canonical" href={`${BASE}/talent`} />
        <meta name="robots" content="noindex,follow" />
      </Helmet>

      <SectionComingSoon
        title="找人才"
        tagline="傳統產業專業人才與企業需求的媒合入口"
        description="OXM 找人才正在準備中，未來將整合技能訓練、人才媒合與傳統產業就業資源。"
        Icon={Users}
        gradientFrom="from-teal-500"
        gradientTo="to-cyan-600"
        accentText="text-teal-700"
        accentBorder="border-teal-200"
        accentBg="bg-teal-50"
        secondaryCta={{ label: "先找工廠", href: "/search" }}
      />
    </>
  );
}
