import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.oxmmatch.app',
  appName: 'OXM台灣傳產資源媒合平台',
  webDir: 'dist/public',
  // App 啟動黑畫面 root cause：server.url 指向遠端網址，WebView 要等
  // HTML/CSS/JS 從網路載回來才有第一個像素可畫；在那之前 WebView 本身顯示
  // 的是原生預設背景色（Android/iOS 沒有設定時常見是黑色，深色模式下更
  // 明顯），跟 Android 啟動主題（android:windowBackground=#FFF7ED，見
  // android/app/src/main/res/values/styles.xml）與 iOS LaunchScreen（白底
  // Splash 圖）完全對不起來，才會出現「品牌啟動畫面 → 突然變黑 → 網頁淡入」
  // 這種不連續的跳接。這裡明確指定 WebView 背景色，讓網路等待期間顯示的
  // 顏色跟啟動畫面／實際頁面背景一致，不是換掉啟動畫面本身。
  backgroundColor: '#FFF7ED',
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
