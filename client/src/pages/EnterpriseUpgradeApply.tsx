import { useState, useEffect, useMemo } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import Navbar from "@/components/Navbar";
import LoginDialog from "@/components/LoginDialog";
import { ArrowLeft, CheckCircle2, Loader2, Building2, ExternalLink, LogIn, Clock, XCircle, AlertCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAiHandoff } from "@/hooks/useAiHandoff";
import { AiHandoffModal } from "@/components/ai/AiHandoffModal";

// ── 表單型別 ──────────────────────────────────────────────────────────────────

type FormValues = {
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
  city: string;
  capitalLevel: string;
  decisionMakerParticipation: "owner" | "manager" | "unavailable" | "";
  annualRevenue: string;
  employeeCount: string;
  factoryType: string;
  isEnterpriseFirm: "yes" | "no";
  hasGovProject: "yes" | "no";
  govProjectName: string;
  hasAppliedForSubsidy: "yes" | "no";
  hasPatent: "yes" | "no";
  patentCount: string;
  exportMode: string;
  notes: string;
  agreeTerms: boolean;
};

// ── 選項常數 ──────────────────────────────────────────────────────────────────

// Values match shared/constants.ts CAPITAL_OPTIONS so auto-fill from factory data works
const CAPITAL_LEVEL_OPTIONS = [
  { value: "100萬以下",    label: "100 萬以下" },
  { value: "100~500萬",   label: "100～500 萬" },
  { value: "500~2000萬",  label: "500～2,000 萬" },
  { value: "2000~5000萬", label: "2,000～5,000 萬" },
  { value: "5000萬以上",  label: "5,000 萬以上" },
];

// 決策者是否共同參與顧問洽談：值對應 drizzle/schema.ts
// upgradeApplications.decisionMakerParticipation 存的穩定英文 code，
// label 為使用者已核准文字，不得自行改寫。
const DECISION_MAKER_OPTIONS: { value: "owner" | "manager" | "unavailable"; label: string }[] = [
  { value: "owner", label: "可以，負責人將共同參與" },
  { value: "manager", label: "可以，由具決策權主管共同參與" },
  { value: "unavailable", label: "目前無法安排決策者參與" },
];

const ANNUAL_REVENUE_OPTIONS = [
  { value: "under_5m", label: "500 萬以下" },
  { value: "5m_to_10m", label: "500～1,000 萬" },
  { value: "over_10m", label: "1,000 萬以上" },
];

const EMPLOYEE_COUNT_OPTIONS = [
  { value: "1_5", label: "1～5 人" },
  { value: "6_30", label: "6～30 人" },
  { value: "31_100", label: "31～100 人" },
  { value: "101_300", label: "101～300 人" },
  { value: "over_300", label: "300 人以上" },
];

const FACTORY_TYPE_OPTIONS = [
  { value: "general", label: "一般工廠" },
  { value: "specific", label: "特定工廠登記" },
  { value: "managed", label: "納管工廠" },
  { value: "unregistered", label: "尚未登記" },
  { value: "unknown", label: "不確定" },
];

const EXPORT_MODE_OPTIONS = [
  { value: "direct_with_export_quote",   label: "直接出口（含出口報價單）" },
  { value: "indirect_trading_company",   label: "間接出口－透過貿易商" },
  { value: "indirect_distributor_agent", label: "間接出口－有經銷商／代理商" },
  { value: "no_export",                  label: "無出口" },
];

// ── 帶入提示 ──────────────────────────────────────────────────────────────────

function AutoFillHint({ factoryName, editable = true }: { factoryName: string; editable?: boolean }) {
  return (
    <p className="text-[11px] text-amber-600/80 dark:text-amber-400/70">
      已從 {factoryName} 工廠資料帶入{editable ? "，可修改" : ""}
    </p>
  );
}

// ── 門禁畫面 ──────────────────────────────────────────────────────────────────

