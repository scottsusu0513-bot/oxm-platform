import { useState } from "react";
import { useLocation } from "wouter";
import { Helmet } from "react-helmet-async";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Loader2, Mail, XCircle } from "lucide-react";
import { toast } from "sonner";

/**
 * Verified Account Linking：LINE 登入的 email 撞到既有 OXM 帳號時的等待頁。
 * 伺服器已寄驗證信到既有帳號的可信信箱（只顯示遮罩後 email）；使用者只能
 * 驗證既有帳號或取消，不提供「略過並建立新帳號」。所有資訊都來自伺服器端
 * pending 狀態（accountLink.pending），前端不能指定目標帳號或寄件 email。
 */
export default function AccountLinkPage() {
  const [, navigate] = useLocation();
  const { data: pending, isLoading } = trpc.accountLink.pending.useQuery(undefined, { retry: false });
  const [cancelled, setCancelled] = useState(false);
  const resendMut = trpc.accountLink.resend.useMutation({
    onSuccess: () => toast.success("驗證信已重新寄出"),
    onError: (err) => toast.error(err.message),
  });
  const cancelMut = trpc.accountLink.cancel.useMutation({
    onSuccess: () => setCancelled(true),
    onError: () => setCancelled(true),
  });

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Helmet><meta name="robots" content="noindex,nofollow" /></Helmet>
      <div className="max-w-md w-full space-y-4 text-center">
        {isLoading ? (
          <Loader2 className="w-12 h-12 animate-spin text-orange-500 mx-auto" />
        ) : cancelled || !pending ? (
          <>
            <XCircle className="w-12 h-12 text-muted-foreground mx-auto" />
            <h1 className="text-xl font-bold">{cancelled ? "已取消連結" : "目前沒有待完成的帳號連結"}</h1>
            <p className="text-muted-foreground">{cancelled ? "您的既有帳號沒有任何變更。" : "連結可能已完成、已取消或已過期。"}</p>
            <Button className="w-full" onClick={() => navigate("/")}>返回首頁</Button>
          </>
        ) : (
          <>
            <Mail className="w-12 h-12 text-orange-500 mx-auto" />
            <h1 className="text-xl font-bold">發現既有 OXM 帳號</h1>
            <p className="text-muted-foreground break-words">
              這個 Email 已經有 OXM 帳號。為了確認是您本人，請完成 Email 驗證後連結 {pending.providerLabel} 登入。
            </p>
            <p className="text-sm break-words" data-testid="account-link-masked-email">
              驗證信已寄到 <strong>{pending.maskedEmail}</strong>
            </p>
            <p className="text-sm text-muted-foreground">請在<strong>這個瀏覽器</strong>開啟信中的連結完成連結。</p>
            <div className="flex flex-col gap-2">
              <Button variant="outline" onClick={() => resendMut.mutate()} disabled={resendMut.isPending}>
                {resendMut.isPending ? "寄送中…" : "重新寄送驗證信"}
              </Button>
              <Button variant="ghost" onClick={() => cancelMut.mutate()} disabled={cancelMut.isPending}>取消</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
