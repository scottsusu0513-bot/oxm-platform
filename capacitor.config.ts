import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.oxmmatch.app',
  appName: 'OXM台灣傳產資源媒合平台',
  webDir: 'dist/public',
  server: {
    url: 'https://www.oxmmatch.com',
    androidScheme: 'https',
    cleartext: false,
  },
  plugins: {
    FirebaseMessaging: {
      // 讓 iOS App 在前景時仍顯示通知橫幅、播放音效、更新 badge
      presentationOptions: ["alert", "badge", "sound"],
    },
  },
};

export default config;
