import { Helmet } from "react-helmet-async";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { PrivacyPolicyContent } from "@/components/legal/PrivacyPolicyContent";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>OXM｜隱私權政策</title>
        <meta name="description" content="OXM 平台隱私權政策，說明我們如何蒐集、使用及保護您的個人資料。" />
      </Helmet>

      <Navbar />

      <FloatingBackButton fallbackHref="/" />
      <div className="container py-8">
        <PrivacyPolicyContent />
      </div>
    </div>
  );
}
