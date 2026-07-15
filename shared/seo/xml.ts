// 最小共用 XML escaping 工具，供 sitemap.xml 產生器使用，抽出成獨立函式方便
// 單元測試涵蓋（原本是路由 handler 內的匿名函式，無法單獨測試）。
export function escapeXmlText(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
