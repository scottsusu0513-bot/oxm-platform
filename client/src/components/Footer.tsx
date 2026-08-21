import { Link } from "wouter";
import { Factory, Wrench, Instagram, Facebook, AtSign } from "lucide-react";

// 內部站內連結共用樣式：hover 用 OXM 橘色語意，focus 狀態維持可見（不可消失）。
const NAV_LINK_CLASS =
  "hover:text-orange-400 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 rounded-sm";

/**
 * Global Footer——原本只存在於 Home.tsx 的一段 footer-like 區塊（品牌／社群／
 * Email／Terms／Privacy／copyright）已搬到這裡並擴充成完整 4 欄頁尾，全站只有
 * 這一份，不與 Home.tsx 重複維護。品牌／聯絡／社群資料完全沿用 Home.tsx 原本
 * 已有的內容，沒有新造任何 URL 或文案。
 *
 * 由 App.tsx 內的 FooterGate（比照既有 AiShellGate 的寫法）依
 * client/src/lib/footerRoutes.ts 的 isFooterExcludedPath() 判斷是否顯示，
 * 這個元件本身不做任何路由判斷。
 */
export function Footer() {
  return (
    <footer className="border-t border-gray-800 bg-gray-900 text-gray-400">
      <div className="container py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">
          {/* A. 品牌區 */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <Factory className="w-5 h-5 text-orange-400 shrink-0" />
              <img src="/logo-oxm.png" alt="OXM" className="h-7 w-auto" />
              <Wrench className="w-5 h-5 text-purple-400 shrink-0" />
            </div>
            <p className="text-sm text-gray-300 mb-1">台灣傳統產業資源媒合平台</p>
            <p className="text-sm text-gray-500 leading-relaxed mb-4">
              串連工廠、工作室與需求方，讓 ODM／OEM 合作媒合更簡單透明。
            </p>
            <div className="flex items-center gap-4">
              <a href="https://www.instagram.com/oxmmatch_tw/?hl=zh-tw" target="_blank" rel="noopener noreferrer"
                className="text-gray-400 hover:text-orange-400 transition-colors" aria-label="Instagram">
                <Instagram className="w-5 h-5" />
              </a>
              <a href="https://www.threads.com/@oxmmatch_tw" target="_blank" rel="noopener noreferrer"
                className="text-gray-400 hover:text-purple-400 transition-colors" aria-label="Threads">
                <AtSign className="w-5 h-5" />
              </a>
              <a href="https://www.facebook.com/profile.php?id=61564590907055" target="_blank" rel="noopener noreferrer"
                className="text-gray-400 hover:text-orange-400 transition-colors" aria-label="Facebook">
                <Facebook className="w-5 h-5" />
              </a>
              <a href="https://line.me/ti/p/@785bsmsr" target="_blank" rel="noopener noreferrer"
                className="text-gray-400 hover:text-green-400 transition-colors" aria-label="LINE">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.105.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
                </svg>
              </a>
            </div>
          </div>

          {/* B／C／D：站內導覽，共用同一個 <nav>，語意上是同一組「頁尾導覽」。
              className="contents" 讓三個子區塊直接落在外層 grid 的欄位裡，
              視覺上維持 4 欄排版，同時保留單一 <nav> 的語意結構。 */}
          <nav aria-label="頁尾導覽" className="contents">
            {/* B. 平台服務 */}
            <div>
              <h3 className="text-sm font-semibold text-white mb-4">平台服務</h3>
              <ul className="space-y-2.5 text-sm">
                <li><Link href="/search" className={NAV_LINK_CLASS}>找工廠</Link></li>
                <li><Link href="/resources" className={NAV_LINK_CLASS}>找資源</Link></li>
                <li><Link href="/talent" className={NAV_LINK_CLASS}>找人才</Link></li>
                <li><Link href="/brand" className={NAV_LINK_CLASS}>找形象</Link></li>
                <li><Link href="/news" className={NAV_LINK_CLASS}>找消息</Link></li>
                <li><Link href="/community" className={NAV_LINK_CLASS}>找討論</Link></li>
              </ul>
            </div>

            {/* C. 關於 OXM */}
            <div>
              <h3 className="text-sm font-semibold text-white mb-4">關於 OXM</h3>
              <ul className="space-y-2.5 text-sm">
                <li><Link href="/about" className={NAV_LINK_CLASS}>關於 OXM</Link></li>
                <li><Link href="/faq" className={NAV_LINK_CLASS}>FAQ</Link></li>
              </ul>
            </div>

            {/* D. 法律與政策 */}
            <div>
              <h3 className="text-sm font-semibold text-white mb-4">法律與政策</h3>
              <ul className="space-y-2.5 text-sm">
                <li><Link href="/terms" className={NAV_LINK_CLASS}>服務條款</Link></li>
                <li><Link href="/privacy" className={NAV_LINK_CLASS}>隱私權政策</Link></li>
              </ul>
            </div>
          </nav>
        </div>

        {/* Contact + Copyright */}
        <div className="mt-10 pt-6 border-t border-gray-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-500">
          <div className="flex items-center gap-1.5">
            <span>客服信箱：</span>
            <a href="mailto:scottsusu@oxmmatch.com" className="hover:text-orange-400 transition-colors">
              scottsusu@oxmmatch.com
            </a>
          </div>
          <p>&copy; {new Date().getFullYear()} OXM. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
