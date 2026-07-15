// 共用 JSON-LD 結構化資料工具：接收單一 Schema.org 物件或物件陣列，輸出
// <script type="application/ld+json">。
//
// 重要：react-helmet-async（本專案安裝的 3.0.0 版，見
// node_modules/react-helmet-async/lib/index.esm.js 的 mapChildrenToProps /
// warnOnInvalidChildren）只接受「原生 HTML 標籤」作為 <Helmet> 的直接子元素。
// 若把子元素以自訂元件的 JSX 形式（例如 <SomeComponent />）放進 <Helmet>，
// React 傳給 Helmet 的 child.type 會是該元件的 function 參照（不是字串
// "script"），react-helmet-async 內部會判定為「試圖巢狀 Helmet 元件」並直接
// throw Error（invariant 拋出例外，不是單純 console warning），導致該頁面
// 渲染整個失敗。因此這裡刻意不提供任何 JSX 元件形式的 API，只提供
// renderJsonLd(data) 一般函式呼叫，呼叫後回傳的就是已經 resolve 好的原生
// <script> 元素（element.type 是字串 "script"），可以安全地直接放進
// <Helmet> 內。
import { toSafeJsonLdString, type JsonLdObject } from "@shared/seo/schema";

export type { JsonLdObject };

// 在 <Helmet> 內請一律以 {renderJsonLd(data)} 的函式呼叫形式使用，
// 不要包成 <SomeComponent data={...} /> 這種 JSX 元件標籤。
// 轉義邏輯（"<" 換成 "<"）與 server 端 publicPageMeta.ts 共用同一份
// toSafeJsonLdString（shared/seo/schema.ts），避免兩邊序列化規則不一致。
export function renderJsonLd(data: JsonLdObject | JsonLdObject[]) {
  return <script type="application/ld+json">{toSafeJsonLdString(data)}</script>;
}
