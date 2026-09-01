import { useState, useEffect, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { Helmet } from "react-helmet-async";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Navbar from "@/components/Navbar";
import LoginDialog from "@/components/LoginDialog";
import { ArrowLeft, CheckCircle2, Loader2, Building2, LogIn, Clock, XCircle, AlertCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { getFriendlyFormError } from "@/lib/formErrors";
import { resolveAnyFactoryStatus } from "./financeOptimizationApplyStatus";
import { useAiHandoff } from "@/hooks/useAiHandoff";
import { AiHandoffModal } from "@/components/ai/AiHandoffModal";

// 財務優化案件未結案狀態：new(新案件)／evaluating(評估中)／deferred(緩追區)
const OPEN_STATUSES = new Set(["new", "evaluating", "deferred"]);

const CASE_STATUS_LABELS: Record<string, string> = {
  new: "等待顧問查收",
  evaluating: "顧問評估中",
  deferred: "暫緩追蹤中",
  not_interested: "已結案（無意願）",
  won: "已結案（成交）",
};

type FormValues = {
  contactName: string;
  phone: string;
  contactTime: string;
  agreeTerms: boolean;
};

type EligibleFactory = { id: number; name: string; address: string };

function GateView({ icon, title, description, actions }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actions: React.ReactNode;
}) {
  return (
    <div className="container py-24 flex flex-col items-center text-center space-y-6 max-w-sm mx-auto">
      <div className="w-16 h-16 rounded-full bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center">
        {icon}
      </div>
      <div className="space-y-2">
        <h2 className="text-xl font-bold">{title}</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
        {actions}
      </div>
    </div>
  );
}

function SuccessView() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container py-24 flex flex-col items-center text-center space-y-6 max-w-md mx-auto">
        <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
        </div>
        <h1 className="text-2xl font-bold">已送出企業財務健檢申請</h1>
        <p className="text-muted-foreground leading-relaxed">
          顧問將儘速查收案件並主動與您聯繫，進行初次諮詢。
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Link href="/finance-optimization">
            <Button variant="outline">
              <ArrowLeft className="w-4 h-4 mr-2" />
              返回企業財務優化
            </Button>
          </Link>
          <Link href="/">
            <Button className="bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 text-white border-0">
              返回首頁
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function FinanceOptimizationApply() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();
  const [loginOpen, setLoginOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [selectedFactoryId, setSelectedFactoryId] = useState<number | null>(null);
  // 財務表單沒有業務欄位可預填（見對話中「二十一」），這裡只用來控制
  // Blocking Modal 與 submit 時的 token 傳遞，不做任何 setValue 預填。
  const aiHandoff = useAiHandoff("finance");

  const { data: ownedFactory, isLoading: ownedLoading } = trpc.factory.getMine.useQuery(undefined, { enabled: !!user });
  const { data: coManaged, isLoading: coManagedLoading } = trpc.factory.getCoManagedFactories.useQuery(undefined, { enabled: !!user });
  const { data: progressData, isLoading: progressLoading } = trpc.financeCenter.myApplicationProgress.useQuery(undefined, {
    enabled: !!user,
    staleTime: 30_000,
  });

  const dataLoading = !!user && (ownedLoading || coManagedLoading || progressLoading);

  const applyMutation = trpc.financeCenter.submitApplication.useMutation({
    onSuccess: () => setSubmitted(true),
    onError: (err) => toast.error(getFriendlyFormError(err, "送出失敗，請稍後再試。")),
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: { agreeTerms: false } });

  // 見 client/src/pages/financeOptimizationApplyStatus.ts 的
  // resolveAnyFactoryStatus 與其行為測試。
  const anyFactoryStatus: string | null = useMemo(
    () => resolveAnyFactoryStatus(ownedFactory, coManaged),
    [ownedFactory, coManaged],
  );

  const hasAnyFactory = ownedFactory !== undefined
    ? (ownedFactory !== null || (coManaged !== undefined && coManaged.length > 0))
    : false;

  // 名下所有已通過審核（approved）的工廠，供選擇本次申請公司
  const eligibleFactories: EligibleFactory[] = useMemo(() => {
    const list: EligibleFactory[] = [];
    if (ownedFactory?.status === "approved") {
      list.push({ id: ownedFactory.id, name: ownedFactory.name, address: ownedFactory.address ?? "" });
    }
    for (const f of coManaged ?? []) {
      if (f.status === "approved" && !list.some(x => x.id === f.factoryId)) {
        list.push({ id: f.factoryId, name: f.name, address: f.address ?? "" });
      }
    }
    return list;
  }, [ownedFactory, coManaged]);

  // 依 factoryId 找出目前是否有未結案案件
  const openCaseByFactory = useMemo(() => {
    const map = new Map<number, { status: string }>();
    for (const app of progressData?.applications ?? []) {
      if (OPEN_STATUSES.has(app.status) && !map.has(app.factoryId)) {
        map.set(app.factoryId, { status: app.status });
      }
    }
    return map;
  }, [progressData]);

  // 只有一間符合資格的工廠時自動選取；有多間時交由使用者選擇
  useEffect(() => {
    if (eligibleFactories.length === 1 && selectedFactoryId == null) {
      setSelectedFactoryId(eligibleFactories[0].id);
    }
  }, [eligibleFactories, selectedFactoryId]);

  const selectedFactory = eligibleFactories.find(f => f.id === selectedFactoryId) ?? null;
  const selectedOpenCase = selectedFactoryId != null ? openCaseByFactory.get(selectedFactoryId) : undefined;

  const agreeTerms = watch("agreeTerms");

  const onSubmit = (data: FormValues) => {
    if (!selectedFactory) return;
    applyMutation.mutate({
      contactName: data.contactName,
      phone: data.phone,
      contactTime: data.contactTime,
      consentAgreed: true,
      factoryId: selectedFactory.id,
      aiHandoffToken: aiHandoff.token ?? undefined,
    });
  };

  if (submitted) return <SuccessView />;
  if (loading || dataLoading) return <AppLoading />;

  // ── Gate 1: 未登入 ──
  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <Helmet><title>免費申請企業財務健檢｜OXM</title><meta name="robots" content="noindex, nofollow, noarchive, nosnippet" /></Helmet>
        <Navbar />
        <GateView
          icon={<LogIn className="w-8 h-8 text-blue-600" />}
          title="請先登入"
          description="登入後，即可申請免費企業財務健檢服務。"
          actions={
            <>
              <Button
                className="w-full bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 text-white border-0"
                onClick={() => setLoginOpen(true)}
              >
                <LogIn className="w-4 h-4 mr-2" />
                前往登入
              </Button>
              <Link href="/finance-optimization">
                <Button variant="outline" className="w-full">返回企業財務優化</Button>
              </Link>
            </>
          }
        />
        <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} />
      </div>
    );
  }

  // ── Gate 2: 沒有任何工廠 ──
  if (!hasAnyFactory && ownedFactory === null && coManaged !== undefined) {
    return (
      <div className="min-h-screen bg-background">
        <Helmet><title>免費申請企業財務健檢｜OXM</title><meta name="robots" content="noindex, nofollow, noarchive, nosnippet" /></Helmet>
        <Navbar />
        <GateView
          icon={<Building2 className="w-8 h-8 text-blue-600" />}
          title="請先上架您的工廠"
          description="請先在 OXM 平台上架工廠，通過審核後即可申請企業財務健檢。"
          actions={
            <>
              <Link href="/register-factory">
                <Button className="w-full bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 text-white border-0">
                  前往上架工廠
                </Button>
              </Link>
              <Link href="/finance-optimization">
                <Button variant="outline" className="w-full">返回企業財務優化</Button>
              </Link>
            </>
          }
        />
      </div>
    );
  }

  // ── Gate 3: 有工廠但沒有任何一間通過審核 ──
  if (eligibleFactories.length === 0 && anyFactoryStatus !== null) {
    const isPending = anyFactoryStatus === "pending";
    const isRejected = anyFactoryStatus === "rejected";
    const title = isPending ? "工廠審核中" : isRejected ? "工廠審核未通過" : "工廠資料尚未送審";
    const description = isPending
      ? "您的工廠資料正在審核中，通過後即可申請企業財務健檢。"
      : isRejected
      ? "請依退件原因修正工廠資料後重新送審，通過審核即可申請企業財務健檢。"
      : "請先完成工廠資料並送出審核申請，通過後即可申請企業財務健檢。";
    const StatusIcon = isPending ? Clock : isRejected ? XCircle : AlertCircle;
    const iconColor = isPending ? "text-yellow-500" : isRejected ? "text-red-500" : "text-blue-600";

    return (
      <div className="min-h-screen bg-background">
        <Helmet><title>免費申請企業財務健檢｜OXM</title><meta name="robots" content="noindex, nofollow, noarchive, nosnippet" /></Helmet>
        <Navbar />
        <GateView
          icon={<StatusIcon className={`w-8 h-8 ${iconColor}`} />}
          title={title}
          description={description}
          actions={
            <>
              <Link href="/dashboard">
                <Button className="w-full bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 text-white border-0">
                  {isPending ? "查看工廠狀態" : "前往工廠後台"}
                </Button>
              </Link>
              <Link href="/finance-optimization">
                <Button variant="outline" className="w-full">返回企業財務優化</Button>
              </Link>
            </>
          }
        />
      </div>
    );
  }

  if (eligibleFactories.length === 0) return <AppLoading />;

  // ── Gate 4: 選定工廠已有未結案案件 ──
  if (selectedFactory && selectedOpenCase) {
    const statusLabel = CASE_STATUS_LABELS[selectedOpenCase.status] ?? selectedOpenCase.status;
    return (
      <div className="min-h-screen bg-background">
        <Helmet><title>免費申請企業財務健檢｜OXM</title><meta name="robots" content="noindex, nofollow, noarchive, nosnippet" /></Helmet>
        <Navbar />
        <GateView
          icon={<CheckCircle2 className="w-8 h-8 text-green-500" />}
          title="您已送出企業財務優化申請"
          description={`「${selectedFactory.name}」的申請已送出，目前狀態：${statusLabel}。顧問將主動與您聯繫。`}
          actions={
            <>
              {eligibleFactories.length > 1 && (
                <Button variant="outline" className="w-full" onClick={() => setSelectedFactoryId(null)}>
                  選擇其他公司
                </Button>
              )}
              <Link href="/finance-optimization">
                <Button className="w-full bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 text-white border-0">
                  返回企業財務優化
                </Button>
              </Link>
            </>
          }
        />
      </div>
    );
  }

  // ── 多間符合資格工廠：尚未選擇 ──
  if (eligibleFactories.length > 1 && selectedFactoryId == null) {
    return (
      <div className="min-h-screen bg-background">
        <Helmet><title>免費申請企業財務健檢｜OXM</title><meta name="robots" content="noindex, nofollow, noarchive, nosnippet" /></Helmet>
        <Navbar />
        <div className="container py-16 max-w-md mx-auto space-y-6">
          <h1 className="text-xl font-bold text-center">請選擇本次申請的公司</h1>
          <div className="space-y-3">
            {eligibleFactories.map(f => {
              const openCase = openCaseByFactory.get(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSelectedFactoryId(f.id)}
                  className="w-full text-left rounded-xl border border-border p-4 hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 transition-colors"
                >
                  <div className="font-semibold">{f.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{f.address}</div>
                  {openCase && (
                    <div className="text-xs text-blue-600 mt-1">
                      目前狀態：{CASE_STATUS_LABELS[openCase.status] ?? openCase.status}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <Link href="/finance-optimization">
            <Button variant="outline" className="w-full">返回企業財務優化</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!selectedFactory) return <AppLoading />;

  // ── 主表單 ──
  return (
    <div className="min-h-screen bg-background">
      <AiHandoffModal open={aiHandoff.showModal} onConfirm={aiHandoff.acknowledge} isConfirming={aiHandoff.isAcknowledging} />
      <Helmet>
        <title>免費申請企業財務健檢｜OXM</title>
        <meta name="description" content="填寫聯絡資料，OXM 合作財務顧問將為您安排免費企業財務健檢。" />
        <meta name="robots" content="noindex, nofollow, noarchive, nosnippet" />
      </Helmet>
      <Navbar />

      <div className="container py-10 md:py-16 max-w-2xl mx-auto space-y-8">
        <button
          type="button"
          onClick={() => {
            if (window.history.length > 1) window.history.back();
            else navigate("/finance-optimization");
          }}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-sm"
          aria-label="返回企業財務優化"
        >
          <ArrowLeft className="w-4 h-4" />
          返回企業財務優化
        </button>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/finance-optimization" className="hover:text-foreground transition-colors">企業財務優化</Link>
          <span>/</span>
          <span className="text-foreground">免費申請企業財務健檢</span>
        </div>

        <div className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-bold">免費申請企業財務健檢</h1>
          <p className="text-muted-foreground">請填寫聯絡資料，合作財務顧問將主動與您聯繫安排初次諮詢。</p>
        </div>

        {eligibleFactories.length > 1 && (
          <div className="space-y-2">
            <Label htmlFor="factorySelect">本次申請公司</Label>
            <Select value={String(selectedFactory.id)} onValueChange={(v) => setSelectedFactoryId(Number(v))}>
              <SelectTrigger id="factorySelect">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {eligibleFactories.map(f => (
                  <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
          <fieldset className="space-y-5 rounded-xl border border-border p-6">
            <legend className="px-1 text-sm font-semibold text-muted-foreground">公司資料（由 OXM 工廠資料帶入，不可修改）</legend>
            <div className="space-y-2">
              <Label>公司名稱</Label>
              <Input readOnly aria-disabled="true" value={selectedFactory.name} className="bg-muted/60 cursor-not-allowed text-foreground/80 focus-visible:ring-0 focus-visible:ring-offset-0" />
            </div>
            <div className="space-y-2">
              <Label>公司地址</Label>
              <Input readOnly aria-disabled="true" value={selectedFactory.address} className="bg-muted/60 cursor-not-allowed text-foreground/80 focus-visible:ring-0 focus-visible:ring-offset-0" />
            </div>
          </fieldset>

          <fieldset className="space-y-5 rounded-xl border border-border p-6">
            <legend className="px-1 text-sm font-semibold text-muted-foreground">聯絡資料</legend>

            <div className="space-y-2">
              <Label htmlFor="contactName">
                聯絡人 <span className="text-destructive">*</span>
              </Label>
              <Input id="contactName" placeholder="姓名" maxLength={100} {...register("contactName", { required: "請填寫聯絡人姓名" })} />
              {errors.contactName && <p className="text-xs text-destructive">{errors.contactName.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">
                聯絡電話 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="phone"
                type="tel"
                placeholder="0912-345-678"
                maxLength={30}
                {...register("phone", {
                  required: "請填寫聯絡電話",
                  pattern: { value: /^[\d\-+() ]{7,20}$/, message: "電話格式不正確" },
                })}
              />
              {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="contactTime">
                方便聯絡時間 <span className="text-destructive">*</span>
              </Label>
              <Input id="contactTime" placeholder="例：平日上午 10:00-12:00" maxLength={100} {...register("contactTime", { required: "請填寫方便聯絡時間" })} />
              {errors.contactTime && <p className="text-xs text-destructive">{errors.contactTime.message}</p>}
            </div>
          </fieldset>

          <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-4">
            <Checkbox
              id="agreeTerms"
              checked={agreeTerms}
              onCheckedChange={(checked) => setValue("agreeTerms", !!checked)}
            />
            <Label htmlFor="agreeTerms" className="font-normal leading-relaxed cursor-pointer text-sm">
              我同意 OXM 將上述資料提供給合作財務顧問，供免費初次諮詢與聯繫使用。
              <span className="text-destructive ml-1">*</span>
            </Label>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Link href="/finance-optimization">
              <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={applyMutation.isPending}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                返回
              </Button>
            </Link>
            <Button
              type="submit"
              disabled={!agreeTerms || applyMutation.isPending}
              className="w-full sm:flex-1 bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 text-white border-0"
            >
              {applyMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  送出中...
                </>
              ) : "送出健檢申請"}
            </Button>
          </div>
          {!agreeTerms && (
            <p className="text-xs text-muted-foreground text-center">請勾選同意條款後才能送出</p>
          )}
        </form>
      </div>
    </div>
  );
}
