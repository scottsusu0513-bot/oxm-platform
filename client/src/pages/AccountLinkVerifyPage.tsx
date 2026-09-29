import { useState } from "react";
import { useLocation } from "wouter";
import { Helmet } from "react-helmet-async";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { CheckCircle, Link2, XCircle } from "lucide-react";

const FAILED_MESSAGE = "驗證失敗或已過期，請重新驗證。";

/**
 * Verified Account Linking：驗證信連結的落地頁。刻意需要使用者按下確認才
 * 送出（不在載入時自動送出）；伺服器端另外要求同一瀏覽器的 pending cookie，
 * 信件掃描器等沒有 cookie 的請求不會消耗掉 token。
 */
export default function AccountLinkVerifyPage() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [status, setStatus] = useState<"confirm" | "success" | "error">(token ? "confirm" : "error");
  const [errorMessage, setErrorMessage] = useState(FAILED_MESSAGE);
  const verifyMut = trpc.accountLink.verify.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      setStatus("success");
    },
    onError: (err) => {
      setErrorMessage(err.message || FAILED_MESSAGE);
      setStatus("error");
    },
  });

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Helmet><meta name="robots" content="noindex,nofollow" /></Helmet>
      <div className="max-w-sm w-full text-center space-y-4">
        {status === "confirm" && (
          <>
            <Link2 className="w-12 h-12 text-orange-500 mx-auto" />
            <h1 className="text-xl font-bold">確認連結登入方式</h1>
            <p className="text-muted-foreground">確認後，之後可以用這個登入方式進入同一個 OXM 帳號。</p>
            <Button className="w-full" onClick={() => verifyMut.mutate({ token })} disabled={verifyMut.isPending}>
              {verifyMut.isPending ? "驗證中…" : "確認連結"}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => navigate("/account-link")}>取消</Button>
          </>
        )}
        {status === "success" && (
          <>
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
            <h1 className="text-xl font-bold">帳號連結完成</h1>
            <p className="text-muted-foreground">之後可以使用新的登入方式登入同一個 OXM 帳號。</p>
            <Button className="w-full" onClick={() => navigate("/")}>返回首頁</Button>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle className="w-12 h-12 text-red-500 mx-auto" />
            <h1 className="text-xl font-bold">無法完成連結</h1>
            <p className="text-muted-foreground break-words" data-testid="account-link-error">{errorMessage}</p>
            <p className="text-sm text-muted-foreground">請確認是在發起登入的同一個瀏覽器開啟此連結，或重新以 LINE 登入。</p>
            <Button variant="outline" className="w-full" onClick={() => navigate("/")}>返回首頁</Button>
          </>
        )}
      </div>
    </div>
  );
}
