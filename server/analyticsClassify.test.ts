import { describe, expect, it } from "vitest";
import {
  parseUserAgent, matchKnownBot, hasAutomationUaSignature, classifyReferrer, extractReferrerHost,
  computeSuspiciousScore, finalizeClassification, normalizePlatform,
} from "./analyticsClassify";

const UA_CHROME_DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const UA_SAFARI_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const UA_ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
const UA_FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0";
const UA_EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0";
const UA_MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const UA_IPAD = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

describe("parseUserAgent（裝置/瀏覽器/OS）", () => {
  it("桌機 Chrome / Windows", () => {
    expect(parseUserAgent(UA_CHROME_DESKTOP)).toEqual({ deviceType: "desktop", browser: "Chrome", os: "Windows" });
  });
  it("iPhone Safari / iOS", () => {
    expect(parseUserAgent(UA_SAFARI_IOS)).toEqual({ deviceType: "mobile", browser: "Safari", os: "iOS" });
  });
  it("Android Chrome", () => {
    expect(parseUserAgent(UA_ANDROID_CHROME)).toEqual({ deviceType: "mobile", browser: "Chrome", os: "Android" });
  });
  it("Firefox", () => {
    expect(parseUserAgent(UA_FIREFOX).browser).toBe("Firefox");
  });
  it("Edge 不會被誤判成 Chrome（Edge UA 裡也含 Chrome/ 字串）", () => {
    expect(parseUserAgent(UA_EDGE).browser).toBe("Edge");
  });
  it("Mac Safari 不會被誤判成 iOS", () => {
    expect(parseUserAgent(UA_MAC_SAFARI)).toEqual({ deviceType: "desktop", browser: "Safari", os: "macOS" });
  });
  it("iPad 判定為 tablet", () => {
    expect(parseUserAgent(UA_IPAD).deviceType).toBe("tablet");
  });
  it("空字串安全 fallback，不拋錯", () => {
    expect(parseUserAgent("")).toEqual({ deviceType: "other", browser: "Other", os: "Other" });
  });
});

describe("normalizePlatform（不信任 client 傳任意字串）", () => {
  it("合法值原樣通過", () => {
    expect(normalizePlatform("ios_app")).toBe("ios_app");
    expect(normalizePlatform("android_app")).toBe("android_app");
    expect(normalizePlatform("web")).toBe("web");
  });
  it("非法/偽造值一律收斂成 other", () => {
    expect(normalizePlatform("desktop_app")).toBe("other");
    expect(normalizePlatform(undefined)).toBe("other");
    expect(normalizePlatform(123)).toBe("other");
  });
});

