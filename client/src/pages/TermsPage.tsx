import { Helmet } from "react-helmet-async";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

const SECTIONS = [
  {
    title: "一、平台性質",
    content:
      "本平台為資訊媒合平台，提供工廠與需求方之間的資訊展示與搜尋服務。本平台不參與雙方實際交易，亦不對交易內容負任何保證或責任。",
    items: [],
  },
  {
    title: "二、帳號使用",
    content: null,
    items: [
      "使用者應提供正確且完整之資料。",
      "使用者須妥善保管帳號資訊，不得轉讓或出借。",
      "若發現任何未經授權之使用，應立即通知本平台。",
    ],
  },
  {
    title: "三、工廠資料責任",
    content: null,
    items: [
      "工廠用戶應確保所提供之資料（包含但不限於公司資訊、產品內容、聯絡方式）之真實性與合法性。",
      "若提供不實資訊所產生之法律責任，應由該用戶自行負責。",
      "本平台有權對內容進行審核、下架或修改。",
    ],
  },
  {
    title: "四、使用者行為",
    content: "使用者不得從事以下行為：",
    items: [
      "發布不實、詐欺或誤導性資訊",
      "侵害他人智慧財產權或其他權利",
      "進行任何違反法令之行為",
      "干擾平台正常運作",
    ],
  },
  {
    title: "五、免責聲明",
    content: null,
    items: [
      "本平台僅提供資訊展示與媒合功能，不對任何交易結果負責。",
      "使用者應自行評估合作對象之可信度與風險。",
      "因使用本平台所產生之任何損失，本平台不負賠償責任。",
    ],
  },
  {
    title: "六、服務調整與終止",
    content: "本平台保留隨時修改、暫停或終止服務之權利，無須事先通知。",
    items: [],
  },
  {
    title: "七、收費與服務（如適用）",
    content:
      "本平台可能提供付費曝光或置頂服務，相關內容與費用將另行公告。使用者一旦購買，即表示同意相關規則。",
    items: [],
  },
  {
    title: "八、條款修改",
    content:
      "本平台有權隨時修改本服務條款，修改後將公告於網站上，使用者繼續使用即視為同意更新內容。",
    items: [],
  },
  {
    title: "九、準據法與管轄",
    content:
      "本條款之解釋與適用，以中華民國法律為準據法。如有爭議，雙方同意以台灣地方法院為第一審管轄法院。",
    items: [],
  },
  {
    title: "十、聯絡方式",
    content: "如對本條款有任何疑問，請透過平台聯繫客服。",
    items: [],
  },
];

export default function TermsPage() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>OXM｜服務條款</title>
        <meta name="description" content="OXM 平台服務條款，說明平台性質、帳號使用規範、免責聲明等相關規定。" />
      </Helmet>

      <Navbar />

      <div className="container py-8">
        <Button variant="ghost" size="sm" className="mb-6" onClick={() => navigate(-1 as any)}>
          <ArrowLeft className="w-4 h-4 mr-1" />返回
        </Button>

        <div className="max-w-[800px] mx-auto">
          <h1 className="text-3xl font-bold mb-2">服務條款</h1>
          <p className="text-sm text-muted-foreground mb-8">最後更新：2025 年</p>

          <p className="text-muted-foreground leading-relaxed mb-8">
            歡迎您使用 OXM 代工廠媒合平台（以下簡稱「本平台」）。當您註冊或使用本平台服務時，即表示您已閱讀、理解並同意遵守以下條款：
          </p>

          <div className="space-y-8">
            {SECTIONS.map((section) => (
              <section key={section.title}>
                <h2 className="text-lg font-semibold mb-3 text-foreground">{section.title}</h2>
                {section.content && (
                  <p className="text-muted-foreground leading-relaxed">{section.content}</p>
                )}
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
