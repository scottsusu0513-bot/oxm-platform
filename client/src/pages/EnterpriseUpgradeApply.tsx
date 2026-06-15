import { useState } from "react";
import { Link } from "wouter";
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
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ── 表單型別 ──────────────────────────────────────────────────────────────────

type FormValues = {
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
  city: string;
  capitalLevel: string;
  employeeCount: string;
  factoryType: string;
  hasGovProject: "yes" | "no";
  govProjectName: string;
  hasAward: "yes" | "no";
  awardName: string;
  hasPatent: "yes" | "no";
  patentCount: string;
  exportMode: string;
  notes: string;
  agreeTerms: boolean;
};

// ── 選項常數 ──────────────────────────────────────────────────────────────────

const CAPITAL_LEVEL_OPTIONS = [
  { value: "under_500w", label: "500 萬以下" },
  { value: "500w_1000w", label: "500 萬～1,000 萬" },
  { value: "1000w_5000w", label: "1,000 萬～5,000 萬" },
  { value: "5000w_1y", label: "5,000 萬～1 億" },
  { value: "over_1y", label: "1 億以上" },
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
  { value: "none", label: "無出口" },
  { value: "direct", label: "直接出口" },
  { value: "trader", label: "透過貿易商出口" },
  { value: "customer", label: "客戶代為出口" },
  { value: "multiple", label: "多種模式" },
];

// ── 成功畫面 ──────────────────────────────────────────────────────────────────

function SuccessView() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container py-24 flex flex-col items-center text-center space-y-6 max-w-md mx-auto">
        <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
        </div>
        <h1 className="text-2xl font-bold">評估資料已送出</h1>
        <p className="text-muted-foreground leading-relaxed">
          感謝您填寫評估表單，OXM 團隊將在 3～5 個工作天內與您聯繫，為您說明適合的補助計畫。
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

