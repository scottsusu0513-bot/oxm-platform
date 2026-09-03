import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Helmet } from "react-helmet-async";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { useRemoveServerSeoHead } from "@/hooks/useRemoveServerSeoHead";
import { PUBLIC_PAGE_SEO } from "@/lib/publicPageSeo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Accordion, AccordionItem, AccordionTrigger, AccordionContent,
} from "@/components/ui/accordion";
import { trpc } from "@/lib/trpc";
import {
  FactorySilhouette,
  GridTexture,
  LeafDataMotif,
  NodePath,
  ShieldDocMotif,
} from "@/components/PageArtwork";
import { CERTIFICATION_NEED_OPTIONS } from "@shared/certificationServices";
import {
  Search, ShieldCheck, Leaf, Award, ArrowRight, ClipboardList, Microscope,
  FileText, GraduationCap, ClipboardCheck, Handshake, Users2, Building2,
} from "lucide-react";

// CTA 統一導向 /certification-center/apply 正式申請表單。openConsultPreview
// 保留 serviceCode 參數簽章（目前申請表單身還不支援預帶單一服務代碼，只是
// 保留穩定介面），實際導頁邏輯在 CertificationCenter() 元件內用 navigate()。

const CATEGORY_ICONS: Record<string, typeof ShieldCheck> = {
  "iso-management": ShieldCheck,
  "carbon-assessment": Leaf,
  "government-carbon-label": Award,
};

const SERVICE_FLOW_STEPS = ["需求確認", "差距評估", "輔導規劃", "文件與制度導入", "第三方稽核／查驗", "結果與後續維護"];

const OXM_HELP_ITEMS = [
  "初步需求判斷",
  "差距分析",
  "適用範圍確認",
  "文件與制度導入",
  "教育訓練",
  "內部稽核準備",
  "第三方驗證／查驗協調",
  "顧問媒合與案件追蹤",
];

const FAQ_ITEMS: { q: string; a: string }[] = [
  { q: "不知道要申請哪一項怎麼辦？", a: "可以先透過免費初步諮詢，說明企業目前遇到的客戶要求、投標需求或管理需求，由 OXM 協助初步判斷方向，再視情況安排合適的顧問進一步討論。" },
  { q: "初步諮詢是否收費？", a: "初步諮詢免費，包含需求了解、初步分流及安排合適顧問；正式輔導、驗證、查驗及其他執行費用，將依企業需求另行提出方案與報價。" },
  { q: "OXM 是否自行核發證書？", a: "不會。OXM 不自行核發 ISO 證書、查驗聲明或政府碳標籤，實際驗證、查驗與標籤申請結果由相關驗證／查驗機構及主管機關依規定辦理。" },
  { q: "輔導後是否保證通過？", a: "不會。OXM 與合作顧問不保證一定取得認證或標籤，實際結果仍須經第三方驗證／查驗機構或主管機關依規定審核。" },
  { q: "已經有部分制度，還能申請協助嗎？", a: "可以。初步諮詢時可以說明目前已具備的制度或文件基礎，顧問會依現況評估差距，不需要從零開始。" },
  { q: "認證需要多久？", a: "所需時間依企業現況、制度完整度及選擇的認證／標籤項目而異，無法一概而論，實際時程會於差距評估後由顧問說明。" },
  { q: "正式費用如何計算？", a: "正式費用會依企業規模、現況與所需輔導範圍另行提出方案與報價，本頁不預先寫死金額或承諾。" },
];

type CategoryOption = { id: number; code: string; name: string; sortOrder: number };
type ServiceItem = {
  id: number;
  code: string;
  badgeCode: string | null;
  categoryId: number;
  categoryCode: string;
  categoryName: string;
  name: string;
  type: string;
  shortDescription: string;
  applicableNeeds: string[];
  applicableIndustries: string[];
  versionNote: string | null;
  iconKey: string | null;
  serviceEnabled: boolean;
  consultEnabled: boolean;
  status: string;
  sortOrder: number;
};

