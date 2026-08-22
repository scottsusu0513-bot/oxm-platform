import { Helmet } from "react-helmet-async";
import { useState } from "react";
import { Link } from "wouter";
import { useRemoveServerSeoHead } from "@/hooks/useRemoveServerSeoHead";
import { PUBLIC_PAGE_SEO } from "@/lib/publicPageSeo";
import { FAQ_CONTENT } from "@shared/content/faq";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { FaqAiEntry } from "@/components/faq/FaqAiEntry";
import { renderFaqParagraph } from "@/components/faq/FaqEmphasis";
import { FAQ_EMPHASIS } from "@/components/faq/faqEmphasisData";
import { useAiShell } from "@/contexts/AiShellContext";
import {
  CategoryIllustration,
  CtaCollaborationIllustration,
  HeroFaqIllustration,
} from "@/components/faq/FaqEditorialIllustrations";
import { ArrowRight, Compass, Search } from "lucide-react";

// FAQPage JSON-LD（16 題全部）完全由伺服器端初始 HTML 注入
// （server/_core/publicPageMeta.ts 的 getJsonLdForPath("/faq")，實際定義在
// shared/seo/schema.ts 的 getFaqPageSchema()），這裡刻意不再呼叫 renderJsonLd()，
// 與 Home.tsx／AboutOXM.tsx 的既有慣例一致（見 client/src/components/seo/JsonLd.tsx
// 開頭註解：React 19 + react-helmet-async 不會把無 src 的行內 <script> hoist
// 進 <head>，JSON-LD 一律交給伺服器負責）。

