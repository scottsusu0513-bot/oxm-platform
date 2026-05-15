# Apple 登入設定流程

Apple Developer Program 審核通過後，照以下步驟完成 Sign in with Apple 設定。

---

## 1. 建立 App ID

1. 登入 [Apple Developer](https://developer.apple.com/account)
2. Certificates, Identifiers & Profiles → **Identifiers**
3. 點 **+**，選 **App IDs** → **App**
4. Description: `OXM`
5. Bundle ID: `com.oxmmatch.app`（或你選定的 iOS Bundle ID）
6. Capabilities → 勾選 **Sign In with Apple**
7. 儲存

---

## 2. 建立 Services ID（這才是網頁登入用的 Client ID）

> **重要**：`APPLE_CLIENT_ID` 填的是 **Services ID**，不是 App ID 的 Bundle ID。

1. Identifiers → **+** → 選 **Services IDs**
2. Description: `OXM Web`
3. Identifier: `com.oxmmatch.web`（自訂，這就是 `APPLE_CLIENT_ID`）
4. 儲存後，點剛建好的 Services ID → 勾選 **Sign In with Apple** → **Configure**
5. Primary App ID：選剛剛建的 App ID（`com.oxmmatch.app`）
6. Domains and Subdomains：
   ```
   www.oxmmatch.com
   ```
7. Return URLs：
   ```
   https://www.oxmmatch.com/api/oauth/apple/callback
   ```
8. 儲存

---

## 3. 建立 Sign In with Apple Key

1. Keys → **+**
2. Key Name: `OXM Sign In with Apple`
3. 勾選 **Sign In with Apple** → **Configure**
4. Primary App ID：選 `com.oxmmatch.app`
5. 儲存 → **Download**（`.p8` 檔只能下載一次，請妥善保存）
6. 記下 **Key ID**（這就是 `APPLE_KEY_ID`）

---

## 4. 取得 Team ID

Apple Developer 首頁右上角或 Membership 頁面都有 **Team ID**（10 碼英數字）。

---

## 5. Render 環境變數設定

到 Render → OXM Service → Environment → 新增以下變數：

| 變數名稱 | 說明 | 範例值 |
|---|---|---|
| `APPLE_CLIENT_ID` | Services ID（不是 Bundle ID） | `com.oxmmatch.web` |
| `APPLE_TEAM_ID` | Apple Developer Team ID | `ABCDE12345` |
| `APPLE_KEY_ID` | Key ID（建立 Key 時取得） | `XYZ1234567` |
| `APPLE_PRIVATE_KEY` | `.p8` 檔內容，換行改為 `\n` | `-----BEGIN PRIVATE KEY-----\nMIGH...` |
| `APPLE_REDIRECT_URI` | 固定值 | `https://www.oxmmatch.com/api/oauth/apple/callback` |

### APPLE_PRIVATE_KEY 格式

`.p8` 檔是純文字，內容如下：
```
-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg...
-----END PRIVATE KEY-----
```

貼入 Render 時，**把換行全部改成 `\n`**：
```
-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg...\n-----END PRIVATE KEY-----
```

---

## 6. 啟用 Apple 登入按鈕

設好 Render env 後，打開 `client/src/components/LoginDialog.tsx`，找到：

```tsx
{/* Apple — 等 Apple Developer 審核通過後啟用 */}
<Button
  ...
  disabled={true}
>
  以 Apple 帳號登入（即將開放）
</Button>
```

改回：

```tsx
{/* Apple */}
<Button
  className="w-full h-12 text-base gap-3 bg-black hover:bg-zinc-800 text-white border-0"
  disabled={loading !== null}
  onClick={() => login("apple")}
>
  <AppleIcon />
  以 Apple 帳號登入
</Button>
```

commit + push 後 Render 自動重部署即可。

---

## 7. 測試流程

部署完成後依序測試：

1. **正常 Apple 登入**
   - 點「以 Apple 帳號登入」→ 跳 Apple 授權頁
   - 授權後回到 OXM 首頁，顯示已登入

2. **隱藏 email（私人轉寄信箱）**
   - Apple 選「隱藏我的電子郵件」
   - 登入後，不應自動設定 primaryEmail（`@privaterelay.appleid.com` 不視為 primaryEmail）
   - 會員中心應提示：尚未設定主要信箱

3. **補主要信箱並驗證**
   - 在會員中心手動輸入真實 email → 寄驗證信 → 點連結驗證
   - 若此 email 已被 Google 帳號驗證過，觸發自動帳號合併（Apple provider 綁到 Google 主帳號）

4. **會員中心登入方式**
   - Apple 已綁定 ✓
   - Google 已綁定 ✓（若有合併）
   - 黃色待驗證提示消失

5. **回歸測試**
   - Google 登入正常
   - LINE 登入正常
   - 主要信箱驗證正常

---

## 8. 注意事項

- Apple 只在**第一次授權**時傳送使用者姓名，之後的登入不會再傳。姓名已存入 `users.name`，不需重新授權。
- `@privaterelay.appleid.com` 結尾的 email 不應成為 primaryEmail，後端已有過濾（`isPrivateRelay` 判斷）。
- Key 一旦建立，**撤銷後需重新建立並更新 Render 的 `APPLE_PRIVATE_KEY`**。
- Services ID 的 Return URL 必須與 `APPLE_REDIRECT_URI` 完全一致（包含 https、路徑）。
