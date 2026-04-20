import Navbar from "@/components/Navbar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { ChevronLeft, Megaphone, Wrench, Newspaper, Zap, Pin } from "lucide-react";

const TYPE_CONFIG = {
  update:      { label: "版本更新", icon: Zap,       className: "bg-blue-100 text-blue-700 border-blue-200" },
  maintenance: { label: "停機維護", icon: Wrench,    className: "bg-red-100 text-red-700 border-red-200" },
  news:        { label: "平台消息", icon: Newspaper,  className: "bg-green-100 text-green-700 border-green-200" },
};

function TypeBadge({ type }: { type: "update" | "maintenance" | "news" }) {
  const cfg = TYPE_CONFIG[type] ?? TYPE_CONFIG.news;
  const Icon = cfg.icon;
  return (
    <Badge className={`${cfg.className} border text-xs font-medium`}>
      <Icon className="w-3 h-3 mr-1" />{cfg.label}
    </Badge>
  );
}

export default function Announcements() {
  const [, navigate] = useLocation();
  const { data: items = [], isLoading } = trpc.announcement.list.useQuery({ limit: 50 });

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container py-8 max-w-3xl">
        <Button variant="outline" size="sm" className="mb-6 gap-2" onClick={() => navigate("/")}>
          <ChevronLeft className="w-4 h-4" />返回首頁
        </Button>

        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-400 flex items-center justify-center shadow">
            <Megaphone className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">平台公告</h1>
            <p className="text-sm text-muted-foreground">OXM 平台最新消息與維護通知</p>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <Card key={i}><CardContent className="p-5 h-24 animate-pulse bg-muted/40" /></Card>
            ))}
          </div>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              <Megaphone className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>目前沒有公告</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {items.map(item => (
              <Card key={item.id} className={item.isPinned ? "border-orange-200 bg-orange-50/50" : ""}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {item.isPinned && (
                        <span className="inline-flex items-center gap-1 text-xs text-orange-600 font-medium">
                          <Pin className="w-3 h-3" />置頂
                        </span>
                      )}
                      <TypeBadge type={item.type} />
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(item.createdAt).toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" })}
                    </span>
                  </div>
                  <h2 className="font-semibold text-base mb-2">{item.title}</h2>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{item.content}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