export default function FAQ() {
  useRemoveServerSeoHead();

  const seo = PUBLIC_PAGE_SEO.faq;
  const [openQuestionId, setOpenQuestionId] = useState("");

  // Global AI Shell（見對話中「全站AI Shell」）：FAQ 頁不再自己持有對話狀態，
  // 只是把使用者輸入的第一句問題交給 App 層級共用的 AiShellProvider——
  // 對話本身的 messages／conversationId／開關狀態全部在那裡，離開這個頁面
  // 也不會被清空。
  const { askQuestion, isAiComingSoon } = useAiShell();

  return (
    <div className="min-h-screen overflow-x-clip bg-[#fcfbf9]">
      <Helmet>
        <title>{seo.title}</title>
        <meta name="description" content={seo.description} />
        <link rel="canonical" href={seo.canonical} />
        <meta property="og:type" content={seo.ogType} />
        <meta property="og:site_name" content="OXM" />
        <meta property="og:url" content={seo.canonical} />
        <meta property="og:title" content={seo.title} />
        <meta property="og:description" content={seo.description} />
        <meta property="og:image" content={seo.ogImage} />
      </Helmet>

      <Navbar />
      <FloatingBackButton fallbackHref="/" label="返回" />

      <section className="relative overflow-hidden border-b border-slate-200/80 bg-[#f7f5f1] px-4 py-11 sm:py-14 lg:py-16">
        <div
          className="pointer-events-none absolute inset-y-0 left-[8%] hidden w-px bg-slate-200/70 lg:block"
          aria-hidden="true"
        />
        <HeroFaqIllustration className="pointer-events-none absolute bottom-0 right-0 w-32 rotate-[-3deg] opacity-20 sm:right-2 sm:w-44 sm:opacity-30 lg:bottom-1 lg:left-[48%] lg:right-auto lg:w-48 lg:-translate-x-1/2 lg:opacity-50" />
        <div className="container relative">
          <div className="mb-6 flex min-w-0 items-center gap-2 text-xs font-medium tracking-wide text-slate-500">
            <Link href="/" className="shrink-0 transition-colors hover:text-orange-600">首頁</Link>
            <span className="shrink-0">/</span>
            <span className="truncate">常見問答 FAQ</span>
          </div>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.66fr)] lg:items-end lg:gap-16">
            <div>
              <div className="mb-5 flex items-center gap-2" aria-hidden="true">
                <span className="h-1.5 w-9 rounded-full bg-orange-500" />
                <span className="h-1.5 w-4 rounded-full bg-purple-600" />
              </div>
              <h1 className="max-w-3xl break-words text-[2rem] font-bold leading-[1.18] tracking-[-0.035em] text-slate-950 sm:text-[2.75rem] lg:text-5xl">
                OXM 常見問答 FAQ
              </h1>
            </div>
            <p className="max-w-2xl break-words text-[15px] leading-7 text-slate-600 sm:text-base sm:leading-8 lg:pb-1">
              整理台灣製造業在市場、供應鏈、企業經營與轉型過程中常見的產業問題，從實際產業情境出發，提供 OXM 的觀察與判斷方向。
            </p>
          </div>
        </div>
      </section>

      {/* AI 問答入口：Hero 之後、四大分類之前。送出的第一句問題交給 App 層級
          的 Global AI Shell（見 FaqAiEntry.tsx 內註解），這裡不再自己開啟／
          持有任何聊天視窗。 */}
      <FaqAiEntry onAskAi={askQuestion} comingSoon={isAiComingSoon} />

      <main>
        <nav
          aria-label="FAQ 分類導覽"
          className="border-b border-slate-200/80 bg-white"
        >
          <div className="container">
            <div className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 py-4 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-4 lg:px-0 [&::-webkit-scrollbar]:hidden">
              {FAQ_CONTENT.categories.map((category) => (
                <a
                  key={category.id}
                  href={`#faq-section-${category.id}`}
                  className="group flex min-w-[15.5rem] snap-start items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50 lg:min-w-0"
                >
                  <span className="font-mono text-xs font-bold tracking-wider text-orange-600 transition-colors group-hover:text-purple-700">
                    {category.number}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">
                    {category.title}
                  </span>
                  <span className="text-[11px] tabular-nums text-slate-400">
                    {category.questions.length} 題
                  </span>
                </a>
              ))}
            </div>
          </div>
        </nav>

        <div className="container py-14 sm:py-20 lg:py-24">
          <div className="space-y-20 sm:space-y-24 lg:space-y-28">
          {FAQ_CONTENT.categories.map((category) => (
            <section
              key={category.id}
              id={`faq-section-${category.id}`}
              aria-labelledby={`faq-category-${category.id}`}
              className="scroll-mt-24 lg:grid lg:grid-cols-[minmax(0,0.29fr)_minmax(0,0.71fr)] lg:gap-14 xl:gap-20"
            >
              <div className="mb-7 lg:mb-0">
                <div className="relative lg:sticky lg:top-28">
                  <div className="flex items-center gap-3" aria-hidden="true">
                    <span className="h-px w-10 bg-orange-500" />
                    <span className="h-1.5 w-1.5 rounded-full bg-purple-600" />
                  </div>
                  <span className="mt-5 block font-mono text-5xl font-semibold leading-none tracking-[-0.06em] text-slate-200 sm:text-6xl">
                    {category.number}
                  </span>
                  <h2
                    id={`faq-category-${category.id}`}
                    className="mt-3 max-w-xs break-words text-xl font-bold leading-snug tracking-[-0.02em] text-slate-950 sm:text-2xl"
                  >
                    {category.title}
                  </h2>
                  <p className="mt-3 text-xs font-medium tracking-[0.12em] text-slate-400">
                    {category.questions.length} QUESTIONS
                  </p>
                  <CategoryIllustration
                    categoryId={category.id}
                    className="pointer-events-none absolute right-0 top-1 w-32 opacity-85 sm:w-40 lg:static lg:mt-7 lg:w-44 lg:rotate-[-2deg]"
                  />
                </div>
              </div>

              <Accordion
                type="single"
                collapsible
                value={openQuestionId}
                onValueChange={setOpenQuestionId}
                className="border-t border-slate-300"
              >
                {category.questions.map((q) => (
                  <AccordionItem
                    key={q.id}
                    value={q.id}
                    className="group border-b border-slate-200 px-0 transition-colors data-[state=open]:border-slate-300"
                  >
                    <AccordionTrigger className="gap-5 rounded-none py-5 text-left text-base font-semibold leading-7 tracking-[-0.01em] text-slate-800 hover:text-orange-700 hover:no-underline focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-200 data-[state=open]:pb-4 data-[state=open]:text-slate-950 sm:py-6 sm:text-lg sm:leading-8 [&>svg]:mr-0.5 [&>svg]:mt-1 [&>svg]:size-5 [&>svg]:text-slate-400 [&>svg]:transition-all [&[data-state=open]>svg]:text-orange-600">
                      <span className="min-w-0 break-words pr-1">{q.question}</span>
                    </AccordionTrigger>
                    <AccordionContent forceMount className="pb-7 sm:pb-8">
                      <div className="max-w-[47rem] space-y-5 border-l-2 border-orange-200 pl-4 text-[15px] leading-[1.9] text-slate-600 sm:pl-6 sm:text-base sm:leading-[1.95]">
                        {q.answerParagraphs.map((paragraph, i) => (
                          <p key={i} className="whitespace-pre-line break-words">
                            {renderFaqParagraph(paragraph, FAQ_EMPHASIS[q.id])}
                          </p>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>
          ))}
          </div>
        </div>

        <section className="relative overflow-hidden border-t border-slate-200 bg-[#f4f2ee] px-4 py-12 sm:py-14">
          <CtaCollaborationIllustration className="pointer-events-none absolute bottom-1 left-[48%] hidden w-52 -translate-x-1/2 opacity-90 lg:block" />
          <div className="container relative">
            <div className="mx-auto flex max-w-5xl flex-col gap-7 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-xl">
                <div className="mb-4 flex items-center gap-2" aria-hidden="true">
                  <span className="h-1 w-7 rounded-full bg-orange-500" />
                  <span className="h-1 w-3 rounded-full bg-purple-600" />
                </div>
                <h2 className="text-xl font-bold leading-snug tracking-[-0.02em] text-slate-950 sm:text-2xl">
                  還在找適合的合作夥伴或轉型資源？
                </h2>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:shrink-0">
                <Link
                  href="/search"
                  className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-slate-950 px-5 text-sm font-semibold text-white transition-colors hover:bg-orange-600"
                >
                  <Search className="size-4" aria-hidden="true" />
                  找工廠
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
                <Link
                  href="/resources"
                  className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-800 transition-colors hover:border-purple-300 hover:text-purple-700"
                >
                  <Compass className="size-4" aria-hidden="true" />
                  找資源
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
