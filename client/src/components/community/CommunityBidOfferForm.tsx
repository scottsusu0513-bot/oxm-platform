import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, X, ShoppingBag, Paperclip } from "lucide-react";
import { toast } from "sonner";
import CommunityImageUploader from "./CommunityImageUploader";
import type { CommunityBidOffer } from "../../../../drizzle/schema";

interface Props {
  bidId: number;
  bidderFactoryId: number;
  existingOffer?: CommunityBidOffer | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function CommunityBidOfferForm({ bidId, bidderFactoryId, existingOffer, onSuccess, onCancel }: Props) {
  const isEdit = !!existingOffer && existingOffer.status === "active";
  const isResubmit = !!existingOffer && existingOffer.status === "withdrawn";

  const [proposal, setProposal] = useState(existingOffer?.proposal ?? "");
  const [amount, setAmount] = useState(existingOffer?.amount?.toString() ?? "");
  const [deliveryDays, setDeliveryDays] = useState(existingOffer?.deliveryDays?.toString() ?? "");
  const [moq, setMoq] = useState(existingOffer?.moq?.toString() ?? "");
  const [sampleAvailable, setSampleAvailable] = useState(existingOffer?.sampleAvailable ?? false);
  const [commercialTerms, setCommercialTerms] = useState(existingOffer?.commercialTerms ?? "");
  const [images, setImages] = useState<string[]>((existingOffer?.images as string[]) ?? []);
  const [pinnedProductIds, setPinnedProductIds] = useState<Set<number>>(
    new Set((existingOffer?.pinnedProductIds as number[]) ?? []),
  );
  const [isUploading, setIsUploading] = useState(false);

  const utils = trpc.useUtils();

  // Factory products for the product picker (clears when factory changes)
  const { data: productsData } = trpc.product.getByFactory.useQuery(
    { factoryId: bidderFactoryId },
    { staleTime: 60_000 },
  );
  const factoryProducts = productsData ?? [];

  const createMutation = trpc.community.createBidOffer.useMutation({
    onSuccess: () => {
      toast.success("投標成功");
      utils.community.getMyBidOffer.invalidate({ bidId });
      utils.community.getBidOfferCount.invalidate({ bidId });
      utils.community.listBidOffersForOwner.invalidate({ bidId });
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.community.updateBidOffer.useMutation({
    onSuccess: (data) => {
      toast.success("投標已更新");
      if (data.removedProductCount > 0) {
        toast.warning(`${data.removedProductCount} 個商品已下架，已自動從投標中移除`);
      }
      utils.community.getMyBidOffer.invalidate({ bidId });
      utils.community.listBidOffersForOwner.invalidate({ bidId });
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  const resubmitMutation = trpc.community.resubmitBidOffer.useMutation({
    onSuccess: (data) => {
      toast.success("已重新投標");
      if (data.removedProductCount > 0) {
        toast.warning(`${data.removedProductCount} 個商品已下架，已自動從投標中移除`);
      }
      utils.community.getMyBidOffer.invalidate({ bidId });
      utils.community.getBidOfferCount.invalidate({ bidId });
      utils.community.listBidOffersForOwner.invalidate({ bidId });
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  const isPending = createMutation.isPending || updateMutation.isPending || resubmitMutation.isPending;

  function toggleProduct(id: number) {
    setPinnedProductIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 5) {
        next.add(id);
      } else {
        toast.error("最多選擇 5 個商品");
      }
      return next;
    });
  }

  function parseOptionalInt(v: string, max: number): number | null | "invalid" {
    if (!v.trim()) return null;
    const n = parseInt(v, 10);
    if (isNaN(n) || n < 1 || n > max) return "invalid";
    return n;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedProposal = proposal.trim();
    if (!trimmedProposal) { toast.error("請填寫投標說明"); return; }
    if (trimmedProposal.length > 5000) { toast.error("投標說明不可超過 5000 字"); return; }
    if (isUploading) { toast.error("圖片上傳中，請稍後再送出"); return; }

    const amountVal = parseOptionalInt(amount, 999999999999);
    if (amountVal === "invalid") { toast.error("報價金額請填寫 1 到 999,999,999,999 的整數"); return; }
    const deliveryDaysVal = parseOptionalInt(deliveryDays, 3650);
    if (deliveryDaysVal === "invalid") { toast.error("交期請填寫 1 到 3650 天"); return; }
    const moqVal = parseOptionalInt(moq, 9999999);
    if (moqVal === "invalid") { toast.error("MOQ 請填寫正整數"); return; }

    const base = {
      proposal: trimmedProposal,
      amount: amountVal,
      deliveryDays: deliveryDaysVal,
      moq: moqVal,
      sampleAvailable,
      commercialTerms: commercialTerms.trim() || null,
      images,
      pinnedProductIds: Array.from(pinnedProductIds),
    };

    if (!isEdit && !isResubmit) {
      createMutation.mutate({ bidId, bidderFactoryId, ...base });
    } else if (isResubmit) {
      resubmitMutation.mutate({ offerId: existingOffer!.id, ...base });
    } else {
      updateMutation.mutate({ offerId: existingOffer!.id, ...base });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xl bg-background rounded-xl shadow-lg border border-border overflow-y-auto max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold">
            {isResubmit ? "重新投標" : isEdit ? "修改投標" : "提交投標"}
          </h2>
          <button type="button" onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {/* Proposal */}
          <div>
            <Label htmlFor="offer-proposal" className="text-sm font-medium">
              投標說明 <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="offer-proposal"
              value={proposal}
              onChange={e => setProposal(e.target.value)}
              placeholder="說明貴廠的生產能力、品質保證、服務特色..."
              rows={5}
              maxLength={5000}
              className="mt-1 text-sm"
              required
            />
            <p className="text-xs text-muted-foreground mt-0.5 text-right">{proposal.length}/5000</p>
          </div>

          {/* Amount + DeliveryDays */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="offer-amount" className="text-sm font-medium">報價金額（NTD，選填）</Label>
              <Input
                id="offer-amount"
                type="number"
                min={1}
                max={999999999999}
                step={1}
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="例：50000"
                className="mt-1 text-sm"
              />
            </div>
            <div>
              <Label htmlFor="offer-delivery" className="text-sm font-medium">交期天數（選填）</Label>
              <Input
                id="offer-delivery"
                type="number"
                min={1}
                max={3650}
                step={1}
                value={deliveryDays}
                onChange={e => setDeliveryDays(e.target.value)}
                placeholder="例：30"
                className="mt-1 text-sm"
              />
            </div>
          </div>

          {/* MOQ + Sample */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="offer-moq" className="text-sm font-medium">最低起訂量 MOQ（選填）</Label>
              <Input
                id="offer-moq"
                type="number"
                min={1}
                step={1}
                value={moq}
                onChange={e => setMoq(e.target.value)}
                placeholder="例：100"
                className="mt-1 text-sm"
              />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sampleAvailable}
                  onChange={e => setSampleAvailable(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <span className="text-sm">可提供樣品</span>
              </label>
            </div>
          </div>

          {/* Commercial terms */}
          <div>
            <Label htmlFor="offer-terms" className="text-sm font-medium">商業條款（選填）</Label>
            <Textarea
              id="offer-terms"
              value={commercialTerms}
              onChange={e => setCommercialTerms(e.target.value)}
              placeholder="付款條件、保固、其他商業條款..."
              rows={3}
              maxLength={5000}
              className="mt-1 text-sm"
            />
          </div>

          {/* Images */}
          <div>
            <Label className="text-sm font-medium">參考圖片（最多 6 張，選填）</Label>
            <div className="mt-1">
              <CommunityImageUploader
                images={images}
                onChange={setImages}
                disabled={isPending}
                onUploadingChange={setIsUploading}
              />
            </div>
          </div>

          {/* Factory product picker */}
          {factoryProducts.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <ShoppingBag className="w-3.5 h-3.5 text-muted-foreground" />
                <Label className="text-sm font-medium">附加貴廠商品（最多 5 個，選填）</Label>
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto rounded-lg border border-border p-2">
                {factoryProducts.map(p => (
                  <label
                    key={p.id}
                    className="flex items-center gap-2.5 cursor-pointer rounded-md px-2 py-1.5 hover:bg-muted/40 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={pinnedProductIds.has(p.id)}
                      onChange={() => toggleProduct(p.id)}
                      className="w-4 h-4 rounded shrink-0"
                    />
                    {(p.images as string[] | null)?.[0] && (
                      <img
                        src={(p.images as string[])[0]}
                        alt={p.name}
                        className="w-8 h-8 rounded object-cover shrink-0"
                      />
                    )}
                    <span className="text-sm truncate flex-1">{p.name}</span>
                  </label>
                ))}
              </div>
              {pinnedProductIds.size > 0 && (
                <p className="text-xs text-muted-foreground mt-1">已選 {pinnedProductIds.size}/5</p>
              )}
            </div>
          )}

          {/* Attachment notice */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Paperclip className="w-3.5 h-3.5 shrink-0" />
            <span>附件功能尚未支援，如需傳遞附件請在商業條款欄說明</span>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
              取消
            </Button>
            <Button type="submit" disabled={isPending || isUploading || !proposal.trim()}>
              {(isPending || isUploading) ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              {isUploading ? "上傳中..." : isResubmit ? "重新投標" : isEdit ? "更新投標" : "提交投標"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
