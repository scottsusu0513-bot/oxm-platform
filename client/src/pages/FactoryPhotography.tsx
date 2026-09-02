import { Helmet } from "react-helmet-async";
import { Link } from "wouter";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useRemoveServerSeoHead } from "@/hooks/useRemoveServerSeoHead";
import { PUBLIC_PAGE_SEO } from "@/lib/publicPageSeo";
import {
  ArrowRight, Camera, Factory, Wrench, PackageSearch, Users2, LayoutGrid,
  Building2, Presentation, Share2, Newspaper, Handshake, Mail, CheckCircle2, XCircle,
} from "lucide-react";
import { GridTexture, ViewfinderCorners, SpotlightBeam } from "@/components/PageArtwork";

const SHOOT_CATEGORIES = [
  { key: "site", title: "工廠環境攝影", desc: "廠房、工作環境、生產空間", Icon: Factory, tone: "orange" },
  { key: "process", title: "設備與製程攝影", desc: "機台、生產流程、技術細節", Icon: Wrench, tone: "amber" },
  { key: "product", title: "商品／產品攝影", desc: "成品、零組件、材料、包裝", Icon: PackageSearch, tone: "rose" },
  { key: "team", title: "企業與團隊形象", desc: "團隊、工作情境、企業形象", Icon: Users2, tone: "purple" },
] as const;

const USE_CASES = [
  { text: "公司官網", Icon: LayoutGrid },
  { text: "OXM 工廠頁", Icon: Building2 },
  { text: "型錄", Icon: Newspaper },
  { text: "提案簡報", Icon: Presentation },
  { text: "社群", Icon: Share2 },
  { text: "展覽、招商與業務素材", Icon: Handshake },
] as const;

const SUITABLE_FOR = [
  "官網或型錄還在用手機隨手拍、畫質與構圖不一致的企業",
  "準備參展、提案或招商，需要一批可長期重複使用的正式素材",
  "希望在 OXM 工廠頁呈現更完整、更專業形象的工廠",
  "廠房、設備或製程已經到位，但從未有系統性拍攝紀錄",
];

const TONE_STYLES: Record<string, { bg: string; border: string; iconBg: string; iconColor: string }> = {
  orange: { bg: "bg-orange-50", border: "border-orange-200", iconBg: "bg-orange-100", iconColor: "text-orange-700" },
  amber:  { bg: "bg-amber-50",  border: "border-amber-200",  iconBg: "bg-amber-100",  iconColor: "text-amber-700" },
  rose:   { bg: "bg-rose-50",   border: "border-rose-200",   iconBg: "bg-rose-100",   iconColor: "text-rose-700" },
  purple: { bg: "bg-purple-50", border: "border-purple-200", iconBg: "bg-purple-100", iconColor: "text-purple-700" },
};

const CONTACT_EMAIL = "scottsusu@oxmmatch.com";

