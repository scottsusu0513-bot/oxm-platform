/**
 * Batch 3.7：App 登入票券的 PKCE 式綁定——前端契約。
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { APP_LOGIN_CHALLENGE_PARAM, APP_LOGIN_CHALLENGE_RE, APP_LOGIN_VERIFIER_STORAGE_KEY } from "@shared/appLoginPkce";

const read = (f: string) => fs.readFileSync(path.resolve(__dirname, f), "utf-8");

describe("App 登入 PKCE（前端）", () => {
  it("performLogin（App）在開啟系統瀏覽器前產生 verifier、存本機，只把 SHA-256 challenge 放進網址", () => {
    const src = read("../const.ts");
    expect(src).toMatch(/crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
    expect(src).toMatch(/crypto\.subtle\.digest\("SHA-256"/);
    expect(src).toMatch(/localStorage\.setItem\(APP_LOGIN_VERIFIER_STORAGE_KEY, verifier\)/);
    expect(src).toMatch(/appUrl \+= `&\$\{APP_LOGIN_CHALLENGE_PARAM\}=\$\{challenge\}`/);
    expect(src.indexOf("createAppLoginChallenge()")).toBeLessThan(src.indexOf("Browser.open({ url: appUrl })"));
    expect(src).not.toMatch(/appUrl[^\n]*verifier/);
  });

  it("深層連結回來時同時送出票券與 verifier，用完即清除；票券不寫進 log", () => {
    const src = read("../App.tsx");
    expect(src).toMatch(/body: JSON\.stringify\(\{ ticket, verifier: readAndClearAppLoginVerifier\(\) \}\)/);
    expect(src).toMatch(/localStorage\.removeItem\(APP_LOGIN_VERIFIER_STORAGE_KEY\)/);
    expect(src).not.toMatch(/console\.\w+\([^)]*ticket\.slice/);
  });

  it("challenge 格式：base64url(SHA-256(verifier))，43 字元（與 server 相同演算法）", () => {
    const verifier = "A".repeat(43);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toMatch(APP_LOGIN_CHALLENGE_RE);
    expect(APP_LOGIN_CHALLENGE_PARAM).toBe("app_challenge");
    expect(APP_LOGIN_VERIFIER_STORAGE_KEY).toBe("oxm_app_login_verifier");
  });
});
