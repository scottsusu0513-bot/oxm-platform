import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { useEffect } from "react";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, CheckCircle, XCircle, AlertCircle, Clock } from "lucide-react";

export default function ReviewHistory() {
  const { user, isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();

  const { data: factory } = trpc.factory.getMine.useQuery(undefined, { enabled: isAuthenticated });
  const { data: reviewLogs, isLoading } = trpc.factory.reviewHistory.useQuery(
    { factoryId: factory?.id ?? 0 },
    { enabled: !!factory?.id }
  );

  useEffect(() => {
    if (!loading && !isAuthenticated) navigate("/");
    if (!loading && isAuthenticated && !factory) navigate("/register-factory");
  }, [loading, isAuthenticated, factory, navigate]);

  if (loading || isLoading || !factory) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container py-16 text-center text-muted-foreground">載入中...</div>
      </div>
    );
  }

  const getActionBadge = (action: string) => {
    switch (action) {
      case "submitted":
      case "resubmitted":
        return <Badge className="bg-blue-100 text-blue-800"><Clock className="w-3 h-3 mr-1" />已送審</Badge>;
      case "approved":
        return <Badge className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" />已批准</Badge>;
      case "rejected":
        return <Badge className="bg-red-100 text-red-800"><XCircle className="w-3 h-3 mr-1" />已拒絕</Badge>;
      default:
        return <Badge>{action}</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container py-6">
        <Button
          variant="outline"
          onClick={() => navigate("/factory-dashboard")}
          className="mb-4 flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          返回工廠管理
        </Button>

        <h1 className="text-2xl font-bold mb-6">審核歷史</h1>

        {!reviewLogs || reviewLogs.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>暫無審核紀錄</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {reviewLogs.map((log: any) => (
              <Card key={log.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {getActionBadge(log.action)}
                      <span className="text-sm text-muted-foreground">
                        {new Date(log.createdAt).toLocaleString("zh-TW")}
                      </span>
                    </div>
                    {log.submitCountSnapshot && (
                      <span className="text-xs text-muted-foreground">
                        第 {log.submitCountSnapshot} 次送審
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {log.note && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">審核備註</p>
                      <p className="text-sm">{log.note}</p>
                    </div>
                  )}
                  {log.rejectReason && (
                    <div>
                      <p className="text-sm font-medium text-red-600">拒絕原因</p>
                      <p className="text-sm text-red-600">{log.rejectReason}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
