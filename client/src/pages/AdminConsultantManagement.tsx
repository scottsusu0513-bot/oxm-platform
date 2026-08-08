import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { trpc } from "@/lib/trpc";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Users, Plus, Mail, Search, X } from "lucide-react";
import { SHORT_VIDEO_SERVICES } from "@shared/shortVideoMarketing";
import { ERP_NEED_TYPES } from "@shared/erpOptimization";

// ── 共用型別與呈現元件 ────────────────────────────────────────────────────────
// 五種顧問各自的底層資料表（upgradeConsultants／financeConsultants／
// certificationConsultants／erpConsultants／shortVideoConsultants）不合併，
// 這裡只是統一管理介面，沿用各自既有的 admin tRPC procedure。

type BoundUserInfo = { id: number; name: string | null; email: string | null; createdAt: string | Date } | null;

type ConsultantRowData = {
  id: number;
  name: string;
  userId: number | null;
  isActive: boolean;
  boundUser?: BoundUserInfo;
};

const REGION_LABELS: Record<string, string> = { north: "北部", central: "中部", south: "南部" };

function fmtDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" });
}

type UserSearchResult = { id: number; name: string | null; email: string | null };

// 綁定顧問用的使用者搜尋——沿用既有 admin.getUsers（admin-only、支援
// email／名稱搜尋、已分頁），不新增後端 procedure。前端只取顯示綁定
// 必要的最少欄位（id／name／email），不把 admin.getUsers 回傳的其餘欄位
// （工廠、驗證狀態等）帶進這個下拉選單。
function UserSearchSelect({
  onSelect, disabled,
}: { onSelect: (user: UserSearchResult) => void; disabled?: boolean }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const trimmed = query.trim();
  const searchQuery = trpc.admin.getUsers.useQuery(
    { search: trimmed, page: 1, pageSize: 8 },
    { enabled: trimmed.length >= 2 },
  );
  const results: UserSearchResult[] = (searchQuery.data?.items ?? []).map((u: any) => ({
    id: u.id, name: u.name, email: u.primaryEmail ?? u.email ?? null,
  }));

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          className="h-8 text-xs pl-7"
          placeholder="輸入使用者 Email 或名稱搜尋（至少 2 個字）"
          value={query}
          disabled={disabled}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
      </div>
      {open && trimmed.length >= 2 && (
        <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md max-h-56 overflow-y-auto">
          {searchQuery.isFetching ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">搜尋中…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">查無符合的使用者</p>
          ) : (
            results.map(u => (
              <button
                key={u.id}
                type="button"
                className="w-full text-left px-3 py-2 text-xs hover:bg-muted border-b border-border/50 last:border-b-0"
                onMouseDown={(e) => { e.preventDefault(); onSelect(u); setQuery(""); setOpen(false); }}
              >
                <p className="font-medium">{u.name ?? "未提供名稱"}</p>
                <p className="text-muted-foreground break-all">{u.email ?? "—"}</p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function BindControl({
  consultant, onBind, pending,
}: { consultant: ConsultantRowData; onBind: (userId: number | null) => void; pending: boolean }) {
  const [pendingUser, setPendingUser] = useState<UserSearchResult | null>(null);

  if (consultant.userId != null) {
    return (
      <div className="space-y-1.5">
        <div className="text-xs text-muted-foreground space-y-0.5">
          {consultant.boundUser ? (
            <div className="pl-2 border-l-2 border-muted ml-1 space-y-0.5">
              <p>使用者名稱：{consultant.boundUser.name ?? "未提供名稱"}</p>
              <p className="break-all flex items-center gap-1"><Mail className="w-3 h-3 shrink-0" />{consultant.boundUser.email ?? "—"}</p>
              <p>建立時間：{fmtDate(consultant.boundUser.createdAt)}</p>
            </div>
          ) : (
            <p className="text-amber-600">查無此使用者資料（userId {consultant.userId}）</p>
          )}
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={pending} onClick={() => onBind(null)}>
          解除綁定
        </Button>
      </div>
    );
  }

  if (pendingUser) {
    return (
      <div className="rounded-md border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 p-2.5 space-y-2">
        <p className="text-xs">
          即將綁定：<span className="font-medium">{pendingUser.name ?? "未提供名稱"}</span>
          <span className="text-muted-foreground">（{pendingUser.email ?? "—"}）</span>
        </p>
        <div className="flex gap-2">
          <Button size="sm" className="h-7 text-xs" disabled={pending} onClick={() => { onBind(pendingUser.id); setPendingUser(null); }}>
            確認綁定
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setPendingUser(null)}>
            <X className="w-3 h-3" />取消
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">目前尚未綁定使用者</p>
      <UserSearchSelect disabled={pending} onSelect={setPendingUser} />
    </div>
  );
}

function ConsultantCard({
  consultant, extra, onBind, bindPending, onToggleActive, togglePending,
}: {
  consultant: ConsultantRowData;
  extra?: React.ReactNode;
  onBind: (userId: number | null) => void;
  bindPending: boolean;
  onToggleActive?: (next: boolean) => void;
  togglePending?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <Users className="w-4 h-4 text-muted-foreground shrink-0" />
          <p className="font-medium text-sm truncate">{consultant.name}</p>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {onToggleActive ? (
              <div className="flex items-center gap-1.5">
                <Switch checked={consultant.isActive} disabled={togglePending} onCheckedChange={onToggleActive} />
                <span className="text-xs text-muted-foreground">{consultant.isActive ? "啟用中" : "已停用"}</span>
              </div>
            ) : (
              <Badge variant={consultant.isActive ? "default" : "secondary"}>{consultant.isActive ? "啟用" : "停用"}</Badge>
            )}
          </div>
        </div>
        {extra}
        <BindControl consultant={consultant} onBind={onBind} pending={bindPending} />
      </CardContent>
    </Card>
  );
}

function CreateConsultantForm({
  onCreate, pending, areaOptions,
}: {
  onCreate: (name: string, serviceAreas: string[]) => void;
  pending: boolean;
  areaOptions?: { key: string; label: string }[];
}) {
  const [name, setName] = useState("");
  const [areas, setAreas] = useState<string[]>([]);

  return (
    <Card className="border-dashed">
      <CardContent className="p-4 space-y-3">
        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" />新增顧問</p>
        <Input
          className="h-8 text-xs"
          placeholder="顧問名稱"
          value={name}
          onChange={e => setName(e.target.value)}
        />
        {areaOptions && areaOptions.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">可承接範圍（未勾選＝全部皆可承接）</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {areaOptions.map(opt => (
                <label key={opt.key} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <Checkbox
                    checked={areas.includes(opt.key)}
                    onCheckedChange={(checked) => {
                      setAreas(prev => checked ? [...prev, opt.key] : prev.filter(a => a !== opt.key));
                    }}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        )}
        <Button
          size="sm"
          className="h-8 text-xs"
          disabled={pending || !name.trim()}
          onClick={() => {
            onCreate(name.trim(), areas);
            setName("");
            setAreas([]);
          }}
        >
          新增
        </Button>
      </CardContent>
    </Card>
  );
}

// ── 政府補助顧問（regionKey 固定北中南三席、UNIQUE，不可新增／刪除席位；
// 啟停用與綁定／解除綁定則與其他四種顧問一致，皆可從這裡完整管理） ──────────

function UpgradeConsultantSection() {
  const utils = trpc.useUtils();
  const listQuery = trpc.upgradeConsultant.adminListConsultants.useQuery();
  const bindMutation = trpc.upgradeConsultant.adminBindUser.useMutation({
    onSuccess: (data) => {
      utils.upgradeConsultant.adminListConsultants.invalidate();
      const count = data.backfilledCount ?? 0;
      toast.success(count > 0 ? `已綁定，並自動補派 ${count} 筆待分派案件` : "已更新綁定");
    },
    onError: (err) => toast.error(err.message || "操作失敗"),
  });
  const toggleMutation = trpc.upgradeConsultant.adminSetActive.useMutation({
    onSuccess: () => { utils.upgradeConsultant.adminListConsultants.invalidate(); toast.success("已更新啟用狀態"); },
    onError: (err) => toast.error(err.message || "操作失敗"),
  });

  if (listQuery.isLoading) return <AppLoading />;
  const consultants = listQuery.data ?? [];

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        北中南三個地區席位由系統固定建立（regionKey 為 UNIQUE），無法新增或刪除席位本身；
        綁定／解除綁定使用者、啟用／停用皆可在此完整操作，不需要回舊頁。
      </p>
      {consultants.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">尚無顧問資料</p>
      ) : (
        consultants.map(c => (
          <ConsultantCard
            key={c.id}
            consultant={c}
            extra={
              <div className="text-xs text-muted-foreground space-y-1">
                <p>地區：{REGION_LABELS[c.regionKey] ?? c.regionKey}</p>
                <p>服務縣市：{(c.serviceAreas as string[]).join("、") || "（未設定）"}</p>
              </div>
            }
            onBind={(userId) => bindMutation.mutate({ consultantId: c.id, userId })}
            bindPending={bindMutation.isPending}
            onToggleActive={(next) => toggleMutation.mutate({ consultantId: c.id, isActive: next })}
            togglePending={toggleMutation.isPending}
          />
        ))
      )}
    </div>
  );
}

// ── 企業財務優化顧問（無 serviceAreas，其餘四個功能齊全） ──────────────────────

function FinanceConsultantSection() {
  const utils = trpc.useUtils();
  const listQuery = trpc.financeConsultant.adminListConsultants.useQuery();
  const bindMutation = trpc.financeConsultant.adminBindUser.useMutation({
    onSuccess: () => { utils.financeConsultant.adminListConsultants.invalidate(); toast.success("已更新綁定"); },
    onError: (err) => toast.error(err.message || "操作失敗"),
  });
  const toggleMutation = trpc.financeConsultant.adminSetActive.useMutation({
    onSuccess: () => { utils.financeConsultant.adminListConsultants.invalidate(); toast.success("已更新啟用狀態"); },
    onError: (err) => toast.error(err.message || "操作失敗"),
  });
  const createMutation = trpc.financeConsultant.adminCreateConsultant.useMutation({
    onSuccess: () => { utils.financeConsultant.adminListConsultants.invalidate(); toast.success("已新增顧問"); },
    onError: (err) => toast.error(err.message || "新增失敗"),
  });

  if (listQuery.isLoading) return <AppLoading />;
  const consultants = listQuery.data ?? [];

  return (
    <div className="space-y-4">
      <CreateConsultantForm onCreate={(name) => createMutation.mutate({ name })} pending={createMutation.isPending} />
      {consultants.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">尚無顧問資料</p>
      ) : (
        consultants.map(c => (
          <ConsultantCard
            key={c.id}
            consultant={c}
            onBind={(userId) => bindMutation.mutate({ consultantId: c.id, userId })}
            bindPending={bindMutation.isPending}
            onToggleActive={(next) => toggleMutation.mutate({ consultantId: c.id, isActive: next })}
            togglePending={toggleMutation.isPending}
          />
        ))
      )}
    </div>
  );
}

// ── ISO／低碳認證顧問（serviceAreas＝服務目錄 code，動態拉取上架服務清單） ──────

function CertificationConsultantSection() {
  const utils = trpc.useUtils();
  const listQuery = trpc.certificationConsultant.adminListConsultants.useQuery();
  const { data: services = [] } = trpc.certificationCenter.listServices.useQuery();
  const areaOptions = services.map(s => ({ key: s.code, label: s.name }));

  const bindMutation = trpc.certificationConsultant.adminBindUser.useMutation({
    onSuccess: () => { utils.certificationConsultant.adminListConsultants.invalidate(); toast.success("已更新綁定"); },
    onError: (err) => toast.error(err.message || "操作失敗"),
  });
  const toggleMutation = trpc.certificationConsultant.adminSetActive.useMutation({
    onSuccess: () => { utils.certificationConsultant.adminListConsultants.invalidate(); toast.success("已更新啟用狀態"); },
    onError: (err) => toast.error(err.message || "操作失敗"),
  });
  const createMutation = trpc.certificationConsultant.adminCreateConsultant.useMutation({
    onSuccess: () => { utils.certificationConsultant.adminListConsultants.invalidate(); toast.success("已新增顧問"); },
    onError: (err) => toast.error(err.message || "新增失敗"),
  });

  if (listQuery.isLoading) return <AppLoading />;
  const consultants = listQuery.data ?? [];
  const serviceNameByCode = new Map(services.map(s => [s.code, s.name]));

  return (
    <div className="space-y-4">
      <CreateConsultantForm
        onCreate={(name, areas) => createMutation.mutate({ name, serviceAreas: areas })}
        pending={createMutation.isPending}
        areaOptions={areaOptions}
      />
      {consultants.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">尚無顧問資料</p>
      ) : (
        consultants.map(c => (
          <ConsultantCard
            key={c.id}
            consultant={c}
            extra={
              <p className="text-xs text-muted-foreground">
                可承接服務：{(c.serviceAreas as string[]).length === 0
                  ? "全部服務"
                  : (c.serviceAreas as string[]).map(code => serviceNameByCode.get(code) ?? code).join("、")}
              </p>
            }
            onBind={(userId) => bindMutation.mutate({ consultantId: c.id, userId })}
            bindPending={bindMutation.isPending}
            onToggleActive={(next) => toggleMutation.mutate({ consultantId: c.id, isActive: next })}
            togglePending={toggleMutation.isPending}
          />
        ))
      )}
    </div>
  );
}

// ── ERP／產線優化顧問（serviceAreas＝ERP_NEED_TYPE_KEYS） ───────────────────────

function ErpConsultantSection() {
  const utils = trpc.useUtils();
  const listQuery = trpc.erpConsultant.adminListConsultants.useQuery();
  const areaOptions = ERP_NEED_TYPES.map(t => ({ key: t.key, label: t.label }));

  const bindMutation = trpc.erpConsultant.adminBindUser.useMutation({
    onSuccess: () => { utils.erpConsultant.adminListConsultants.invalidate(); toast.success("已更新綁定"); },
    onError: (err) => toast.error(err.message || "操作失敗"),
  });
  const toggleMutation = trpc.erpConsultant.adminSetActive.useMutation({
    onSuccess: () => { utils.erpConsultant.adminListConsultants.invalidate(); toast.success("已更新啟用狀態"); },
    onError: (err) => toast.error(err.message || "操作失敗"),
  });
  const createMutation = trpc.erpConsultant.adminCreateConsultant.useMutation({
    onSuccess: () => { utils.erpConsultant.adminListConsultants.invalidate(); toast.success("已新增顧問"); },
    onError: (err) => toast.error(err.message || "新增失敗"),
  });

  if (listQuery.isLoading) return <AppLoading />;
  const consultants = listQuery.data ?? [];
  const labelByKey = new Map<string, string>(ERP_NEED_TYPES.map(t => [t.key, t.label]));

  return (
    <div className="space-y-4">
      <CreateConsultantForm
        onCreate={(name, areas) => createMutation.mutate({ name, serviceAreas: areas as any })}
        pending={createMutation.isPending}
        areaOptions={areaOptions}
      />
      {consultants.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">尚無顧問資料</p>
      ) : (
        consultants.map(c => (
          <ConsultantCard
            key={c.id}
            consultant={c}
            extra={
              <p className="text-xs text-muted-foreground">
                可承接需求：{(c.serviceAreas as string[]).length === 0
                  ? "全部需求類型"
                  : (c.serviceAreas as string[]).map(k => labelByKey.get(k) ?? k).join("、")}
              </p>
            }
            onBind={(userId) => bindMutation.mutate({ consultantId: c.id, userId })}
            bindPending={bindMutation.isPending}
            onToggleActive={(next) => toggleMutation.mutate({ consultantId: c.id, isActive: next })}
            togglePending={toggleMutation.isPending}
          />
        ))
      )}
    </div>
  );
}

