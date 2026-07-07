import { useRoute, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { FloatingBackButton } from "@/components/FloatingBackButton";

export default function AdminConversationDetail() {
  const [matched, params] = useRoute("/admin/conversations/:id");
  const conversationId = Number(params?.id);
  const [, setLocation] = useLocation();
  const { user, loading: authLoading } = useAuth();

  const messagesQuery = trpc.chat.getMessages.useQuery(
    { conversationId, page: 1 },
    { enabled: !authLoading && !!conversationId && user?.role === "admin" }
  );

  const metaQuery = trpc.chat.getConversationMeta.useQuery(
    { conversationId },
    { enabled: !authLoading && !!conversationId && user?.role === "admin" }
  );

  console.log('[AdminConversationDetail] matched:', matched, 'params:', params);
  if (authLoading) return <AppLoading />;
  if (!user || user.role !== "admin") return <div className="flex items-center justify-center min-h-screen text-red-600">無權限</div>;

  const messages = (messagesQuery.data as any) ?? [];
  const meta = metaQuery.data;

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 px-4 pb-4 md:px-8 md:pb-8 admin-page-top">
      <div className="max-w-3xl mx-auto">
      <FloatingBackButton fallbackHref="/admin/conversations" noNavbar />
        <div className="flex items-center gap-4 mb-6">
          <div />
          <div>
            <h1 className="text-2xl font-bold">對話內容</h1>
            {meta && (
              <p className="text-sm text-gray-500">
                {meta.factoryName} ← {meta.productName ? `詢問產品：${meta.productName}` : "一般詢問"}
              </p>
            )}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base text-gray-600">
              對話 ID：{conversationId}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {messagesQuery.isLoading ? (
              <div className="text-center py-8 text-gray-500">載入中...</div>
            ) : messages.length === 0 ? (
              <div className="text-center py-8 text-gray-500">尚無訊息</div>
            ) : (
              <div className="space-y-3">
                {messages.map((msg: any) => (
                  <div key={msg.id} className={`flex ${msg.senderRole === "factory" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] rounded-lg px-4 py-2 text-sm ${
                      msg.senderRole === "factory"
                        ? "bg-orange-100 text-orange-900"
                        : "bg-gray-100 text-gray-900"
                    }`}>
                      <p className="font-medium text-xs mb-1 opacity-60">
                        {msg.senderRole === "factory" ? "工廠" : "用戶"}
                      </p>
                      <p>{msg.content}</p>
                      <p className="text-xs opacity-50 mt-1 text-right">
                        {new Date(msg.createdAt).toLocaleString("zh-TW")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}