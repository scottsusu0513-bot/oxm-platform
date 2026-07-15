import { useEffect } from "react";

/**
 * server/_core/publicPageMeta.ts 在初始 HTML 裡直接寫入這個頁面專屬的
 * title／meta description／canonical／所有 og:* meta，讓「檢視網頁原始碼」
 * 與搜尋引擎爬蟲不用等 React 執行就能看到正確的 SEO 資料。每一個這樣的節點
 * 都帶有 data-oxm-seo-transient="true" 屬性。
 *
 * react-helmet-async 只會管理它自己建立的 head 元素，完全不會去異動這些
 * 伺服器早就寫好、不是它建立的靜態標籤。因此一旦 React 掛載、Helmet 透過
 * <Helmet> 重新宣告了「同一組」title／canonical／OG，畫面上就會同時存在
 * 伺服器版與 Helmet 版兩份，造成重複。
 *
 * 這個 hook 在頁面元件掛載後執行，只移除帶有 data-oxm-seo-transient="true"
 * 標記的節點——不會誤刪 Helmet 自己管理的節點（Helmet 產生的節點沒有這個
 * 屬性），也不會動到 index.html 其他必要的 meta（viewport、charset、favicon
 * 等皆無此標記）。
 *
 * 注意：JSON-LD <script> 不帶這個屬性、故意不會被這個 hook 移除——實測並讀
 * react-helmet-async 原始碼確認，本專案的 React 19 + react-helmet-async 3.0
 * 對「沒有 src 的行內 script」不會把它 hoist 到 <head>（只有 title/meta/link
 * 一定會被搬進 head；無 src 的 inline script 只會停留在 <Helmet> 元件在畫面
 * 樹中的原本位置），代表 Helmet 端根本沒有在 <head> 放置對應的 JSON-LD 可
 * 供切換；JSON-LD 因此完全交給 server 端注入、React 掛載後永遠保留，
 * Home.tsx／AboutOXM.tsx 也不再呼叫 renderJsonLd()。
 *
 * document.querySelectorAll + Element.remove() 是冪等操作：React StrictMode
 * 讓 effect 執行兩次時，第二次呼叫只會找到 0 個節點（第一次已經移除），
 * forEach 對空 NodeList 是安全的無操作，不會拋出任何錯誤。
 */
export function useRemoveServerSeoHead(): void {
  useEffect(() => {
    document
      .querySelectorAll('[data-oxm-seo-transient="true"]')
      .forEach(el => el.remove());
  }, []);
}
