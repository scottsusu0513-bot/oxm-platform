import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, ShoppingBag } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { COMMUNITY_CROSS_INDUSTRY_SLUG } from "@shared/const";
import { INDUSTRY_OPTIONS, INDUSTRY_SLUGS } from "@shared/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import CommunityImageUploader from "./CommunityImageUploader";

const schema = z.object({
  title: z.string().min(1, "請填寫需求標題").max(200),
  description: z.string().min(1, "請描述您的需求").max(10000),
  quantity: z.string().max(200).optional(),
  material: z.string().max(200).optional(),
  specifications: z.string().max(5000).optional(),
  sampleRequired: z.boolean(),
  desiredDeliveryDate: z.string().max(100).optional(),
  deliveryLocation: z.string().max(200).optional(),
  budgetMin: z.string().optional(),
  budgetMax: z.string().optional(),
  durationHours: z.number().int().min(1).max(168),
  targetIndustrySpaceCodes: z.array(z.string()).optional(),
});

type FormData = {
  title: string;
  description: string;
  quantity?: string;
  material?: string;
  specifications?: string;
  sampleRequired: boolean;
  desiredDeliveryDate?: string;
  deliveryLocation?: string;
  budgetMin?: string;
  budgetMax?: string;
  durationHours: number;
  targetIndustrySpaceCodes?: string[];
};

const DURATION_OPTIONS = [
  { label: "1 小時", value: 1 },
  { label: "6 小時", value: 6 },
  { label: "24 小時", value: 24 },
  { label: "3 天", value: 72 },
  { label: "7 天", value: 168 },
];

const INDUSTRY_SLUG_LIST = Array.from(INDUSTRY_OPTIONS)
  .map(name => ({ name, slug: INDUSTRY_SLUGS[name] ?? "" }))
  .filter(t => t.slug !== "");

interface Props {
  spaceCode: string;
  existingBidId?: number;
  existingAuthorFactoryId?: number | null;
  defaultValues?: Partial<FormData & { images: string[]; pinnedProductIds: number[] }>;
  onSuccess: (bidId: number) => void;
  onCancel: () => void;
}

