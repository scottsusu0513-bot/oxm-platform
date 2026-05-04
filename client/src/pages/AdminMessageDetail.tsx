import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Loader2 } from "lucide-react";
import { getLoginUrl } from "@/const";

export default function AdminMessageDetail() {
  const { id } = useParams<{ id: string }>();
  const campaignId = parseInt(id ?? "0", 10);
  const [, navigate] = useLocation();
  const { user, isAuthenticated, loading } = useAuth();

  const { data, isLoading, error } = trpc.chat.getAdminMessage.useQuery(
    { campaignId },
    { enabled: isAuthenticated && !isNaN(campaignId) && campaignId > 0 }
  );

  if (!isAuthenticated && !loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container py-16 text-center">
          <p className="text-muted-foreground mb-4">請先登入以查看此訊息</p>
          <a href={getLoginUrl()}><Button>登入</Button></a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container py-6 max-w-2xl">
        <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate("/messages")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> 返回訊息
        </Button>

        {(isLoading || loading) && (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && error && (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              找不到此訊息，或您無權限查看
            </CardContent>
          </Card>
        )}

        {!isLoading && data && (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="font-bold text-orange-500 text-sm">★ 平台管理員</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(data.createdAt).toLocaleString("zh-TW")}
                </span>
              </div>
              <h1 className="text-xl font-bold mb-4">{data.title}</h1>
              <div className="text-sm leading-relaxed whitespace-pre-wrap border-t pt-4">
                {data.content}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