export default function CertificationCenter() {
  useRemoveServerSeoHead();
  const [, navigate] = useLocation();
  const [keyword, setKeyword] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const { data: categories = [] } = trpc.certificationCenter.listCategories.useQuery();
  const { data: services = [] } = trpc.certificationCenter.listServices.useQuery();

  const openConsultPreview = (_serviceCode: string) => navigate("/certification-center/apply");

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return (services as ServiceItem[]).filter(item => {
      if (activeCategory !== "all" && item.categoryCode !== activeCategory) return false;
      if (kw && !item.name.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [services, keyword, activeCategory]);

  return (
    <div className="min-h-screen bg-background">
      {/* 正式開放服務 Landing Page：Final Public Index Release 已移除
          server/_core/security.ts NOINDEX_EXACT_PATHS 裡的隱藏 gate，title
          移除先前「（專區預覽）」字樣，description/canonical 改引用
          shared/seo/publicPages.ts，與伺服器端初始 HTML head 注入共用同一份
          資料。/certification-center/apply 是申請表單，非內容型 Landing
          Page，仍維持 noindex，不受本次開放影響。 */}
      <Helmet>
        <title>{PUBLIC_PAGE_SEO.certificationCenter.title}</title>
        <meta name="description" content={PUBLIC_PAGE_SEO.certificationCenter.description} />
        <link rel="canonical" href={PUBLIC_PAGE_SEO.certificationCenter.canonical} />
      </Helmet>

      <Navbar />
      <FloatingBackButton fallbackHref="/resources" />

      {/* breadcrumb：讓使用者與爬蟲理解上層是「找資源」，沿用
          ShortVideoMarketing.tsx／Brand.tsx 同一種輕量 breadcrumb 樣式。
          pt-16（而非較小的 pt-6）避開 FloatingBackButton——見
          ShortVideoMarketing.tsx 同樣的 pt-16 說明，這裡沿用同一個數值。 */}
      <div className="max-w-4xl mx-auto px-4 pt-16">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link href="/" className="hover:text-emerald-700">首頁</Link><span>/</span>
          <Link href="/resources" className="hover:text-emerald-700">找資源</Link><span>/</span>
          <span>ISO 與低碳認證</span>
        </div>
      </div>

      {/* ── 1. 首屏 ── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-emerald-50/70 via-white to-purple-50/50 py-16 px-4">
        {/* 裝飾光暈：森林綠／青綠呼應盤查與低碳主題，紫呼應信任／認證，
            純視覺、不可互動、不影響版面。 */}
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
          <div className="absolute -top-20 -left-20 w-72 h-72 rounded-full bg-emerald-200/40 blur-3xl" />
          <div className="absolute top-6 right-0 w-80 h-80 rounded-full bg-purple-200/30 blur-3xl" />
          <div className="absolute bottom-[-4rem] left-1/3 w-64 h-64 rounded-full bg-orange-100/40 blur-3xl" />
        </div>

        <div className="relative max-w-4xl mx-auto text-center">
          <h1 className="text-2xl md:text-4xl font-bold text-foreground mb-4">
            不知道該做哪一項認證？先從企業需求開始判斷。
          </h1>
          <p className="text-muted-foreground text-sm md:text-base mb-6 max-w-2xl mx-auto leading-relaxed">
            OXM 協助工廠釐清客戶、投標、品質、環境與碳管理需求，媒合適合的輔導與查驗資源。
          </p>
          <Badge className="bg-orange-100 text-orange-700 border-orange-200 border mb-6">初步諮詢免費</Badge>
          <div>
            <Button
              size="lg"
              className="bg-gradient-to-r from-orange-500 to-purple-600 hover:opacity-90 text-white border-0 gap-2"
              onClick={() => openConsultPreview("hero")}
            >
              申請免費初步諮詢 <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Hero 插畫：工廠盤查／改善環狀路徑通往可信任的認證結果，純裝飾，
            不連結、不可點擊。 */}
        <div className="relative max-w-4xl mx-auto mt-10 md:mt-12">
          <div className="rounded-3xl border border-emerald-100 bg-white/60 shadow-sm shadow-emerald-900/5 p-2 sm:p-3">
            <img
              src="/hero/certification-center-hero.webp"
              alt="工廠溫室氣體盤查與 ISO 驗證流程示意圖"
              width={1536}
              height={1024}
              className="w-full h-auto rounded-2xl"
            />
          </div>
        </div>
      </section>

      {/* ── 2. 工廠常見需求 ── */}
      <section className="relative overflow-hidden py-14 px-4 border-b border-emerald-100 bg-gradient-to-br from-emerald-50 via-teal-50/70 to-stone-50">
        <div className="absolute inset-0 text-emerald-900" aria-hidden="true">
          <GridTexture className="absolute inset-0" opacity={0.055} size={56} />
          <FactorySilhouette className="absolute -bottom-8 -right-20 w-[36rem] h-56 opacity-[0.11] hidden md:block" />
          <LeafDataMotif className="absolute -top-12 -left-16 w-64 h-64 opacity-[0.13]" />
        </div>
        <div className="relative max-w-5xl mx-auto grid gap-8 md:grid-cols-[1fr_18rem] md:items-center">
          <div>
            <h2 className="text-lg font-semibold mb-5 flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-orange-500" />工廠常見需求
            </h2>
            <div className="flex flex-wrap gap-2">
              {CERTIFICATION_NEED_OPTIONS.map(need => (
                <Badge key={need} variant="outline" className="text-xs px-3 py-1.5 bg-white/80 border-emerald-200 shadow-sm">{need}</Badge>
              ))}
            </div>
          </div>
          <div className="relative min-h-44 rounded-3xl border border-emerald-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-sm" aria-hidden="true">
            <p className="mb-4 text-center text-xs font-semibold tracking-wide text-emerald-800">從現況找到適合的認證方向</p>
            <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1">
              <div className="rounded-2xl bg-emerald-100 px-2 py-3 text-center shadow-sm">
                <span className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-white">
                  <Building2 className="h-5 w-5" />
                </span>
                <span className="block text-[11px] font-semibold text-emerald-900">工廠現況</span>
              </div>
              <ArrowRight className="h-4 w-4 text-emerald-500" />
              <div className="rounded-2xl bg-orange-100 px-2 py-3 text-center shadow-sm">
                <span className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-orange-500 text-white">
                  <ClipboardList className="h-5 w-5" />
                </span>
                <span className="block text-[11px] font-semibold text-orange-900">需求盤點</span>
              </div>
              <ArrowRight className="h-4 w-4 text-purple-500" />
              <div className="rounded-2xl bg-purple-100 px-2 py-3 text-center shadow-sm">
                <span className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-purple-600 text-white">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <span className="block text-[11px] font-semibold text-purple-900">認證方向</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 3. 搜尋與篩選 + 4. 動態認證卡片 ── */}
      <section className="relative overflow-hidden py-14 px-4 border-b border-emerald-100 bg-[#eef5ef]">
        <div className="absolute inset-0 text-emerald-950" aria-hidden="true">
          <ShieldDocMotif className="absolute -right-16 top-10 w-80 h-80 opacity-[0.09]" />
          <LeafDataMotif className="absolute -left-20 bottom-12 w-72 h-72 opacity-[0.08]" />
        </div>
        <div className="relative max-w-5xl mx-auto">
          <h2 className="text-lg font-semibold mb-5 flex items-center gap-2">
            <Microscope className="w-5 h-5 text-purple-500" />認證與標籤項目
          </h2>

          <div className="flex flex-col sm:flex-row gap-3 mb-5">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                placeholder="搜尋認證或標籤名稱..."
                className="pl-9"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mb-6">
            <Button
              size="sm"
              variant={activeCategory === "all" ? "default" : "outline"}
              className={activeCategory === "all" ? "bg-orange-500 hover:bg-orange-600 text-white border-0" : ""}
              onClick={() => setActiveCategory("all")}
            >全部</Button>
            {(categories as CategoryOption[]).map(cat => (
              <Button
                key={cat.id}
                size="sm"
                variant={activeCategory === cat.code ? "default" : "outline"}
                className={activeCategory === cat.code ? "bg-orange-500 hover:bg-orange-600 text-white border-0" : ""}
                onClick={() => setActiveCategory(cat.code)}
              >{cat.name}</Button>
            ))}
          </div>

          <p className="text-xs text-muted-foreground mb-4">共 {filtered.length} 筆結果</p>

          {filtered.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center text-muted-foreground text-sm">
                找不到符合條件的認證或標籤項目，請調整搜尋關鍵字或分類。
              </CardContent>
            </Card>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(item => {
                const Icon = CATEGORY_ICONS[item.categoryCode] ?? ShieldCheck;
                return (
                  <Card key={item.id} className="flex flex-col bg-white/90 border-emerald-100 hover:shadow-md transition-shadow">
                    <CardContent className="p-5 flex flex-col">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-orange-100 to-purple-100 shrink-0">
                          <Icon className="w-4 h-4 text-orange-600" />
                        </span>
                        <Badge variant="outline" className="text-[11px]">{item.type}</Badge>
                      </div>
                      <h3 className="font-semibold text-sm mb-1.5 leading-snug">{item.name}</h3>
                      <p className="text-xs text-muted-foreground leading-relaxed mb-3">{item.shortDescription}</p>

                      {item.applicableNeeds.length > 0 && (
                        <div className="mb-2">
                          <p className="text-[11px] text-muted-foreground mb-1">適用需求</p>
                          <div className="flex flex-wrap gap-1">
                            {item.applicableNeeds.map(n => (
                              <span key={n} className="text-[11px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-700">{n}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {item.applicableIndustries.length > 0 && (
                        <div className="mb-2">
                          <p className="text-[11px] text-muted-foreground mb-1">適用產業</p>
                          <div className="flex flex-wrap gap-1">
                            {item.applicableIndustries.map(n => (
                              <span key={n} className="text-[11px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700">{n}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {item.versionNote && (
                        <p className="text-[11px] text-amber-600">{item.versionNote}</p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── 5. 如何選擇 ── */}
      <section className="relative overflow-hidden py-14 px-4 border-b border-teal-100 bg-gradient-to-br from-white via-teal-50/50 to-purple-50/50">
        <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full border-[42px] border-purple-200/30" aria-hidden="true" />
        <div className="relative max-w-5xl mx-auto grid gap-8 lg:grid-cols-[19rem_1fr] lg:items-center">
          <div className="relative min-h-72 rounded-[2rem] border border-teal-200 bg-gradient-to-br from-teal-100/80 via-white to-purple-100/80 p-5 shadow-sm" aria-hidden="true">
            <div className="mb-4 flex items-center justify-center gap-2 rounded-full bg-slate-800 px-4 py-2 text-xs font-semibold text-white shadow-sm">
              <ClipboardList className="h-4 w-4" />依需求選擇服務
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-purple-200 bg-white p-3 text-center shadow-sm">
                <span className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100 text-purple-700"><ShieldCheck className="h-5 w-5" /></span>
                <span className="block text-[11px] font-semibold leading-snug text-slate-800">ISO<br />管理系統</span>
              </div>
              <div className="rounded-2xl border border-teal-200 bg-white p-3 text-center shadow-sm">
                <span className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-teal-100 text-teal-700"><Building2 className="h-5 w-5" /></span>
                <span className="block text-[11px] font-semibold leading-snug text-slate-800">組織<br />溫室氣體盤查</span>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-white p-3 text-center shadow-sm">
                <span className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><Leaf className="h-5 w-5" /></span>
                <span className="block text-[11px] font-semibold leading-snug text-slate-800">產品<br />碳足跡</span>
              </div>
              <div className="rounded-2xl border border-orange-200 bg-white p-3 text-center shadow-sm">
                <span className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 text-orange-700"><Award className="h-5 w-5" /></span>
                <span className="block text-[11px] font-semibold leading-snug text-slate-800">政府<br />碳標籤</span>
              </div>
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-5">如何選擇</h2>
            <div className="grid sm:grid-cols-2 gap-4">
            {[
              { title: "ISO 管理系統", desc: "建立企業內部管理制度（品質、環境、職安、能源、資安等），是長期性的管理框架，不等於單一產品的碳足跡數據。" },
              { title: "組織溫室氣體盤查", desc: "以「整個組織」為範圍盤查溫室氣體排放量（如 ISO 14064-1），回應的是企業整體碳排放，不是單一產品。" },
              { title: "產品碳足跡", desc: "以「單一產品」的生命週期為範圍量化碳排放（如 ISO 14067），與組織層級盤查的範圍不同。" },
              { title: "政府碳標籤", desc: "由主管機關核發的產品碳足跡相關標籤，通常需先完成產品碳足跡量化才能申請，與 ISO 驗證證書是不同的核發單位與程序。" },
            ].map(g => (
              <Card key={g.title} className="bg-white/85 border-teal-100 shadow-sm">
                <CardContent className="p-4">
                  <p className="font-semibold text-sm mb-1.5">{g.title}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{g.desc}</p>
                </CardContent>
              </Card>
            ))}
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              申請其中一項，並不代表自動取得其他項目的資格或結果，實際適用範圍請以初步諮詢與差距評估結果為準。
            </p>
          </div>
        </div>
      </section>

      {/* ── 6. 服務流程 ── */}
      <section className="relative overflow-hidden py-14 px-4 border-b border-emerald-200 bg-emerald-950 text-white">
        <div className="absolute inset-0 text-emerald-300" aria-hidden="true">
          <GridTexture className="absolute inset-0" opacity={0.1} size={64} />
          <FactorySilhouette className="absolute -bottom-10 right-0 w-[32rem] h-52 opacity-[0.13]" />
        </div>
        <div className="relative max-w-5xl mx-auto">
          <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
            <FileText className="w-5 h-5 text-orange-400" />服務流程
          </h2>
          <div className="relative grid gap-4 md:grid-cols-6 md:gap-3">
            <NodePath count={SERVICE_FLOW_STEPS.length} className="absolute left-[5%] right-[5%] top-6 h-10 w-[90%] text-emerald-300 hidden md:block" />
            <NodePath count={SERVICE_FLOW_STEPS.length} orientation="vertical" className="absolute left-1 top-4 bottom-4 h-[calc(100%-2rem)] w-8 text-emerald-300 md:hidden" />
            {SERVICE_FLOW_STEPS.map((step, i) => (
              <div key={step} className="relative z-10 ml-10 md:ml-0 rounded-2xl border border-emerald-400/30 bg-white/10 p-4 text-center backdrop-blur-sm">
                <span className="mx-auto mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-orange-400 text-xs font-bold text-emerald-950 shadow-lg shadow-emerald-950/30">{i + 1}</span>
                <span className="text-xs md:text-sm font-medium leading-snug">{step}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 7. OXM 可提供的協助 ── */}
      <section className="relative overflow-hidden py-14 px-4 border-b border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-purple-50">
        <div className="absolute inset-0 text-purple-900" aria-hidden="true">
          <ShieldDocMotif className="absolute -right-12 -bottom-24 w-80 h-80 opacity-[0.11]" />
          <LeafDataMotif className="absolute -left-20 -top-16 w-72 h-72 text-emerald-900 opacity-[0.09]" />
        </div>
        <div className="relative max-w-5xl mx-auto grid gap-8 md:grid-cols-[1fr_17rem] md:items-center">
          <div>
          <h2 className="text-lg font-semibold mb-5 flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-purple-500" />OXM 可提供的協助
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {OXM_HELP_ITEMS.map(item => (
              <div key={item} className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-white/75 p-3 text-sm text-muted-foreground shadow-sm">
                <ClipboardCheck className="w-4 h-4 text-green-600 shrink-0" />{item}
              </div>
            ))}
          </div>
          </div>
          <div className="relative min-h-56 rounded-3xl border border-purple-200 bg-white/80 p-5 shadow-sm" aria-hidden="true">
            <div className="mb-4 flex items-center justify-center gap-2">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 to-emerald-500 text-white shadow-md">
                <Handshake className="h-6 w-6" />
              </span>
              <span className="text-sm font-bold text-slate-800">OXM 協作路徑</span>
            </div>
            <div className="space-y-2">
              {[
                { icon: ClipboardList, label: "需求盤點", tone: "bg-emerald-100 text-emerald-700" },
                { icon: FileText, label: "文件導入", tone: "bg-orange-100 text-orange-700" },
                { icon: ShieldCheck, label: "查驗協調", tone: "bg-purple-100 text-purple-700" },
              ].map((item, index) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2 shadow-sm">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${item.tone}`}><Icon className="h-4 w-4" /></span>
                    <span className="text-xs font-semibold text-slate-700">{item.label}</span>
                    <span className="ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold text-white">{index + 1}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── 8. 免費範圍說明 + 十、重要聲明 ── */}
      <section className="relative overflow-hidden py-14 px-4 border-b border-orange-100 bg-[#fbf7ef]">
        <div className="absolute inset-0 text-orange-900" aria-hidden="true">
          <GridTexture className="absolute inset-0" opacity={0.04} size={52} />
          <FactorySilhouette className="absolute -bottom-12 -left-24 w-[30rem] h-48 opacity-[0.08]" />
        </div>
        <div className="relative max-w-3xl mx-auto grid gap-4 md:grid-cols-2">
          <Card className="border-orange-200 bg-orange-50/50">
            <CardContent className="p-5">
              <p className="text-sm font-semibold mb-1.5 flex items-center gap-1.5">
                <Handshake className="w-4 h-4 text-orange-600" />免費範圍說明
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                初步諮詢免費，包含需求了解、初步分流及安排合適顧問；正式輔導、驗證、查驗及其他執行費用，將依企業需求另行提出方案與報價。
              </p>
            </CardContent>
          </Card>

          <Card className="border-border bg-muted/30">
            <CardContent className="p-5">
              <p className="text-sm font-semibold mb-1.5 flex items-center gap-1.5">
                <Users2 className="w-4 h-4 text-muted-foreground" />重要聲明
              </p>
              <ul className="text-xs text-muted-foreground leading-relaxed list-disc list-inside space-y-1">
                <li>OXM 負責需求整理、顧問媒合與案件追蹤。</li>
                <li>OXM 不自行核發 ISO 證書、查驗聲明或政府碳標籤。</li>
                <li>實際驗證、查驗與標籤申請結果由相關驗證／查驗機構及主管機關依規定辦理。</li>
                <li>OXM 與合作顧問不保證一定取得認證或標籤。</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── 9. FAQ ── */}
      <section className="relative overflow-hidden py-14 px-4 border-b border-border bg-gradient-to-b from-white to-emerald-50/60">
        <div className="absolute -right-24 top-10 h-72 w-72 rounded-full bg-emerald-200/25 blur-3xl" aria-hidden="true" />
        <div className="relative max-w-3xl mx-auto">
          <h2 className="text-lg font-semibold mb-5">常見問題</h2>
          <Accordion type="single" collapsible>
            {FAQ_ITEMS.map((item, i) => (
              <AccordionItem key={i} value={`faq-${i}`}>
                <AccordionTrigger className="text-sm text-left">{item.q}</AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground leading-relaxed">{item.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* ── 10. 最終 CTA ── */}
      <section className="relative overflow-hidden py-20 px-4 bg-gradient-to-br from-emerald-100 via-white to-purple-100">
        <div className="absolute inset-0 text-emerald-900" aria-hidden="true">
          <GridTexture className="absolute inset-0" opacity={0.05} size={58} />
          <FactorySilhouette className="absolute -bottom-5 -left-16 w-[32rem] h-44 opacity-[0.14] hidden sm:block" />
          <LeafDataMotif className="absolute -top-14 right-1/4 w-56 h-56 opacity-[0.14]" />
          <ShieldDocMotif className="absolute -bottom-16 -right-8 w-72 h-72 text-purple-800 opacity-[0.16]" />
          <NodePath count={5} className="absolute bottom-16 left-[18%] right-[18%] h-12 w-[64%] text-emerald-700 opacity-70 hidden md:block" />
        </div>
        <div className="relative max-w-2xl mx-auto rounded-[2rem] border border-white/80 bg-white/70 px-6 py-10 text-center shadow-xl shadow-emerald-900/10 backdrop-blur-sm">
          <Badge className="bg-orange-100 text-orange-700 border-orange-200 border mb-4">初步諮詢免費</Badge>
          <p className="text-sm text-muted-foreground mb-6">由 OXM 協助需求整理、顧問媒合及案件追蹤</p>
          <Button
            size="lg"
            className="bg-gradient-to-r from-orange-500 to-purple-600 hover:opacity-90 text-white border-0 gap-2"
            onClick={() => openConsultPreview("final-cta")}
          >
            申請免費初步諮詢 <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </section>
    </div>
  );
}