export default function EnterpriseUpgradeApply() {
  const [submitted, setSubmitted] = useState(false);

  const applyMutation = trpc.upgradeCenter.apply.useMutation({
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
      hasGovProject: "no",
      hasAward: "no",
      hasPatent: "no",
      agreeTerms: false,
    },
  });

  const hasGovProject = watch("hasGovProject");
  const hasAward = watch("hasAward");
  const hasPatent = watch("hasPatent");
  const agreeTerms = watch("agreeTerms");

  const onSubmit = (data: FormValues) => {
    applyMutation.mutate({
      companyName: data.companyName,
      contactName: data.contactName,
      phone: data.phone,
      email: data.email,
      location: data.city,
      capitalAmount: data.capitalLevel,
      employeeCount: data.employeeCount,
      factoryType: data.factoryType,
      hasGovernmentProject: data.hasGovProject === "yes",
      governmentProjectName: data.hasGovProject === "yes" ? data.govProjectName || undefined : undefined,
      hasGovernmentAward: data.hasAward === "yes",
      governmentAwardName: data.hasAward === "yes" ? data.awardName || undefined : undefined,
      hasPatent: data.hasPatent === "yes",
      patentCount: data.hasPatent === "yes" && data.patentCount ? parseInt(data.patentCount) || undefined : undefined,
      exportStatus: data.exportMode,
      notes: data.notes || undefined,
      consentAgreed: true,
    });
  };

  if (submitted) return <SuccessView />;

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>免費評估資格｜企業升級中心｜OXM</title>
        <meta
          name="description"
          content="填寫企業基本資料，OXM 協助評估適合的政府補助計畫，包含 SBIR、CITD、SIIR 等。"
        />
      </Helmet>

      <Navbar />

      <div className="container py-10 md:py-16 max-w-2xl mx-auto space-y-8">
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

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
          {/* ── 基本資料 ── */}
          <fieldset className="space-y-5 rounded-xl border border-border p-6">
            <legend className="px-1 text-sm font-semibold text-muted-foreground">基本資料</legend>

            <div className="space-y-2">
              <Label htmlFor="companyName">
                公司名稱 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="companyName"
                placeholder="例：台灣精密工業股份有限公司"
                {...register("companyName", { required: "請填寫公司名稱" })}
              />
              {errors.companyName && (
                <p className="text-xs text-destructive">{errors.companyName.message}</p>
              )}
            </div>

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
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">
                  Email <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="contact@company.com"
                  {...register("email", {
                    required: "請填寫 Email",
                    pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Email 格式不正確" },
                  })}
                />
                {errors.email && (
                  <p className="text-xs text-destructive">{errors.email.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="city">
                公司所在地 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="city"
                placeholder="例：台中市"
                {...register("city", { required: "請填寫公司所在地" })}
              />
              {errors.city && (
                <p className="text-xs text-destructive">{errors.city.message}</p>
              )}
            </div>
          </fieldset>

          {/* ── 企業規模 ── */}
          <fieldset className="space-y-5 rounded-xl border border-border p-6">
            <legend className="px-1 text-sm font-semibold text-muted-foreground">企業規模</legend>

            <div className="space-y-2">
              <Label htmlFor="capitalLevel">
                資本額 <span className="text-destructive">*</span>
              </Label>
              <Select onValueChange={(v) => setValue("capitalLevel", v)}>
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
              <input
                type="hidden"
                {...register("capitalLevel", { required: "請選擇資本額" })}
              />
              {errors.capitalLevel && (
                <p className="text-xs text-destructive">{errors.capitalLevel.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="employeeCount">
                員工人數 <span className="text-destructive">*</span>
              </Label>
              <Select onValueChange={(v) => setValue("employeeCount", v)}>
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
              <input
                type="hidden"
                {...register("employeeCount", { required: "請選擇員工人數" })}
              />
              {errors.employeeCount && (
                <p className="text-xs text-destructive">{errors.employeeCount.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="factoryType">
                工廠類型 <span className="text-destructive">*</span>
              </Label>
              <Select onValueChange={(v) => setValue("factoryType", v)}>
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
              <input
                type="hidden"
                {...register("factoryType", { required: "請選擇工廠類型" })}
              />
              {errors.factoryType && (
                <p className="text-xs text-destructive">{errors.factoryType.message}</p>
              )}
            </div>
          </fieldset>

          {/* ── 研發與獎項 ── */}
          <fieldset className="space-y-6 rounded-xl border border-border p-6">
            <legend className="px-1 text-sm font-semibold text-muted-foreground">研發與獎項</legend>

            {/* 政府計畫 */}
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
                  <Input
                    id="govProjectName"
                    placeholder="例：SBIR 小型企業創新研發計畫"
                    {...register("govProjectName")}
                  />
                </div>
              )}
            </div>

            {/* 政府獎項 */}
            <div className="space-y-3">
              <Label>是否曾獲政府獎項 <span className="text-destructive">*</span></Label>
              <RadioGroup
                defaultValue="no"
                onValueChange={(v) => setValue("hasAward", v as "yes" | "no")}
                className="flex gap-6"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="yes" id="award-yes" />
                  <Label htmlFor="award-yes" className="font-normal cursor-pointer">有</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="no" id="award-no" />
                  <Label htmlFor="award-no" className="font-normal cursor-pointer">沒有</Label>
                </div>
              </RadioGroup>
              {hasAward === "yes" && (
                <div className="pl-1 space-y-2">
                  <Label htmlFor="awardName">獎項名稱</Label>
                  <Input
                    id="awardName"
                    placeholder="例：台灣精品獎"
                    {...register("awardName")}
                  />
                </div>
              )}
            </div>

            {/* 專利 */}
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
                  <Input
                    id="patentCount"
                    type="number"
                    min={1}
                    placeholder="例：3"
                    {...register("patentCount")}
                  />
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
            <Select onValueChange={(v) => setValue("exportMode", v)}>
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
            <input
              type="hidden"
              {...register("exportMode", { required: "請選擇出口模式" })}
            />
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
          {!agreeTerms && errors.agreeTerms && (
            <p className="text-xs text-destructive -mt-6">{errors.agreeTerms.message}</p>
          )}

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
