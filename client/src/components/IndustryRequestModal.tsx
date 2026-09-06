import { useEffect, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { performLogin } from "@/const";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, Clock } from "lucide-react";

const DESCRIPTION_MAX = 2000;

function fmtDateTime(v: string | Date): string {
  const d = typeof v === "string" ? new Date(v) : v;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function ReadonlySubmission({ request }: { request: { name: string; email: string; phone: string | null; description: string; createdAt: string | Date } }) {
  return (
    <div className="rounded-xl bg-muted/60 border border-border p-4 space-y-2.5 text-sm">
      <div className="grid grid-cols-[64px_1fr] gap-x-3 gap-y-2">
        <span className="text-muted-foreground">姓名</span>
        <span className="break-words">{request.name}</span>
        <span className="text-muted-foreground">Email</span>
        <span className="break-all">{request.email}</span>
        <span className="text-muted-foreground">電話</span>
        <span className="break-words">{request.phone || "—"}</span>
      </div>
      <div>
        <span className="text-muted-foreground block mb-1">需求說明</span>
        <p className="whitespace-pre-wrap break-words">{request.description}</p>
      </div>
      <p className="text-xs text-muted-foreground pt-1">
        您已於 {fmtDateTime(request.createdAt)} 提出需求
      </p>
    </div>
  );
}

export function IndustryRequestModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { user, isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  const mineQuery = trpc.industryRequest.getMyRequest.useQuery(undefined, {
    enabled: open && isAuthenticated,
    refetchOnWindowFocus: false,
  });

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [description, setDescription] = useState("");
  // 本地「剛送出成功」狀態：送出後立即切成受理畫面，即使 query 還沒 refetch。
  const [justSubmitted, setJustSubmitted] = useState<null | {
    name: string; email: string; phone: string | null; description: string; createdAt: string | Date;
  }>(null);

  // 每次打開 modal 時，用會員目前 profile 預填（姓名/Email/電話），並清掉上次的
  // 送出狀態。姓名/Email/電話皆可修改；需求說明必填。
  useEffect(() => {
    if (open) {
      setName(user?.name ?? "");
      setEmail(user?.email ?? "");
      setPhone(user?.phone ?? "");
      setDescription("");
      setJustSubmitted(null);
    }
  }, [open, user?.name, user?.email, user?.phone]);

  const createMut = trpc.industryRequest.create.useMutation({
    onSuccess: (res) => {
      toast.success("產業新增需求已送出");
      setJustSubmitted(res.request);
      utils.industryRequest.getMyRequest.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const trimmedDesc = description.trim();
  const canSubmit = !!name.trim() && !!email.trim() && trimmedDesc.length > 0 && !createMut.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    createMut.mutate({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim() || undefined,
      description: trimmedDesc,
    });
  };

  // 未登入：不建立任何匿名需求，導向既有登入流程。
  if (open && !isAuthenticated) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md flex max-h-[calc(100dvh-2rem)] flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle>找不到適合的產業分類？</DialogTitle>
            <DialogDescription>此功能需要登入 OXM 會員後才能提出。</DialogDescription>
          </DialogHeader>
          <div className="pt-2">
            <Button className="w-full" onClick={() => { onOpenChange(false); performLogin(); }}>
              登入 / 註冊
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const activeRequest = justSubmitted
    ? { request: justSubmitted, received: true as const }
    : mineQuery.data?.isActive && mineQuery.data.request
      ? { request: mineQuery.data.request, received: false as const }
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md flex max-h-[calc(100dvh-2rem)] flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 p-6 pb-3">
          {activeRequest ? (
            <>
              <DialogTitle className="flex items-center gap-2">
                {activeRequest.received
                  ? <><CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />已收到您的需求</>
                  : <><Clock className="h-5 w-5 text-orange-500 shrink-0" />需求處理中</>}
              </DialogTitle>
              <DialogDescription>管理員已受理中，請靜待通知。</DialogDescription>
            </>
          ) : (
            <>
              <DialogTitle>找不到適合的產業分類？</DialogTitle>
              <DialogDescription>
                告訴我們您希望新增的產業，OXM 會進一步評估平台分類需求。
              </DialogDescription>
            </>
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-1">
          {mineQuery.isLoading && !justSubmitted ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : activeRequest ? (
            <ReadonlySubmission request={activeRequest.request} />
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="ir-name">姓名</Label>
                <Input id="ir-name" value={name} onChange={e => setName(e.target.value)} maxLength={200} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ir-email">Email</Label>
                <Input id="ir-email" type="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={320} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ir-phone">電話（選填）</Label>
                <Input id="ir-phone" value={phone} onChange={e => setPhone(e.target.value)} maxLength={30} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ir-desc">請描述您希望新增的產業</Label>
                <Textarea
                  id="ir-desc"
                  value={description}
                  onChange={e => setDescription(e.target.value.slice(0, DESCRIPTION_MAX))}
                  placeholder="例如：目前找不到適合我們的產業分類，我們主要從事……"
                  rows={5}
                  className="resize-none"
                />
                <p className="text-xs text-muted-foreground text-right">{trimmedDesc.length} / {DESCRIPTION_MAX}</p>
              </div>
              <Button className="w-full" disabled={!canSubmit} onClick={handleSubmit}>
                {createMut.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />送出中…</> : "要求新增產業"}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
