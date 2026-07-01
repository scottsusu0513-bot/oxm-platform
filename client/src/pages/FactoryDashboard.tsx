import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { trpc } from "@/lib/trpc";
import { compressImage } from "@/lib/compressImage";
import { INDUSTRIES, INDUSTRY_OPTIONS, TAIWAN_REGIONS, CAPITAL_OPTIONS, MFG_MODE_OPTIONS } from "@shared/constants";
import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useSearch, Link } from "wouter";
import { toast } from "sonner";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { NativePullToRefreshLayout } from "@/components/NativePullToRefreshLayout";
import {
  Factory, Package, MessageCircle, Settings, Plus, Pencil, Trash2, Save, Star, AlertTriangle, ImagePlus, X, ArrowLeft, Camera, Send, CheckCircle, Clock, XCircle, Wrench, Images, ChevronDown, Megaphone, Users, UserMinus, ClipboardList
} from "lucide-react";
import { OrderTimelineBar } from "@/components/OrderTimelineBar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// 千分位格式化
function formatNumber(val: string): string {
  const num = val.replace(/[^\d.]/g, "");
  if (!num) return "";
  const parts = num.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

function parseNumber(val: string): string {
  return val.replace(/,/g, "");
}

// 狀態 Badge 元件
function StatusBadge({ status }: { status: string }) {
  if (status === 'draft') return (
    <Badge className="bg-gray-100 text-gray-700 hover:bg-gray-100 border border-gray-300">
      <Clock className="w-3 h-3 mr-1" />未送審
    </Badge>
  );
  if (status === 'pending') return (
    <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">
      <AlertTriangle className="w-3 h-3 mr-1" />審核中
    </Badge>
  );
  if (status === 'approved') return (
    <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
      <CheckCircle className="w-3 h-3 mr-1" />已上線
    </Badge>
  );
  if (status === 'rejected') return (
    <Badge className="bg-red-100 text-red-800 hover:bg-red-100">
      <XCircle className="w-3 h-3 mr-1" />已拒絕
    </Badge>
  );
  return null;
}

export default function FactoryDashboard() {
  const { user, isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const initialTab = new URLSearchParams(searchString).get("tab") ?? "info";

  const { data: ownedFactory, isLoading: ownedLoading } = trpc.factory.getMine.useQuery(undefined, { enabled: isAuthenticated });

  // 次管理者：若本身不是工廠主，查詢是否有被共同管理的工廠
  const { data: coManagedList, isLoading: coManagedLoading } = trpc.factory.getCoManagedFactories.useQuery(undefined, {
    enabled: isAuthenticated && !ownedLoading && !ownedFactory,
  });
  const firstCoManaged = coManagedList?.[0];
  const { data: coManagedFactory, isLoading: coManagedFactoryLoading } = trpc.factory.getById.useQuery(
    { id: firstCoManaged?.factoryId ?? 0, includeRevision: true },
    { enabled: !!firstCoManaged?.factoryId }
  );

  const factory = ownedFactory ?? coManagedFactory ?? null;
  const isOwner = !!ownedFactory;
  const factoryLoading = ownedLoading || coManagedLoading || (!!firstCoManaged && coManagedFactoryLoading);

  const { data: convs } = trpc.chat.factoryConversations.useQuery(
    { factoryId: factory?.id ?? 0 },
    { enabled: !!factory?.id, refetchInterval: 30000 }
  );
  const { data: myReviews } = trpc.review.getByFactory.useQuery(
    { factoryId: factory?.id ?? 0, page: 1, pageSize: 50 },
    { enabled: isAuthenticated && !!factory?.id }
  );

  const utils = trpc.useUtils();
  const [activeTab, setActiveTab] = useState(initialTab);
  // Separate dirty refs per child — prevents one tab overwriting another's dirty state
  const infoDirtyRef = useRef(false);
  const productDirtyRef = useRef(false);
  const photoDirtyRef = useRef(false);

  const handleRefresh = useCallback(async () => {
    if (infoDirtyRef.current || productDirtyRef.current || photoDirtyRef.current) {
      toast("您有尚未儲存的變更，請先儲存或放棄後再重新整理");
      return;
    }
    if (!factory?.id) return;
    await Promise.all([
      utils.factory.getMine.invalidate(),
      utils.factory.getPhotos.invalidate({ factoryId: factory.id }),
      utils.product.getByFactory.invalidate({ factoryId: factory.id }),
      utils.chat.factoryConversations.invalidate({ factoryId: factory.id }),
      utils.review.getByFactory.invalidate({ factoryId: factory.id }),
      utils.chat.unreadCount.invalidate(),
      utils.notification.getAppBadgeCount.invalidate(),
    ]);
  }, [utils, factory?.id]);
  const { contentRef, indicatorRef, iconRef, phase } = usePullToRefresh({ onRefresh: handleRefresh });

  const REVIEW_SEEN_KEY = 'oxm_reviews_seen';
  const [reviewSeenAt, setReviewSeenAt] = useState<number>(() => {
    try { return parseInt(localStorage.getItem(REVIEW_SEEN_KEY) ?? '0', 10); } catch { return 0; }
  });
  const unseenReviewCount = myReviews?.items.filter(r =>
    new Date(r.createdAt as any).getTime() > reviewSeenAt
  ).length ?? 0;
  const showReviewBadge = unseenReviewCount > 0;

  const handleReviewTabClick = () => {
    const now = Date.now();
    try { localStorage.setItem(REVIEW_SEEN_KEY, now.toString()); } catch {}
    setReviewSeenAt(now);
    window.dispatchEvent(new CustomEvent('oxm-reviews-viewed'));
  };

  useEffect(() => {
    if (!loading && !isAuthenticated) navigate("/");
    // 只有在確認不是 owner 且不是 co-manager 時才導向註冊
    if (!loading && isAuthenticated && !factoryLoading && !factory &&
        coManagedList !== undefined && coManagedList.length === 0) {
      navigate("/register-factory");
    }
  }, [loading, isAuthenticated, factoryLoading, factory, coManagedList, navigate]);

  if (loading || factoryLoading || !factory) {
    return <AppLoading />;
  }

  const isPending = factory.status === 'pending';

  return (
    <NativePullToRefreshLayout contentRef={contentRef} indicatorRef={indicatorRef} iconRef={iconRef} phase={phase} className="min-h-screen bg-background">
      <Navbar />
      <div className="container py-6">
        <Button variant="outline" onClick={() => navigate("/")} className="mb-4 flex items-center gap-2">
          <ArrowLeft className="h-4 w-4" />返回首頁
        </Button>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            {/* 大頭貼 */}
            {factory.avatarUrl && (
              <img src={factory.avatarUrl} alt={factory.name} className="w-16 h-16 rounded-full object-cover border-2 border-border shrink-0" loading="lazy" />
            )}
            {!factory.avatarUrl && (
              <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center border-2 border-border shrink-0">
                <Factory className="w-8 h-8 text-orange-500" />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold flex flex-wrap items-center gap-2">
                {factory.name}
                {(factory as any).businessType === "studio" ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-sm font-medium">
                    <Wrench className="w-3 h-3" />工作室
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 text-sm font-medium">
                    <Factory className="w-3 h-3" />代工廠
                  </span>
                )}
                {(factory as any).certified && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-sm font-medium">
                    ✓ 認證工廠
                  </span>
                )}
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">工廠管理後台</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={factory.status} />
                {factory.status === 'rejected' && factory.rejectionReason && (
                  <span className="text-xs text-red-600">原因：{factory.rejectionReason}</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="secondary">
              <Star className="w-3 h-3 mr-1 text-yellow-500" />
              {Number(factory.avgRating).toFixed(1)} ({factory.reviewCount})
            </Badge>
            {isOwner && <DeleteFactoryButton factoryId={factory.id} />}
            {!isOwner && (
              <Badge variant="outline" className="text-xs text-muted-foreground">次管理者</Badge>
            )}
          </div>
        </div>

        {/* 狀態提示橫幅 */}
        {factory.status === 'draft' && (
          <div className="mb-4 p-4 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-2 text-gray-700">
              <Clock className="w-5 h-5" />
              <span className="text-sm font-medium">您的工廠尚未送審，完善資料後請送出審核才能上線</span>
            </div>
          </div>
        )}
        {factory.status === 'pending' && (
          <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex items-center gap-2 text-yellow-800">
            <AlertTriangle className="w-5 h-5" />
            <span className="text-sm font-medium">您的工廠正在審核中，審核期間資料暫時無法修改</span>
          </div>
        )}
        {factory.status === 'approved' && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-800">
            <CheckCircle className="w-5 h-5" />
            <span className="text-sm font-medium">您的工廠已上線，買家可以在搜尋頁面找到您</span>
          </div>
        )}
        {factory.status === 'rejected' && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center gap-2 text-red-800 mb-1">
              <XCircle className="w-5 h-5" />
              <span className="text-sm font-medium">您的工廠審核未通過，請修改後重新送審</span>
            </div>
            {factory.rejectionReason && (
              <p className="text-sm text-red-700 ml-7">拒絕原因：{factory.rejectionReason}</p>
            )}
          </div>
        )}

        <Tabs defaultValue={initialTab} onValueChange={setActiveTab}>
          <TabsList className="flex flex-wrap h-auto gap-1 mb-4 bg-white/80 p-1">
            <TabsTrigger value="info" className="gap-1.5 text-xs sm:text-sm">
              <Settings className="w-3.5 h-3.5 shrink-0" />
              基本資料
            </TabsTrigger>
            <TabsTrigger value="photos" className="gap-1.5 text-xs sm:text-sm">
              <Images className="w-3.5 h-3.5 shrink-0" />
              照片集
            </TabsTrigger>
            <TabsTrigger value="products" className="gap-1.5 text-xs sm:text-sm">
              <Package className="w-3.5 h-3.5 shrink-0" />
              產品管理
            </TabsTrigger>
            <TabsTrigger value="messages" className="gap-1.5 text-xs sm:text-sm">
              <MessageCircle className="w-3.5 h-3.5 shrink-0" />
              客戶詢問
              {convs && convs.some(c => c.unreadCount > 0) && (
                <span className="ml-0.5 h-2 w-2 rounded-full bg-orange-500 shrink-0" />
              )}
            </TabsTrigger>
            <TabsTrigger value="reviews" onClick={handleReviewTabClick} className="gap-1.5 text-xs sm:text-sm">
              <Star className="w-3.5 h-3.5 shrink-0" />
              客戶評價
              {showReviewBadge && (
                <span className="ml-0.5 h-2 w-2 rounded-full bg-orange-500 shrink-0" />
              )}
            </TabsTrigger>
            <TabsTrigger value="ads" className="gap-1.5 text-xs sm:text-sm">
              <Megaphone className="w-3.5 h-3.5 shrink-0" />
              廣告曝光
            </TabsTrigger>
            <TabsTrigger value="orders" className="gap-1.5 text-xs sm:text-sm">
              <ClipboardList className="w-3.5 h-3.5 shrink-0" />
              訂單管理
            </TabsTrigger>
          </TabsList>

          <TabsContent value="info">
            <FactoryInfoForm factory={factory} isOwner={isOwner} latestRevision={(factory as any).latestRevision ?? null} onDirtyChange={(d) => { infoDirtyRef.current = d; }} />
          </TabsContent>
          <TabsContent value="photos">
            <PhotoManager factoryId={factory.id} onDirtyChange={(d) => { photoDirtyRef.current = d; }} />
          </TabsContent>
          <TabsContent value="products">
            <ProductManager factoryId={factory.id} products={factory.products} isPending={isPending} onDirtyChange={(d) => { productDirtyRef.current = d; }} />
          </TabsContent>
          <TabsContent value="messages">
            <ConversationList conversations={convs ?? []} />
          </TabsContent>
          <TabsContent value="reviews">
            <ReviewList reviews={myReviews?.items ?? []} factoryId={factory.id} />
          </TabsContent>
          <TabsContent value="ads">
            <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground gap-4">
              <Megaphone className="w-12 h-12 opacity-30" />
              <div>
                <p className="text-lg font-medium text-foreground">廣告曝光功能</p>
                <p className="text-sm mt-1">此功能預計於平台穩定上線後開放，敬請期待。</p>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="orders">
            <CollaborationOrdersTab factoryId={factory.id} />
          </TabsContent>
        </Tabs>

        {isOwner && <CoManagerPanel factoryId={factory.id} />}
      </div>
    </NativePullToRefreshLayout>
  );
}

// ===== Factory Info Form =====
const OPERATION_STATUS_OPTIONS = [
  { value: "normal", label: "接單中", dot: "bg-green-500" },
  { value: "busy",   label: "產線繁忙", dot: "bg-yellow-500" },
  { value: "full",   label: "產線滿載", dot: "bg-red-500" },
] as const;

function FactoryInfoForm({ factory, isOwner = true, latestRevision = null, onDirtyChange }: { factory: any; isOwner?: boolean; latestRevision?: any; onDirtyChange?: (dirty: boolean) => void }) {
  const [name, setName] = useState(factory.name);
  const [industry, setIndustry] = useState<string[]>(() => {
    const raw = (factory as any).industry;
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string' && raw) return [raw];
    return [];
  });
  const [subIndustry, setSubIndustry] = useState<string[]>((factory as any).subIndustry ?? []);
  const [mfgModes, setMfgModes] = useState<string[]>(factory.mfgModes as string[]);
  const [region, setRegion] = useState(factory.region);
  const [description, setDescription] = useState(factory.description ?? "");
  const [capitalLevel, setCapitalLevel] = useState(factory.capitalLevel);
  const [foundedYear, setFoundedYear] = useState(factory.foundedYear?.toString() ?? "");
  const [ownerName, setOwnerName] = useState(factory.ownerName ?? "");
  const [contactPersonName, setContactPersonName] = useState((factory as any).contactPersonName ?? "");
  const [phone, setPhone] = useState(factory.phone ?? "");
  const [website, setWebsite] = useState(factory.website ?? "");
  const [contactEmail, setContactEmail] = useState(factory.contactEmail ?? "");
  const [address, setAddress] = useState(factory.address ?? "");
  const [operationStatus, setOperationStatus] = useState<"normal" | "busy" | "full">(factory.operationStatus ?? "normal");
  const [weekdayHours, setWeekdayHours] = useState((factory as any).weekdayHours ?? "");
  const [weekendHours, setWeekendHours] = useState((factory as any).weekendHours ?? "");
  const [businessNote, setBusinessNote] = useState((factory as any).businessNote ?? "");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(factory.avatarUrl ?? null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(factory.avatarUrl ?? null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Snapshot of saved form values for dirty detection.
  // avatarUrl is included here. For draft/rejected, it is updated in handleAvatarChange immediately
  // after upload succeeds (savedToDb: true), so the button does not stay dirty after a save.
  // For approved, it is NOT updated on upload (savedToDb: false), so isDirty correctly stays true
  // until the revision is submitted.
  const initialForm = useRef({
    name: factory.name as string,
    industry: Array.isArray(factory.industry) ? [...factory.industry as string[]] : typeof factory.industry === 'string' && factory.industry ? [factory.industry as string] : [] as string[],
    subIndustry: [...((factory as any).subIndustry ?? [])] as string[],
    mfgModes: [...(factory.mfgModes as string[])],
    region: factory.region as string,
    description: (factory.description ?? "") as string,
    capitalLevel: factory.capitalLevel as string,
    foundedYear: (factory.foundedYear?.toString() ?? "") as string,
    ownerName: (factory.ownerName ?? "") as string,
    contactPersonName: ((factory as any).contactPersonName ?? "") as string,
    phone: (factory.phone ?? "") as string,
    website: (factory.website ?? "") as string,
    contactEmail: (factory.contactEmail ?? "") as string,
    address: (factory.address ?? "") as string,
    operationStatus: (factory.operationStatus ?? "normal") as "normal" | "busy" | "full",
    weekdayHours: ((factory as any).weekdayHours ?? "") as string,
    weekendHours: ((factory as any).weekendHours ?? "") as string,
    businessNote: ((factory as any).businessNote ?? "") as string,
    avatarUrl: (factory.avatarUrl ?? null) as string | null,
  });

  const arrEq = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().join("\0") === [...b].sort().join("\0");

  const isDirty =
    name !== initialForm.current.name ||
    !arrEq(industry, initialForm.current.industry) ||
    !arrEq(subIndustry, initialForm.current.subIndustry) ||
    !arrEq(mfgModes, initialForm.current.mfgModes) ||
    region !== initialForm.current.region ||
    description !== initialForm.current.description ||
    capitalLevel !== initialForm.current.capitalLevel ||
    foundedYear !== initialForm.current.foundedYear ||
    ownerName !== initialForm.current.ownerName ||
    contactPersonName !== initialForm.current.contactPersonName ||
    phone !== initialForm.current.phone ||
    website !== initialForm.current.website ||
    contactEmail !== initialForm.current.contactEmail ||
    address !== initialForm.current.address ||
    operationStatus !== initialForm.current.operationStatus ||
    weekdayHours !== initialForm.current.weekdayHours ||
    weekendHours !== initialForm.current.weekendHours ||
    businessNote !== initialForm.current.businessNote ||
    (avatarUrl ?? null) !== (initialForm.current.avatarUrl ?? null);

  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);

  const [revisionDialogOpen, setRevisionDialogOpen] = useState(false);
  const [revisionReason, setRevisionReason] = useState("");

  const utils = trpc.useUtils();
  const updateFactory = trpc.factory.update.useMutation({
    onError: (err) => toast.error(err.message),
  });
  const uploadAvatarMut = trpc.factory.uploadAvatar.useMutation();
  const submitForReviewMut = trpc.factory.submitForReview.useMutation({
    onSuccess: () => { toast.success("已送出審核！請等待管理員審核"); utils.factory.getMine.invalidate(); },
    onError: (err) => toast.error(err.message),
  });
  const submitRevisionMut = trpc.factory.submitRevision.useMutation({
    onSuccess: () => {
      toast.success("修改申請已送出，請等待管理員審核");
      setRevisionDialogOpen(false);
      setRevisionReason("");
      if (isOwner) {
        utils.factory.getMine.invalidate();
      } else {
        utils.factory.getById.invalidate({ id: factory.id, includeRevision: true });
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const hasPendingRevision = latestRevision?.status === 'pending';
  const hasRejectedRevision = latestRevision?.status === 'rejected';

  // isBasicDataLocked: only applies to basic data form + avatar; NOT products/photos
  const isBasicDataLocked = factory.status === 'pending' || hasPendingRevision;
  const isLocked = isBasicDataLocked; // alias for existing code below

  const toggleMode = (mode: string) => {
    if (isBasicDataLocked) return;
    setMfgModes(prev => prev.includes(mode) ? prev.filter(m => m !== mode) : [...prev, mode]);
  };

  const handleYearChange = (val: string) => {
    const cleaned = val.replace(/\D/g, "").slice(0, 4);
    setFoundedYear(cleaned);
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("圖片大小不能超過 5MB"); return; }
    setAvatarUploading(true);
    try {
      const base64 = await compressImage(file);
      setAvatarPreview(base64);
      const result = await uploadAvatarMut.mutateAsync({ base64, mimeType: "image/jpeg", factoryId: factory.id });
      setAvatarUrl(result.url);
      setAvatarPreview(result.url);
      if ((result as any).savedToDb !== false) {
        // draft/rejected: server saved immediately → sync initialForm so isDirty resets to false
        initialForm.current = { ...initialForm.current, avatarUrl: result.url ?? null };
        if (isOwner) {
          await utils.factory.getMine.invalidate();
        } else {
          await utils.factory.getById.invalidate({ id: factory.id, includeRevision: true });
        }
      }
      // approved: savedToDb is false — URL stays staged in avatarUrl state for the revision submission
    } catch {
      toast.error("圖片上傳失敗，請重試");
      setAvatarPreview(factory.avatarUrl ?? null);
      setAvatarUrl(factory.avatarUrl ?? null);
    } finally {
      setAvatarUploading(false);
    }
  };

  const buildProposedData = () => ({
    name,
    industry: industry.length > 0 ? industry : factory.industry,
    subIndustry: subIndustry,
    mfgModes,
    region,
    description: description || null,
    capitalLevel,
    foundedYear: foundedYear ? parseInt(foundedYear) : null,
    ownerName: ownerName || null,
    contactPersonName: contactPersonName || null,
    phone: phone || null,
    website: website || null,
    contactEmail: contactEmail || null,
    address,
    operationStatus,
    weekdayHours: weekdayHours || null,
    weekendHours: weekendHours || null,
    businessNote: businessNote || null,
    avatarUrl: avatarUrl || factory.avatarUrl || null,
  });

  const handleSave = () => {
    if (!isDirty) return;
    if (avatarUploading) { toast.error("圖片上傳中，請稍候"); return; }
    if (foundedYear && foundedYear.length !== 4) { toast.error("成立年份請輸入4位數西元年"); return; }

    if (factory.status === 'approved') {
      // Open revision dialog for approved factories
      setRevisionDialogOpen(true);
      return;
    }

    // draft / rejected → direct update
    const snapshot = {
      name, industry: [...industry], subIndustry: [...subIndustry], mfgModes: [...mfgModes],
      region, description, capitalLevel, foundedYear, ownerName, contactPersonName, phone, website, contactEmail,
      address, operationStatus, weekdayHours, weekendHours, businessNote,
      avatarUrl: avatarUrl ?? null,
    };
    updateFactory.mutate({
      id: factory.id, name,
      industry: industry.length > 0 ? industry : undefined,
      subIndustry: subIndustry.length > 0 ? subIndustry : undefined,
      mfgModes, region, description, capitalLevel, address,
      operationStatus,
      weekdayHours: weekdayHours || undefined,
      weekendHours: weekendHours || undefined,
      businessNote: businessNote || undefined,
      foundedYear: foundedYear ? parseInt(foundedYear) : undefined,
      ownerName: ownerName || undefined,
      contactPersonName: contactPersonName || undefined,
      phone: phone || undefined,
      website: website || undefined, contactEmail: contactEmail || undefined,
      avatarUrl: avatarUrl || factory.avatarUrl || undefined,
    }, {
      onSuccess: () => {
        toast.success("資料已更新");
        initialForm.current = snapshot;
        utils.factory.getMine.invalidate();
        utils.factory.getById.invalidate({ id: factory.id });
      },
    });
  };

  const handleSubmitRevision = () => {
    const trimmed = revisionReason.trim();
    if (trimmed.length < 2) {
      toast.error("修改原因至少需要 2 個字");
      return;
    }
    if (trimmed.length > 200) {
      toast.error("修改原因不可超過 200 個字");
      return;
    }
    submitRevisionMut.mutate({
      factoryId: factory.id,
      proposedData: buildProposedData(),
      revisionReason: trimmed,
    });
  };

  return (
    <>
      {/* ── 修改申請 Dialog ── */}
      <Dialog open={revisionDialogOpen} onOpenChange={setRevisionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>提交基本資料修改申請</DialogTitle>
            <DialogDescription>
              已上線工廠的基本資料變更需要管理員審核。填寫修改原因後送出申請，審核通過後資料才會更新至公開頁面。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>修改原因（必填，2 至 200 字）</Label>
            <Textarea
              value={revisionReason}
              onChange={e => { if (e.target.value.length <= 200) setRevisionReason(e.target.value); }}
              placeholder="例：公司搬遷更新地址、增加新產業分類…"
              rows={3}
            />
            <div className="flex items-center justify-between">
              {revisionReason.trim().length > 0 && revisionReason.trim().length < 2 && (
                <p className="text-xs text-red-500">至少需要 2 個字</p>
              )}
              {revisionReason.trim().length === 0 && <p className="text-xs text-red-500">修改原因為必填</p>}
              <p className="text-xs text-muted-foreground ml-auto">{revisionReason.trim().length} / 200</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevisionDialogOpen(false)} disabled={submitRevisionMut.isPending}>取消</Button>
            <Button
              onClick={handleSubmitRevision}
              disabled={submitRevisionMut.isPending || revisionReason.trim().length < 2}
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              {submitRevisionMut.isPending ? "送出中..." : "確認送出申請"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
      <CardHeader>
        <CardTitle>基本資料</CardTitle>
        <CardDescription>
          {factory.status === 'pending'
            ? "首次申請審核中，資料暫時無法修改"
            : hasPendingRevision
            ? "修改申請審核中，待審核完成後可再次修改"
            : factory.status === 'approved'
            ? "已上線工廠的基本資料變更需提交修改申請由管理員審核"
            : "這些資料會顯示在您的工廠公開頁面，請確保資訊正確"}
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-border">

        {/* ── 修改申請審核中 Banner ── */}
        {hasPendingRevision && (
          <div className="py-4 px-4 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-2 text-yellow-800 mb-2">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium">基本資料修改申請審核中</p>
              <p className="text-xs text-yellow-700 mt-0.5">您於 {new Date(latestRevision.submittedAt).toLocaleDateString('zh-TW')} 提交的修改申請正在審核中，審核期間無法提交新的修改申請。</p>
            </div>
          </div>
        )}

        {/* ── 修改申請被拒絕 Banner（只在沒有 pending 申請時顯示） ── */}
        {!hasPendingRevision && hasRejectedRevision && (
          <div className="py-4 px-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 text-red-800 mb-2">
            <XCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="text-sm font-medium">基本資料修改申請未通過</p>
              <p className="text-xs text-red-700">
                拒絕原因：{latestRevision.rejectionReason ?? '（未說明）'}
              </p>
              {latestRevision.reviewedAt && (
                <p className="text-xs text-red-600">
                  審核時間：{new Date(latestRevision.reviewedAt).toLocaleDateString('zh-TW')}
                </p>
              )}
              {latestRevision.revisionReason && (
                <p className="text-xs text-red-600">原申請原因：{latestRevision.revisionReason}</p>
              )}
              <p className="text-xs text-red-600 mt-1">您可修改後重新提交修改申請。</p>
            </div>
          </div>
        )}

        {/* ── 大頭貼 ── */}
        {!isLocked && (
          <div className="py-6 space-y-2">
            <Label>工廠大頭貼</Label>
            <div className="flex items-center gap-4">
              <div
                className="w-20 h-20 rounded-full border-2 border-dashed border-border flex items-center justify-center overflow-hidden cursor-pointer hover:border-orange-400 transition-colors bg-muted relative"
                onClick={() => !avatarUploading && avatarInputRef.current?.click()}
              >
                {avatarUploading ? (
                  <div className="flex flex-col items-center">
                    <div className="w-5 h-5 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
                    <p className="text-xs text-muted-foreground mt-1">上傳中</p>
                  </div>
                ) : avatarPreview ? (
                  <img src={avatarPreview} alt="大頭貼" className="w-full h-full object-cover" />
                ) : (
                  <div className="text-center">
                    <Camera className="w-6 h-6 mx-auto text-muted-foreground" />
                    <p className="text-xs text-muted-foreground mt-1">上傳</p>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Button type="button" variant="outline" size="sm" disabled={avatarUploading} onClick={() => avatarInputRef.current?.click()}>
                  <Camera className="w-4 h-4 mr-1" />{avatarUploading ? "上傳中..." : "更換照片"}
                </Button>
                {avatarPreview && !avatarUploading && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setAvatarPreview(null); setAvatarUrl(null); }}>
                    <X className="w-4 h-4 mr-1" />移除
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">JPG、PNG，最大 5MB</p>
              </div>
              <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
            </div>
          </div>
        )}

        {/* ── 基本資訊 ── */}
        <div className="py-6 space-y-5">
          <p className="text-sm font-semibold text-foreground">基本資訊</p>

          <div className="space-y-2">
            <Label>業務類型</Label>
            <div className="flex items-center gap-2">
              {factory.businessType === "studio" ? (
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-50 border border-purple-200 w-fit">
                  <Wrench className="w-4 h-4 text-purple-600" />
                  <span className="font-medium text-purple-700">工作室</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-50 border border-orange-200 w-fit">
                  <Factory className="w-4 h-4 text-orange-600" />
                  <span className="font-medium text-orange-700">代工廠</span>
                </div>
              )}
              <span className="text-xs text-muted-foreground">（申請後無法更改）</span>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-5">
            <div className="space-y-2">
              <Label>工廠名稱</Label>
              <Input disabled={isLocked} value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>主產業（可複選）</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" className="w-full justify-between font-normal" disabled={isLocked}>
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
                            setIndustry(prev => {
                              const next = prev.includes(opt) ? prev.filter(i => i !== opt) : [...prev, opt];
                              // 移除不再屬於任何已選主產業的子產業
                              const validSubs = new Set(
                                INDUSTRIES.filter(i => next.includes(i.name)).flatMap(i => i.sub)
                              );
                              setSubIndustry(s => s.filter(sub => validSubs.has(sub as any)));
                              return next;
                            });
                          }}
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
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
              <div className="space-y-2">
                <Label>子產業（可複選）</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" className="w-full justify-between font-normal">
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

          <div className="space-y-2">
            <Label>代工模式</Label>
            <div className="flex flex-wrap gap-4">
              {MFG_MODE_OPTIONS.map(mode => (
                <label key={mode} className={`flex items-center gap-2 ${isLocked ? "opacity-50" : "cursor-pointer"}`}>
                  <Checkbox disabled={isLocked} checked={mfgModes.includes(mode)} onCheckedChange={() => toggleMode(mode)} />
                  <span className="text-sm">{mode}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* ── 地點與規模 ── */}
        <div className="py-6 space-y-5">
          <p className="text-sm font-semibold text-foreground">地點與規模</p>
          <div className="grid sm:grid-cols-2 gap-5">
            <div className="space-y-2">
              <Label>地區</Label>
              <Select disabled={isLocked} value={region} onValueChange={setRegion}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TAIWAN_REGIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>資本額</Label>
              <Select disabled={isLocked} value={capitalLevel} onValueChange={setCapitalLevel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CAPITAL_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-5">
            <div className="space-y-2">
              <Label>成立年份</Label>
              <Input disabled={isLocked} inputMode="numeric" value={foundedYear} onChange={e => handleYearChange(e.target.value)} placeholder="西元（例：2010）" maxLength={4} />
            </div>
            <div className="space-y-2">
              <Label>負責人姓名</Label>
              <Input disabled={isLocked} value={ownerName} onChange={e => setOwnerName(e.target.value)} />
              <p className="text-xs text-muted-foreground">負責人通常為工廠老闆、創辦人或實際經營者。</p>
            </div>
          </div>
        </div>

        {/* ── 工廠簡介 ── */}
        <div className="py-6 space-y-5">
          <p className="text-sm font-semibold text-foreground">工廠簡介</p>
          <div className="space-y-2">
            <Label>工廠簡介</Label>
            <p className="text-xs text-muted-foreground">簡述核心優勢、產能及服務範圍，會顯示在工廠公開頁面</p>
            <Textarea disabled={isLocked} value={description} onChange={e => setDescription(e.target.value)} rows={5} />
          </div>
        </div>

        {/* ── 聯絡窗口 ── */}
        <div className="py-6 space-y-5">
          <p className="text-sm font-semibold text-foreground">聯絡窗口</p>
          <div className="space-y-2">
            <Label>聯絡人姓名</Label>
            <Input disabled={isLocked} value={contactPersonName} onChange={e => setContactPersonName(e.target.value)} placeholder="洽詢窗口姓名" />
            <p className="text-xs text-muted-foreground">聯絡人為使用者詢價、電話或平台訊息時，第一位接洽的窗口。</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-5">
            <div className="space-y-2">
              <Label>聯絡電話</Label>
              <Input disabled={isLocked} value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>聯絡信箱</Label>
              <Input disabled={isLocked} type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>官方網站</Label>
            <Input disabled={isLocked} value={website} onChange={e => setWebsite(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>公廠地址 *</Label>
            <Input disabled={isLocked} value={address} onChange={e => setAddress(e.target.value)} placeholder="例：台北市中山區民權路 100 號" />
          </div>
        </div>

        {/* ── 營業資訊 ── */}
        <div className="py-6 space-y-5">
          <p className="text-sm font-semibold text-foreground">營業資訊</p>
          <div className="space-y-2">
            <Label>營業狀態</Label>
            <div className="flex flex-wrap gap-2">
              {OPERATION_STATUS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setOperationStatus(opt.value)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                    operationStatus === opt.value
                      ? "border-current shadow-sm bg-white ring-2 ring-offset-1 " + (opt.value === "normal" ? "ring-green-500 text-green-700" : opt.value === "busy" ? "ring-yellow-500 text-yellow-700" : "ring-red-500 text-red-700")
                      : "border-border text-muted-foreground hover:border-muted-foreground"
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${opt.dot}`} />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>營業時間</Label>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">平日</p>
                <Input disabled={isLocked} value={weekdayHours} onChange={e => setWeekdayHours(e.target.value)} placeholder="例：09:00–18:00" />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">假日</p>
                <Input disabled={isLocked} value={weekendHours} onChange={e => setWeekendHours(e.target.value)} placeholder="例：休息 / 10:00–15:00" />
              </div>
            </div>
            <div className="space-y-1.5 mt-1">
              <p className="text-xs text-muted-foreground">備註</p>
              <Input disabled={isLocked} value={businessNote} onChange={e => setBusinessNote(e.target.value)} placeholder="例：農曆年休七天" />
            </div>
          </div>
        </div>

        {/* ── 儲存按鈕 ── */}
        {!isLocked && (
          <div className="pt-6 pb-2 flex items-center justify-end gap-3">
            {isOwner && (factory.status === 'draft' || factory.status === 'rejected') && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="border-blue-300 text-blue-600 hover:bg-blue-50">
                    <Send className="w-4 h-4 mr-1" />送出審核
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>確認送出審核？</AlertDialogTitle>
                    <AlertDialogDescription>
                      送出後資料將暫時鎖定，等待管理員審核。審核通過後工廠將正式上線。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-blue-600 hover:bg-blue-700"
                      onClick={() => submitForReviewMut.mutate(undefined)}
                      disabled={submitForReviewMut.isPending}
                    >
                      {submitForReviewMut.isPending ? "送出中..." : "確認送出"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button
              onClick={handleSave}
              disabled={!isDirty || updateFactory.isPending || submitRevisionMut.isPending}
              className={
                isDirty
                  ? "bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0"
                  : "bg-gray-200 text-gray-400 cursor-not-allowed border-0"
              }
            >
              <Save className="w-4 h-4 mr-1" />
              {factory.status === 'approved'
                ? (isDirty ? "提交修改申請" : "無修改")
                : (updateFactory.isPending ? "儲存中..." : "儲存變更")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
    </>
  );
}

// ===== Photo Manager =====
function PhotoManager({ factoryId, onDirtyChange }: { factoryId: number; onDirtyChange?: (dirty: boolean) => void }) {
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  useEffect(() => { onDirtyChange?.(uploading); }, [uploading, onDirtyChange]);
  const [editCaptionId, setEditCaptionId] = useState<number | null>(null);
  const [captionDraft, setCaptionDraft] = useState("");

  const { data: photos = [] } = trpc.factory.getPhotos.useQuery({ factoryId });
  const uploadMut = trpc.factory.uploadPhoto.useMutation({
    onSuccess: () => { utils.factory.getPhotos.invalidate({ factoryId }); toast.success("照片已上傳"); },
    onError: (err) => toast.error(err.message),
  });
  const deleteMut = trpc.factory.deletePhoto.useMutation({
    onSuccess: () => { utils.factory.getPhotos.invalidate({ factoryId }); toast.success("照片已刪除"); },
    onError: (err) => toast.error(err.message),
  });
  const captionMut = trpc.factory.updatePhotoCaption.useMutation({
    onSuccess: () => { utils.factory.getPhotos.invalidate({ factoryId }); setEditCaptionId(null); },
    onError: (err) => toast.error(err.message),
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const remaining = 20 - photos.length;
    const toUpload = files.slice(0, remaining);
    setUploading(true);
    for (const file of toUpload) {
      if (file.size > 5 * 1024 * 1024) { toast.error(`${file.name} 超過 5MB，請選擇較小的圖片`); continue; }
      try {
        const base64 = await compressImage(file);
        await uploadMut.mutateAsync({ base64, mimeType: "image/jpeg" });
      } catch {}
    }
    setUploading(false);
    e.target.value = "";
  };

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <CardTitle>工廠照片集</CardTitle>
          <CardDescription>上傳工廠環境、設備、生產線照片，最多 20 張，每張上限 5MB</CardDescription>
        </div>
        {photos.length < 20 && (
          <Button size="sm" disabled={uploading} className="self-start sm:self-auto shrink-0" onClick={() => fileInputRef.current?.click()}>
            <ImagePlus className="w-4 h-4 mr-1" />{uploading ? "上傳中..." : "新增照片"}
          </Button>
        )}
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleUpload} />
      </CardHeader>
      <CardContent>
        {photos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border-2 border-dashed rounded-lg cursor-pointer hover:border-primary transition-colors"
            onClick={() => fileInputRef.current?.click()}>
            <Images className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">點擊或拖曳上傳照片</p>
            <p className="text-xs mt-1">支援 JPG、PNG、WEBP</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {photos.map((photo) => (
              <div key={photo.id} className="group relative">
                <div className="aspect-square rounded-lg overflow-hidden bg-muted border">
                  <img src={photo.url} alt={photo.caption ?? ""} className="w-full h-full object-cover" loading="lazy" />
                </div>
                <button
                  onClick={() => deleteMut.mutate({ photoId: photo.id })}
                  className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                >
                  <X className="w-3 h-3" />
                </button>
                {editCaptionId === photo.id ? (
                  <div className="mt-2 flex gap-1.5 items-center">
                    <Input
                      value={captionDraft}
                      onChange={e => setCaptionDraft(e.target.value)}
                      className="h-8 text-xs flex-1"
                      placeholder="照片說明"
                      maxLength={200}
                      onKeyDown={e => { if (e.key === "Enter") captionMut.mutate({ photoId: photo.id, caption: captionDraft }); if (e.key === "Escape") setEditCaptionId(null); }}
                    />
                    <Button size="sm" className="h-8 px-2 shrink-0" onClick={() => captionMut.mutate({ photoId: photo.id, caption: captionDraft })}>
                      <Save className="w-3 h-3" />
                    </Button>
                  </div>
                ) : (
                  <p
                    className="mt-2 text-xs text-muted-foreground truncate cursor-pointer hover:text-foreground"
                    onClick={() => { setEditCaptionId(photo.id); setCaptionDraft(photo.caption ?? ""); }}
                  >
                    {photo.caption || <span className="italic opacity-50">點擊加說明</span>}
                  </p>
                )}
              </div>
            ))}
            {photos.length < 20 && (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="aspect-square rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center text-muted-foreground hover:border-primary hover:text-primary transition-colors"
              >
                {uploading ? <span className="text-xs">上傳中...</span> : <><ImagePlus className="w-5 h-5" /><span className="text-xs mt-1">新增</span></>}
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ===== Product Manager =====
function ProductManager({ factoryId, products, isPending, onDirtyChange }: { factoryId: number; products: any[]; isPending: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  useEffect(() => { onDirtyChange?.(showAdd || editId !== null); }, [showAdd, editId, onDirtyChange]);
  const [filterCat, setFilterCat] = useState<number | null | "all">("all");
  const utils = trpc.useUtils();
  const { data: categories = [] } = trpc.category.getByFactory.useQuery({ factoryId });

  const deleteMut = trpc.product.delete.useMutation({
    onSuccess: () => {
      toast.success("產品已刪除");
      utils.factory.getMine.invalidate();
      utils.product.getByFactory.invalidate({ factoryId });
    },
    onError: (err) => toast.error(err.message),
  });

  const visibleProducts = filterCat === "all"
    ? products
    : filterCat === null
      ? products.filter(p => !p.categoryId)
      : products.filter(p => p.categoryId === filterCat);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>產品管理</CardTitle>
          <CardDescription>管理您的產品列表</CardDescription>
        </div>
        {!isPending && (
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="w-4 h-4 mr-1" />新增產品
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isPending && (
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800 mb-4">
            審核期間無法新增或修改產品
          </div>
        )}
        {/* 分類篩選 */}
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {[{ id: "all" as const, name: "全部" }, ...categories, { id: null as null, name: "未分類" }].map(cat => (
              <button
                key={String(cat.id)}
                onClick={() => setFilterCat(cat.id as any)}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${filterCat === cat.id ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary"}`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}
        {showAdd && !isPending && (
          <ProductForm factoryId={factoryId} onDone={() => { setShowAdd(false); utils.factory.getMine.invalidate(); utils.product.getByFactory.invalidate({ factoryId }); }} />
        )}
        {visibleProducts.length === 0 && !showAdd ? (
          <p className="text-center text-muted-foreground py-8">
            {products.length === 0 ? "尚未新增任何產品" : "此分類沒有產品"}
          </p>
        ) : (
          <div className="space-y-3 mt-4">
            {visibleProducts.map(p => (
              <div key={p.id}>
                {editId === p.id ? (
                  <ProductForm factoryId={factoryId} product={p} onDone={() => { setEditId(null); utils.factory.getMine.invalidate(); utils.product.getByFactory.invalidate({ factoryId }); }} />
                ) : (
                  <div className="flex items-center justify-between p-4 rounded-lg border">
                    <div className="flex gap-3 items-start flex-1">
                      {p.images && (p.images as string[]).length > 0 && (
                        <img src={(p.images as string[])[0]} alt={p.name} className="w-16 h-16 rounded-lg object-cover shrink-0" />
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium">{p.name}</h4>
                          {p.categoryId && categories.find((c: any) => c.id === p.categoryId) && (
                            <Badge variant="outline" className="text-xs">
                              {categories.find((c: any) => c.id === p.categoryId)?.name}
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2 mt-1 text-sm text-muted-foreground">
                          {(p.priceMin || p.priceMax) && (
                            <span>價格：{formatNumber(p.priceMin ?? "")}~{formatNumber(p.priceMax ?? "")} 元</span>
                          )}
                          <Badge variant={p.acceptSmallOrder ? "default" : "secondary"} className="text-xs">
                            {p.acceptSmallOrder ? "接小量" : "不接小量"}
                          </Badge>
                          <Badge variant={p.provideSample ? "default" : "secondary"} className="text-xs">
                            {p.provideSample ? "可打樣" : "不打樣"}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    {!isPending && (
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="sm" onClick={() => setEditId(p.id)}><Pencil className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteMut.mutate({ id: p.id, factoryId })}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ===== Product Form =====
function ProductForm({ factoryId, product, onDone }: { factoryId: number; product?: any; onDone: () => void }) {
  const utils = trpc.useUtils();
  const { data: categories = [] } = trpc.category.getByFactory.useQuery({ factoryId });

  const [name, setName] = useState(product?.name ?? "");
  // selectValue drives the <Select> UI; "" = placeholder (new product, unset)
  const initSelect = product?.categoryId ? String(product.categoryId) : product ? "none" : "";
  const [selectValue, setSelectValue] = useState(initSelect);
  const [categoryId, setCategoryId] = useState<number | null>(product?.categoryId ?? null);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [priceType, setPriceType] = useState<"range" | "fixed" | "market">(product?.priceType ?? "range");
  const [priceMin, setPriceMin] = useState(product?.priceMin ? formatNumber(product.priceMin) : "");
  const [priceMax, setPriceMax] = useState(product?.priceMax ? formatNumber(product.priceMax) : "");
  const [priceFixed, setPriceFixed] = useState(product?.priceMin ? formatNumber(product.priceMin) : "");
  const [acceptSmallOrder, setAcceptSmallOrder] = useState(product?.acceptSmallOrder ?? false);
  const [provideSample, setProvideSample] = useState(product?.provideSample ?? false);
  const [description, setDescription] = useState(product?.description ?? "");
  const [images, setImages] = useState<string[]>((product?.images as string[]) ?? []);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const createMut = trpc.product.create.useMutation({ onSuccess: () => { toast.success("產品已新增"); onDone(); }, onError: e => toast.error(e.message) });
  const updateMut = trpc.product.update.useMutation({ onSuccess: () => { toast.success("產品已更新"); onDone(); }, onError: e => toast.error(e.message) });
  const uploadMut = trpc.product.uploadImage.useMutation();
  const createCategoryMut = trpc.category.create.useMutation({
    onSuccess: (result, variables) => {
      utils.category.getByFactory.setData({ factoryId }, (old) =>
        old ? [...old, { id: result.id, factoryId, name: variables.name, sortOrder: old.length, createdAt: new Date() }] : old
      );
      setCategoryId(result.id);
      setSelectValue(String(result.id));
      setShowNewCategory(false);
      setNewCategoryName("");
      toast.success("分類已建立");
      utils.category.getByFactory.invalidate({ factoryId });
    },
    onError: (e) => toast.error(e.message),
  });

  const handleCategorySelectChange = (value: string) => {
    if (value === "__new__") {
      setSelectValue("__new__");
      setShowNewCategory(true);
    } else {
      setSelectValue(value);
      setCategoryId(value === "none" || value === "" ? null : Number(value));
      setShowNewCategory(false);
    }
  };

  const handleCancelNewCategory = () => {
    setShowNewCategory(false);
    setNewCategoryName("");
    setSelectValue(categoryId === null ? (product ? "none" : "") : String(categoryId));
  };

  const handleSaveNewCategory = () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed) { toast.error("請輸入分類名稱"); return; }
    if ((categories as any[]).some((c) => c.name === trimmed)) { toast.error("此分類名稱已存在"); return; }
    createCategoryMut.mutate({ name: trimmed, factoryId });
  };

  const handlePriceChange = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^\d.]/g, "");
    setter(formatNumber(raw));
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    if (images.length + files.length > 3) { toast.error("最多只能上傳 3 張圖片"); return; }
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 5 * 1024 * 1024) { toast.error(`${file.name} 超過 5MB 限制`); continue; }
        const base64 = await compressImage(file);
        const result = await uploadMut.mutateAsync({ factoryId, base64, mimeType: "image/jpeg" });
        setImages(prev => [...prev, result.url]);
      }
    } catch { toast.error("圖片上傳失敗"); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) { toast.error("請輸入產品名稱"); return; }
    const data = {
      factoryId, name, categoryId,
      priceType,
      priceMin: priceType === "range" ? (parseNumber(priceMin) || undefined) : priceType === "fixed" ? (parseNumber(priceFixed) || undefined) : undefined,
      priceMax: priceType === "range" ? (parseNumber(priceMax) || undefined) : priceType === "fixed" ? (parseNumber(priceFixed) || undefined) : undefined,
      acceptSmallOrder, provideSample,
      description: description || undefined,
      images,
    };
    if (product) updateMut.mutate({ ...data, id: product.id });
    else createMut.mutate(data);
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 rounded-lg border bg-muted/20 space-y-3">
      <div><Label>產品名稱 *</Label><Input value={name} onChange={e => setName(e.target.value)} required /></div>

      {/* 商品分類 — 永遠顯示；包含「＋ 新增商品分類」選項 */}
      <div>
        <Label>商品分類</Label>
        <Select value={selectValue} onValueChange={handleCategorySelectChange}>
          <SelectTrigger className="mt-1">
            <SelectValue placeholder="請選擇商品分類" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">未分類</SelectItem>
            {(categories as any[]).map((cat) => (
              <SelectItem key={cat.id} value={String(cat.id)}>{cat.name}</SelectItem>
            ))}
            <SelectSeparator />
            <SelectItem value="__new__" className="text-primary font-medium">
              ＋ 新增商品分類
            </SelectItem>
          </SelectContent>
        </Select>

        {showNewCategory && (
          <div className="mt-2 p-3 border rounded-lg bg-muted/30 space-y-2">
            <Input
              placeholder="輸入分類名稱"
              value={newCategoryName}
              onChange={e => setNewCategoryName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") { e.preventDefault(); handleSaveNewCategory(); }
                if (e.key === "Escape") handleCancelNewCategory();
              }}
              maxLength={100}
              autoFocus
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                onClick={handleSaveNewCategory}
                disabled={createCategoryMut.isPending || !newCategoryName.trim()}
              >
                {createCategoryMut.isPending ? "儲存中…" : "儲存分類"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={handleCancelNewCategory}>取消</Button>
            </div>
          </div>
        )}
      </div>

      {/* 價格模式選擇 */}
      <div>
        <Label>價格方式</Label>
        <div className="flex gap-2 mt-2">
          {[
            { value: "range", label: "價格區間" },
            { value: "fixed", label: "固定金額" },
            { value: "market", label: "時價" },
          ].map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setPriceType(opt.value as any)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                priceType === opt.value
                  ? "bg-orange-500 text-white border-orange-500"
                  : "bg-white text-muted-foreground border-border hover:border-orange-300"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* 根據選擇顯示不同輸入 */}
        <div className="mt-3">
          {priceType === "range" && (
            <div className="grid sm:grid-cols-2 gap-3">
              <div><Label>最低價格</Label><Input value={priceMin} onChange={handlePriceChange(setPriceMin)} placeholder="例：100" /></div>
              <div><Label>最高價格</Label><Input value={priceMax} onChange={handlePriceChange(setPriceMax)} placeholder="例：500" /></div>
            </div>
          )}
          {priceType === "fixed" && (
            <div>
              <Label>固定金額</Label>
              <Input value={priceFixed} onChange={handlePriceChange(setPriceFixed)} placeholder="例：299" />
            </div>
          )}
          {priceType === "market" && (
            <div className="p-3 bg-muted rounded-lg text-sm text-muted-foreground">
              時價：將顯示「依時價報價」，買家聯繫後再議價
            </div>
          )}
        </div>
      </div>

      <div><Label>產品描述</Label><Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} /></div>

      {/* 圖片上傳 */}
      <div>
        <Label>產品圖片（最多 3 張）</Label>
        <div className="flex gap-2 mt-2 flex-wrap">
          {images.map((img, i) => (
            <div key={i} className="relative group">
              <img src={img} alt="" className="w-20 h-20 rounded-lg object-cover border" />
              <button type="button" onClick={() => setImages(prev => prev.filter((_, j) => j !== i))}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {images.length < 3 && (
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
              className="w-20 h-20 rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center text-muted-foreground hover:border-primary hover:text-primary transition-colors">
              {uploading ? <span className="text-xs">上傳中</span> : <><ImagePlus className="w-5 h-5" /><span className="text-xs mt-1">上傳</span></>}
            </button>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
      </div>

      <div className="flex gap-6">
        <label className="flex items-center gap-2"><Switch checked={acceptSmallOrder} onCheckedChange={setAcceptSmallOrder} /><span className="text-sm">接受小量訂單</span></label>
        <label className="flex items-center gap-2"><Switch checked={provideSample} onCheckedChange={setProvideSample} /><span className="text-sm">提供打樣</span></label>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={createMut.isPending || updateMut.isPending}>
          <Save className="w-4 h-4 mr-1" />{product ? "更新" : "新增"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>取消</Button>
      </div>
    </form>
  );
}

// ===== Conversation List =====
function ConversationList({ conversations }: { conversations: any[] }) {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const deleteMut = trpc.chat.deleteConversation.useMutation({
    onSuccess: () => {
      toast.success("對話已刪除");
      utils.chat.factoryConversations.invalidate();
      utils.chat.unreadCount.invalidate();
      utils.notification.getAppBadgeCount.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (conversations.length === 0) {
    return (
      <Card><CardContent className="p-12 text-center text-muted-foreground">
        <MessageCircle className="w-12 h-12 mx-auto mb-4 opacity-30" /><p>尚無客戶詢問</p>
      </CardContent></Card>
    );
  }

  return (
    <Card className="w-full min-w-0 overflow-hidden">
      <CardHeader><CardTitle>客戶詢問</CardTitle><CardDescription>查看並回覆客戶的詢問訊息</CardDescription></CardHeader>
      <CardContent>
        <div className="space-y-2">
          {conversations.map(conv => (
            <div key={conv.id} className="flex items-center gap-2 min-w-0">
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/chat/${conv.id}`, { state: { from: "/dashboard?tab=messages" } })}>
                <div className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/30 transition-colors min-w-0 w-full">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                      <p className="font-medium truncate">{conv.userName}</p>
                      {conv.productName && <Badge variant="outline" className="text-xs shrink-0">{conv.productName}</Badge>}
                    </div>
                    {conv.buyerAffiliation && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        <Link
                          href={`/factory/${conv.buyerAffiliation.factoryId}`}
                          onClick={(e: React.MouseEvent) => e.stopPropagation()}
                          className="hover:underline"
                        >
                          {conv.buyerAffiliation.factoryName}
                        </Link>
                        ・{conv.buyerAffiliation.role === "owner" ? "負責人" : "管理員"}
                      </p>
                    )}
                    {conv.lastMessage && (
                      <p className="text-sm text-muted-foreground truncate mt-0.5">
                        {conv.lastSenderRole === "factory" ? "你：" : ""}{conv.lastMessage}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">{new Date(conv.lastMessageAt).toLocaleDateString("zh-TW")}</span>
                    {conv.unreadCount > 0 && (
                      <span className="h-2.5 w-2.5 rounded-full bg-orange-500 shrink-0" />
                    )}
                  </div>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive shrink-0"
                onClick={() => { if (confirm("確定要刪除此對話嗎？")) deleteMut.mutate({ conversationId: conv.id }); }}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ===== Review List =====
function ReviewList({ reviews, factoryId }: { reviews: any[], factoryId: number }) {
  const utils = trpc.useUtils();
  const [replyingId, setReplyingId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const replyMut = trpc.review.reply.useMutation({
    onSuccess: () => {
      toast.success("回覆已送出");
      setReplyingId(null);
      setReplyText("");
      utils.review.myReviews.invalidate();
      utils.review.getByFactory.invalidate({ factoryId });
      utils.review.unreadCount.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  if (reviews.length === 0) {
    return (
      <Card><CardContent className="p-12 text-center text-muted-foreground">
        <Star className="w-12 h-12 mx-auto mb-4 opacity-30" /><p>尚無客戶評價</p>
      </CardContent></Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>客戶評價</CardTitle><CardDescription>查看客戶對您工廠的評價</CardDescription></CardHeader>
      <CardContent>
        <div className="space-y-3">
          {reviews.map((r: any) => (
            <div key={r.id} className="p-4 rounded-lg border">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{r.userName ?? "匿名使用者"}</span>
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map(s => (
                      <Star key={s} className={`w-3.5 h-3.5 ${r.rating >= s ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground/20"}`} />
                    ))}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString("zh-TW")}</span>
              </div>
              {r.comment && <p className="text-sm text-muted-foreground">{r.comment}</p>}
                    {/* 已有回覆 */}
                    {r.reply && (
                      <div className="mt-2 pl-3 border-l-2 border-orange-200">
                        <p className="text-xs text-orange-700 font-medium mb-0.5">工廠回覆 {r.repliedAt ? `· ${new Date(r.repliedAt).toLocaleDateString("zh-TW")}` : ""}</p>
                        <p className="text-sm text-muted-foreground">{r.reply}</p>
                      </div>
                    )}
                    {/* 回覆入口 */}
                    {replyingId === r.id ? (
                      <div className="mt-2 flex gap-2">
                        <Textarea
                          placeholder="回覆此評價..."
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          rows={2}
                          className="text-sm"
                        />
                        <div className="flex flex-col gap-1">
                          <Button size="sm" disabled={!replyText.trim() || replyMut.isPending} onClick={() => replyMut.mutate({ reviewId: r.id, reply: replyText })}>送出</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setReplyingId(null); setReplyText(""); }}>取消</Button>
                        </div>
                      </div>
                    ) : (
                      <Button size="sm" variant="ghost" className="mt-1 text-xs text-muted-foreground" onClick={() => { setReplyingId(r.id); setReplyText(r.reply ?? ""); }}>
                        {r.reply ? "編輯回覆" : "回覆"}
                      </Button>
                    )}
                  </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ===== Delete Factory Button =====
function DeleteFactoryButton({ factoryId }: { factoryId: number }) {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const deleteMut = trpc.factory.delete.useMutation({
    onSuccess: () => { toast.success("工廠已刪除"); utils.factory.getMine.invalidate(); navigate("/"); },
    onError: (err) => toast.error(err.message),
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10">
          <Trash2 className="w-4 h-4 mr-1" />刪除工廠
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive" />確認刪除工廠
          </AlertDialogTitle>
          <AlertDialogDescription>此操作將永久刪除您的工廠資料及所有產品資訊，且無法復原。確定要繼續嗎？</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => deleteMut.mutate({ id: factoryId })} disabled={deleteMut.isPending}>
            {deleteMut.isPending ? "刪除中..." : "確認刪除"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ===== Co-Manager Panel =====
function CoManagerPanel({ factoryId }: { factoryId: number }) {
  const utils = trpc.useUtils();
  const [email, setEmail] = useState("");

  const { data } = trpc.factory.getCoManagers.useQuery(undefined, { refetchOnWindowFocus: false });

  const inviteMut = trpc.factory.inviteCoManager.useMutation({
    onSuccess: () => {
      toast.success("邀請已送出，對方將在訊息頁看到邀請");
      setEmail("");
      utils.factory.getCoManagers.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const removeMut = trpc.factory.removeCoManager.useMutation({
    onSuccess: () => { toast.success("已移除次管理者"); utils.factory.getCoManagers.invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  const activeCount = data?.coManagers.length ?? 0;

  return (
    <Card className="mt-6 overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="w-4 h-4 shrink-0" />共同管理者
        </CardTitle>
        <CardDescription className="text-xs">
          可邀請最多 6 位次管理者共同編輯工廠後台。次管理者無法刪除工廠或管理其他管理者。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-sm font-medium mb-1.5 block">邀請次管理者</Label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="email"
              placeholder="輸入對方在 OXM 註冊的 Gmail..."
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && email.trim() && inviteMut.mutate({ email: email.trim() })}
              className="flex-1 min-w-0 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <Button
              size="sm"
              className="w-full sm:w-auto shrink-0"
              onClick={() => inviteMut.mutate({ email: email.trim() })}
              disabled={!email.trim() || inviteMut.isPending || activeCount >= 6}
            >
              {inviteMut.isPending ? "送出中..." : "送出邀請"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            對方需已在 OXM 上註冊，邀請有效期 7 天。目前 {activeCount} / 6 位。
          </p>
        </div>

        {activeCount > 0 && (
          <div>
            <Label className="text-sm font-medium mb-2 block">目前次管理者</Label>
            <div className="space-y-2">
              {data!.coManagers.map((cm) => (
                <div key={cm.id} className="flex items-center gap-2 p-2.5 rounded-lg border bg-muted/30 min-w-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{cm.name ?? "未知用戶"}</p>
                    <p className="text-xs text-muted-foreground break-all">{cm.email}</p>
                  </div>
                  <div className="shrink-0">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10">
                          <UserMinus className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>確認移除次管理者</AlertDialogTitle>
                          <AlertDialogDescription>
                            確定要移除 {cm.name ?? cm.email} 的次管理者權限？對方將無法繼續存取此工廠後台。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>取消</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => removeMut.mutate({ userId: cm.userId })}
                          >
                            確認移除
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {(data?.pending.length ?? 0) > 0 && (
          <div>
            <Label className="text-sm font-medium mb-2 block text-muted-foreground">待確認邀請</Label>
            <div className="space-y-2">
              {data!.pending.map((inv) => (
                <div key={inv.id} className="flex items-center gap-2 p-2.5 rounded-lg border border-dashed min-w-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm break-all">{inv.name ?? inv.email}</p>
                    <p className="text-xs text-muted-foreground">
                      截止：{new Date(inv.expiresAt).toLocaleDateString("zh-TW")}
                    </p>
                  </div>
                  <Badge variant="secondary" className="text-xs shrink-0">等待回覆</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeCount === 0 && (data?.pending.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground text-center py-2">尚未邀請任何次管理者</p>
        )}
      </CardContent>
    </Card>
  );
}

// ===== 訂單管理 Tab =====
const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: "待需求方同意",
  accepted: "已成立",
  rejected: "已拒絕",
  in_progress: "製作中",
  shipped: "已出貨",
  completed: "已完成",
  cancelled: "已取消",
  cancel_requested: "取消申請中",
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  accepted: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  in_progress: "bg-blue-100 text-blue-800",
  shipped: "bg-purple-100 text-purple-800",
  completed: "bg-orange-100 text-orange-800",
  cancelled: "bg-gray-100 text-gray-600",
  cancel_requested: "bg-red-100 text-red-700",
};

function ReceivedOrdersPanel({ factoryId }: { factoryId: number }) {
  const utils = trpc.useUtils();
  const { data: orders = [], isLoading } = trpc.collaborationOrder.listForFactory.useQuery({ factoryId });
  const [cancelTarget, setCancelTarget] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const updateMut = trpc.collaborationOrder.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("狀態已更新");
      utils.collaborationOrder.listForFactory.invalidate({ factoryId });
    },
    onError: e => toast.error(e.message),
  });

  const requestCancelMut = trpc.collaborationOrder.requestCancel.useMutation({
    onSuccess: () => {
      toast.success("取消申請已送出，等待需求方回覆");
      setCancelTarget(null);
      setCancelReason("");
      utils.collaborationOrder.listForFactory.invalidate({ factoryId });
    },
    onError: e => toast.error(e.message),
  });

  if (isLoading) {
    return <div className="py-12 text-center text-muted-foreground text-sm">載入中…</div>;
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground gap-3">
        <ClipboardList className="w-12 h-12 opacity-30" />
        <div>
          <p className="text-lg font-medium text-foreground">尚無承接訂單</p>
          <p className="text-sm mt-1">當其他使用者向你的工廠確認合作後，訂單會顯示在這裡。</p>
        </div>
      </div>
    );
  }

  function nextStatuses(status: string): { value: string; label: string }[] {
    const map: Record<string, string[]> = {
      accepted: ["in_progress"],
      in_progress: ["shipped"],
      shipped: ["completed"],
    };
    return (map[status] ?? []).map(s => ({ value: s, label: ORDER_STATUS_LABEL[s] }));
  }

  const cancelTargetOrder = orders.find(o => o.id === cancelTarget);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="w-4 h-4 text-orange-500" />
            承接訂單
          </CardTitle>
          <CardDescription>管理其他使用者向此工廠建立的合作確認單</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {orders.map(order => {
            const nexts = nextStatuses(order.status);
            const canCancel = ["pending", "accepted", "in_progress", "shipped"].includes(order.status);
            const backTo = encodeURIComponent("/dashboard?tab=orders");
            return (
              <div key={order.id} className="rounded-lg border p-3 space-y-2">
                {/* Header: name | metadata | badge */}
                <div className="flex items-start gap-2">
                  <div className="shrink-0" style={{ minWidth: "28%" }}>
                    <p className="font-medium text-sm leading-tight">{order.projectName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {order.productName ? `商品：${order.productName}` : "手動輸入"}
                    </p>
                  </div>
                  {/* Metadata — desktop: inline; mobile: separate row below */}
                  <div className="flex-1 hidden sm:grid sm:grid-cols-3 gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>需求方：{order.buyerName ?? "—"}</span>
                    {order.depositDueDate && <span>首款：{order.depositDueDate.slice(5).replace("-", "/")}</span>}
                    {order.productionStartDate && <span>製作：{order.productionStartDate.slice(5).replace("-", "/")}</span>}
                    {order.expectedShipmentDate && <span>出貨：{order.expectedShipmentDate.slice(5).replace("-", "/")}</span>}
                    {order.finalPaymentDueDate && <span>尾款：{order.finalPaymentDueDate.slice(5).replace("-", "/")}</span>}
                    <span>建立：{new Date(order.createdAt).toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" })}</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_BADGE_CLASS[order.status] ?? STATUS_BADGE_CLASS.pending}`}>
                    {ORDER_STATUS_LABEL[order.status] ?? order.status}
                  </span>
                </div>
                {/* Mobile metadata */}
                <div className="grid grid-cols-2 sm:hidden gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span>需求方：{order.buyerName ?? "—"}</span>
                  {order.depositDueDate && <span>首款：{order.depositDueDate.slice(5).replace("-", "/")}</span>}
                  {order.expectedShipmentDate && <span>出貨：{order.expectedShipmentDate.slice(5).replace("-", "/")}</span>}
                  {order.finalPaymentDueDate && <span>尾款：{order.finalPaymentDueDate.slice(5).replace("-", "/")}</span>}
                  <span className="col-span-2">建立：{new Date(order.createdAt).toLocaleDateString("zh-TW")}</span>
                </div>

                {order.status === "cancel_requested" && order.cancelRequestReason && (
                  <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">
                    取消原因：{order.cancelRequestReason}
                  </p>
                )}

                {/* Timeline bar */}
                <OrderTimelineBar order={order} compact />

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  {nexts.map(n => (
                    <Button
                      key={n.value}
                      size="sm"
                      className="bg-orange-500 hover:bg-orange-600 text-white"
                      disabled={updateMut.isPending}
                      onClick={() => updateMut.mutate({ orderId: order.id, status: n.value as any })}
                    >
                      {n.label}
                    </Button>
                  ))}
                  {canCancel && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive border-destructive hover:bg-destructive/5"
                      onClick={() => setCancelTarget(order.id)}
                    >
                      申請取消
                    </Button>
                  )}
                  <div className="ml-auto flex gap-3">
                    <Link href={`/orders/${order.id}?backTo=${backTo}`} className="text-xs text-orange-600 hover:underline font-medium">
                      查看訂單 →
                    </Link>
                    <Link href={`/chat/${order.conversationId}`} className="text-xs text-blue-600 hover:underline">
                      查看對話 →
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* 申請取消 Dialog */}
      <Dialog open={cancelTarget !== null} onOpenChange={open => { if (!open) { setCancelTarget(null); setCancelReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>申請取消合作</DialogTitle>
            <DialogDescription>送出後需求方需在聊天室同意或拒絕取消申請</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {cancelTargetOrder && (
              <div>
                <Label className="text-sm">合作項目</Label>
                <p className="text-sm text-muted-foreground mt-0.5">{cancelTargetOrder.projectName}</p>
              </div>
            )}
            <div>
              <Label className="text-sm">取消原因 *</Label>
              <Textarea
                className="mt-1"
                placeholder="請說明申請取消的原因…"
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCancelTarget(null); setCancelReason(""); }}>關閉</Button>
            <Button
              className="bg-red-500 hover:bg-red-600 text-white"
              disabled={!cancelReason.trim() || requestCancelMut.isPending || cancelTarget === null}
              onClick={() => {
                if (cancelTarget !== null) {
                  requestCancelMut.mutate({ orderId: cancelTarget, reason: cancelReason.trim() });
                }
              }}
            >
              送出取消申請
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PlacedOrdersPanel({ factoryId }: { factoryId: number }) {
  const { data: orders = [], isLoading } = trpc.collaborationOrder.listPlacedByFactory.useQuery({ factoryId });

  if (isLoading) {
    return <div className="py-12 text-center text-muted-foreground text-sm">載入中…</div>;
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground gap-3">
        <ClipboardList className="w-12 h-12 opacity-30" />
        <div>
          <p className="text-lg font-medium text-foreground">尚無下訂訂單</p>
          <p className="text-sm mt-1">當你以此工廠身分接受其他工廠的合作確認單後，訂單會顯示在這裡。</p>
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="w-4 h-4 text-orange-500" />
          下訂訂單
        </CardTitle>
        <CardDescription>以此工廠身分承接的對外合作訂單</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {orders.map(order => {
          const backTo = encodeURIComponent("/dashboard?tab=orders");
          return (
            <div key={order.id} className="rounded-lg border p-3 space-y-2">
              {/* Header */}
              <div className="flex items-start gap-2">
                <div className="shrink-0" style={{ minWidth: "28%" }}>
                  <p className="font-medium text-sm leading-tight">{order.projectName}</p>
                  {order.sellerFactoryName && (
                    <p className="text-xs text-muted-foreground mt-0.5">供應：{order.sellerFactoryName}</p>
                  )}
                </div>
                <div className="flex-1 hidden sm:grid sm:grid-cols-3 gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {order.depositDueDate && <span>首款：{order.depositDueDate.slice(5).replace("-", "/")}</span>}
                  {order.productionStartDate && <span>製作：{order.productionStartDate.slice(5).replace("-", "/")}</span>}
                  {order.expectedShipmentDate && <span>出貨：{order.expectedShipmentDate.slice(5).replace("-", "/")}</span>}
                  {order.finalPaymentDueDate && <span>尾款：{order.finalPaymentDueDate.slice(5).replace("-", "/")}</span>}
                  <span>建立：{new Date(order.createdAt).toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" })}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_BADGE_CLASS[order.status] ?? STATUS_BADGE_CLASS.pending}`}>
                  {ORDER_STATUS_LABEL[order.status] ?? order.status}
                </span>
              </div>
              {/* Mobile metadata */}
              <div className="grid grid-cols-2 sm:hidden gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {order.depositDueDate && <span>首款：{order.depositDueDate.slice(5).replace("-", "/")}</span>}
                {order.expectedShipmentDate && <span>出貨：{order.expectedShipmentDate.slice(5).replace("-", "/")}</span>}
                {order.finalPaymentDueDate && <span>尾款：{order.finalPaymentDueDate.slice(5).replace("-", "/")}</span>}
                <span className="col-span-2">建立：{new Date(order.createdAt).toLocaleDateString("zh-TW")}</span>
              </div>

              {/* Timeline bar */}
              <OrderTimelineBar order={order} compact />

              {/* Links */}
              <div className="flex gap-3">
                <Link href={`/orders/${order.id}?backTo=${backTo}`} className="text-xs text-orange-600 hover:underline font-medium">
                  查看訂單 →
                </Link>
                <Link href={`/chat/${order.conversationId}`} className="text-xs text-blue-600 hover:underline">
                  查看對話 →
                </Link>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function CollaborationOrdersTab({ factoryId }: { factoryId: number }) {
  const [subTab, setSubTab] = useState<"received" | "placed">("received");
  return (
    <Tabs value={subTab} onValueChange={v => setSubTab(v as "received" | "placed")}>
      <TabsList className="mb-4">
        <TabsTrigger value="received">承接訂單</TabsTrigger>
        <TabsTrigger value="placed">下訂訂單</TabsTrigger>
      </TabsList>
      <TabsContent value="received">
        <ReceivedOrdersPanel factoryId={factoryId} />
      </TabsContent>
      <TabsContent value="placed">
        <PlacedOrdersPanel factoryId={factoryId} />
      </TabsContent>
    </Tabs>
  );
}
