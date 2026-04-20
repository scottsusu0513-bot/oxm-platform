import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Link, useLocation } from "wouter";
import { getLoginUrl } from "@/const";
import { MessageCircle, ArrowLeft, Trash2, Inbox } from "lucide-react";
import { toast } from "sonner";

export default function MyMessages() {
  const { user, isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();

  const { data: userConvs } = trpc.chat.myConversations.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 30000,
  });

  if (!isAuthenticated && !loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container py-16 text-center">
          <MessageCircle className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold mb-2">請先登入</h2>
          <p className="text-muted-foreground mb-4">登入後即可查看您的訊息</p>
          <a href={getLoginUrl()}><Button>登入</Button></a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container py-6 max-w-3xl">
        <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate("/")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> 返回首頁
        </Button>

        <h1 className="text-2xl font-bold flex items-center gap-2 mb-6">
          <MessageCircle className="w-6 h-6" />
          我的訊息
        </h1>

        <UserConversationList conversations={userConvs ?? []} />
      </div>
    </div>
  );
}

function UserConversationList({ conversations }: { conversations: any[] }) {
  const utils = trpc.useUtils();
  const deleteMut = trpc.chat.deleteConversation.useMutation({
    onSuccess: () => {
      toast.success("對話已刪除");
      utils.chat.myConversations.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (conversations.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-muted-foreground">
          <Inbox className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p>尚無對話紀錄</p>
          <p className="text-sm mt-1">瀏覽工廠產品後，點擊「詢問產品」即可開始對話</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {conversations.map(conv => (
        <div key={conv.id} className="flex items-center gap-2">
          <Link href={`/chat/${conv.id}`} className="flex-1">
            <div className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/30 transition-colors cursor-pointer">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{conv.factoryName}</p>
                  {conv.productName && <Badge variant="outline" className="text-xs">{conv.productName}</Badge>}
                </div>
                {conv.lastMessage && (
                  <p className="text-sm text-muted-foreground truncate mt-0.5">
                    {conv.lastSenderRole === "user" ? "你：" : ""}{conv.lastMessage}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-muted-foreground">
                  {new Date(conv.lastMessageAt).toLocaleDateString("zh-TW")}
                </span>
                {conv.unreadCount > 0 && (
                  <span className="bg-red-500 text-white text-xs font-bold rounded-full min-w-5 h-5 px-1 flex items-center justify-center">
                    {conv.unreadCount}
                  </span>
                )}
              </div>
            </div>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive shrink-0"
            onClick={() => {
              if (confirm("確定要刪除此對話嗎？所有訊息將會消失。")) {
                deleteMut.mutate({ conversationId: conv.id });
              }
            }}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
