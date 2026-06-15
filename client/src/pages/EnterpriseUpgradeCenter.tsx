import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Navbar from "@/components/Navbar";
import { ArrowRight, CheckCircle } from "lucide-react";

// ── 統計數字遞增動畫 ──────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 1800, started = false) {
  const [value, setValue] = useState(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!started) return;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, duration, started]);

  return value;
}

function StatCard({
  label,
  value,
  suffix,
  started,
}: {
  label: string;
  value: number;
  suffix?: string;
  started: boolean;
}) {
  const count = useCountUp(value, 1800, started);
  const display = count >= 10000
    ? `${(count / 10000).toFixed(1)}億`
    : count.toLocaleString();

  return (
    <div className="flex flex-col items-center gap-1 py-6 px-4">
      <span className="text-3xl md:text-4xl font-extrabold text-orange-500 tabular-nums">
        {display}
        {suffix}
      </span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

// ── 補助方案卡片 ──────────────────────────────────────────────────────────────

const SUBSIDY_PLANS = [
  {
    code: "SBIR",
    title: "SBIR",
    desc: "小型企業創新研發計畫",
    max: "1,000 萬元",
    color: "from-orange-500 to-amber-500",
  },
  {
    code: "CITD",
    title: "CITD",
    desc: "協助傳統產業技術開發",
    max: "500 萬元",
    color: "from-amber-500 to-yellow-400",
  },
  {
    code: "SIIR",
    title: "SIIR",
    desc: "服務業創新研發計畫",
    max: "1,000 萬元",
    color: "from-violet-500 to-indigo-500",
  },
];

// ── 申請流程步驟 ──────────────────────────────────────────────────────────────

const STEPS = [
  "填寫評估資料",
  "OXM 資格初審",
  "媒合合作顧問",
  "專人評估",
  "申請政府計畫",
];

// ── 主頁面 ────────────────────────────────────────────────────────────────────

export default function EnterpriseUpgradeCenter() {
  const statsRef = useRef<HTMLDivElement>(null);
  const [statsStarted, setStatsStarted] = useState(false);

  useEffect(() => {
    const el = statsRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setStatsStarted(true); },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>企業升級中心｜OXM</title>
        <meta
          name="description"
          content="OXM 企業升級中心，協助台灣企業取得政府補助與轉型資源，包含 SBIR、CITD、SIIR 等計畫媒合服務。"
        />
      </Helmet>

      <Navbar />

      {/* ── 區塊 1：Hero ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-orange-50 via-amber-50 to-white dark:from-orange-950/30 dark:via-amber-950/20 dark:to-background py-20 md:py-28">
        <div
          className="pointer-events-none absolute inset-0 -z-10 opacity-30 dark:opacity-10 blur-3xl"
          style={{
            background:
              "radial-gradient(ellipse at 60% 50%, oklch(0.75 0.20 50), oklch(0.65 0.18 295) 60%, transparent 80%)",
          }}
          aria-hidden="true"
        />
        <div className="container text-center space-y-6 max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 text-sm font-medium select-none">
            <span className="relative flex h-2 w-2">
              <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500" />
            </span>
            免費資格評估開放中
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">
            <span className="bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent">
              企業升級中心
            </span>
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed">
            協助台灣企業取得政府補助與轉型資源
          </p>
          <Link href="/upgrade-center/apply">
            <Button
              size="lg"
              className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0 text-base px-8"
            >
              免費評估資格
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>
      </section>

      {/* ── 區塊 2：統計數字 ──────────────────────────────────────────────── */}
      <section ref={statsRef} className="border-y border-border bg-muted/30">
        <div className="container">
          <div className="grid grid-cols-3 divide-x divide-border">
            <StatCard label="已媒合案件數" value={126} suffix=" 件" started={statsStarted} />
            <StatCard label="已協助申請金額" value={38650000} started={statsStarted} />
            <StatCard label="合作企業數" value={84} suffix=" 家" started={statsStarted} />
          </div>
        </div>
      </section>

      {/* ── 區塊 3：補助方案 ──────────────────────────────────────────────── */}
      <section className="container py-16 md:py-20 space-y-8">
        <div className="text-center space-y-2">
          <h2 className="text-2xl md:text-3xl font-bold">主要補助方案</h2>
          <p className="text-muted-foreground">OXM 協助媒合適合您企業的政府計畫</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {SUBSIDY_PLANS.map((plan) => (
            <Card key={plan.code} className="group hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div
                  className={`w-12 h-12 rounded-xl bg-gradient-to-br ${plan.color} flex items-center justify-center mb-3`}
                >
                  <span className="text-white font-extrabold text-sm">{plan.code}</span>
                </div>
                <CardTitle className="text-xl">{plan.title}</CardTitle>
                <p className="text-sm text-muted-foreground">{plan.desc}</p>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between border-t border-border pt-4">
                  <span className="text-xs text-muted-foreground">最高補助</span>
                  <span className="text-lg font-bold text-orange-500">{plan.max}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ── 區塊 4：申請流程 ──────────────────────────────────────────────── */}
      <section className="bg-muted/30 py-16 md:py-20">
        <div className="container space-y-8 max-w-3xl mx-auto">
          <div className="text-center space-y-2">
            <h2 className="text-2xl md:text-3xl font-bold">申請流程</h2>
            <p className="text-muted-foreground">五個步驟，OXM 全程陪同</p>
          </div>

          {/* 桌機：橫向步驟條；手機：直向列表 */}
          <div className="hidden md:flex items-center justify-between gap-2">
            {STEPS.map((step, i) => (
              <div key={step} className="flex items-center gap-2 min-w-0">
                <div className="flex flex-col items-center gap-1.5 shrink-0">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 text-white flex items-center justify-center font-bold text-sm">
                    {i + 1}
                  </div>
                  <span className="text-xs text-center font-medium whitespace-nowrap">{step}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className="flex-1 h-px bg-gradient-to-r from-orange-300 to-amber-300 mt-[-14px]" />
                )}
              </div>
            ))}
          </div>

          <div className="md:hidden space-y-3">
            {STEPS.map((step, i) => (
              <div key={step} className="flex items-start gap-3">
                <div className="flex flex-col items-center shrink-0">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 text-white flex items-center justify-center font-bold text-sm">
                    {i + 1}
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className="w-px h-6 bg-orange-200 mt-1" />
                  )}
                </div>
                <div className="pt-1">
                  <p className="font-medium text-sm">{step}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 區塊 5：CTA ───────────────────────────────────────────────────── */}
      <section className="container py-16 md:py-20">
        <div className="max-w-2xl mx-auto text-center space-y-5 rounded-2xl border border-orange-100 dark:border-orange-900/40 bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-950/20 dark:to-amber-950/10 p-10 md:p-14">
          <div className="flex justify-center">
            <CheckCircle className="w-10 h-10 text-orange-500" />
          </div>
          <h2 className="text-2xl md:text-3xl font-bold">不確定適合哪項補助？</h2>
          <p className="text-muted-foreground">讓 OXM 協助評估</p>
          <Link href="/upgrade-center/apply">
            <Button
              size="lg"
              className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0 px-8"
            >
              免費評估資格
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
