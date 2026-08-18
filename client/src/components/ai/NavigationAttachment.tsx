import { useLocation } from "wouter";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AiShellAttachment } from "@/contexts/AiShellContext";

/**
 * Phase 6C（見對話中「站內 Navigation Action」）：單純一顆導覽 CTA 按鈕，
 * title／route 都是 server 端 shared/ai/navigationRegistry.ts 查出來的正式
 * 資料，這個元件不自己組任何文字或網址（見「十三：模型不能輸出任意
 * path」）。對話文字本身（帶你去看看...）由 routing.ts 的 finalReply 產生，
 * 這裡只負責按鈕。
 */
export function NavigationAttachmentView({
  attachment,
}: {
  attachment: Extract<AiShellAttachment, { type: "navigation_action" }>;
}) {
  const [, navigate] = useLocation();
  return (
    <div className="mt-2">
      <Button
        type="button"
        onClick={() => navigate(attachment.route)}
        variant="outline"
        className="w-full border-orange-300 text-orange-700 hover:bg-orange-50"
      >
        <ArrowRight className="size-4 mr-2" aria-hidden="true" />
        前往{attachment.title}
      </Button>
    </div>
  );
}
