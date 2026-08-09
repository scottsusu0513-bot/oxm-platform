import { Link } from "wouter";
import { Sparkles, ArrowRight } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { Button } from "@/components/ui/button";

type NavIcon = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;

interface SectionComingSoonProps {
  /** 專區名稱，例如「找人才」 */
  title: string;
  /** 簡短定位文案，一句話 */
  tagline: string;
  /** 進一步說明，1-2 句即可，不要寫長文 */
  description: string;
  Icon: NavIcon;
  /** icon 圓角方塊的漸層色，例如 "from-teal-500" / "to-cyan-600" */
  gradientFrom: string;
  gradientTo: string;
  /** 狀態徽章與副標文字顏色 */
  accentText: string;
  accentBorder: string;
  accentBg: string;
  /** 可選：導向目前已開放功能的第二顆按鈕，例如「先找工廠」→ /search */
  secondaryCta?: { label: string; href: string };
}

/**
 * 六大主入口共用的「準備開放中／敬請期待」Landing Page。取代原本 Navbar 對
 * 尚未開放入口的鎖定 disabled 樣式——這裡是真實可進入的頁面（保留 Navbar／
 * 返回首頁等完整導覽，不是孤立空白頁），只是還沒有正式功能。各專區只需要
 * 透過 props 帶入自己的文案／配色，不用另外複製一整套版面。
 */
export function SectionComingSoon({
  title,
  tagline,
  description,
  Icon,
  gradientFrom,
  gradientTo,
  accentText,
  accentBorder,
  accentBg,
  secondaryCta,
}: SectionComingSoonProps) {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <FloatingBackButton fallbackHref="/" label="返回" />

      <section className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-20">
        <div className="mx-auto max-w-lg text-center">
          <div className={`mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br ${gradientFrom} ${gradientTo} shadow-xl`}>
            <Icon className="h-10 w-10 text-white" />
          </div>

          <span className={`mb-5 inline-flex items-center gap-2 rounded-full border ${accentBorder} ${accentBg} px-3.5 py-1.5 text-xs font-semibold ${accentText}`}>
            <Sparkles className="h-3.5 w-3.5" />
            準備開放中・敬請期待
          </span>

          <h1 className="mb-3 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">{title}</h1>
          <p className={`mb-4 text-base font-semibold sm:text-lg ${accentText}`}>{tagline}</p>
          <p className="mb-10 text-sm leading-relaxed text-slate-500 sm:text-base">{description}</p>

          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/">
              <Button className="bg-slate-900 text-white shadow-lg shadow-slate-900/15 hover:bg-slate-800">
                返回首頁
              </Button>
            </Link>
            {secondaryCta && (
              <Link href={secondaryCta.href}>
                <Button variant="outline" className={`${accentBorder} ${accentText} hover:${accentBg}`}>
                  {secondaryCta.label}<ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
