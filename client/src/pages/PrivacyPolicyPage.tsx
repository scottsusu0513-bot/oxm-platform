import { Helmet } from "react-helmet-async";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

const SECTIONS = [
  {
    title: "一、蒐集的資料類型",
    content: "當您使用本平台服務時，我們可能蒐集以下資訊：",
    items: [
      "電子郵件地址（如透過 Google 登入）",
      "基本帳戶資料（如名稱、頭像）",
      "您在平台上填寫的資料（如工廠資訊）",
    ],
  },
  {
    title: "二、資料使用目的",
    content: "我們蒐集您的資料，僅用於以下用途：",
    items: [
      "提供登入與會員功能",
      "優化平台使用體驗",
      "提供客戶服務與回覆您的問題",
    ],
  },
  {
    title: "三、資料保護",
    content: "本平台將採取合理技術與管理措施，保護您的個人資料不被未授權存取、洩漏或竄改。",
    items: [],
  },
  {
    title: "四、資料分享",
    content: "本平台不會將您的個人資料提供給第三方，除非：",
    items: ["經您同意", "依法規或政府機關要求"],
  },
  {
    title: "五、第三方服務",
    content: "本平台使用 Google 登入等第三方服務，其資料處理方式將依該服務之隱私政策辦理。",
    items: [],
  },
  {
    title: "六、使用者權利",
    content: "您可隨時要求查詢、更正或刪除您的個人資料。",
    items: [],
  },
  {
    title: "七、政策修改",
    content: "本平台保留隨時修改本隱私權政策之權利，更新後將公告於網站。",
    items: [],
  },
  {
    title: "八、聯絡方式",
    content: "如您對本政策有任何疑問，請透過平台聯繫客服與我們聯絡。",
    items: [],
  },
];

export default function PrivacyPolicyPage() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>OXM｜隱私權政策</title>
        <meta name="description" content="OXM 平台隱私權政策，說明我們如何蒐集、使用及保護您的個人資料。" />
      </Helmet>

      <Navbar />

      <div className="container py-8">
        <Button variant="ghost" size="sm" className="mb-6" onClick={() => navigate(-1 as any)}>
          <ArrowLeft className="w-4 h-4 mr-1" />返回
        </Button>

        <div className="max-w-[800px] mx-auto">
          <h1 className="text-3xl font-bold mb-2">隱私權政策</h1>
          <p className="text-sm text-muted-foreground mb-8">最後更新：2025 年</p>

          <p className="text-muted-foreground leading-relaxed mb-8">
            歡迎您使用 OXM（以下簡稱「本平台」）。我們非常重視您的個人資料與隱私權，並依據相關法規保護您的資料安全。
          </p>

          <div className="space-y-8">
            {SECTIONS.map((section) => (
              <section key={section.title}>
                <h2 className="text-lg font-semibold mb-3 text-foreground">{section.title}</h2>
                <p className="text-muted-foreground leading-relaxed">{section.content}</p>
                {section.items.length > 0 && (
                  <ol className="mt-3 space-y-1.5 list-decimal list-inside">
                    {section.items.map((item, i) => (
                      <li key={i} className="text-muted-foreground text-sm leading-relaxed pl-1">
                        {item}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
