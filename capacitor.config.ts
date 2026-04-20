import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.oxmmatch.app',
  appName: 'OXM全台最大代工平台',
  webDir: 'dist/public',
  server: {
    // 正式主機上線後，將下方 url 改為實際網址，例如：
    // url: 'https://oxmmatch.com',
    // 開發測試時保持註解，App 會讀取 webDir 的靜態檔案
    androidScheme: 'https',
  },
};

export default config;
