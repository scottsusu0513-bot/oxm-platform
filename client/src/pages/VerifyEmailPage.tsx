import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Loader2, Link2 } from "lucide-react";

export default function VerifyEmailPage() {
  const [, navigate] = useLocation();
  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  const [status, setStatus] = useState<"loading" | "success" | "merged" | "error">("loading");

  const verifyMut = trpc.auth.verifyEmail.useMutation({
    onSuccess: (res) => setStatus(res.merged ? "merged" : "success"),
    onError: () => setStatus("error"),
  });

  useEffect(() => {
    if (!token) { setStatus("error"); return; }
    verifyMut.mutate({ token });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-sm w-full text-center space-y-4">
        {status === "loading" && (
          <>
            <Loader2 className="w-12 h-12 animate-spin text-orange-500 mx-auto" />
            <p className="text-muted-foreground">正在驗證中…</p>
          </>
        )}
        {status === "success" && (
          <>
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
            <h1 className="text-xl font-bold">驗證成功</h1>
            <p className="text-muted-foreground">您的主要信箱已完成驗證，現在可以使用所有功能。</p>
            <Button className="w-full" onClick={() => navigate("/")}>返回首頁</Button>
          </>
        )}
        {status === "merged" && (
          <>
            <Link2 className="w-12 h-12 text-blue-500 mx-auto" />
            <h1 className="text-xl font-bold">驗證成功，帳號已連結</h1>
            <p className="text-muted-foreground">
              您的登入方式已連結到既有 OXM 帳號。請重新登入以使用原帳號。
            </p>
            <Button
              className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0"
              onClick={() => navigate("/")}
            >
              重新登入
            </Button>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle className="w-12 h-12 text-red-500 mx-auto" />
            <h1 className="text-xl font-bold">連結無效或已過期</h1>
            <p className="text-muted-foreground">此驗證連結已失效，請至會員中心重新寄送驗證信。</p>
            <Button variant="outline" className="w-full" onClick={() => navigate("/member")}>前往會員中心</Button>
          </>
        )}
      </div>
    </div>
  );
}
