import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { useRoute, useLocation, useSearch } from "wouter";
import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { Send, ArrowLeft, Factory, User } from "lucide-react";

export default function ChatPage() {
  const [matchExisting, params] = useRoute("/chat/:conversationId");
  const isNewChat = !matchExisting || params?.conversationId === "new";
  const conversationId = isNewChat ? null : Number(params?.conversationId);

  const [, navigate] = useLocation();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const factoryId = searchParams.get("factoryId") ? Number(searchParams.get("factoryId")) : null;
  const productId = searchParams.get("productId") ? Number(searchParams.get("productId")) : undefined;

  const { user, isAuthenticated } = useAuth();
  const productName = searchParams.get("productName");
  const [message, setMessage] = useState(
    productId && productName
      ? `您好，我對貴工廠的「${productName}」有興趣，想了解報價、最低訂購數量及生產交期，請問方便提供嗎？謝謝！`
      : ""
  );
  const [isSending, setIsSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();

  // 已存在的對話：取 meta 和訊息
  const { data: existingConv } = trpc.chat.getExisting.useQuery(
    { factoryId: factoryId!, productId: undefined },
    { enabled: isNewChat && !!factoryId && isAuthenticated }
  );
  const { data: meta } = trpc.chat.getConversationMeta.useQuery(
    { conversationId: conversationId! },
    { enabled: !!conversationId && isAuthenticated }
  );
  const { data: msgs, isLoading: msgsLoading } = trpc.chat.getMessages.useQuery(
    { conversationId: conversationId!, page: 1 },
    { enabled: !!conversationId && isAuthenticated, refetchInterval: 5000 }
  );

  // 新對話：查詢工廠資訊以顯示名稱（不建立對話）
  const { data: factoryData } = trpc.factory.getById.useQuery(
    { id: factoryId! },
    { enabled: isNewChat && !!factoryId && isAuthenticated }
  );

 
  // 若已有對話，自動跳轉
useEffect(() => {
  if (existingConv) {
    navigate(`/chat/${existingConv.id}`, { replace: true });
  }
}, [existingConv, navigate]);

// 新對話：預填訊息
useEffect(() => {
  if (isNewChat && factoryData && !existingConv) {
    const name = factoryData.name ?? "工廠";
    const product = factoryData.products?.find((p: any) => p.id === productId);
    if (product) {
      setMessage(`${name}你好，我對您的「${product.name}」產品有興趣，希望你可以提供不同訂購數量之間的報價，謝謝！`);
    } else {
      setMessage(`${name}你好，我想詢問貴工廠的代工服務，期待您的回覆！`);
    }
  }
}, [isNewChat, factoryData, existingConv, productId]);

  // mutations
  const getOrCreateMut = trpc.chat.getOrCreate.useMutation();
  const sendMut = trpc.chat.send.useMutation({
    onSuccess: () => {
      setMessage("");
      utils.chat.getMessages.invalidate({ conversationId: conversationId! });
      utils.chat.myConversations.invalidate();
      utils.chat.unreadCount.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [msgs]);

  const handleSend = async () => {
    if (!message.trim() || isSending) return;
    setIsSending(true);
    try {
      if (isNewChat && factoryId) {
        // 第一則訊息：建立對話再送出
        const conv = await getOrCreateMut.mutateAsync({ factoryId, productId });
        await sendMut.mutateAsync({ conversationId: conv.id, content: message.trim() });
        utils.chat.myConversations.invalidate();
        utils.chat.unreadCount.invalidate();
        navigate(`/chat/${conv.id}`, { replace: true });
      } else if (conversationId) {
        sendMut.mutate({ conversationId, content: message.trim() });
      }
    } catch (e) {
      toast.error("訊息送出失敗");
    } finally {
      setIsSending(false);
    }
  };

  // 顯示名稱與產品名
  const displayFactoryName = isNewChat
    ? (factoryData?.name ?? "工廠")
    : (meta?.factoryName ?? "對話");
  const displayProductName = isNewChat
    ? (factoryData?.products?.find((p: any) => p.id === productId)?.name ?? null)
    : (meta?.productName ?? null);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container py-16 text-center">
          <p className="text-muted-foreground mb-4">請先登入以查看訊息</p>
          <a href={getLoginUrl()}><Button>登入</Button></a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />

      <div className="container py-4 flex-1 flex flex-col max-w-3xl">
        <Button variant="ghost" size="sm" className="mb-3 self-start" onClick={() => navigate("/messages")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> 返回訊息列表
        </Button>

        <Card className="flex-1 flex flex-col">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Factory className="w-5 h-5" />
              {displayFactoryName}
              {displayProductName && (
                <Badge variant="outline" className="text-xs font-normal">{displayProductName}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col p-0">
            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2 space-y-3" style={{ maxHeight: "calc(100vh - 300px)", minHeight: "400px" }}>
              {msgsLoading && !isNewChat ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-3/4" />)}
                </div>
              ) : isNewChat ? (
                <div className="text-center text-muted-foreground py-12">
                  <p>與 {displayFactoryName} 開始對話</p>
                  <p className="text-sm mt-1">送出第一則訊息後，對話將會建立</p>
                </div>
              ) : msgs?.length === 0 ? (
                <div className="text-center text-muted-foreground py-12">
                  <p>開始對話吧！</p>
                  <p className="text-sm mt-1">輸入訊息與對方溝通</p>
                </div>
              ) : (
                msgs?.map((msg) => {
                  const isMine = msg.senderId === user?.id;
                  return (
                    <div key={msg.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                        isMine
                          ? "bg-primary text-primary-foreground rounded-br-md"
                          : "bg-muted rounded-bl-md"
                      }`}>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          {msg.senderRole === "factory" ? (
                            <Factory className="w-3 h-3 opacity-70" />
                          ) : (
                            <User className="w-3 h-3 opacity-70" />
                          )}
                          <span className="text-xs opacity-70">
                            {msg.senderRole === "factory" ? "工廠" : "使用者"}
                          </span>
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                        <p className={`text-xs mt-1 ${isMine ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                          {new Date(msg.createdAt).toLocaleString("zh-TW")}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Input */}
            <div className="border-t p-4">
              <div className="flex gap-2">
                <Input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={isNewChat ? "輸入第一則訊息以開始對話..." : "輸入訊息..."}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                  disabled={isSending || sendMut.isPending}
                />
                <Button onClick={handleSend} disabled={!message.trim() || isSending || sendMut.isPending}>
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
