import { useEffect, useRef, useState } from "react";
import { CheckIcon, Loader2 } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { TermsContent } from "@/components/legal/TermsContent";
import { PrivacyPolicyContent } from "@/components/legal/PrivacyPolicyContent";

// 註冊條款 Consent Gate——只針對「Consent Gate 正式啟用日之後」建立的新會員
// 顯示（判斷邏輯見 shared/consent.ts 的 userNeedsConsent，依 auth.me 回傳的
// needsConsent 欄位決定），舊會員完全不受影響，不會在這裡被擋下。
//
// Blocking 行為刻意比照 client/src/components/ai/AiHandoffModal.tsx 採用的
// pattern（Dialog + onOpenChange no-op + 關閉 ESC/點擊背景/右上角 X），但這裡
// 是獨立抽出、依 Consent Gate 需求另外實作，不是直接改那支 AI 專用元件。
export function ConsentGate() {
  const { user, isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  const [activeTab, setActiveTab] = useState<"terms" | "privacy">("terms");
  const [termsRead, setTermsRead] = useState(false);
  const [privacyRead, setPrivacyRead] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const termsScrollRef = useRef<HTMLDivElement>(null);
  const privacyScrollRef = useRef<HTMLDivElement>(null);

  const acceptConsent = trpc.auth.acceptConsent.useMutation({
    onSuccess: async () => {
      setErrorMsg(null);
      await utils.auth.me.invalidate();
    },
    onError: (err) => {
      setErrorMsg(err.message || "送出失敗，請稍後再試一次。");
    },
  });

  const open = isAuthenticated && Boolean((user as { needsConsent?: boolean } | null)?.needsConsent);

  // 內容如果本來就短到不需要捲動，開啟當下（或切換分頁時）就直接視為已讀，
  // 避免使用者被無法觸發的 scroll 事件卡住。
  useEffect(() => {
    if (!open) return;
    const el = activeTab === "terms" ? termsScrollRef.current : privacyScrollRef.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight + 4) {
      if (activeTab === "terms") setTermsRead(true);
      else setPrivacyRead(true);
    }
  }, [open, activeTab]);

  if (!open) return null;

  const bothRead = termsRead && privacyRead;
  const canSubmit = bothRead && agreed && !acceptConsent.isPending;

  const handleScroll = (which: "terms" | "privacy") => (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
    if (!atBottom) return;
    if (which === "terms") setTermsRead(true);
    else setPrivacyRead(true);
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    setErrorMsg(null);
    acceptConsent.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        className="flex flex-col gap-0 p-0 sm:max-w-2xl max-h-[85vh]"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0 p-6 pb-4">
          <DialogTitle className="text-xl">歡迎加入 OXM</DialogTitle>
          <DialogDescription>
            在開始使用 OXM 前，請先閱讀並確認服務條款與隱私權政策。
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "terms" | "privacy")}
          className="min-h-0 flex-1 px-6"
        >
          <TabsList className="grid w-full shrink-0 grid-cols-2">
            <TabsTrigger value="terms" className="gap-1">
              服務條款
              {termsRead && <CheckIcon className="size-3.5 text-green-600" aria-hidden="true" />}
            </TabsTrigger>
            <TabsTrigger value="privacy" className="gap-1">
              隱私權政策
              {privacyRead && <CheckIcon className="size-3.5 text-green-600" aria-hidden="true" />}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="terms" className="mt-3 flex min-h-0 flex-1 flex-col gap-1.5">
            <div
              ref={termsScrollRef}
              onScroll={handleScroll("terms")}
              data-testid="consent-terms-scroll"
              className="min-h-0 flex-1 overflow-y-auto rounded-md border p-4 text-sm"
            >
              <TermsContent />
            </div>
            <p className={`shrink-0 text-xs ${termsRead ? "text-green-600" : "text-muted-foreground"}`}>
              {termsRead ? "✓ 已閱讀完畢" : "請將服務條款捲動至底部，才算完成閱讀"}
            </p>
          </TabsContent>

          <TabsContent value="privacy" className="mt-3 flex min-h-0 flex-1 flex-col gap-1.5">
            <div
              ref={privacyScrollRef}
              onScroll={handleScroll("privacy")}
              data-testid="consent-privacy-scroll"
              className="min-h-0 flex-1 overflow-y-auto rounded-md border p-4 text-sm"
            >
              <PrivacyPolicyContent />
            </div>
            <p className={`shrink-0 text-xs ${privacyRead ? "text-green-600" : "text-muted-foreground"}`}>
              {privacyRead ? "✓ 已閱讀完畢" : "請將隱私權政策捲動至底部，才算完成閱讀"}
            </p>
          </TabsContent>
        </Tabs>

        <DialogFooter className="shrink-0 flex-col items-stretch gap-3 p-6 pt-4 sm:flex-col sm:items-stretch sm:justify-start">
          <label className="flex min-w-0 items-start gap-2 text-sm">
            <Checkbox
              checked={agreed}
              disabled={!bothRead}
              onCheckedChange={(v) => setAgreed(v === true)}
              className="mt-0.5"
            />
            <span>我已閱讀並同意 OXM《服務條款》與《隱私權政策》</span>
          </label>

          {errorMsg && (
            <p data-testid="consent-error" className="text-sm text-destructive">{errorMsg}</p>
          )}

          <Button onClick={handleSubmit} disabled={!canSubmit} className="w-full">
            {acceptConsent.isPending && (
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
            )}
            同意並繼續
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