export default function CommunityBidForm({ spaceCode, existingBidId, existingAuthorFactoryId, defaultValues, onSuccess, onCancel }: Props) {
  const isCrossIndustry = spaceCode === COMMUNITY_CROSS_INDUSTRY_SLUG;
  const [selectedIndustries, setSelectedIndustries] = useState<Set<string>>(
    new Set(defaultValues?.targetIndustrySpaceCodes ?? [])
  );
  const [images, setImages] = useState<string[]>(defaultValues?.images ?? []);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>(defaultValues?.pinnedProductIds ?? []);
  const [selectedFactoryId, setSelectedFactoryId] = useState<string>(
    existingAuthorFactoryId != null ? String(existingAuthorFactoryId) : ""
  );

  // Load identity options (only for new bids; editing keeps the original factory)
  const { data: identityData, isLoading: identityLoading } = trpc.community.getMyIdentityOptions.useQuery(
    undefined,
    { enabled: !existingBidId }
  );

  const factories = existingBidId
    ? []
    : ((identityData?.identities ?? []).filter(i => i.type === "factory") as
        Array<{ type: "factory"; factoryId: number; label: string; role: string }>);

  // Active factory for product loading
  const activeFactoryId = existingBidId
    ? existingAuthorFactoryId ?? null
    : factories.length === 1
      ? factories[0].factoryId
      : factories.length > 1 && selectedFactoryId
        ? parseInt(selectedFactoryId, 10)
        : null;

  const [staleProductCount, setStaleProductCount] = useState(0);
  const staleChecked = useRef(false);

  const { data: factoryProducts } = trpc.product.getByFactory.useQuery(
    { factoryId: activeFactoryId! },
    { enabled: activeFactoryId != null },
  );

  // On edit: when factory products load, filter out stale pinnedProductIds and warn
  useEffect(() => {
    if (!existingBidId || !factoryProducts || staleChecked.current) return;
    staleChecked.current = true;
    const validIds = new Set(factoryProducts.map(p => p.id));
    const original = defaultValues?.pinnedProductIds ?? [];
    const valid = original.filter(id => validIds.has(id));
    const staleCount = original.length - valid.length;
    if (staleCount > 0) {
      setSelectedProductIds(valid);
      setStaleProductCount(staleCount);
    }
  }, [factoryProducts, existingBidId]);

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: defaultValues?.title ?? "",
      description: defaultValues?.description ?? "",
      quantity: defaultValues?.quantity ?? "",
      material: defaultValues?.material ?? "",
      specifications: defaultValues?.specifications ?? "",
      sampleRequired: defaultValues?.sampleRequired ?? false,
      desiredDeliveryDate: defaultValues?.desiredDeliveryDate ?? "",
      deliveryLocation: defaultValues?.deliveryLocation ?? "",
      budgetMin: defaultValues?.budgetMin ?? "",
      budgetMax: defaultValues?.budgetMax ?? "",
      durationHours: defaultValues?.durationHours ?? 168,
    },
  });

  const createMutation = trpc.community.createBid.useMutation({
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.community.updateBid.useMutation({
    onError: (e) => toast.error(e.message),
  });
  const submitMutation = trpc.community.submitBid.useMutation({
    onError: (e) => toast.error(e.message),
  });

  const isSubmitting = createMutation.isPending || updateMutation.isPending || submitMutation.isPending;

  const handleFactoryChange = (val: string) => {
    setSelectedFactoryId(val);
    setSelectedProductIds([]); // clear on factory change
  };

  const toggleProduct = (id: number) => {
    setSelectedProductIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 5) { toast.error("最多選擇 5 個商品"); return prev; }
      return [...prev, id];
    });
  };

  async function onSubmit(data: FormData, andSubmit: boolean) {
    if (isCrossIndustry && selectedIndustries.size === 0) return;

    // Resolve authorFactoryId for new bids
    let authorFactoryId: number | undefined;
    if (!existingBidId) {
      if (factories.length === 0) {
        authorFactoryId = undefined;
      } else if (factories.length === 1) {
        authorFactoryId = factories[0].factoryId;
      } else {
        if (!selectedFactoryId) { toast.error("請選擇代表工廠"); return; }
        authorFactoryId = parseInt(selectedFactoryId, 10);
      }
    }

    const budgetMin = data.budgetMin ? parseInt(data.budgetMin, 10) || null : null;
    const budgetMax = data.budgetMax ? parseInt(data.budgetMax, 10) || null : null;

    try {
      let bidId: number;

      if (existingBidId) {
        await updateMutation.mutateAsync({
          bidId: existingBidId,
          title: data.title,
          description: data.description,
          quantity: data.quantity || null,
          material: data.material || null,
          specifications: data.specifications || null,
          sampleRequired: data.sampleRequired,
          desiredDeliveryDate: data.desiredDeliveryDate || null,
          deliveryLocation: data.deliveryLocation || null,
          budgetMin,
          budgetMax,
          images,
          pinnedProductIds: selectedProductIds,
          durationHours: data.durationHours,
          targetIndustrySpaceCodes: isCrossIndustry ? Array.from(selectedIndustries) : [],
        });
        bidId = existingBidId;
      } else {
        const res = await createMutation.mutateAsync({
          spaceCode,
          title: data.title,
          description: data.description,
          quantity: data.quantity || null,
          material: data.material || null,
          specifications: data.specifications || null,
          sampleRequired: data.sampleRequired,
          desiredDeliveryDate: data.desiredDeliveryDate || null,
          deliveryLocation: data.deliveryLocation || null,
          budgetMin,
          budgetMax,
          images,
          pinnedProductIds: selectedProductIds,
          durationHours: data.durationHours,
          authorFactoryId,
          targetIndustrySpaceCodes: isCrossIndustry ? Array.from(selectedIndustries) : [],
        });
        bidId = res.bidId;
      }

      if (andSubmit) {
        await submitMutation.mutateAsync({ bidId });
      }

      onSuccess(bidId);
    } catch {
      // errors shown via toast
    }
  }

  return (
    <Dialog open onOpenChange={() => onCancel()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existingBidId ? "編輯需求" : "發布採購需求"}</DialogTitle>
        </DialogHeader>

        <form className="space-y-4 py-2">
          {/* Author identity — only on new bids when there's something to decide */}
          {!existingBidId && (
            identityLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                載入身份資訊…
              </div>
            ) : factories.length === 1 ? (
              <div className="text-sm text-muted-foreground">
                代表工廠：<span className="font-medium text-foreground">{factories[0].label}</span>
                {factories[0].role === "co_manager" && <span className="ml-1 text-xs">（共管）</span>}
              </div>
            ) : factories.length > 1 ? (
              <div className="space-y-1.5">
                <Label className="text-sm">代表工廠 *</Label>
                <Select value={selectedFactoryId} onValueChange={handleFactoryChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="請選擇代表工廠" />
                  </SelectTrigger>
                  <SelectContent>
                    {factories.map(f => (
                      <SelectItem key={f.factoryId} value={String(f.factoryId)}>
                        {f.label}{f.role === "co_manager" ? "（共管）" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null
          )}

          <div>
            <Label htmlFor="bid-title">需求標題 *</Label>
            <Input id="bid-title" {...register("title")} placeholder="例：需要不鏽鋼零件加工廠" className="mt-1" />
            {errors.title && <p className="text-xs text-destructive mt-1">{errors.title.message}</p>}
          </div>

          <div>
            <Label htmlFor="bid-description">需求說明 *</Label>
            <Textarea
              id="bid-description"
              {...register("description")}
              placeholder="詳細描述您的需求、規格要求、數量、用途等..."
              rows={4}
              className="mt-1"
            />
            {errors.description && <p className="text-xs text-destructive mt-1">{errors.description.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="bid-quantity">數量</Label>
              <Input id="bid-quantity" {...register("quantity")} placeholder="例：1000 件" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="bid-material">材質</Label>
              <Input id="bid-material" {...register("material")} placeholder="例：SUS316" className="mt-1" />
            </div>
          </div>

          <div>
            <Label htmlFor="bid-specs">詳細規格</Label>
            <Textarea
              id="bid-specs"
              {...register("specifications")}
              placeholder="尺寸、公差、表面處理等..."
              rows={3}
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="bid-delivery-date">期望交期</Label>
              <Input id="bid-delivery-date" {...register("desiredDeliveryDate")} placeholder="例：2026 Q3" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="bid-location">交貨地點</Label>
              <Input id="bid-location" {...register("deliveryLocation")} placeholder="例：台北市" className="mt-1" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="bid-budget-min">預算下限（NT$）</Label>
              <Input id="bid-budget-min" type="number" min={0} {...register("budgetMin")} placeholder="選填" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="bid-budget-max">預算上限（NT$）</Label>
              <Input id="bid-budget-max" type="number" min={0} {...register("budgetMax")} placeholder="選填" className="mt-1" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="bid-sample"
              checked={watch("sampleRequired")}
              onCheckedChange={(v) => setValue("sampleRequired", Boolean(v))}
            />
            <Label htmlFor="bid-sample" className="font-normal cursor-pointer">需要樣品</Label>
          </div>

          {/* Images */}
          <div className="space-y-1.5">
            <Label>附加圖片（最多 6 張）</Label>
            <CommunityImageUploader
              images={images}
              onChange={setImages}
              disabled={isSubmitting}
              onUploadingChange={setIsUploading}
            />
          </div>

          {/* Pinned products — only shown when a factory is active */}
          {activeFactoryId != null && factoryProducts && factoryProducts.length > 0 && (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <ShoppingBag className="w-3.5 h-3.5" />
                附加商品（最多 5 個）
              </Label>
              <div className="rounded-lg border border-border divide-y divide-border max-h-40 overflow-y-auto">
                {factoryProducts.map(p => (
                  <label
                    key={p.id}
                    className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors"
                  >
                    <Checkbox
                      checked={selectedProductIds.includes(p.id)}
                      onCheckedChange={() => toggleProduct(p.id)}
                    />
                    {(p.images as string[] | null)?.[0] && (
                      <img src={(p.images as string[])[0]} alt={p.name} className="w-8 h-8 rounded object-cover shrink-0" />
                    )}
                    <span className="text-sm truncate">{p.name}</span>
                  </label>
                ))}
              </div>
              {selectedProductIds.length > 0 && (
                <p className="text-xs text-muted-foreground">已選 {selectedProductIds.length} / 5 個</p>
              )}
              {staleProductCount > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  部分原先附加的商品已失效，已自動移除（{staleProductCount} 個）
                </p>
              )}
            </div>
          )}

          {/* Attachment notice */}
          <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            附件功能尚未支援，將於後續版本推出
          </div>

          {isCrossIndustry && (
            <div>
              <Label>目標產業（至少選一項）*</Label>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto border rounded-md p-3 bg-muted/30">
                {INDUSTRY_SLUG_LIST.map(({ name, slug }) => (
                  <div key={slug} className="flex items-center gap-2">
                    <Checkbox
                      id={`ind-${slug}`}
                      checked={selectedIndustries.has(slug)}
                      onCheckedChange={(v) => {
                        setSelectedIndustries(prev => {
                          const next = new Set(prev);
                          if (v) next.add(slug); else next.delete(slug);
                          return next;
                        });
                      }}
                    />
                    <label htmlFor={`ind-${slug}`} className="text-xs cursor-pointer leading-tight">{name}</label>
                  </div>
                ))}
              </div>
              {isCrossIndustry && selectedIndustries.size === 0 && (
                <p className="text-xs text-destructive mt-1">請至少選擇一個目標產業</p>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="bid-duration">競標開放時間</Label>
            <Select
              value={String(watch("durationHours"))}
              onValueChange={(v) => setValue("durationHours", parseInt(v, 10))}
            >
              <SelectTrigger id="bid-duration" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATION_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">審核通過後開始計時，最短 1 小時，最長 7 天</p>
          </div>
        </form>

        <DialogFooter className="gap-2 flex-wrap sm:flex-nowrap">
          <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>取消</Button>
          <Button
            variant="outline"
            disabled={isSubmitting || isUploading || (isCrossIndustry && selectedIndustries.size === 0) || (!existingBidId && factories.length > 1 && !selectedFactoryId)}
            onClick={handleSubmit((data: FormData) => onSubmit(data, false))}
          >
            {(isSubmitting || isUploading) ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
            {isUploading ? "上傳中…" : "儲存草稿"}
          </Button>
          <Button
            disabled={isSubmitting || isUploading || (isCrossIndustry && selectedIndustries.size === 0) || (!existingBidId && factories.length > 1 && !selectedFactoryId)}
            onClick={handleSubmit((data: FormData) => onSubmit(data, true))}
          >
            {(isSubmitting || isUploading) ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
            {isUploading ? "上傳中…" : "送審"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
