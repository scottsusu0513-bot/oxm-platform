import { useEffect } from "react";
import { Helmet } from "react-helmet-async";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { TermsContent } from "@/components/legal/TermsContent";

export default function TermsPage() {
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;

    const id = hash.replace("#", "");
    let attempts = 0;

    const scrollToHash = () => {
      const el = document.getElementById(id);
      attempts += 1;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return true;
      }
      return attempts >= 20;
    };

    if (scrollToHash()) return;

    const interval = window.setInterval(() => {
      if (scrollToHash()) window.clearInterval(interval);
    }, 100);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>OXM｜服務條款</title>
        <meta name="description" content="OXM 台灣傳統產業資源媒合平台服務條款，說明平台性質、帳號使用規範、交易責任、智慧財產權、隱私保護等相關規定。" />
      </Helmet>

      <Navbar />

      <FloatingBackButton fallbackHref="/" />
      <div className="container py-8">
        <TermsContent />
      </div>
    </div>
  );
}