// ── 短影音／品牌內容顧問（serviceAreas＝SHORT_VIDEO_SERVICE_KEYS） ──────────────

function ShortVideoConsultantSection() {
  const utils = trpc.useUtils();
  const listQuery = trpc.shortVideoConsultant.adminListConsultants.useQuery();
  const areaOptions = SHORT_VIDEO_SERVICES.map(s => ({ key: s.key, label: s.shortLabel }));

  const bindMutation = trpc.shortVideoConsultant.adminBindUser.useMutation({
    onSuccess: () => { utils.shortVideoConsultant.adminListConsultants.invalidate(); toast.success("已更新綁定"); },
    onError: (err) => toast.error(err.message || "操作失敗"),
  });
  const toggleMutation = trpc.shortVideoConsultant.adminSetActive.useMutation({
    onSuccess: () => { utils.shortVideoConsultant.adminListConsultants.invalidate(); toast.success("已更新啟用狀態"); },
    onError: (err) => toast.error(err.message || "操作失敗"),
  });
  const createMutation = trpc.shortVideoConsultant.adminCreateConsultant.useMutation({
    onSuccess: () => { utils.shortVideoConsultant.adminListConsultants.invalidate(); toast.success("已新增顧問"); },
    onError: (err) => toast.error(err.message || "新增失敗"),
  });

  if (listQuery.isLoading) return <AppLoading />;
  const consultants = listQuery.data ?? [];
  const labelByKey = new Map<string, string>(SHORT_VIDEO_SERVICES.map(s => [s.key, s.shortLabel]));

  return (
    <div className="space-y-4">
      <CreateConsultantForm
        onCreate={(name, areas) => createMutation.mutate({ name, serviceAreas: areas as any })}
        pending={createMutation.isPending}
        areaOptions={areaOptions}
      />
      {consultants.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">尚無顧問資料</p>
      ) : (
        consultants.map(c => (
          <ConsultantCard
            key={c.id}
            consultant={c}
            extra={
              <p className="text-xs text-muted-foreground">
                可承接服務：{(c.serviceAreas as string[]).length === 0
                  ? "全部服務"
                  : (c.serviceAreas as string[]).map(k => labelByKey.get(k) ?? k).join("、")}
              </p>
            }
            onBind={(userId) => bindMutation.mutate({ consultantId: c.id, userId })}
            bindPending={bindMutation.isPending}
            onToggleActive={(next) => toggleMutation.mutate({ consultantId: c.id, isActive: next })}
            togglePending={toggleMutation.isPending}
          />
        ))
      )}
    </div>
  );
}

