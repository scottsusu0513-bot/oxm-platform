import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import {
  HANDOFF_MODAL_TITLE,
  HANDOFF_MODAL_BODY,
  HANDOFF_MODAL_CONFIRM_LABEL,
} from "@shared/ai/handoffServices";

/**
 * AI Handoff Blocking Modal——共用元件，五個表單共用同一份文案與行為，不是
 * 各表單各自刻一份、也不是另外設計一套「AI 科技感」UI（見對話中
 * 「二十七」：視覺沿用 OXM 現有 dialog 風格）。
 *
 * 「Blocking」＝Modal 尚未確認時背景表單不可操作：Radix Dialog 本身的
 * overlay／focus trap 已經天生做到這件事，這裡只需要額外關掉 ESC／點擊
 * 背景關閉，逼使用者一定要按下確認按鈕。
 */
export function AiHandoffModal({
  open,
  onConfirm,
  isConfirming,
}: {
  open: boolean;
  onConfirm: () => void;
  isConfirming?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{HANDOFF_MODAL_TITLE}</DialogTitle>
          <DialogDescription className="whitespace-pre-line pt-2 text-sm leading-relaxed text-foreground/80">
            {HANDOFF_MODAL_BODY}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onConfirm} disabled={isConfirming} className="w-full sm:w-auto">
            {isConfirming && <Loader2 className="size-4 mr-2 animate-spin" aria-hidden="true" />}
            {HANDOFF_MODAL_CONFIRM_LABEL}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
