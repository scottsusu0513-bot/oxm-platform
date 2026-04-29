import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronDown } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { INDUSTRIES, INDUSTRY_OPTIONS, TAIWAN_REGIONS, CAPITAL_OPTIONS, MFG_MODE_OPTIONS } from "@shared/constants";
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Factory, ArrowLeft, AlertCircle, Camera, X, Wrench } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

type BusinessType = "factory" | "studio";

type FormErrors = {
  name?: string;
  industry?: string;
  mfgModes?: string;
  region?: string;
  capitalLevel?: string;
  address?: string;
  foundedYear?: string;
};

export default function FactoryRegister() {
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [formStarted, setFormStarted] = useState(false);
  const [businessType, setBusinessType] = useState<BusinessType>("factory");
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const { data: existingFactory, isLoading: factoryLoading } = trpc.factory.getMine.useQuery(undefined, { enabled: isAuthenticated });

  const [name, setName] = useState("");
  const [industry, setIndustry] = useState<string[]>([]);
  const [subIndustry, setSubIndustry] = useState<string[]>([]);
  const [mfgModes, setMfgModes] = useState<string[]>([]);
  const [region, setRegion] = useState("");
  const [description, setDescription] = useState("");
  const [capitalLevel, setCapitalLevel] = useState("");
  const [foundedYear, setFoundedYear] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [contactEmail, setContactEmail] = useState(user?.email ?? "");
  const [address, setAddress] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarBase64, setAvatarBase64] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});

  // 根據類型動態顯示文字
  const typeLabel = businessType === "factory" ? "代工廠" : "工作室";
  const namePlaceholder = businessType === "factory" ? "請輸入工廠名稱" : "請輸入工作室名稱";
  const descPlaceholder = businessType === "factory" ? "介紹您的代工廠服務、專長與設備..." : "介紹您的工作室服務、風格與專長...";

  const createFactoryMut = trpc.factory.create.useMutation();
  const uploadAvatarMut = trpc.factory.uploadAvatar.useMutation();

  const toggleMode = (mode: string) => {
    setMfgModes(prev => prev.includes(mode) ? prev.filter(m => m !== mode) : [...prev, mode]);
    if (errors.mfgModes) setErrors(prev => ({ ...prev, mfgModes: undefined }));
  };

  const handleYearChange = (val: string) => {
    const cleaned = val.replace(/\D/g, "").slice(0, 4);
    setFoundedYear(cleaned);
    if (errors.foundedYear) setErrors(prev => ({ ...prev, foundedYear: undefined }));
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("圖片大小不能超過 5MB"); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string;
      setAvatarPreview(base64);
      setAvatarBase64(base64);
    };
    reader.readAsDataURL(file);
  };

  const validate = (): boolean => {
    const newErrors: FormErrors = {};
    if (!name.trim()) newErrors.name = `請輸入${typeLabel}名稱`;
    if (industry.length === 0) newErrors.industry = "請至少選擇一個產業分類";
    if (mfgModes.length === 0) newErrors.mfgModes = "請至少選擇一種代工模式";
    if (!region) newErrors.region = "請選擇地區";
    if (!capitalLevel) newErrors.capitalLevel = "請選擇資本額";
    if (!address.trim()) newErrors.address = "請輸入地址";
    if (foundedYear && foundedYear.length !== 4) newErrors.foundedYear = "請輸入4位數西元年（例：2010）";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    try {
      // Step 1：建立工廠（不含 avatar，避免 base64 暴露在 payload）
      await createFactoryMut.mutateAsync({
        name, industry, subIndustry: subIndustry.length > 0 ? subIndustry : undefined,
        mfgModes, region, description, capitalLevel, address,
        businessType,
        foundedYear: foundedYear ? parseInt(foundedYear) : undefined,
        ownerName: ownerName || undefined,
        phone: phone || undefined,
        website: website || undefined,
        contactEmail: contactEmail || undefined,
      });
      // Step 2：工廠建立成功後才上傳頭像（uploadAvatar 需要工廠已存在）
      if (avatarBase64) {
        const mime = avatarBase64.match(/^data:(image\/[^;]+)/)?.[1] ?? "image/jpeg";
        const safeMime = (["image/jpeg", "image/png", "image/webp"].includes(mime) ? mime : "image/jpeg") as "image/jpeg" | "image/png" | "image/webp";
        try {
          await uploadAvatarMut.mutateAsync({ base64: avatarBase64, mimeType: safeMime });
        } catch {
          // 頭像上傳失敗不阻斷流程，工廠已建立成功
        }
      }
      toast.success(`${typeLabel}建立成功！請在後台完善資料後送出審核。`);
      window.location.href = "/dashboard";
    } catch {
      toast.error("建立失敗，請稍後再試或聯繫客服");
    }
  };

  useEffect(() => {
    if (existingFactory && user?.role !== 'admin') {
      navigate("/dashboard");
    }
  }, [existingFactory, navigate, user]);

  if (factoryLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container py-16 text-center text-muted-foreground">載入中...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container py-16 text-center">
          <Factory className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold mb-2">請先登入</h2>
          <p className="text-muted-foreground mb-4">您需要登入後才能申請刊登</p>
          <a href={getLoginUrl()}><Button>登入</Button></a>
        </div>
      </div>
    );
  }

  if (existingFactory && user?.role !== 'admin') {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container py-16 text-center">
          <AlertCircle className="w-16 h-16 mx-auto mb-4 text-yellow-600" />
          <h2 className="text-xl font-semibold mb-2">您已有一個刊登</h2>
          <p className="text-muted-foreground mb-4">每個帳號只能申請一次</p>
          <Button onClick={() => navigate("/dashboard")}>返回管理後台</Button>
        </div>
      </div>
    );
  }

  if (!formStarted) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <AlertDialog open={true}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-blue-600" />
                申請須知
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="text-base space-y-3 mt-4">
                  <span className="font-semibold text-foreground block">重要提醒：</span>
                  <ul className="list-disc list-inside space-y-2 text-foreground">
                    <li>每個帳號只能申請一次</li>
                    <li>申請後無法更改帳號所有者</li>
                    <li>請確保填寫的資訊真實有效</li>
                    <li>虛假申請將被永久禁用</li>
                  </ul>
                  <span className="text-sm text-muted-foreground mt-4 block">您確認已閱讀上述須知嗎？</span>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => navigate("/")}>取消</AlertDialogCancel>
              <AlertDialogAction onClick={() => setFormStarted(true)}>我已了解，繼續申請</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container py-6 max-w-2xl">
        <Button variant="ghost" size="sm" className="mb-4" onClick={() => setFormStarted(false)}>
          <ArrowLeft className="w-4 h-4 mr-1" /> 返回
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>申請刊登</CardTitle>
            <CardDescription>選擇類型並填寫基本資料，完善後送出審核即可上線</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">

              {/* 業務類型選擇 */}
              <div>
                <Label className="text-base font-semibold mb-3 block">您要申請的類型</Label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setBusinessType("factory")}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${
                      businessType === "factory"
                        ? "border-orange-500 bg-orange-50"
                        : "border-border hover:border-orange-300"
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-2 ${
                      businessType === "factory" ? "bg-orange-500" : "bg-muted"
                    }`}>
                      <Factory className={`w-5 h-5 ${businessType === "factory" ? "text-white" : "text-muted-foreground"}`} />
                    </div>
                    <p className={`font-semibold ${businessType === "factory" ? "text-orange-600" : ""}`}>代工廠</p>
                    <p className="text-xs text-muted-foreground mt-1">具備生產設備的製造工廠</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setBusinessType("studio")}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${
                      businessType === "studio"
                        ? "border-purple-500 bg-purple-50"
                        : "border-border hover:border-purple-300"
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-2 ${
                      businessType === "studio" ? "bg-purple-500" : "bg-muted"
                    }`}>
                      <Wrench className={`w-5 h-5 ${businessType === "studio" ? "text-white" : "text-muted-foreground"}`} />
                    </div>
                    <p className={`font-semibold ${businessType === "studio" ? "text-purple-600" : ""}`}>工作室</p>
                    <p className="text-xs text-muted-foreground mt-1">手工藝、設計師或個人接案</p>
                  </button>
                </div>
              </div>

              {/* 大頭貼上傳 */}
              <div>
                <Label>{typeLabel}頭像</Label>
                <div className="mt-2 flex items-center gap-4">
                  <div
                    className="w-24 h-24 rounded-full border-2 border-dashed border-border flex items-center justify-center overflow-hidden cursor-pointer hover:border-orange-400 transition-colors bg-muted"
                    onClick={() => avatarInputRef.current?.click()}
                  >
                    {avatarPreview ? (
                      <img src={avatarPreview} alt="頭像預覽" className="w-full h-full object-cover" />
                    ) : (
                      <div className="text-center">
                        <Camera className="w-8 h-8 mx-auto text-muted-foreground" />
                        <p className="text-xs text-muted-foreground mt-1">上傳照片</p>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => avatarInputRef.current?.click()}>
                      <Camera className="w-4 h-4 mr-1" /> 選擇圖片
                    </Button>
                    {avatarPreview && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => { setAvatarPreview(null); setAvatarBase64(null); }}>
                        <X className="w-4 h-4 mr-1" /> 移除
                      </Button>
                    )}
                    <p className="text-xs text-muted-foreground">支援 JPG、PNG，最大 5MB</p>
                  </div>
                  <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
                </div>
              </div>

              {/* 名稱 */}
              <div>
                <Label htmlFor="name">{typeLabel}名稱 *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={e => { setName(e.target.value); if (errors.name) setErrors(p => ({ ...p, name: undefined })); }}
                  placeholder={namePlaceholder}
                  className={errors.name ? "border-red-500 focus-visible:ring-red-500" : ""}
                />
                {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
              </div>

              {/* 主產業（可複選） */}
              <div>
                <Label>主產業 *（可複選）</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" className={`w-full justify-between font-normal mt-1 ${errors.industry ? "border-red-500" : ""}`}>
                      <span className="truncate text-sm">{industry.length === 0 ? "選擇主產業" : industry.join("、")}</span>
                      <ChevronDown className="w-3 h-3 shrink-0 opacity-50 ml-1" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-2" align="start">
                    <div className="max-h-60 overflow-y-auto space-y-1">
                      {INDUSTRY_OPTIONS.map(opt => (
                        <label key={opt} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm">
                          <Checkbox
                            checked={industry.includes(opt)}
                            onCheckedChange={() => {
                              setIndustry(prev => prev.includes(opt) ? prev.filter(i => i !== opt) : [...prev, opt]);
                              if (errors.industry) setErrors(p => ({ ...p, industry: undefined }));
                            }}
                          />
                          {opt}
                        </label>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                {errors.industry && <p className="text-xs text-red-500 mt-1">{errors.industry}</p>}
              </div>

              {/* 子產業（選擇主產業後出現） */}
              {industry.length > 0 && (() => {
                const groups = industry
                  .map(ind => ({ name: ind, found: INDUSTRIES.find(i => i.name === ind) }))
                  .filter(({ found }) => found && found.sub.length > 0)
                  .map(({ name, found }) => ({ name, subs: found!.sub as unknown as string[] }));
                if (groups.length === 0) return null;
                const label = subIndustry.length === 0 ? "選擇子產業（可複選）" : subIndustry.join("、");
                return (
                  <div>
                    <Label>子產業（可複選）</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button type="button" variant="outline" className="w-full justify-between font-normal mt-1">
                          <span className="truncate text-sm">{label}</span>
                          <ChevronDown className="w-3 h-3 shrink-0 opacity-50 ml-1" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-72 p-2" align="start">
                        <div className="max-h-60 overflow-y-auto">
                          {groups.map(group => (
                            <div key={group.name}>
                              <div className="px-2 py-1 mt-1 mb-0.5 text-xs font-semibold text-muted-foreground bg-muted rounded select-none">
                                {group.name}
                              </div>
                              <div className="space-y-0.5">
                                {group.subs.map(opt => (
                                  <label key={opt} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm">
                                    <Checkbox
                                      checked={subIndustry.includes(opt)}
                                      onCheckedChange={() => setSubIndustry(prev =>
                                        prev.includes(opt) ? prev.filter(s => s !== opt) : [...prev, opt]
                                      )}
                                    />
                                    {opt}
                                  </label>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                );
              })()}

              {/* 代工模式 */}
              <div>
                <Label>代工模式 *（可複選）</Label>
                <div className={`flex gap-4 mt-2 p-3 rounded-md ${errors.mfgModes ? "border border-red-500 bg-red-50" : ""}`}>
                  {MFG_MODE_OPTIONS.map(mode => (
                    <label key={mode} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox checked={mfgModes.includes(mode)} onCheckedChange={() => toggleMode(mode)} />
                      <span className="text-sm">{mode}</span>
                    </label>
                  ))}
                </div>
                {errors.mfgModes && <p className="text-xs text-red-500 mt-1">{errors.mfgModes}</p>}
              </div>

              {/* 地區 */}
              <div>
                <Label>地區 *</Label>
                <Select value={region} onValueChange={v => { setRegion(v); if (errors.region) setErrors(p => ({ ...p, region: undefined })); }}>
                  <SelectTrigger className={errors.region ? "border-red-500" : ""}>
                    <SelectValue placeholder="選擇地區" />
                  </SelectTrigger>
                  <SelectContent>
                    {TAIWAN_REGIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
                {errors.region && <p className="text-xs text-red-500 mt-1">{errors.region}</p>}
              </div>

              {/* 資本額 */}
              <div>
                <Label>資本額 *</Label>
                <Select value={capitalLevel} onValueChange={v => { setCapitalLevel(v); if (errors.capitalLevel) setErrors(p => ({ ...p, capitalLevel: undefined })); }}>
                  <SelectTrigger className={errors.capitalLevel ? "border-red-500" : ""}>
                    <SelectValue placeholder="選擇資本額" />
                  </SelectTrigger>
                  <SelectContent>
                    {CAPITAL_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
                {errors.capitalLevel && <p className="text-xs text-red-500 mt-1">{errors.capitalLevel}</p>}
              </div>

              {/* 簡介 */}
              <div>
                <Label htmlFor="desc">簡介</Label>
                <Textarea id="desc" value={description} onChange={e => setDescription(e.target.value)} placeholder={descPlaceholder} rows={4} />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="year">成立年份</Label>
                  <Input
                    id="year"
                    inputMode="numeric"
                    value={foundedYear}
                    onChange={e => handleYearChange(e.target.value)}
                    placeholder="西元（例：2010）"
                    maxLength={4}
                    className={errors.foundedYear ? "border-red-500 focus-visible:ring-red-500" : ""}
                  />
                  {errors.foundedYear && <p className="text-xs text-red-500 mt-1">{errors.foundedYear}</p>}
                </div>
                <div>
                  <Label htmlFor="owner">負責人</Label>
                  <Input id="owner" value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder="負責人姓名" />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="phone">聯絡電話</Label>
                  <Input id="phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="02-1234-5678" />
                </div>
                <div>
                  <Label htmlFor="email">聯絡信箱</Label>
                  <Input id="email" type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="example@email.com" />
                </div>
              </div>

              <div>
                <Label htmlFor="web">官方網站</Label>
                <Input id="web" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://www.example.com" />
              </div>

              {/* 地址 */}
              <div>
                <Label htmlFor="address">地址 *</Label>
                <Input
                  id="address"
                  value={address}
                  onChange={e => { setAddress(e.target.value); if (errors.address) setErrors(p => ({ ...p, address: undefined })); }}
                  placeholder="例：台北市中山區民權路 100 號"
                  className={errors.address ? "border-red-500 focus-visible:ring-red-500" : ""}
                />
                {errors.address && <p className="text-xs text-red-500 mt-1">{errors.address}</p>}
              </div>

              <Button
                type="submit"
                className={`w-full ${businessType === "studio" ? "bg-purple-600 hover:bg-purple-700" : "bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600"} text-white border-0`}
                size="lg"
                disabled={createFactoryMut.isPending || uploadAvatarMut.isPending}
              >
                {createFactoryMut.isPending || uploadAvatarMut.isPending ? "建立中..." : `建立${typeLabel}`}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}