describe("matchKnownBot（只用明確清單，不用模糊 bot/crawler 關鍵字）", () => {
  it("Googlebot", () => {
    expect(matchKnownBot("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe("Googlebot");
  });
  it("GPTBot", () => {
    expect(matchKnownBot("Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)")).toBe("GPTBot");
  });
  it("AhrefsBot", () => {
    expect(matchKnownBot("Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)")).toBe("AhrefsBot");
  });
  it("一般瀏覽器 UA 不會誤判成 bot", () => {
    expect(matchKnownBot(UA_CHROME_DESKTOP)).toBeNull();
    expect(matchKnownBot(UA_SAFARI_IOS)).toBeNull();
  });
  it("UA 裡剛好出現 'robot'/'spider' 字樣但不在明確清單內，不誤判（避免模糊比對誤傷）", () => {
    expect(matchKnownBot("Mozilla/5.0 SomeRandomSpiderThing/1.0")).toBeNull();
  });
});

describe("hasAutomationUaSignature", () => {
  it("命中已知 automation 工具", () => {
    expect(hasAutomationUaSignature("Mozilla/5.0 (Windows NT 10.0) HeadlessChrome/128.0.0.0")).toBe(true);
    expect(hasAutomationUaSignature("python-requests/2.31.0")).toBe(true);
    expect(hasAutomationUaSignature("curl/8.4.0")).toBe(true);
  });
  it("正常瀏覽器與行動 App 常用 SDK（axios/okhttp/node-fetch）不誤判——避免誤傷 Capacitor App", () => {
    expect(hasAutomationUaSignature(UA_CHROME_DESKTOP)).toBe(false);
    expect(hasAutomationUaSignature(UA_SAFARI_IOS)).toBe(false);
    expect(hasAutomationUaSignature("okhttp/4.9.0")).toBe(false);
    expect(hasAutomationUaSignature("axios/1.6.0")).toBe(false);
  });
});

describe("classifyReferrer / extractReferrerHost", () => {
  it("沒有 referrer 且非 App → direct", () => {
    expect(classifyReferrer({ referrer: null })).toBe("direct");
  });
  it("沒有 referrer 且是 App → app（不誤判成 unknown 或異常）", () => {
    expect(classifyReferrer({ referrer: null, platform: "ios_app" })).toBe("app");
    expect(classifyReferrer({ referrer: null, platform: "android_app" })).toBe("app");
  });
  it("Google 網域", () => {
    expect(classifyReferrer({ referrer: "https://www.google.com/search?q=oxm" })).toBe("google_organic");
  });
  it("Bing", () => {
    expect(classifyReferrer({ referrer: "https://www.bing.com/search?q=oxm" })).toBe("bing_organic");
  });
  it("Threads / Facebook / Instagram / LINE / ChatGPT / Perplexity", () => {
    expect(classifyReferrer({ referrer: "https://www.threads.net/@someone" })).toBe("threads");
    expect(classifyReferrer({ referrer: "https://www.facebook.com/" })).toBe("facebook");
    expect(classifyReferrer({ referrer: "https://www.instagram.com/" })).toBe("instagram");
    expect(classifyReferrer({ referrer: "https://line.me/R/" })).toBe("line");
    expect(classifyReferrer({ referrer: "https://chatgpt.com/c/xxx" })).toBe("chatgpt");
    expect(classifyReferrer({ referrer: "https://www.perplexity.ai/search" })).toBe("perplexity");
  });
  it("站內導覽（referrer 是自己網域）算 direct，不算外部來源", () => {
    expect(classifyReferrer({ referrer: "https://www.oxmmatch.com/search" })).toBe("direct");
  });
  it("其他外部網域 → other_referral", () => {
    expect(classifyReferrer({ referrer: "https://some-random-blog.example.com/post" })).toBe("other_referral");
  });
  it("UTM source 優先於 referrer 網域判斷", () => {
    expect(classifyReferrer({ referrer: "https://www.oxmmatch.com/", utmSource: "facebook" })).toBe("facebook");
  });
  it("無法解析的 referrer 字串 → unknown", () => {
    expect(classifyReferrer({ referrer: "not-a-valid-url" })).toBe("unknown");
  });
  it("extractReferrerHost 正確取出 hostname", () => {
    expect(extractReferrerHost("https://www.google.com/search?q=x")).toBe("www.google.com");
    expect(extractReferrerHost(null)).toBeNull();
    expect(extractReferrerHost("garbage")).toBeNull();
  });
});

function allFalseSignals() {
  return {
    automationUa: false, newVisitorIdsPerIpRecent: 0, searchesPerIpRecent: 0,
    fixedIntervalPattern: false, mostlySingleEventSessions: false, repeatedQueryCount: 0,
    factoryEnumeration: false, cloudAsn: false,
  };
}

describe("computeSuspiciousScore（多訊號組合，非單一 boolean）", () => {
  it("完全沒有訊號 → score=0, level=human", () => {
    const r = computeSuspiciousScore(allFalseSignals());
    expect(r.score).toBe(0);
    expect(r.level).toBe("human");
    expect(r.signals).toEqual([]);
  });

  it("單一 automation UA 訊號（40分）→ suspicious_low（30-59），不是 human", () => {
    const r = computeSuspiciousScore({ ...allFalseSignals(), automationUa: true });
    expect(r.score).toBe(40);
    expect(r.level).toBe("suspicious_low");
    expect(r.signals).toEqual(["AUTOMATION_UA"]);
  });

  it("同 IP 5 分鐘大量新 visitorId（30分）→ suspicious_low", () => {
    const r = computeSuspiciousScore({ ...allFalseSignals(), newVisitorIdsPerIpRecent: 25 });
    expect(r.score).toBe(30);
    expect(r.level).toBe("suspicious_low");
    expect(r.signals).toContain("HIGH_NEW_VISITOR_RATE");
  });

  it("組合多項訊號可以疊加到 suspicious_high（>=80）", () => {
    const r = computeSuspiciousScore({
      automationUa: true, // 40
      newVisitorIdsPerIpRecent: 25, // 30
      searchesPerIpRecent: 20, // 25
      fixedIntervalPattern: false,
      mostlySingleEventSessions: false,
      repeatedQueryCount: 0,
      factoryEnumeration: false,
      cloudAsn: false,
    });
    expect(r.score).toBe(95);
    expect(r.level).toBe("suspicious_high");
  });

  it("分數上限封頂在 100，不會溢出", () => {
    const r = computeSuspiciousScore({
      automationUa: true, newVisitorIdsPerIpRecent: 100, searchesPerIpRecent: 100,
      fixedIntervalPattern: true, mostlySingleEventSessions: true, repeatedQueryCount: 50,
      factoryEnumeration: true, cloudAsn: true,
    });
    expect(r.score).toBe(100);
    expect(r.level).toBe("suspicious_high");
  });

  it("低於門檻的少量訊號（例如剛好 20 個新 visitorId，未達 >20 門檻）不觸發", () => {
    const r = computeSuspiciousScore({ ...allFalseSignals(), newVisitorIdsPerIpRecent: 20 });
    expect(r.score).toBe(0);
    expect(r.level).toBe("human");
  });

  it("factoryId 系統性枚舉單獨命中（25分，低於 30 分門檻）仍是 human——單一訊號不足以判定可疑，須跟其他訊號組合", () => {
    const r = computeSuspiciousScore({ ...allFalseSignals(), factoryEnumeration: true });
    expect(r.score).toBe(25);
    expect(r.level).toBe("human");
    expect(r.signals).toEqual(["FACTORY_ENUMERATION"]);
  });

  it("factoryId 系統性枚舉 + 重複查詢組合（25+15=40）→ suspicious_low", () => {
    const r = computeSuspiciousScore({ ...allFalseSignals(), factoryEnumeration: true, repeatedQueryCount: 5 });
    expect(r.score).toBe(40);
    expect(r.level).toBe("suspicious_low");
  });

  it("cloud ASN 單獨命中（10分）不足以構成 suspicious（低於 30 門檻）——ASN 不得當主要依據", () => {
    const r = computeSuspiciousScore({ ...allFalseSignals(), cloudAsn: true });
    expect(r.level).toBe("human");
  });
});

describe("finalizeClassification（Dashboard 三層彙總）", () => {
  it("known bot 優先於 suspicious score", () => {
    expect(finalizeClassification("Googlebot", "suspicious_high")).toBe("known_bot");
  });
  it("沒有 known bot、suspicious level 非 human → suspicious（不得顯示成 bot）", () => {
    expect(finalizeClassification(null, "suspicious_low")).toBe("suspicious");
    expect(finalizeClassification(null, "suspicious_medium")).toBe("suspicious");
    expect(finalizeClassification(null, "suspicious_high")).toBe("suspicious");
  });
  it("都沒有命中 → human", () => {
    expect(finalizeClassification(null, "human")).toBe("human");
  });
});

describe("Capacitor App 不應被誤判（對話中「四十、APP 不可被誤判」）", () => {
  it("App 平台 + 一般行動瀏覽器 UA + 無 referrer → human，不是 suspicious", () => {
    const botName = matchKnownBot(UA_SAFARI_IOS);
    const automationUa = hasAutomationUaSignature(UA_SAFARI_IOS);
    const source = classifyReferrer({ referrer: null, platform: "ios_app" });
    const suspicious = computeSuspiciousScore({ ...allFalseSignals(), automationUa });
    const finalClass = finalizeClassification(botName, suspicious.level);
    expect(source).toBe("app");
    expect(finalClass).toBe("human");
  });
});
