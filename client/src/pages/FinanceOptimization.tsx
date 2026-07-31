import { Link } from "wouter";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import Navbar from "@/components/Navbar";
import {
  PiggyBank, Percent, Landmark, Wallet, MessagesSquare,
  ShieldCheck, RefreshCw, Users, Award, Scale, Briefcase,
  CalendarCheck, ClipboardList, Compass, ArrowRight,
} from "lucide-react";

// ── 企業是否遇到這些狀況 ──────────────────────────────────────────────────────
const PAIN_POINTS = [
  { Icon: Percent, title: "稅務負擔偏高", desc: "不確定目前的稅務安排是否合理" },
  { Icon: Landmark, title: "貸款條件不理想", desc: "利率、額度或還款結構需要調整" },
  { Icon: Wallet, title: "有營收卻缺現金", desc: "公司資金進出與調度不夠順暢" },
  { Icon: MessagesSquare, title: "銀行溝通困難", desc: "不知道如何準備授信資料與爭取條件" },
];

// ── 我們能協助企業 ────────────────────────────────────────────────────────────
const SERVICES = [
  { Icon: ShieldCheck, title: "合法節稅", desc: "檢視稅務與帳務結構，降低不必要的稅務成本及風險。" },
  { Icon: Landmark, title: "融資優化", desc: "規劃適合企業的貸款額度、期限與還款結構，並協助銀行對接。" },
  { Icon: RefreshCw, title: "財務結構優化", desc: "改善負債與現金流配置，讓營運資金調度更有彈性。" },
];

// ── 專業顧問團隊 ──────────────────────────────────────────────────────────────
const CONSULTANT_HIGHLIGHTS = [
  { Icon: Briefcase, title: "17 年以上", desc: "金融實務經驗" },
  { Icon: Award, title: "RFC 國際認證", desc: "專業財務顧問資格" },
  { Icon: Scale, title: "跨領域整合", desc: "金融、會計、稅務與法律資源" },
  { Icon: Users, title: "理解企業經營", desc: "從企業主角度規劃可執行方案" },
];

// ── 三步驟完成企業健檢 ────────────────────────────────────────────────────────
const STEPS = [
  { Icon: CalendarCheck, num: "01", title: "預約免費體檢", desc: "填寫聯絡資料，安排顧問初次諮詢。" },
  { Icon: ClipboardList, num: "02", title: "顧問全面健檢", desc: "從稅務、融資、負債與現金流全面了解公司體質。" },
  { Icon: Compass, num: "03", title: "提出優化方向", desc: "依企業整體狀況提出改善建議，並協助專業資源對接。" },
];

const CTA_BUTTON_CLASS =
  "bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 text-white border-0";

export default function FinanceOptimization() {
  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>企業財務優化｜OXM</title>
        <meta
          name="description"
          content="合法節稅、融資優化、資金更靈活。專業顧問從稅務、融資、負債與現金流全面檢視企業體質，初次諮詢與企業財務體檢免費。"
        />
      </Helmet>
      <Navbar />

      {/* ── 1. 主視覺 ── */}
      <section className="border-b border-border bg-gradient-to-b from-blue-50/60 to-transparent dark:from-blue-950/20">
        <div className="container py-14 md:py-20 max-w-3xl mx-auto text-center space-y-6">
          <div className="w-16 h-16 mx-auto rounded-full bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center">
            <PiggyBank className="w-8 h-8 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl md:text-4xl font-bold">企業財務優化</h1>
            <p className="text-lg text-muted-foreground">合法節稅｜融資優化｜資金更靈活</p>
          </div>
          <div className="inline-block rounded-full bg-blue-600 text-white text-sm font-semibold px-4 py-1.5">
            初次諮詢・企業財務體檢免費
          </div>
          <p className="text-muted-foreground leading-relaxed max-w-xl mx-auto">
            專業顧問從稅務、融資、負債與現金流，全面檢視企業體質，協助改善財務結構，讓資金運用更健康、更順暢。
          </p>
          <div className="pt-2">
            <Link href="/finance-optimization/apply">
              <Button size="lg" className={CTA_BUTTON_CLASS}>
                免費申請企業財務健檢
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ── 2. 企業是否遇到這些狀況 ── */}
      <section className="container py-14 max-w-5xl mx-auto space-y-8">
        <h2 className="text-2xl font-bold text-center">企業是否遇到這些狀況？</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PAIN_POINTS.map((p) => (
            <div key={p.title} className="rounded-xl border border-border p-5 space-y-3 text-center">
              <div className="w-11 h-11 mx-auto rounded-full bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center">
                <p.Icon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="font-semibold">{p.title}</h3>
              <p className="text-sm text-muted-foreground">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── 3. 我們能協助企業 ── */}
      <section className="bg-muted/30 border-y border-border">
        <div className="container py-14 max-w-5xl mx-auto space-y-8">
          <h2 className="text-2xl font-bold text-center">我們能協助企業</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {SERVICES.map((s) => (
              <div key={s.title} className="rounded-2xl border border-border bg-background p-6 space-y-4 text-center">
                <div className="w-14 h-14 mx-auto rounded-full bg-gradient-to-br from-blue-600/10 to-violet-600/10 flex items-center justify-center">
                  <s.Icon className="w-7 h-7 text-blue-600" />
                </div>
                <h3 className="text-lg font-semibold">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 4. 專業顧問團隊 ── */}
      <section className="container py-14 max-w-5xl mx-auto space-y-8">
        <h2 className="text-2xl font-bold text-center">專業顧問團隊</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {CONSULTANT_HIGHLIGHTS.map((h) => (
            <div key={h.title} className="rounded-xl border border-border p-5 text-center space-y-2">
              <h.Icon className="w-6 h-6 mx-auto text-blue-600" />
              <p className="font-semibold text-sm">{h.title}</p>
              <p className="text-xs text-muted-foreground">{h.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── 5. 三步驟完成企業健檢 ── */}
      <section className="bg-muted/30 border-y border-border">
        <div className="container py-14 max-w-4xl mx-auto space-y-8">
          <h2 className="text-2xl font-bold text-center">三步驟完成企業健檢</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {STEPS.map((s) => (
              <div key={s.num} className="text-center space-y-3">
                <div className="w-12 h-12 mx-auto rounded-full bg-blue-600 text-white flex items-center justify-center">
                  <s.Icon className="w-6 h-6" />
                </div>
                <div className="text-xs font-semibold text-blue-600">STEP {s.num}</div>
                <h3 className="font-semibold">{s.title}</h3>
                <p className="text-sm text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 6. 最後行動區 ── */}
      <section className="container py-16 max-w-2xl mx-auto text-center space-y-5">
        <h2 className="text-xl md:text-2xl font-bold">
          先看懂企業的財務全貌，再找出適合的改善方式
        </h2>
        <p className="text-blue-600 font-semibold">初次諮詢與企業財務體檢免費</p>
        <Link href="/finance-optimization/apply">
          <Button size="lg" className={CTA_BUTTON_CLASS}>
            免費申請企業財務健檢
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </Link>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-md mx-auto">
          企業資料僅供顧問評估與聯繫使用，將採保密方式處理。後續服務內容及費用將於評估後另行說明。
        </p>
      </section>
    </div>
  );
}
