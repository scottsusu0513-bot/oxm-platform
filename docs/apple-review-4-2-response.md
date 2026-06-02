# OXM App Store Review Response — Guideline 4.2 (1.0.10)

## App Store Connect — Response to Guideline 4.2 Minimum Functionality

Paste the following into App Store Connect → Resolution Center:

---

**[App Store Connect Response — English]**

Thank you for your review and feedback. We have made the following improvements in version 1.0.10 to address Guideline 4.2 (Minimum Functionality):

**New in version 1.0.10:**

1. **App-specific Bottom Tab Bar Navigation**
   A native-style bottom tab bar is now displayed exclusively within the iOS and Android app (not shown in web browsers). It provides direct access to:
   - Home feed
   - Factory search
   - Messages / inquiries
   - Saved factories (favorites)
   - Member center (settings, profile, notifications)

2. **Native Share Sheet Integration**
   Users can now share any factory listing using the iOS native share sheet (via Capacitor Share plugin). Tapping the "Share" button on a factory detail page invokes the system share sheet, allowing users to share the factory's URL through any installed app (Messages, Mail, LINE, etc.).

**Existing app-specific functionality (since v1.0.8 / v1.0.9):**

3. **Factory Favorites**
   Users can save factories to a persistent favorites list (stored in the cloud database) and view them in the "My Favorites" section of the app.

4. **Recently Viewed Factories**
   The app automatically records the last 20 factories a user has visited, available in the "Recently Viewed" tab without requiring an internet connection.

5. **In-App Notification Preferences**
   A dedicated "Notification Settings" section in the Member Center allows users to configure which types of push notifications they receive (new messages, review replies, platform announcements).

6. **App-Optimized Loading Experience**
   Branded loading screen, smooth page transitions, and native-app-grade animated menu interactions have been implemented specifically for the mobile app experience.

7. **Member Center — App Settings Hub**
   The Member Center provides a structured, app-like interface with dedicated sections for: profile management, order history, reviews, reports, account security, and customer support.

OXM is a B2B manufacturing marketplace connecting Taiwanese factories with businesses seeking OEM/ODM sourcing. The app provides value beyond a mobile website through push notifications, device-level integrations (share sheet, badge counts), persistent user data, real-time factory inquiry and messaging, and offline-accessible recently viewed history.

We believe the app now demonstrates the minimum functionality required by Guideline 4.2. Please feel free to contact us if you need any further clarification.

---

## Google Play 1.0.10 Release Notes（繁體中文）

**版本 1.0.10 更新內容**

- 新增 App 專屬底部導覽列，快速切換首頁、搜尋、訊息、收藏、我的頁面
- 新增原生分享功能：工廠詳情頁可直接呼叫系統分享選單
- 修正 App 啟動黑屏問題，啟動體驗更流暢
- 優化全站 Loading 畫面，顯示 OXM 品牌化 spinner
- 頁面切換加入輕量淡入動畫
- 優化 Navbar 手機選單展開/收合動畫
- Chat 附件選單加入展開動畫
- 修正工廠後台客戶詢問分頁返回 404 問題
- 工廠 App 名稱更新為「OXM台灣傳產資源媒合平台」

---

## Google Play 1.0.10 Release Notes（English）

**What's new in 1.0.10**

- Added native bottom tab bar navigation (Home, Search, Messages, Favorites, My Page)
- Added native share sheet: tap Share on any factory listing to share via system apps
- Fixed black screen on app launch (Android native theme)
- Improved loading screen with branded OXM spinner
- Added smooth page entry and menu open/close animations
- Fixed factory dashboard navigation returning 404
- Updated app display name