// ── 主頁面 ────────────────────────────────────────────────────────────────────

export default function AdminConsultantManagement() {
  const { user, loading } = useAuth();
  if (loading) return <AppLoading />;
  if (!user || user.role !== "admin") {
    return <div className="flex items-center justify-center min-h-screen text-muted-foreground">無權限</div>;
  }
  return <AdminConsultantManagementContent />;
}

function AdminConsultantManagementContent() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container py-8 max-w-3xl mx-auto space-y-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <FloatingBackButton fallbackHref="/admin" label="後台" />
            <h1 className="text-xl font-bold">顧問管理</h1>
          </div>
          <p className="text-xs text-muted-foreground ml-1">統一管理所有服務的顧問帳號綁定、啟用狀態與新增，各服務案件的承辦／派案仍在各自案件管理頁操作。</p>
        </div>

        <Tabs defaultValue="upgrade">
          <TabsList className="flex flex-wrap h-auto gap-1 w-full justify-start">
            <TabsTrigger value="upgrade" className="text-xs whitespace-nowrap">政府補助顧問</TabsTrigger>
            <TabsTrigger value="finance" className="text-xs whitespace-nowrap">企業財務優化顧問</TabsTrigger>
            <TabsTrigger value="certification" className="text-xs whitespace-nowrap">ISO／低碳認證顧問</TabsTrigger>
            <TabsTrigger value="erp" className="text-xs whitespace-nowrap">ERP／產線優化顧問</TabsTrigger>
            <TabsTrigger value="shortVideo" className="text-xs whitespace-nowrap">短影音／品牌內容顧問</TabsTrigger>
          </TabsList>

          <TabsContent value="upgrade" className="mt-4"><UpgradeConsultantSection /></TabsContent>
          <TabsContent value="finance" className="mt-4"><FinanceConsultantSection /></TabsContent>
          <TabsContent value="certification" className="mt-4"><CertificationConsultantSection /></TabsContent>
          <TabsContent value="erp" className="mt-4"><ErpConsultantSection /></TabsContent>
          <TabsContent value="shortVideo" className="mt-4"><ShortVideoConsultantSection /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
