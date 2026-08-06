import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { Helmet } from "react-helmet-async";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import Navbar from "@/components/Navbar";
import LoginDialog from "@/components/LoginDialog";
import { ArrowLeft, CheckCircle2, Loader2, Building2, LogIn, Clock, XCircle, AlertCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { resolveAnyFactoryStatus } from "./financeOptimizationApplyStatus";
import { CERTIFICATION_OPEN_STATUSES, CERTIFICATION_STATUS_LABELS } from "@shared/certificationCase";

const OPEN_STATUSES = new Set<string>(CERTIFICATION_OPEN_STATUSES);

type FormValues = {
  contactName: string;
  phone: string;
  contactTime: string;
  additionalNotes: string;
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
      <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center">
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
        <h1 className="text-2xl font-bold">已送出 ISO 與低碳認證免費初步諮詢申請</h1>
        <p className="text-muted-foreground leading-relaxed">
          顧問將儘速查收案件並主動與您聯繫，進行初次諮詢。
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Link href="/certification-center">
            <Button variant="outline">
              <ArrowLeft className="w-4 h-4 mr-2" />
              返回 ISO 與低碳認證專區
            </Button>
          </Link>
          <Link href="/">
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white border-0">
              返回首頁
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function CertificationCenterApply() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();
  const [loginOpen, setLoginOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [selectedFactoryId, setSelectedFactoryId] = useState<number | null>(null);

  const [servicesWanted, setServicesWanted] = useState<string[]>([]);
  const [isUnsure, setIsUnsure] = useState(false);

  const { data: ownedFactory, isLoading: ownedLoading } = trpc.factory.getMine.useQuery(undefined, { enabled: !!user });
  const { data: coManaged, isLoading: coManagedLoading } = trpc.factory.getCoManagedFactories.useQuery(undefined, { enabled: !!user });
  const { data: progressData, isLoading: progressLoading } = trpc.certificationCenter.myApplicationProgress.useQuery(undefined, {
    enabled: !!user,
    staleTime: 30_000,
  });
  // 想了解的認證服務選項一律來自現有已上架服務目錄，不另建固定清單。
  const { data: services = [], isLoading: servicesLoading } = trpc.certificationCenter.listServices.useQuery();

  const dataLoading = !!user && (ownedLoading || coManagedLoading || progressLoading);

  const applyMutation = trpc.certificationCenter.submitApplication.useMutation({
    onSuccess: () => setSubmitted(true),
    onError: (err) => toast.error(err.message || "送出失敗，請稍後再試"),
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: { agreeTerms: false, additionalNotes: "" } });

  const anyFactoryStatus: string | null = useMemo(
    () => resolveAnyFactoryStatus(ownedFactory, coManaged),
    [ownedFactory, coManaged],
  );

  const hasAnyFactory = ownedFactory !== undefined
    ? (ownedFactory !== null || (coManaged !== undefined && coManaged.length > 0))
    : false;

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

  const openCaseByFactory = useMemo(() => {
    const map = new Map<number, { status: string }>();
    for (const app of progressData?.applications ?? []) {
      if (OPEN_STATUSES.has(app.status) && !map.has(app.factoryId)) {
        map.set(app.factoryId, { status: app.status });
      }
    }
    return map;
  }, [progressData]);

  useEffect(() => {
    if (eligibleFactories.length === 1 && selectedFactoryId == null) {
      setSelectedFactoryId(eligibleFactories[0].id);
    }
  }, [eligibleFactories, selectedFactoryId]);

  const selectedFactory = eligibleFactories.find(f => f.id === selectedFactoryId) ?? null;
  const selectedOpenCase = selectedFactoryId != null ? openCaseByFactory.get(selectedFactoryId) : undefined;

  const agreeTerms = watch("agreeTerms");

  const toggleService = (code: string) => {
    setIsUnsure(false);
    setServicesWanted(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  };
  const toggleUnsure = (checked: boolean) => {
    setIsUnsure(checked);
    if (checked) setServicesWanted([]);
  };
  const servicesValid = isUnsure || servicesWanted.length > 0;

  // 依 categoryName 分組顯示，讓長清單有結構，不是一長串沒有分類的 checkbox。
  const servicesByCategory = useMemo(() => {
    const groups = new Map<string, typeof services>();
    for (const s of services) {
      const key = s.categoryName;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }
    return Array.from(groups.entries());
  }, [services]);

  const onSubmit = (data: FormValues) => {
    if (!selectedFactory) return;
    applyMutation.mutate({
      factoryId: selectedFactory.id,
      contactName: data.contactName,
      phone: data.phone,
      contactTime: data.contactTime,
      servicesWanted,
      isUnsure,
      additionalNotes: data.additionalNotes || undefined,
      consentAgreed: true,
    });
  };

  if (submitted) return <SuccessView />;
  if (loading || dataLoading || servicesLoading) return <AppLoading />;

  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <Helmet><title>ISO 與低碳認證免費初步諮詢｜OXM</title><meta name="robots" content="noindex, nofollow, noarchive, nosnippet" /></Helmet>
        <Navbar />
        <GateView
          icon={<LogIn className="w-8 h-8 text-emerald-600" />}
          title="請先登入"
          description="登入後，即可申請 ISO 與低碳認證免費初步諮詢服務。"
          actions={
            <>
              <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white border-0" onClick={() => setLoginOpen(true)}>
                <LogIn className="w-4 h-4 mr-2" />
                前往登入
              </Button>
              <Link href="/certification-center">
                <Button variant="outline" className="w-full">返回 ISO 與低碳認證專區</Button>
              </Link>
            </>
          }
        />
        <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} />
      </div>
    );
  }

  if (!hasAnyFactory && ownedFactory === null && coManaged !== undefined) {
    return (
      <div className="min-h-screen bg-background">
        <Helmet><title>ISO 與低碳認證免費初步諮詢｜OXM</title><meta name="robots" content="noindex, nofollow, noarchive, nosnippet" /></Helmet>
        <Navbar />
        <GateView
          icon={<Building2 className="w-8 h-8 text-emerald-600" />}
          title="請先上架您的工廠"
          description="請先在 OXM 平台上架工廠，通過審核後即可申請 ISO 與低碳認證免費初步諮詢。"
          actions={
            <>
              <Link href="/register-factory">
                <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white border-0">前往上架工廠</Button>
              </Link>
              <Link href="/certification-center">
                <Button variant="outline" className="w-full">返回 ISO 與低碳認證專區</Button>
              </Link>
            </>
          }
        />
      </div>
    );
  }

  if (eligibleFactories.length === 0 && anyFactoryStatus !== null) {
    const isPending = anyFactoryStatus === "pending";
    const isRejected = anyFactoryStatus === "rejected";
    const title = isPending ? "工廠審核中" : isRejected ? "工廠審核未通過" : "工廠資料尚未送審";
    const description = isPending
      ? "您的工廠資料正在審核中，通過後即可申請 ISO 與低碳認證免費初步諮詢。"
      : isRejected
      ? "請依退件原因修正工廠資料後重新送審，通過審核即可申請。"
      : "請先完成工廠資料並送出審核申請，通過後即可申請。";
    const StatusIcon = isPending ? Clock : isRejected ? XCircle : AlertCircle;
    const iconColor = isPending ? "text-yellow-500" : isRejected ? "text-red-500" : "text-emerald-600";

    return (
      <div className="min-h-screen bg-background">
        <Helmet><title>ISO 與低碳認證免費初步諮詢｜OXM</title><meta name="robots" content="noindex, nofollow, noarchive, nosnippet" /></Helmet>
        <Navbar />
        <GateView
          icon={<StatusIcon className={`w-8 h-8 ${iconColor}`} />}
          title={title}
          description={description}
          actions={
            <>
              <Link href="/dashboard">
                <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white border-0">
                  {isPending ? "查看工廠狀態" : "前往工廠後台"}
                </Button>
              </Link>
              <Link href="/certification-center">
                <Button variant="outline" className="w-full">返回 ISO 與低碳認證專區</Button>
              </Link>
            </>
          }
        />
      </div>
    );
  }

  if (eligibleFactories.length === 0) return <AppLoading />;

  if (selectedFactory && selectedOpenCase) {
    const statusLabel = CERTIFICATION_STATUS_LABELS[selectedOpenCase.status as keyof typeof CERTIFICATION_STATUS_LABELS] ?? selectedOpenCase.status;
    return (
      <div className="min-h-screen bg-background">
        <Helmet><title>ISO 與低碳認證免費初步諮詢｜OXM</title><meta name="robots" content="noindex, nofollow, noarchive, nosnippet" /></Helmet>
        <Navbar />
        <GateView
          icon={<CheckCircle2 className="w-8 h-8 text-green-500" />}
          title="您已送出 ISO 與低碳認證申請"
          description={`「${selectedFactory.name}」的申請已送出，目前狀態：${statusLabel}。顧問將主動與您聯繫。`}
          actions={
            <>
              {eligibleFactories.length > 1 && (
                <Button variant="outline" className="w-full" onClick={() => setSelectedFactoryId(null)}>選擇其他公司</Button>
              )}
              <Link href="/certification-center">
                <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white border-0">返回 ISO 與低碳認證專區</Button>
              </Link>
            </>
          }
        />
      </div>
    );
  }

  if (eligibleFactories.length > 1 && selectedFactoryId == null) {
    return (
      <div className="min-h-screen bg-background">
        <Helmet><title>ISO 與低碳認證免費初步諮詢｜OXM</title><meta name="robots" content="noindex, nofollow, noarchive, nosnippet" /></Helmet>
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
                  className="w-full text-left rounded-xl border border-border p-4 hover:border-emerald-400 hover:bg-emerald-50/50 transition-colors"
                >
                  <div className="font-semibold">{f.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{f.address}</div>
                  {openCase && (
                    <div className="text-xs text-emerald-600 mt-1">
                      目前狀態：{CERTIFICATION_STATUS_LABELS[openCase.status as keyof typeof CERTIFICATION_STATUS_LABELS] ?? openCase.status}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <Link href="/certification-center">
            <Button variant="outline" className="w-full">返回 ISO 與低碳認證專區</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!selectedFactory) return <AppLoading />;

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>ISO 與低碳認證免費初步諮詢｜OXM</title>
        <meta name="description" content="填寫聯絡資料與想了解的認證服務，OXM 合作顧問將為您安排免費初步諮詢。" />
        <meta name="robots" content="noindex, nofollow, noarchive, nosnippet" />
      </Helmet>
      <Navbar />

      <div className="container py-10 md:py-16 max-w-2xl mx-auto space-y-8">
        <button
          type="button"
          onClick={() => { if (window.history.length > 1) window.history.back(); else navigate("/certification-center"); }}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-sm"
          aria-label="返回 ISO 與低碳認證專區"
        >
          <ArrowLeft className="w-4 h-4" />
          返回 ISO 與低碳認證專區
        </button>

        <div className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-bold">ISO 與低碳認證免費初步諮詢</h1>
          <p className="text-muted-foreground">請填寫聯絡資料與想了解的認證服務，合作顧問將主動與您聯繫安排初次諮詢。</p>
        </div>

        {eligibleFactories.length > 1 && (
          <div className="space-y-2">
            <Label htmlFor="factorySelect">本次申請公司</Label>
            <Select value={String(selectedFactory.id)} onValueChange={(v) => setSelectedFactoryId(Number(v))}>
              <SelectTrigger id="factorySelect"><SelectValue /></SelectTrigger>
              <SelectContent>
                {eligibleFactories.map(f => (<SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>))}
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
              <Label htmlFor="contactName">聯絡人 <span className="text-destructive">*</span></Label>
              <Input id="contactName" placeholder="姓名" {...register("contactName", { required: "請填寫聯絡人姓名" })} />
              {errors.contactName && <p className="text-xs text-destructive">{errors.contactName.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">聯絡電話 <span className="text-destructive">*</span></Label>
              <Input
                id="phone" type="tel" placeholder="0912-345-678"
                {...register("phone", { required: "請填寫聯絡電話", pattern: { value: /^[\d\-+() ]{7,20}$/, message: "電話格式不正確" } })}
              />
              {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactTime">方便聯絡時間 <span className="text-destructive">*</span></Label>
              <Input id="contactTime" placeholder="例：平日上午 10:00-12:00" {...register("contactTime", { required: "請填寫方便聯絡時間" })} />
              {errors.contactTime && <p className="text-xs text-destructive">{errors.contactTime.message}</p>}
            </div>
          </fieldset>

          <fieldset className="space-y-4 rounded-xl border border-border p-6">
            <legend className="px-1 text-sm font-semibold text-muted-foreground">想了解的認證服務 <span className="text-destructive">*</span>（可複選）</legend>
            {servicesByCategory.map(([categoryName, items]) => (
              <div key={categoryName} className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">{categoryName}</p>
                <div className="grid sm:grid-cols-2 gap-2.5">
                  {items.map(s => (
                    <label key={s.code} className="flex items-center gap-2 text-sm rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/40">
                      <Checkbox checked={servicesWanted.includes(s.code)} onCheckedChange={() => toggleService(s.code)} disabled={isUnsure} />
                      {s.name}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <label className="flex items-center gap-2 text-sm rounded-lg border border-dashed border-border p-3 cursor-pointer hover:bg-muted/40">
              <Checkbox checked={isUnsure} onCheckedChange={(v) => toggleUnsure(v === true)} />
              不確定，希望由顧問協助判斷
            </label>
            {!servicesValid && <p className="text-xs text-destructive">請選擇至少一項認證服務，或勾選「不確定」</p>}
          </fieldset>

          <fieldset className="space-y-2 rounded-xl border border-border p-6">
            <legend className="px-1 text-sm font-semibold text-muted-foreground">想補充的需求（選填）</legend>
            <Textarea rows={4} placeholder="例如：目標認證時程、既有管理系統狀況等" {...register("additionalNotes")} />
          </fieldset>

          <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-4">
            <Checkbox id="agreeTerms" checked={agreeTerms} onCheckedChange={(checked) => setValue("agreeTerms", !!checked)} />
            <Label htmlFor="agreeTerms" className="font-normal leading-relaxed cursor-pointer text-sm">
              我同意 OXM 將上述資料提供給合作顧問，供免費初次諮詢與聯繫使用。
              <span className="text-destructive ml-1">*</span>
            </Label>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Link href="/certification-center">
              <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={applyMutation.isPending}>
                <ArrowLeft className="w-4 h-4 mr-2" />返回
              </Button>
            </Link>
            <Button
              type="submit"
              disabled={!agreeTerms || !servicesValid || applyMutation.isPending}
              className="w-full sm:flex-1 bg-emerald-600 hover:bg-emerald-700 text-white border-0"
            >
              {applyMutation.isPending ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />送出中...</>) : "送出諮詢申請"}
            </Button>
          </div>
          {(!agreeTerms || !servicesValid) && (
            <p className="text-xs text-muted-foreground text-center">請完成上方必填欄位並勾選同意條款後才能送出</p>
          )}
        </form>
      </div>
    </div>
  );
}
