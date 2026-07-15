// 全站品牌常數：集中管理 OXM 品牌名稱、網址、描述等資料，供 client 與 server
// 共用（SEO meta、JSON-LD 結構化資料、伺服器端初始 HTML head 注入皆引用同一份，
// 避免各處各自寫一份、日後描述不一致）。

export interface Brand {
  name: string;
  url: string;
  logo: string;
  shortDescription: string;
  description: string;
  serviceArea: string;
  language: string;
  sameAs: string[];
}

export const BRAND: Brand = {
  name: "OXM",
  url: "https://www.oxmmatch.com",
  // 目前專案內沒有獨立的 logo 檔案，favicon.png（1024×1024，正方形）是唯一
  // 已確認、實際在 client/index.html 中引用中的官方品牌圖示，因此採用它。
  logo: "https://www.oxmmatch.com/favicon.png",
  shortDescription: "台灣傳統產業的數位資源平台",
  description:
    "OXM 是台灣傳統產業的數位資源平台，整合工廠媒合、企業升級、產業人才、品牌形象與產業資訊，協助企業找到合適的製造與轉型資源。",
  serviceArea: "台灣",
  language: "zh-TW",
  // 只列出專案中已確認存在、目前實際使用中的官方連結（Home.tsx 頁尾社群連結、
  // App Store／Google Play 上架連結），未確認的官方帳號不加入。
  sameAs: [
    "https://play.google.com/store/apps/details?id=com.oxmmatch.app",
    "https://apps.apple.com/tw/app/oxm/id6774048275",
    "https://www.instagram.com/oxmmatch_tw/",
    "https://www.threads.com/@oxmmatch_tw",
    "https://www.facebook.com/profile.php?id=61564590907055",
    "https://line.me/ti/p/@785bsmsr",
  ],
};
