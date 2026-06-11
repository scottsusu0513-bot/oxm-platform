import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, ShoppingBag } from "lucide-react";
import CommunityImageUploader from "./CommunityImageUploader";

interface Props {
  spaceCode: string;
  spaceName: string;
  onClose: () => void;
  onCreated: (postId: number) => void;
}

export default function CommunityNewPostDialog({ spaceCode, spaceName, onClose, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [images, setImages] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>([]);
  // For multi-factory users: stores the selected factoryId as string for Select
  const [selectedFactoryId, setSelectedFactoryId] = useState<string>("");

  const { data: identityData, isLoading: identityLoading } = trpc.community.getMyIdentityOptions.useQuery();

  const createPostMut = trpc.community.createPost.useMutation({
    onSuccess: ({ postId }) => onCreated(postId),
    onError: (e) => toast.error(e.message),
  });

  const factories = (identityData?.identities ?? []).filter(i => i.type === "factory") as
    Array<{ type: "factory"; factoryId: number; label: string; role: string }>;

  // Determine the currently active factory ID for product loading
  const activeFactoryId = factories.length === 1
    ? factories[0].factoryId
    : factories.length > 1 && selectedFactoryId
      ? parseInt(selectedFactoryId, 10)
      : null;

  const { data: factoryProducts } = trpc.product.getByFactory.useQuery(
    { factoryId: activeFactoryId! },
    { enabled: activeFactoryId != null },
  );

  const handleFactoryChange = (val: string) => {
    setSelectedFactoryId(val);
    setSelectedProductIds([]); // clear products when switching factory
  };

  const toggleProduct = (id: number) => {
    setSelectedProductIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 5) { toast.error("最多選擇 5 個商品"); return prev; }
      return [...prev, id];
    });
  };

  const handleSubmit = () => {
    if (!title.trim() || !content.trim()) {
      toast.error("請填寫標題和內容");
      return;
    }

    // Resolve authorFactoryId to send:
    // 0 factories → don't send
    // 1 factory → auto-send its ID (server will also auto-assign)
    // 2+ factories → send the selected one
    let authorFactoryId: number | undefined;
    if (factories.length === 0) {
      authorFactoryId = undefined;
    } else if (factories.length === 1) {
      authorFactoryId = factories[0].factoryId;
    } else {
      if (!selectedFactoryId) {
        toast.error("請選擇代表工廠");
        return;
      }
      authorFactoryId = parseInt(selectedFactoryId, 10);
    }

    createPostMut.mutate({
      spaceCode,
      title: title.trim(),
      content: content.trim(),
      commentsEnabled,
      images,
      pinnedProductIds: selectedProductIds,
      authorFactoryId,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>在「{spaceName}」發文</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Author identity — only shown when there's something to decide */}
          {identityLoading ? (
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
                  <SelectValue placeholder="請選擇發文工廠" />
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
          ) : null /* 0 factories: post as personal, no UI needed */}

          {/* Title */}
          <div className="space-y-1.5">
            <Label className="text-sm">標題 *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="簡短描述你的問題或需求"
              maxLength={200}
            />
          </div>

          {/* Content */}
          <div className="space-y-1.5">
            <Label className="text-sm">內容 *</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="詳細說明..."
              rows={6}
              className="resize-none"
              maxLength={10000}
            />
            <p className="text-xs text-muted-foreground text-right">{content.length} / 10000</p>
          </div>

          {/* Images */}
          <div className="space-y-1.5">
            <Label className="text-sm">附加圖片（最多 6 張）</Label>
            <CommunityImageUploader
              images={images}
              onChange={setImages}
              disabled={createPostMut.isPending}
              onUploadingChange={setIsUploading}
            />
          </div>

          {/* Pinned products — only shown when a factory is active */}
          {activeFactoryId != null && factoryProducts && factoryProducts.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-sm flex items-center gap-1.5">
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
            </div>
          )}

          {/* Comments enabled toggle */}
          <div className="flex items-center gap-2">
            <Switch
              id="new-post-comments-enabled"
              checked={commentsEnabled}
              onCheckedChange={setCommentsEnabled}
            />
            <Label htmlFor="new-post-comments-enabled" className="text-sm cursor-pointer">
              開放留言
            </Label>
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" onClick={onClose} disabled={createPostMut.isPending}>
              取消
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                createPostMut.isPending ||
                isUploading ||
                !title.trim() ||
                !content.trim() ||
                (factories.length > 1 && !selectedFactoryId)
              }
              className="bg-gradient-to-r from-orange-500 to-amber-500 text-white border-0"
            >
              {(createPostMut.isPending || isUploading) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isUploading ? "上傳中…" : "發文"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
