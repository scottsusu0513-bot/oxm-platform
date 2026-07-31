import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { trpc } from "@/lib/trpc";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { Lightbulb, PiggyBank, ArrowRight, ShieldAlert } from "lucide-react";

// 顧問中心第一層分流：企業補助顧問／財務優化顧問。可見性只是導頁便利性，
// 實際存取權限一律由 server（upgradeConsultant.myCases / financeConsultant.myCases）
// 強制驗證，這裡隱藏或顯示入口都不影響後端授權判斷。
export default function ConsultantHub() {
  const { user, loading } = useAuth();
  const isAdmin = user?.role === "admin";

  const govProfilesQuery = trpc.upgradeConsultant.myProfiles.useQuery(undefined, { enabled: !!user && !isAdmin });
  const financeProfilesQuery = trpc.financeConsultant.myProfiles.useQuery(undefined, { enabled: !!user && !isAdmin });

  if (loading || (!isAdmin && (govProfilesQuery.isLoading || financeProfilesQuery.isLoading))) {
    return <AppLoading />;
  }

  const showGov = isAdmin || (govProfilesQuery.data ?? []).some(p => p.isActive);
  const showFinance = isAdmin || (financeProfilesQuery.data ?? []).some(p => p.isActive);

  if (!showGov && !showFinance) {
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
      <div className="container py-14 max-w-2xl mx-auto space-y-8">
        <h1 className="text-2xl font-bold text-center">顧問中心</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {showGov && (
            <Link href="/upgrade-consultant/cases">
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
            <Link href="/finance-consultant/cases">
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
        </div>
      </div>
    </div>
  );
}