function GateView({ icon, title, description, actions }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actions: React.ReactNode;
}) {
  return (
    <div className="container py-24 flex flex-col items-center text-center space-y-6 max-w-sm mx-auto">
      <div className="w-16 h-16 rounded-full bg-orange-50 dark:bg-orange-950/30 flex items-center justify-center">
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

// ── 成功畫面 ──────────────────────────────────────────────────────────────────

function SuccessView() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container py-24 flex flex-col items-center text-center space-y-6 max-w-md mx-auto">
        <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
        </div>
        <h1 className="text-2xl font-bold">已送出企業升級評估申請</h1>
        <p className="text-muted-foreground leading-relaxed">
          系統將依您的公司所在地區分派合作顧問，顧問查收案件後將主動與您聯繫。
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Link href="/upgrade-center">
            <Button variant="outline">
              <ArrowLeft className="w-4 h-4 mr-2" />
              返回企業升級中心
            </Button>
          </Link>
          <Link href="/">
            <Button className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0">
              返回首頁
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── 主頁面 ────────────────────────────────────────────────────────────────────

type ApprovedFactory = {
  id: number;
  name: string;
  region: string | null;
  contactEmail: string | null;
  phone: string | null;
  contactPersonName: string | null;
  capitalLevel: string | null;
};

export default function EnterpriseUpgradeApply() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();
  const [loginOpen, setLoginOpen] = useState(false);
  // 只有從 AI【幫你送出詢問】進來才會有值（URL ?aih= token）；一般入口
  // （/upgrade-center/apply 直接點進來）這個 hook 的所有欄位都是安全的空值，
  // 完全不影響一般入口行為（見「七、一般入口完全不能被改壞」）。
  const aiHandoff = useAiHandoff("gov_subsidy");

  // Factory queries — only when logged in
  const { data: ownedFactory, isLoading: ownedLoading } = trpc.factory.getMine.useQuery(undefined, {
    enabled: !!user,
  });
  const { data: coManaged, isLoading: coManagedLoading } = trpc.factory.getCoManagedFactories.useQuery(undefined, {
    enabled: !!user,
  });

  // 防重複送件：提前查詢是否已有進行中申請
  const { data: myProgressData, isLoading: myProgressLoading } = trpc.upgradeCenter.myApplicationProgress.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60_000,
  });
  const existingApplication = myProgressData?.applications?.[0] ?? null;

  const dataLoading = !!user && (ownedLoading || coManagedLoading || myProgressLoading);

  const [submitted, setSubmitted] = useState(false);

  const applyMutation = trpc.upgradeCenter.submitApplication.useMutation({
    onSuccess: () => setSubmitted(true),
    onError: (err) => {
      toast.error(err.message || "送出失敗，請稍後再試");
    },
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      isEnterpriseFirm: "no",
      hasGovProject: "no",
      hasAppliedForSubsidy: "no",
      hasPatent: "no",
      agreeTerms: false,
    },
  });

  // Find the single approved factory accessible by this user
  const approvedFactory = useMemo((): ApprovedFactory | null => {
    if (ownedFactory?.status === "approved") {
      return {
        id: ownedFactory.id,
        name: ownedFactory.name,
        region: ownedFactory.region ?? null,
        contactEmail: ownedFactory.contactEmail ?? null,
        phone: ownedFactory.phone ?? null,
        contactPersonName: ownedFactory.contactPersonName ?? null,
        capitalLevel: ownedFactory.capitalLevel ?? null,
      };
    }
    const approvedCo = coManaged?.find(f => f.status === "approved");
    if (approvedCo) {
      return {
        id: approvedCo.factoryId,
        name: approvedCo.name,
        region: approvedCo.region ?? null,
        contactEmail: approvedCo.contactEmail ?? null,
        phone: approvedCo.phone ?? null,
        contactPersonName: approvedCo.contactPersonName ?? null,
        capitalLevel: approvedCo.capitalLevel ?? null,
      };
    }
    return null;
  }, [ownedFactory, coManaged]);

  // Best factory status for error gate (any factory, not necessarily approved)
  const anyFactoryStatus: string | null = useMemo(() => {
    if (ownedFactory) return ownedFactory.status;
    if (coManaged && coManaged.length > 0) return coManaged[0].status;
    return null;
  }, [ownedFactory, coManaged]);

  const hasAnyFactory = ownedFactory !== undefined
    ? (ownedFactory !== null || (coManaged !== undefined && coManaged.length > 0))
    : false;

  // Auto-fill from approved factory (single effect, no switching)
  useEffect(() => {
    if (!approvedFactory) return;
    if (approvedFactory.name) setValue("companyName", approvedFactory.name);
    if (approvedFactory.contactPersonName) {
      setValue("contactName", approvedFactory.contactPersonName);
    } else if (user?.name) {
      setValue("contactName", user.name);
    }
    if (approvedFactory.phone) {
      setValue("phone", approvedFactory.phone);
    } else if ((user as any)?.phone) {
      setValue("phone", (user as any).phone);
    }
    const email = approvedFactory.contactEmail || user?.email || "";
    if (email) setValue("email", email);
    if (approvedFactory.region) setValue("city", approvedFactory.region);
    if (approvedFactory.capitalLevel) setValue("capitalLevel", approvedFactory.capitalLevel);
  }, [approvedFactory, user, setValue]);

  // AI handoff 預填：只填 AI 這次對話中使用者明確確認過的欄位（見
  // server/ai/handoffPrefill.ts 的白名單驗證），且刻意跟上面既有的工廠
  // autofill 完全不重疊欄位（公司名稱/聯絡人/電話/Email/地址/資本額仍然
  // 只由既有 autofill 邏輯處理，不重新從 AI handoff 複製一套，見對話中
  // 「十三」）。所有欄位使用者都可以再修改，AI 預填不是最終值。
  useEffect(() => {
    if (!aiHandoff.hasHandoff) return;
    const d = aiHandoff.prefillData;
    if (typeof d.decisionMakerParticipation === "string") {
      setValue("decisionMakerParticipation", d.decisionMakerParticipation as FormValues["decisionMakerParticipation"]);
    }
    if (typeof d.annualRevenue === "string") setValue("annualRevenue", d.annualRevenue);
    if (typeof d.employeeCount === "string") setValue("employeeCount", d.employeeCount);
    if (typeof d.factoryType === "string") setValue("factoryType", d.factoryType);
    if (typeof d.isEnterpriseFirm === "boolean") setValue("isEnterpriseFirm", d.isEnterpriseFirm ? "yes" : "no");
    if (typeof d.hasGovProject === "boolean") {
      setValue("hasGovProject", d.hasGovProject ? "yes" : "no");
      if (d.hasGovProject && typeof d.govProjectName === "string") setValue("govProjectName", d.govProjectName);
    }
    if (typeof d.hasAppliedForSubsidy === "boolean") setValue("hasAppliedForSubsidy", d.hasAppliedForSubsidy ? "yes" : "no");
    if (typeof d.hasPatent === "boolean") {
      setValue("hasPatent", d.hasPatent ? "yes" : "no");
      if (d.hasPatent && typeof d.patentCount === "number") setValue("patentCount", String(d.patentCount));
    }
    if (typeof d.exportMode === "string") setValue("exportMode", d.exportMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiHandoff.hasHandoff, aiHandoff.prefillData, setValue]);

  const hasGovProject = watch("hasGovProject");
  const hasAppliedForSubsidy = watch("hasAppliedForSubsidy");
  const hasPatent = watch("hasPatent");
  const agreeTerms = watch("agreeTerms");
  // Controlled Select values
  const decisionMakerParticipationValue = watch("decisionMakerParticipation") ?? "";
  const capitalLevelValue = watch("capitalLevel") ?? "";
  const annualRevenueValue = watch("annualRevenue") ?? "";
  const employeeCountValue = watch("employeeCount") ?? "";
  const factoryTypeValue = watch("factoryType") ?? "";
  const exportModeValue = watch("exportMode") ?? "";

  // Which fields were auto-filled (for hints)
  const autoFilled = useMemo(() => ({
    companyName: !!approvedFactory?.name,
    contactName: !!(approvedFactory?.contactPersonName || user?.name),
    phone: !!(approvedFactory?.phone || (user as any)?.phone),
    email: !!(approvedFactory?.contactEmail || user?.email),
    city: !!approvedFactory?.region,
    capitalLevel: !!approvedFactory?.capitalLevel,
  }), [approvedFactory, user]);

  const onSubmit = (data: FormValues) => {
    if (!approvedFactory) return;
    applyMutation.mutate({
      companyName: data.companyName,
      contactName: data.contactName,
      phone: data.phone,
      email: data.email,
      location: data.city,
      capitalAmount: data.capitalLevel,
      decisionMakerParticipation: data.decisionMakerParticipation as "owner" | "manager" | "unavailable",
      annualRevenue: data.annualRevenue,
      employeeCount: data.employeeCount,
      factoryType: data.factoryType,
      isEnterpriseFirm: data.isEnterpriseFirm === "yes",
      hasGovernmentProject: data.hasGovProject === "yes",
      governmentProjectName: data.hasGovProject === "yes" ? data.govProjectName || undefined : undefined,
      hasAppliedForGovernmentSubsidy: data.hasAppliedForSubsidy === "yes",
      hasPatent: data.hasPatent === "yes",
      patentCount: data.hasPatent === "yes" && data.patentCount ? parseInt(data.patentCount) || undefined : undefined,
      exportStatus: data.exportMode,
      notes: data.notes || undefined,
      consentAgreed: true,
      factoryId: approvedFactory.id,
      aiHandoffToken: aiHandoff.token ?? undefined,
    });
  };

  // ── 成功畫面 ──
  if (submitted) return <SuccessView />;

  // ── 載入中 ──
  if (loading || dataLoading) return <AppLoading />;

  // ── Gate 1: 未登入 ──
  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <Helmet><title>免費評估資格｜企業升級中心｜OXM</title></Helmet>
        <Navbar />
        <GateView
          icon={<LogIn className="w-8 h-8 text-orange-500" />}
          title="請先登入"
          description="登入後，即可申請企業升級評估服務。"
          actions={
            <>
              <Button
                className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0"
                onClick={() => setLoginOpen(true)}
              >
                <LogIn className="w-4 h-4 mr-2" />
                前往登入
              </Button>
              <Link href="/upgrade-center">
                <Button variant="outline" className="w-full">返回企業升級中心</Button>
              </Link>
            </>
          }
        />
        <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} />
      </div>
    );
  }

  // ── Gate 2: 沒有工廠 ──
  if (!hasAnyFactory && ownedFactory === null && coManaged !== undefined) {
    return (
      <div className="min-h-screen bg-background">
        <Helmet><title>免費評估資格｜企業升級中心｜OXM</title></Helmet>
        <Navbar />
        <GateView
          icon={<Building2 className="w-8 h-8 text-orange-500" />}
          title="請先上架您的工廠"
          description="請先在 OXM 平台上架工廠，通過審核後即可申請企業升級評估。"
          actions={
            <>
              <Link href="/register-factory">
                <Button className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0">
                  前往上架工廠
                </Button>
              </Link>
              <Link href="/upgrade-center">
                <Button variant="outline" className="w-full">返回企業升級中心</Button>
              </Link>
            </>
          }
        />
      </div>
    );
  }

  // ── Gate 3: 有工廠但未 approved ──
  if (!approvedFactory && anyFactoryStatus !== null) {
    const isDraft = anyFactoryStatus === "draft";
    const isPending = anyFactoryStatus === "pending";
    const isRejected = anyFactoryStatus === "rejected";

    const title = isPending
      ? "工廠審核中"
      : isRejected
      ? "工廠審核未通過"
      : "工廠資料尚未送審";

    const description = isPending
      ? "您的工廠資料正在審核中，通過後即可申請企業升級評估。"
      : isRejected
      ? "請依退件原因修正工廠資料後重新送審，通過審核即可申請企業升級評估。"
      : "請先完成工廠資料並送出審核申請，通過後即可申請企業升級評估。";

    const btnLabel = isPending ? "查看工廠狀態" : "前往工廠後台";

    const StatusIcon = isPending
      ? Clock
      : isRejected
      ? XCircle
      : AlertCircle;

    const iconColor = isPending
      ? "text-yellow-500"
      : isRejected
      ? "text-red-500"
      : "text-orange-500";

    return (
      <div className="min-h-screen bg-background">
        <Helmet><title>免費評估資格｜企業升級中心｜OXM</title></Helmet>
        <Navbar />
        <GateView
          icon={<StatusIcon className={`w-8 h-8 ${iconColor}`} />}
          title={title}
          description={description}
          actions={
            <>
              <Link href="/dashboard">
                <Button className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0">
                  {btnLabel}
                </Button>
              </Link>
              <Link href="/upgrade-center">
                <Button variant="outline" className="w-full">返回企業升級中心</Button>
              </Link>
            </>
          }
        />
      </div>
    );
  }

  // ── 仍在載入工廠資料時（edge case：user 存在但 queries 還沒完成） ──
  if (!approvedFactory) return <AppLoading />;

  // ── Gate 4: 已有進行中的申請，禁止重複送件 ──
  if (existingApplication) {
    const APPLY_STATUS_LABELS: Record<string, string> = {
      new: "等待顧問查收", evaluating: "顧問評估中", ineligible: "資格不符",
      accepted: "評估通過", submitted: "已送審", transforming: "補助核定",
      completed: "已完成", unassigned: "待分派", viewed: "顧問已查收",
      contacted: "已聯繫", consulting: "諮詢中",
      rejected: "未通過", qualification_failed: "資格不符",
    };
    const statusLabel = APPLY_STATUS_LABELS[existingApplication.status] ?? existingApplication.status;
    return (
      <div className="min-h-screen bg-background">
        <Helmet><title>免費評估資格｜企業升級中心｜OXM</title></Helmet>
        <Navbar />
        <GateView
          icon={<CheckCircle2 className="w-8 h-8 text-green-500" />}
          title="你已送出企業升級申請"
          description={`「${existingApplication.companyName}」的申請已送出，目前狀態：${statusLabel}。如需查看詳細進度，請至企業升級中心。`}
          actions={
            <>
              <Link href="/upgrade-center">
                <Button className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0">
                  查看目前進度
                </Button>
              </Link>
              <Link href="/upgrade-center">
                <Button variant="outline" className="w-full">返回企業升級中心</Button>
              </Link>
            </>
          }
        />
      </div>
    );
  }

  // ── 主表單 ──
  return (
    <div className="min-h-screen bg-background">
      <AiHandoffModal open={aiHandoff.showModal} onConfirm={aiHandoff.acknowledge} isConfirming={aiHandoff.isAcknowledging} />
      <Helmet>
        <title>免費評估資格｜企業升級中心｜OXM</title>
        <meta
          name="description"
          content="填寫企業基本資料，OXM 協助評估適合的政府補助計畫，包含 SBIR、CITD、SIIR 等。"
        />
      </Helmet>

      <Navbar />

      <div className="container py-10 md:py-16 max-w-2xl mx-auto space-y-8">
        {/* 返回按鈕 */}
        <button
          type="button"
          onClick={() => {
            if (window.history.length > 1) {
              window.history.back();
            } else {
              navigate("/upgrade-center");
            }
          }}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-sm"
          aria-label="返回企業升級中心"
        >
          <ArrowLeft className="w-4 h-4" />
          返回企業升級中心
        </button>

        {/* 麵包屑 */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/upgrade-center" className="hover:text-foreground transition-colors">
            企業升級中心
          </Link>
          <span>/</span>
          <span className="text-foreground">免費評估資格</span>
        </div>

        <div className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-bold">免費評估資格</h1>
          <p className="text-muted-foreground">
            請填寫以下資料，OXM 顧問將為您評估最適合的政府補助計畫。
          </p>
        </div>

        {/* ── 申請工廠來源（不可編輯） ── */}
        <div className="rounded-xl border border-orange-200 bg-orange-50/50 dark:border-orange-900/40 dark:bg-orange-950/20 px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="w-4 h-4 text-orange-500 shrink-0" />
            <span className="text-sm text-muted-foreground shrink-0">已綁定 OXM 工廠：</span>
            <span className="font-medium text-sm truncate">{approvedFactory.name}</span>
          </div>
          <a
            href={`/factory/${approvedFactory.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 shrink-0"
          >
            查看
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
          {/* ── 基本資料 ── */}
          <fieldset className="space-y-5 rounded-xl border border-border p-6">
            <legend className="px-1 text-sm font-semibold text-muted-foreground">基本資料</legend>

            {/* 公司名稱 */}
            <div className="space-y-2">
              <Label htmlFor="companyName">
                公司名稱 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="companyName"
                readOnly
                aria-disabled="true"
                className="bg-muted/60 cursor-not-allowed text-foreground/80 focus-visible:ring-0 focus-visible:ring-offset-0"
                {...register("companyName", { required: "請填寫公司名稱" })}
              />
              {errors.companyName && (
                <p className="text-xs text-destructive">{errors.companyName.message}</p>
              )}
              {autoFilled.companyName && <AutoFillHint factoryName={approvedFactory.name} editable={false} />}
            </div>

            {/* 聯絡人 */}
            <div className="space-y-2">
              <Label htmlFor="contactName">
                聯絡人 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="contactName"
                placeholder="姓名"
                {...register("contactName", { required: "請填寫聯絡人姓名" })}
              />
              {errors.contactName && (
                <p className="text-xs text-destructive">{errors.contactName.message}</p>
              )}
              {autoFilled.contactName && <AutoFillHint factoryName={approvedFactory.name} />}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* 電話 */}
              <div className="space-y-2">
                <Label htmlFor="phone">
                  電話 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="0912-345-678"
                  {...register("phone", {
                    required: "請填寫電話",
                    pattern: { value: /^[\d\-+() ]{7,20}$/, message: "電話格式不正確" },
                  })}
                />
                {errors.phone && (
                  <p className="text-xs text-destructive">{errors.phone.message}</p>
                )}
                {autoFilled.phone && <AutoFillHint factoryName={approvedFactory.name} />}
              </div>

              {/* Email */}
              <div className="space-y-2">
                <Label htmlFor="email">
                  Email <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="example@company.com"
                  {...register("email", {
                    required: "請填寫 Email",
                    pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Email 格式不正確" },
                  })}
                />
                {errors.email && (
                  <p className="text-xs text-destructive">{errors.email.message}</p>
                )}
                {autoFilled.email && <AutoFillHint factoryName={approvedFactory.name} />}
              </div>
            </div>

            {/* 公司所在地 */}
            <div className="space-y-2">
              <Label htmlFor="city">
                公司所在地 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="city"
                readOnly
                aria-disabled="true"
                className="bg-muted/60 cursor-not-allowed text-foreground/80 focus-visible:ring-0 focus-visible:ring-offset-0"
                {...register("city", { required: "請填寫公司所在地" })}
              />
              {errors.city && (
                <p className="text-xs text-destructive">{errors.city.message}</p>
              )}
              {autoFilled.city && <AutoFillHint factoryName={approvedFactory.name} editable={false} />}
            </div>
          </fieldset>

          {/* ── 顧問洽談安排 ── */}
          <fieldset className="space-y-3 rounded-xl border border-border p-6">
            <legend className="px-1 text-sm font-semibold text-muted-foreground">顧問洽談安排</legend>
            <Label>
              顧問洽談時，是否可安排公司決策者共同參與？ <span className="text-destructive">*</span>
            </Label>
            <RadioGroup
              value={decisionMakerParticipationValue}
              onValueChange={(v) => setValue("decisionMakerParticipation", v as "owner" | "manager" | "unavailable", { shouldValidate: true })}
              className="space-y-2"
            >
              {DECISION_MAKER_OPTIONS.map((opt) => (
                <div key={opt.value} className="flex items-center gap-2">
                  <RadioGroupItem value={opt.value} id={`decisionMaker-${opt.value}`} />
                  <Label htmlFor={`decisionMaker-${opt.value}`} className="font-normal cursor-pointer">
                    {opt.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            <input
              type="hidden"
              {...register("decisionMakerParticipation", { required: "請選擇顧問洽談時是否可安排公司決策者共同參與" })}
            />
            {errors.decisionMakerParticipation && (
              <p className="text-xs text-destructive">{errors.decisionMakerParticipation.message}</p>
            )}
          </fieldset>

          {/* ── 企業規模 ── */}
          <fieldset className="space-y-5 rounded-xl border border-border p-6">
            <legend className="px-1 text-sm font-semibold text-muted-foreground">企業規模</legend>

            {/* 資本額 */}
            <div className="space-y-2">
              <Label htmlFor="capitalLevel">
                資本額 <span className="text-destructive">*</span>
              </Label>
              <Select
                value={capitalLevelValue}
                onValueChange={(v) => setValue("capitalLevel", v)}
              >
                <SelectTrigger id="capitalLevel">
                  <SelectValue placeholder="請選擇資本額範圍" />
                </SelectTrigger>
                <SelectContent>
                  {CAPITAL_LEVEL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" {...register("capitalLevel", { required: "請選擇資本額" })} />
              {errors.capitalLevel && (
                <p className="text-xs text-destructive">{errors.capitalLevel.message}</p>
              )}
              {autoFilled.capitalLevel && <AutoFillHint factoryName={approvedFactory.name} />}
            </div>

            {/* 年營收 */}
            <div className="space-y-2">
              <Label htmlFor="annualRevenue">
                年營收 <span className="text-destructive">*</span>
              </Label>
              <Select
                value={annualRevenueValue}
                onValueChange={(v) => setValue("annualRevenue", v)}
              >
                <SelectTrigger id="annualRevenue">
                  <SelectValue placeholder="請選擇年營收範圍" />
                </SelectTrigger>
                <SelectContent>
                  {ANNUAL_REVENUE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" {...register("annualRevenue", { required: "請選擇年營收範圍" })} />
              {errors.annualRevenue && (
                <p className="text-xs text-destructive">{errors.annualRevenue.message}</p>
              )}
            </div>

            {/* 員工人數 */}
            <div className="space-y-2">
              <Label htmlFor="employeeCount">
                員工人數 <span className="text-destructive">*</span>
              </Label>
              <Select
                value={employeeCountValue}
                onValueChange={(v) => setValue("employeeCount", v)}
              >
                <SelectTrigger id="employeeCount">
                  <SelectValue placeholder="請選擇員工人數範圍" />
                </SelectTrigger>
                <SelectContent>
                  {EMPLOYEE_COUNT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" {...register("employeeCount", { required: "請選擇員工人數" })} />
              {errors.employeeCount && (
                <p className="text-xs text-destructive">{errors.employeeCount.message}</p>
              )}
            </div>

            {/* 工廠類型 */}
            <div className="space-y-2">
              <Label htmlFor="factoryType">
                工廠類型 <span className="text-destructive">*</span>
              </Label>
              <Select
                value={factoryTypeValue}
                onValueChange={(v) => setValue("factoryType", v)}
              >
                <SelectTrigger id="factoryType">
                  <SelectValue placeholder="請選擇工廠類型" />
                </SelectTrigger>
                <SelectContent>
                  {FACTORY_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" {...register("factoryType", { required: "請選擇工廠類型" })} />
              {errors.factoryType && (
                <p className="text-xs text-destructive">{errors.factoryType.message}</p>
              )}
            </div>

            {/* 是否為企業社 */}
            <div className="space-y-3">
              <Label>是否為企業社 <span className="text-destructive">*</span></Label>
              <RadioGroup
                defaultValue="no"
                onValueChange={(v) => setValue("isEnterpriseFirm", v as "yes" | "no")}
                className="flex gap-6"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="yes" id="enterpriseFirm-yes" />
                  <Label htmlFor="enterpriseFirm-yes" className="font-normal cursor-pointer">是</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="no" id="enterpriseFirm-no" />
                  <Label htmlFor="enterpriseFirm-no" className="font-normal cursor-pointer">否</Label>
                </div>
              </RadioGroup>
            </div>
          </fieldset>

          {/* ── 研發與補助 ── */}
          <fieldset className="space-y-6 rounded-xl border border-border p-6">
            <legend className="px-1 text-sm font-semibold text-muted-foreground">研發與補助</legend>

            <div className="space-y-3">
              <Label>是否曾申請過政府補助 <span className="text-destructive">*</span></Label>
              <RadioGroup
                defaultValue="no"
                onValueChange={(v) => setValue("hasAppliedForSubsidy", v as "yes" | "no")}
                className="flex gap-6"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="yes" id="appliedForSubsidy-yes" />
                  <Label htmlFor="appliedForSubsidy-yes" className="font-normal cursor-pointer">有</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="no" id="appliedForSubsidy-no" />
                  <Label htmlFor="appliedForSubsidy-no" className="font-normal cursor-pointer">沒有</Label>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-3">
              <Label>是否曾執行政府計畫 <span className="text-destructive">*</span></Label>
              <RadioGroup
                defaultValue="no"
                onValueChange={(v) => setValue("hasGovProject", v as "yes" | "no")}
                className="flex gap-6"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="yes" id="govProject-yes" />
                  <Label htmlFor="govProject-yes" className="font-normal cursor-pointer">有</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="no" id="govProject-no" />
                  <Label htmlFor="govProject-no" className="font-normal cursor-pointer">沒有</Label>
                </div>
              </RadioGroup>
              {hasGovProject === "yes" && (
                <div className="pl-1 space-y-2">
                  <Label htmlFor="govProjectName">計畫名稱</Label>
                  <Input id="govProjectName" placeholder="例：SBIR 小型企業創新研發計畫" {...register("govProjectName")} />
                </div>
              )}
            </div>

            <div className="space-y-3">
              <Label>是否持有專利 <span className="text-destructive">*</span></Label>
              <RadioGroup
                defaultValue="no"
                onValueChange={(v) => setValue("hasPatent", v as "yes" | "no")}
                className="flex gap-6"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="yes" id="patent-yes" />
                  <Label htmlFor="patent-yes" className="font-normal cursor-pointer">有</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="no" id="patent-no" />
                  <Label htmlFor="patent-no" className="font-normal cursor-pointer">沒有</Label>
                </div>
              </RadioGroup>
              {hasPatent === "yes" && (
                <div className="pl-1 space-y-2">
                  <Label htmlFor="patentCount">專利數量</Label>
                  <Input id="patentCount" type="number" min={1} placeholder="例：3" {...register("patentCount")} />
                </div>
              )}
            </div>
          </fieldset>

          {/* ── 出口模式 ── */}
          <fieldset className="space-y-3 rounded-xl border border-border p-6">
            <legend className="px-1 text-sm font-semibold text-muted-foreground">出口模式</legend>
            <Label htmlFor="exportMode">
              產品是否出口 <span className="text-destructive">*</span>
            </Label>
            <Select
              value={exportModeValue}
              onValueChange={(v) => setValue("exportMode", v)}
            >
              <SelectTrigger id="exportMode">
                <SelectValue placeholder="請選擇出口模式" />
              </SelectTrigger>
              <SelectContent>
                {EXPORT_MODE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" {...register("exportMode", { required: "請選擇出口模式" })} />
            {errors.exportMode && (
              <p className="text-xs text-destructive">{errors.exportMode.message}</p>
            )}
          </fieldset>

          {/* ── 補充說明 ── */}
          <div className="space-y-2">
            <Label htmlFor="notes">補充說明</Label>
            <Textarea
              id="notes"
              rows={4}
              placeholder="可補充企業現況、主要產品、目前遇到的挑戰或其他希望了解的補助方向..."
              {...register("notes")}
            />
          </div>

          {/* ── 同意條款 ── */}
          <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-4">
            <Checkbox
              id="agreeTerms"
              checked={agreeTerms}
              onCheckedChange={(checked) => setValue("agreeTerms", !!checked)}
            />
            <Label htmlFor="agreeTerms" className="font-normal leading-relaxed cursor-pointer text-sm">
              我同意 OXM 將本次資料提供給合作顧問進行評估與聯繫
              <span className="text-destructive ml-1">*</span>
            </Label>
          </div>

          {/* ── 送出 ── */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Link href="/upgrade-center">
              <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={applyMutation.isPending}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                返回
              </Button>
            </Link>
            <Button
              type="submit"
              disabled={!agreeTerms || applyMutation.isPending}
              className="w-full sm:flex-1 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0"
            >
              {applyMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  送出中...
                </>
              ) : "送出評估申請"}
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
