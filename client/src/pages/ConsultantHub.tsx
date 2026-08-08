import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { trpc } from "@/lib/trpc";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { Lightbulb, PiggyBank, ArrowRight, ShieldAlert, BadgeCheck, Factory, Clapperboard } from "lucide-react";

// 顧問中心第一層分流：企業補助／財務優化／ISO 與低碳認證／ERP 與產線優化／
// 短影音與品牌內容，共 5 種顧問服務。可見性只是導頁便利性，實際存取權限一律
// 由 server（各 xConsultant.myCases）強制驗證，這裡隱藏或顯示入口都不影響
// 後端授權判斷。
export default function ConsultantHub() {
  const { user, loading } = useAuth();
  const isAdmin = user?.role === "admin";

  const govProfilesQuery = trpc.upgradeConsultant.myProfiles.useQuery(undefined, { enabled: !!user && !isAdmin });
  const financeProfilesQuery = trpc.financeConsultant.myProfiles.useQuery(undefined, { enabled: !!user && !isAdmin });
  const certProfilesQuery = trpc.certificationConsultant.myProfiles.useQuery(undefined, { enabled: !!user && !isAdmin });
  const erpProfilesQuery = trpc.erpConsultant.myProfiles.useQuery(undefined, { enabled: !!user && !isAdmin });
  const videoProfilesQuery = trpc.shortVideoConsultant.myProfiles.useQuery(undefined, { enabled: !!user && !isAdmin });

  const anyLoading = !isAdmin && (
    govProfilesQuery.isLoading || financeProfilesQuery.isLoading ||
    certProfilesQuery.isLoading || erpProfilesQuery.isLoading || videoProfilesQuery.isLoading
  );

  if (loading || anyLoading) {
    return <AppLoading />;
  }

  const showGov = isAdmin || (govProfilesQuery.data ?? []).some(p => p.isActive);
  const showFinance = isAdmin || (financeProfilesQuery.data ?? []).some(p => p.isActive);
  const showIso = isAdmin || (certProfilesQuery.data ?? []).some(p => p.isActive);
  const showErp = isAdmin || (erpProfilesQuery.data ?? []).some(p => p.isActive);
  const showVideo = isAdmin || (videoProfilesQuery.data ?? []).some(p => p.isActive);

  if (!showGov && !showFinance && !showIso && !showErp && !showVideo) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container py-24 flex flex-col items-center text-center space-y-4 max-w-sm mx-auto">
          <ShieldAlert className="w-8 h-8 text-red-500" />
          <h2 className="text-xl font-bold">您目前不是顧問</h2>
          <p className="text-muted-foreground text-sm">此頁面僅供已授權的顧問使用。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <FloatingBackButton fallbackHref="/" />
      <div className="container py-14 max-w-5xl mx-auto space-y-8">
        <h1 className="text-2xl font-bold text-center">顧問中心</h1>
        <div className="flex flex-wrap justify-center gap-6">
          {showGov && (
            <Link href="/upgrade-consultant/cases" className="w-full sm:w-[calc(50%-0.75rem)] lg:w-[calc(33.333%-1rem)]">
              <div className="rounded-2xl border border-orange-200 dark:border-orange-900/40 bg-orange-50/50 dark:bg-orange-950/20 p-6 space-y-3 hover:border-orange-400 transition-colors cursor-pointer h-full">
                <Lightbulb className="w-8 h-8 text-orange-600" />
                <h2 className="text-lg font-semibold">企業補助顧問</h2>
                <p className="text-sm text-muted-foreground">管理現有 SBIR、CITD、SIIR 等政府補助案件。</p>
                <div className="flex items-center gap-1 text-sm text-orange-600 font-medium">
                  進入案件看板 <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </Link>
          )}
          {showFinance && (
            <Link href="/finance-consultant/cases" className="w-full sm:w-[calc(50%-0.75rem)] lg:w-[calc(33.333%-1rem)]">
              <div className="rounded-2xl border border-blue-200 dark:border-blue-900/40 bg-blue-50/50 dark:bg-blue-950/20 p-6 space-y-3 hover:border-blue-400 transition-colors cursor-pointer h-full">
                <PiggyBank className="w-8 h-8 text-blue-600" />
                <h2 className="text-lg font-semibold">財務優化顧問</h2>
                <p className="text-sm text-muted-foreground">管理企業財務健檢、合法節稅、融資優化及資金調度案件。</p>
                <div className="flex items-center gap-1 text-sm text-blue-600 font-medium">
                  進入案件看板 <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </Link>
          )}
          {showIso && (
            <Link href="/certification-consultant/cases" className="w-full sm:w-[calc(50%-0.75rem)] lg:w-[calc(33.333%-1rem)]">
              <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/50 dark:bg-emerald-950/20 p-6 space-y-3 hover:border-emerald-400 transition-colors cursor-pointer h-full">
                <BadgeCheck className="w-8 h-8 text-emerald-600" />
                <h2 className="text-lg font-semibold">ISO／低碳認證顧問</h2>
                <p className="text-sm text-muted-foreground">管理 ISO 認證、碳盤查、產品碳足跡及低碳輔導案件。</p>
                <div className="flex items-center gap-1 text-sm text-emerald-600 font-medium">
                  進入案件看板 <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </Link>
          )}
          {showErp && (
            <Link href="/erp-consultant/cases" className="w-full sm:w-[calc(50%-0.75rem)] lg:w-[calc(33.333%-1rem)]">
              <div className="rounded-2xl border border-purple-200 dark:border-purple-900/40 bg-purple-50/50 dark:bg-purple-950/20 p-6 space-y-3 hover:border-purple-400 transition-colors cursor-pointer h-full">
                <Factory className="w-8 h-8 text-purple-600" />
                <h2 className="text-lg font-semibold">ERP／產線優化顧問</h2>
                <p className="text-sm text-muted-foreground">管理 ERP 導入、流程數位化、產線及工廠動線優化案件。</p>
                <div className="flex items-center gap-1 text-sm text-purple-600 font-medium">
                  進入案件看板 <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </Link>
          )}
          {showVideo && (
            <Link href="/short-video-consultant/cases" className="w-full sm:w-[calc(50%-0.75rem)] lg:w-[calc(33.333%-1rem)]">
              <div className="rounded-2xl border border-pink-200 dark:border-pink-900/40 bg-pink-50/50 dark:bg-pink-950/20 p-6 space-y-3 hover:border-pink-400 transition-colors cursor-pointer h-full">
                <Clapperboard className="w-8 h-8 text-pink-600" />
                <h2 className="text-lg font-semibold">短影音／品牌內容顧問</h2>
                <p className="text-sm text-muted-foreground">管理短影音企劃、拍攝製作、品牌內容及持續代營運案件。</p>
                <div className="flex items-center gap-1 text-sm text-pink-600 font-medium">
                  進入案件看板 <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
