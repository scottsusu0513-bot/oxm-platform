import { useState } from "react";
import { useLocation } from "wouter";
import { Helmet } from "react-helmet-async";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle, Loader2, Mail, XCircle } from "lucide-react";
import { toast } from "sonner";
import { clearAppAccountLinkState, getAppAccountLinkState, setAppAccountLinkState } from "@/lib/appAccountLink";

/**
 * App（Capacitor）帳號連結：LINE 登入的 email 屬於既有 OXM 帳號時，輸入寄到
 * 既有帳號信箱的 6 位數驗證碼完成連結。state 只存在記憶體（見
 * lib/appAccountLink.ts）；App 重啟後沒有 state，請使用者重新以 LINE 登入。
 */
export default function AccountLinkAppPage() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [state, setState] = useState<string | null>(() => getAppAccountLinkState());
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"linked" | "cancelled" | null>(null);

  const pendingQuery = trpc.accountLink.appPending.useQuery({ state: state ?? "" }, { enabled: !!state, retry: false });
  const pending = pendingQuery.data;

  const verifyMut = trpc.accountLink.appVerify.useMutation({
    onSuccess: (res) => {
      if (res.success) {
        clearAppAccountLinkState();
        utils.auth.me.invalidate();
        setDone("linked");
        return;
      }
      setCode("");
      setError(res.remainingAttempts && res.reason === "wrong" ? `${res.message}剩餘嘗試次數：${res.remainingAttempts}` : res.message);
      pendingQuery.refetch();
    },
    onError: () => setError("驗證失敗或已過期，請重新驗證。"),
  });
  const resendMut = trpc.accountLink.appResend.useMutation({
    onSuccess: (res) => {
      setAppAccountLinkState(res.state);
      setState(res.state);
      setCode("");
      setError(null);
      toast.success("驗證碼已重新寄出");
    },
    onError: (err) => toast.error(err.message),
  });
  const cancelMut = trpc.accountLink.appCancel.useMutation({
    onSettled: () => {
      clearAppAccountLinkState();
      setDone("cancelled");
    },
  });

  const submit = () => {
    if (!state || code.length !== 6 || verifyMut.isPending) return;
    setError(null);
    verifyMut.mutate({ state, code });
  };

  const noState = !state || (!pendingQuery.isLoading && !pending);
  const inactive = !!pending && !pending.active;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Helmet><meta name="robots" content="noindex,nofollow" /></Helmet>
      <div className="max-w-md w-full space-y-4 text-center">
        {done === "linked" ? (
          <>
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
            <h1 className="text-xl font-bold">帳號連結完成</h1>
            <p className="text-muted-foreground">之後可以使用 LINE 登入同一個 OXM 帳號。</p>
            <Button className="w-full" onClick={() => navigate("/")}>返回首頁</Button>
          </>
        ) : done === "cancelled" || noState ? (
          <>
            <XCircle className="w-12 h-12 text-muted-foreground mx-auto" />
            <h1 className="text-xl font-bold">{done === "cancelled" ? "已取消連結" : "連結流程已失效"}</h1>
            <p className="text-muted-foreground">{done === "cancelled" ? "您的既有帳號沒有任何變更。" : "請重新以 LINE 登入以取得新的驗證碼。"}</p>
            <Button className="w-full" onClick={() => navigate("/")}>返回首頁</Button>
          </>
        ) : pendingQuery.isLoading ? (
          <Loader2 className="w-12 h-12 animate-spin text-orange-500 mx-auto" />
        ) : (
          <>
            <Mail className="w-12 h-12 text-orange-500 mx-auto" />
            <h1 className="text-xl font-bold">連結既有 OXM 帳號</h1>
            <p className="text-muted-foreground break-words">
              我們發現這個 Email 已經有 OXM 帳號。請輸入寄到信箱的 6 位數驗證碼，確認是您本人。
            </p>
            <p className="text-sm break-words" data-testid="app-account-link-masked-email">
              驗證碼已寄到 <strong>{pending?.maskedEmail}</strong>
            </p>
            <form
              className="space-y-3"
              onSubmit={(e) => { e.preventDefault(); submit(); }}
            >
              <Input
                aria-label="6 位數驗證碼"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="text-center text-2xl tracking-[0.5em] h-14"
                disabled={inactive || verifyMut.isPending}
              />
              {error && <p className="text-sm text-destructive break-words" role="alert">{error}</p>}
              {inactive && !error && <p className="text-sm text-destructive" role="alert">驗證碼已失效，請重新取得。</p>}
              <Button type="submit" className="w-full h-11" disabled={inactive || code.length !== 6 || verifyMut.isPending}>
                {verifyMut.isPending ? "驗證中…" : "確認並連結 LINE"}
              </Button>
            </form>
            <div className="flex flex-col gap-2">
              <Button variant="outline" onClick={() => state && resendMut.mutate({ state })} disabled={resendMut.isPending}>
                {resendMut.isPending ? "寄送中…" : "重新寄送驗證碼"}
              </Button>
              <Button variant="ghost" onClick={() => state && cancelMut.mutate({ state })} disabled={cancelMut.isPending}>取消</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