export default function FactoryPhotography() {
  useRemoveServerSeoHead();

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>{PUBLIC_PAGE_SEO.factoryPhotography.title}</title>
        <meta name="description" content={PUBLIC_PAGE_SEO.factoryPhotography.description} />
        <link rel="canonical" href={PUBLIC_PAGE_SEO.factoryPhotography.canonical} />
        <meta name="robots" content="noindex,follow" />
      </Helmet>

      <Navbar />
      <FloatingBackButton fallbackHref="/brand" />

      {/* ── 1. Hero：breadcrumb 標示上層為「找形象」，純 CSS 光暈裝飾 ── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-amber-50 via-white to-orange-50 py-16 px-4 border-b border-border">
        <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
          <SpotlightBeam className="absolute -top-10 right-0 w-80 h-80 text-amber-900 opacity-[0.09]" />
        </div>
        <div className="relative z-10 max-w-4xl mx-auto">
          <div className="mb-6 flex items-center gap-2 text-xs text-slate-500">
            <Link href="/" className="hover:text-orange-700">首頁</Link><span>/</span>
            <Link href="/brand" className="hover:text-orange-700">找形象</Link><span>/</span>
            <span>工廠形象攝影</span>
          </div>
          <p className="text-xs font-semibold tracking-wide text-orange-700 mb-3">OXM｜企業形象攝影服務</p>
          <h1 className="text-2xl md:text-4xl font-bold text-foreground mb-4 leading-tight">
            用專業攝影，留下企業真正的品牌資產
          </h1>
          <p className="text-muted-foreground text-sm md:text-base mb-6 leading-relaxed max-w-2xl">
            專業工廠攝影不是單純拍幾張照片，而是建立企業可以長期使用的品牌視覺素材——涵蓋廠房環境、設備製程、產品與團隊，應用於官網、型錄、提案與社群曝光。
          </p>
          <a href={`mailto:${CONTACT_EMAIL}`}>
            <Button size="lg" className="bg-gradient-to-r from-orange-500 to-amber-600 hover:opacity-90 text-white border-0 gap-2">
              聯絡我們了解攝影服務 <ArrowRight className="w-4 h-4" />
            </Button>
          </a>
        </div>
      </section>

      {/* ── 2. 拍攝內容四大類 ── */}
      <section className="relative overflow-hidden py-12 px-4 border-b border-border">
        <div className="absolute inset-0 z-0 text-amber-900" aria-hidden="true">
          <GridTexture className="absolute inset-0" opacity={0.04} />
        </div>
        <ViewfinderCorners className="inset-6 md:inset-10 text-orange-900 opacity-[0.10] z-0" />
        <div className="relative z-10 max-w-5xl mx-auto">
          <h2 className="text-lg font-semibold mb-2">拍攝內容</h2>
          <p className="text-xs text-muted-foreground mb-5">依企業需求選擇拍攝範圍，可單獨執行，也可以組合安排在同一次拍攝行程內。</p>
          <div className="grid sm:grid-cols-2 gap-4">
            {SHOOT_CATEGORIES.map(item => {
              const tone = TONE_STYLES[item.tone];
              const Icon = item.Icon;
              return (
                <Card key={item.key} className={`border ${tone.border} ${tone.bg}`}>
                  <CardContent className="p-5 flex items-start gap-3">
                    <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full ${tone.iconBg} shrink-0`}>
                      <Icon className={`w-5 h-5 ${tone.iconColor}`} />
                    </span>
                    <div>
                      <p className="font-semibold text-sm mb-1">{item.title}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 3. 適合哪些企業 ── */}
      <section className="py-12 px-4 border-b border-border bg-stone-50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-lg font-semibold mb-5">適合哪些企業</h2>
          <div className="rounded-2xl border border-border bg-white overflow-hidden">
            {SUITABLE_FOR.map((text, i) => (
              <div key={text} className={`flex items-start gap-3 px-5 py-3.5 ${i < SUITABLE_FOR.length - 1 ? "border-b border-border" : ""}`}>
                <CheckCircle2 className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
                <p className="text-sm text-foreground/80 leading-snug">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 4. 成果用途 ── */}
      <section className="py-12 px-4 border-b border-border">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-lg font-semibold mb-2">素材可以用在哪裡</h2>
          <p className="text-xs text-muted-foreground mb-5">同一批拍攝素材可依授權範圍延伸應用於多個場景，不限單一用途。</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {USE_CASES.map(item => {
              const Icon = item.Icon;
              return (
                <div key={item.text} className="flex items-center gap-2.5 text-sm text-foreground/80 rounded-lg border border-border bg-white p-3.5">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-100 shrink-0">
                    <Icon className="w-4 h-4 text-amber-700" />
                  </span>
                  {item.text}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 5. 把期待說清楚 ── */}
      <section className="py-12 px-4 border-b border-border bg-orange-50/40">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-lg font-semibold mb-5 flex items-center gap-1.5 text-foreground/70">
            <XCircle className="w-4 h-4" />把期待說清楚
          </h2>
          <ul className="text-sm text-muted-foreground leading-relaxed space-y-2">
            {[
              "工廠形象攝影提供的是專業視覺素材，不保證成交、不保證流量、不保證詢價成長",
              "實際拍攝範圍、張數、時程與交付規格，會依現場評估與需求確認，不在此頁預先承諾",
              "機密區域、客戶資料與未公開製程需先確認拍攝邊界",
            ].map(text => (
              <li key={text} className="flex items-start gap-2">
                <XCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── 6. CTA：使用既有客服信箱聯絡機制，非虛構的申請 API ── */}
      <section className="py-16 px-4 bg-gradient-to-br from-orange-100 via-amber-50 to-rose-50">
        <div className="max-w-2xl mx-auto rounded-[2rem] border border-white/80 bg-white/80 px-6 py-10 text-center shadow-xl shadow-orange-900/10">
          <Badge className="bg-orange-100 text-orange-700 border-orange-200 border mb-4 gap-1">
            <Camera className="w-3 h-3" />工廠形象攝影
          </Badge>
          <p className="text-sm text-muted-foreground mb-6">想了解拍攝範圍與流程，歡迎先透過客服信箱與 OXM 聯繫</p>
          <a href={`mailto:${CONTACT_EMAIL}`}>
            <Button size="lg" className="bg-gradient-to-r from-orange-500 to-amber-600 hover:opacity-90 text-white border-0 gap-2">
              <Mail className="w-4 h-4" />{CONTACT_EMAIL}
            </Button>
          </a>
        </div>
      </section>
    </div>
  );
}
