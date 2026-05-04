import { useState, useRef, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { getLoginUrl } from "@/const";

export default function AdminMessageDetail() {
  const { id } = useParams<{ id: string }>();
  const campaignId = parseInt(id ?? "0", 10);
  const [, navigate] = useLocation();
  const { user, isAuthenticated, loading } = useAuth();
  const [replyText, setReplyText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();

  const campaignQuery = trpc.chat.getAdminMessage.useQuery(
    { campaignId },
    { enabled: isAuthenticated && campaignId > 0 }
  );

  const threadQuery = trpc.chat.getAdminMessageThread.useQuery(
    { campaignId },
    { enabled: isAuthenticated && campaignId > 0, refetchInterval: 15000 }
  );

  const replyMut = trpc.chat.replyToAdminMessage.useMutation({
    onSuccess: () => {
      setReplyText("");
      utils.chat.getAdminMessageThread.invalidate({ campaignId });
    },
    onError: (err) => toast.error(err.message),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [threadQuery.data?.length]);

  const handleReply = () => {
    if (!replyText.trim()) return;
    replyMut.mutate({ campaignId, content: replyText.trim() });
  };

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

  const campaign = campaignQuery.data;
  const thread = threadQuery.data ?? [];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <div className="container py-6 max-w-2xl flex flex-col flex-1">
        <Button variant="ghost" size="sm" className="mb-4 self-start" onClick={() => navigate("/messages")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> 返回訊息
        </Button>

        {(campaignQuery.isLoading || loading) && (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {!campaignQuery.isLoading && campaignQuery.error && (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              找不到此訊息，或您無權限查看
            </CardContent>
          </Card>
        )}

        {!campaignQuery.isLoading && campaign && (
          <>
            {/* 原始站內信 */}
            <Card className="mb-4 border-orange-200">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="font-bold text-orange-500 text-sm">★ 平台管理員</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(campaign.createdAt).toLocaleString("zh-TW")}
                  </span>
                </div>
                <h1 className="text-lg font-bold mb-2">{campaign.title}</h1>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{campaign.content}</p>
              </CardContent>
            </Card>

            {/* 對話串 */}
            {thread.length > 0 && (
              <div className="space-y-3 mb-4">
                {thread.map((msg: any) => {
                  const isAdmin = msg.senderRole === "admin";
                  return (
                    <div key={msg.id} className={`flex ${isAdmin ? "justify-start" : "justify-end"}`}>
                      <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                        isAdmin
                          ? "bg-orange-50 border border-orange-200"
                          : "bg-primary text-primary-foreground"
                      }`}>
                        {isAdmin && (
                          <p className="text-xs font-bold text-orange-500 mb-1">★ 平台管理員</p>
                        )}
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                        <p className={`text-xs mt-1 ${isAdmin ? "text-muted-foreground" : "text-primary-foreground/70"}`}>
                          {new Date(msg.createdAt).toLocaleString("zh-TW")}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            )}

            {/* 回覆輸入框 */}
            <div className="flex gap-2 mt-auto pt-2">
              <Textarea
                placeholder="回覆管理員..."
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                rows={2}
                className="resize-none"
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleReply();
                  }
                }}
              />
              <Button
                className="shrink-0 self-end"
                disabled={!replyText.trim() || replyMut.isPending}
                onClick={handleReply}
              >
                {replyMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
