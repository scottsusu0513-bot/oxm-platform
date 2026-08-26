import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * 工廠公開頁「聯繫工廠」action module 重構（Phase 4A-R）的回歸測試。
 *
 * 同 server/factoryContactLogin.test.ts／server/factoryDetailScrollReset.test.ts
 * 的既有做法：本專案 vitest 只涵蓋 environment: "node"，沒有 jsdom／React
 * Testing Library，無法在這裡真的 render 元件量測版面。這裡改用原始碼內容
 * 斷言，鎖定這次重構的具體回歸情境：
 *   1. Action module（聯繫工廠＋收藏／分享／檢舉）是 Header 區塊內、公司自我
 *      介紹「旁邊」的一個獨立操作卡，不是 Header 下方另開的整頁 full-width
 *      primary section（Phase 4A 第一版的錯誤方向，已被本輪取代）。
 *   2. Action module 在桌機有自己收斂的寬度／shrink 行為，不會撐滿整個內容寬度。
 *   3. module 內部才做「左：大型聯繫工廠／右：收藏、分享、檢舉三等分」的切分。
 *   4. contactPersonName 維持 conditional render，不顯示「未提供」。
 *   5. 四個既有 handler／disabled 條件沒有被重寫。
 *   6. Logo 的 negative margin 只留在 Logo 自己身上，不套用到 action module。
 *   7. 手機（sm 以下）收藏／分享／檢舉可以三等分橫排。
 *
 * 刻意不鎖死任何精確 pixel width，只驗證「有收斂寬度／shrink-0」這個結構性事實。
 */

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

describe("FactoryDetailView.tsx: Action module 位於 Header／Intro 同一區域，不是下方整頁區塊", () => {
  const source = readSource("client", "src", "components", "FactoryDetailView.tsx");

  it("Header 最外層只有一個 flex 容器包住「Logo+Intro 群組」與「Action module」兩個並排項目", () => {
    const headerMatch = source.match(/<div className="relative z-10 flex flex-col lg:flex-row lg:items-start gap-4 mb-6">[\s\S]*?\{\/\* ── Body: TOC \+ sections/);
    expect(headerMatch, "找不到新版 Header 外層容器").not.toBeNull();
  });

  it("Logo＋公司名稱／簡介仍是同一個群組（維持 sm:flex-row），且 Action module 註解緊接在這個群組之後、在同一個 Header flex row 結束之前，不是被塞進 Header 下方另一整排", () => {
    const source2 = readSource("client", "src", "components", "FactoryDetailView.tsx");
    const introGroupIdx = source2.indexOf('<div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-start gap-3">');
    const actionModuleCommentIdx = source2.indexOf("{/* Action module");
    const bodyTocIdx = source2.indexOf("{/* ── Body: TOC + sections");
    expect(introGroupIdx, "找不到 Logo+Intro 群組").toBeGreaterThan(-1);
    expect(actionModuleCommentIdx, "找不到 Action module 註解").toBeGreaterThan(-1);
    expect(bodyTocIdx, "找不到 Body: TOC + sections 區塊").toBeGreaterThan(-1);
    // Action module 必須在 Logo+Intro 群組之後、Body 區塊之前——確認它仍在同一個
    // Header flex row 裡，而不是被移到 Header 結束後的下一個獨立區塊。
    expect(actionModuleCommentIdx).toBeGreaterThan(introGroupIdx);
    expect(actionModuleCommentIdx).toBeLessThan(bodyTocIdx);
  });

  it("Action module 不再是 Header 下方獨立的 mb-6 全寬區塊（Phase 4A 第一版的錯誤結構）", () => {
    expect(source).not.toMatch(/\{\/\* ── 聯繫工廠 CTA ／收藏／分享／檢舉：獨立於上方 Logo/);
    expect(source).not.toMatch(/<div className="flex flex-col lg:flex-row lg:items-stretch gap-3 mb-6">/);
  });
});

describe("FactoryDetailView.tsx: Action module 桌機寬度收斂，不撐滿整頁", () => {
  const source = readSource("client", "src", "components", "FactoryDetailView.tsx");

  it("Action module 容器在 lg 有固定寬度與 shrink-0，不是 flex-1／w-full 撐滿剩餘空間", () => {
    const moduleMatch = source.match(/<div className="w-full sm:max-w-xl lg:max-w-none lg:w-\[440px\] lg:shrink-0 lg:pt-1">/);
    expect(moduleMatch, "找不到收斂寬度的 action module 容器").not.toBeNull();
  });

  it("Intro（公司名稱／簡介）容器維持 flex-1 min-w-0，桌機仍保有主要閱讀寬度", () => {
    expect(source).toMatch(/<div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-start gap-3">/);
  });
});

describe("FactoryDetailView.tsx: module 內部才做左右切分", () => {
  const source = readSource("client", "src", "components", "FactoryDetailView.tsx");

  it("module 內部有一層 flex-col sm:flex-row 把「大型聯繫工廠」跟「收藏/分享/檢舉」分成左右兩塊", () => {
    expect(source).toMatch(/<div className="flex flex-col sm:flex-row gap-3">/);
  });

  it("CTA 呼叫既有 handleChatClick，沒有另外複製一套聊天邏輯", () => {
    const ctaBlockMatch = source.match(/<Button\s+onClick=\{\(\) => handleChatClick\(\)\}\s+disabled=\{isPreview\}[\s\S]*?<\/Button>/);
    expect(ctaBlockMatch, "找不到呼叫 handleChatClick 的 CTA 按鈕").not.toBeNull();
  });

  it("右側收藏／分享／檢舉三顆維持在同一個容器內", () => {
    const rightBlockMatch = source.match(/<div className="flex flex-row sm:flex-col gap-2 sm:w-28 shrink-0">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
    expect(rightBlockMatch, "找不到右側三顆 action 的容器").not.toBeNull();
    expect(rightBlockMatch![0]).toMatch(/收藏/);
    expect(rightBlockMatch![0]).toMatch(/分享/);
    expect(rightBlockMatch![0]).toMatch(/檢舉/);
  });

  it("手機（sm 以下）收藏／分享／檢舉可三等分橫排：容器預設 flex-row，各自 flex-1", () => {
    const rightBlockMatch = source.match(/<div className="flex flex-row sm:flex-col gap-2 sm:w-28 shrink-0">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
    const body = rightBlockMatch![0];
    const flexOneCount = (body.match(/className="flex-1"/g) ?? []).length
      + (body.match(/className="flex-1 text-muted-foreground hover:text-destructive"/g) ?? []).length;
    expect(flexOneCount).toBeGreaterThanOrEqual(2);
  });
});

describe("FactoryDetailView.tsx: 聯繫工廠 CTA 內顯示 contactPersonName", () => {
  const source = readSource("client", "src", "components", "FactoryDetailView.tsx");

  it("CTA 區塊內以 conditional render 顯示 contactPersonName，不是無條件渲染", () => {
    expect(source).toMatch(/\{factory\.contactPersonName && \(\s*<span className="w-full min-w-0 text-sm font-normal text-primary-foreground\/90 break-words">\s*聯絡窗口：\{factory\.contactPersonName\}\s*<\/span>\s*\)\}/);
  });

  it("CTA 附近沒有「未提供」這種空值 fallback 文案", () => {
    const ctaBlockMatch = source.match(/\{\/\* 左：聯繫工廠[\s\S]*?<\/Button>/);
    expect(ctaBlockMatch, "找不到聯繫工廠 CTA 區塊").not.toBeNull();
    expect(ctaBlockMatch![0]).not.toMatch(/未提供/);
  });

  it("CTA 保留輔助文字「詢問商品、服務或合作方式」", () => {
    expect(source).toMatch(/詢問商品、服務或合作方式/);
  });
});

describe("FactoryDetailView.tsx: 聯繫／收藏／分享／檢舉既有功能沒有被破壞", () => {
  const source = readSource("client", "src", "components", "FactoryDetailView.tsx");

  it("收藏按鈕仍保留 isFav 狀態文字／icon 切換與 favPending disabled 條件", () => {
    expect(source).toMatch(/variant=\{isFav \? "default" : "outline"\}\s*\n\s*onClick=\{handleToggleFavClick\}\s*\n\s*disabled=\{isPreview \|\| favPending\}/);
    expect(source).toMatch(/\{isFav \? "已收藏" : "收藏"\}/);
    expect(source).toMatch(/className=\{`w-4 h-4 mr-1\.5 \$\{isFav \? "fill-current" : ""\}`\}/);
  });

  it("分享按鈕仍呼叫既有 handleShareClick，沒有重寫 Web Share／clipboard 邏輯", () => {
    expect(source).toMatch(/<Button variant="outline" onClick=\{handleShareClick\} disabled=\{isPreview\} className="flex-1">/);
    expect(source).not.toMatch(/navigator\.share|navigator\.clipboard/);
  });

  it("檢舉按鈕仍只在 isAuthenticated 時顯示，且沿用既有 setShowReportDialog 流程", () => {
    const reportBlockMatch = source.match(/\{isAuthenticated && \(\s*<Button variant="outline"[\s\S]*?檢舉[\s\S]*?<\/Button>\s*\)\}/);
    expect(reportBlockMatch, "找不到檢舉按鈕的 conditional 區塊").not.toBeNull();
    expect(reportBlockMatch![0]).toMatch(/onClick=\{\(\) => setShowReportDialog\(true\)\}/);
    expect(reportBlockMatch![0]).toMatch(/disabled=\{isPreview\}/);
  });
});

describe("FactoryDetailView.tsx: Logo 的 negative margin 不套用到 action module", () => {
  const source = readSource("client", "src", "components", "FactoryDetailView.tsx");

  it("Logo 既有的 -mt-10/-mt-12 疊 Banner 效果維持不變，且只出現在 Logo 自己的 className 上", () => {
    const logoMatch = source.match(/className=\{`w-20 h-20 md:w-24 md:h-24 rounded-2xl border-4 border-white shadow-lg bg-white overflow-hidden shrink-0 -mt-10 md:-mt-12[^`]*`\}/);
    expect(logoMatch, "找不到帶 negative margin 的 Logo 容器").not.toBeNull();
  });

  it("Action module 容器本身沒有 negative margin 或 translateY", () => {
    const moduleMatch = source.match(/\{\/\* Action module[\s\S]*?\n\s*<\/div>\s*<\/div>\s*<\/div>\s*\n\s*<\/div>/);
    expect(moduleMatch, "找不到 action module 區塊").not.toBeNull();
    expect(moduleMatch![0]).not.toMatch(/-m[tblrxy]?-\d/);
    expect(moduleMatch![0]).not.toMatch(/translateY/);
    expect(moduleMatch![0]).not.toMatch(/\babsolute\b/);
  });
});

describe("FactoryDetailView.tsx（Phase 4A-R2）: 長自我介紹不得把 Action module 推下移或置中／拉伸", () => {
  const source = readSource("client", "src", "components", "FactoryDetailView.tsx");

  it("Header 外層 flex row 在桌機是 lg:items-start（top-align），不是 stretch／center", () => {
    expect(source).toMatch(/<div className="relative z-10 flex flex-col lg:flex-row lg:items-start gap-4 mb-6">/);
  });

  it("Header 外層／Logo+Intro 群組／Action module 這三個決定 Action module 垂直位置的容器，實際 className 本身都不含 items-center／self-center／my-auto／justify-center／items-stretch／sticky／fixed", () => {
    // 動態從原始碼抓出這三個容器「當下真正的」className 字串再檢查，而不是拿寫死
    // 的字串比對——這樣如果之後有人真的把 items-center 之類的 class 加進這幾個
    // 容器，這裡會直接從抓出來的 className 內容抓到，而不是只回報「容器不存在」。
    // 只鎖定這三個容器，是因為 Header 區塊內部本來就有無關的 items-center
    // （例如 icon+文字小行內排版的 <span className="flex items-center ...">），
    // 那些跟 Action module 的垂直位置無關，不該被這個測試誤判成回歸。
    const patterns = {
      "Header 外層 row": /<div className="(relative z-10 flex flex-col lg:flex-row[^"]*)">/,
      "Logo\\+Intro 群組": /<div className="(flex-1 min-w-0 flex flex-col sm:flex-row[^"]*)">/,
      "Action module 容器": /<div className="(w-full sm:max-w-xl lg:max-w-none[^"]*)">/,
    };
    for (const [label, pattern] of Object.entries(patterns)) {
      const match = source.match(pattern);
      expect(match, `找不到容器：${label}`).not.toBeNull();
      const className = match![1];
      expect(className, `${label} 的 className: ${className}`).not.toMatch(/\bitems-center\b/);
      expect(className).not.toMatch(/\bself-center\b/);
      expect(className).not.toMatch(/\bmy-auto\b/);
      expect(className).not.toMatch(/\bjustify-center\b/);
      expect(className).not.toMatch(/\bitems-stretch\b/);
      // 使用者明確禁止：不得為了「看起來更保險」而把 action module 改成
      // sticky／fixed，那是「捲動時黏住」的行為，不是這裡要的「Header 內 top-align」。
      expect(className).not.toMatch(/\bsticky\b/);
      expect(className).not.toMatch(/\bfixed\b/);
    }
  });

  it("Action module 容器本身不依賴 self-start／h-fit 這類本輪不該新增的保險 class（現況 lg:items-start 已足夠）", () => {
    const moduleMatch = source.match(/<div className="w-full sm:max-w-xl lg:max-w-none lg:w-\[440px\] lg:shrink-0 lg:pt-1">[\s\S]*?\n\s*<\/div>\s*<\/div>\s*<\/div>/);
    expect(moduleMatch, "找不到 action module 容器").not.toBeNull();
    expect(moduleMatch![0]).not.toMatch(/\bself-start\b/);
    expect(moduleMatch![0]).not.toMatch(/\bh-fit\b/);
  });

  it("Intro（公司名稱／簡介）容器維持 min-w-0，長文字靠 wrap 往下長，不會撐開橫向寬度", () => {
    expect(source).toMatch(/<div className="flex-1 min-w-0 sm:pt-1">/);
    expect(source).toMatch(/whitespace-pre-line leading-relaxed/);
  });
});

describe("FactoryDetailView.tsx（Phase 4B）: 手機 responsive contract", () => {
  const source = readSource("client", "src", "components", "FactoryDetailView.tsx");

  it("Action module 內部：手機（sm 以下）CTA 與收藏/分享/檢舉整列堆疊、桌機（sm+，含 module 落到下一行時）CTA 與右側並排", () => {
    // flex-col sm:flex-row：sm 以下是欄（CTA 整列在上，收藏/分享/檢舉整列在下），
    // sm 以上才變成列（CTA 與右側並排）——手機不得沿用桌機的左右並排版面。
    expect(source).toMatch(/<div className="flex flex-col sm:flex-row gap-3">/);
  });

  it("收藏／分享／檢舉容器：手機（sm 以下）三等分橫排（flex-row），sm 以上改直排（flex-col）", () => {
    const containerMatch = source.match(/<div className="flex flex-row sm:flex-col gap-2 sm:w-28 shrink-0">/);
    expect(containerMatch, "找不到收藏/分享/檢舉的容器，或 flex-row/sm:flex-col 沒有正確設定").not.toBeNull();
  });

  it("收藏／分享／檢舉三顆都用 flex-1，手機三等分是靠 flex 自動均分（無論 2 顆或 3 顆都成立），不是寫死各自寬度", () => {
    const rightBlockMatch = source.match(/<div className="flex flex-row sm:flex-col gap-2 sm:w-28 shrink-0">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
    expect(rightBlockMatch, "找不到右側三顆 action 的容器").not.toBeNull();
    const body = rightBlockMatch![0];
    const flexOneOccurrences = (body.match(/className="flex-1"/g) ?? []).length
      + (body.match(/className="flex-1 text-muted-foreground hover:text-destructive"/g) ?? []).length;
    expect(flexOneOccurrences).toBe(3);
  });

  it("CTA 沒有用 absolute／fixed／sticky 去維持固定 Y——手機是上下堆疊的正常 document flow，長 intro 本來就可以把 action module 往下推", () => {
    const moduleMatch = source.match(/\{\/\* Action module[\s\S]*?\n\s*<\/div>\s*<\/div>\s*<\/div>\s*\n\s*<\/div>/);
    expect(moduleMatch, "找不到 action module 區塊").not.toBeNull();
    expect(moduleMatch![0]).not.toMatch(/\babsolute\b/);
    expect(moduleMatch![0]).not.toMatch(/\bfixed\b/);
    expect(moduleMatch![0]).not.toMatch(/\bsticky\b/);
  });

  it("desktop Action module 仍是固定/受控寬度（lg:w-[440px] lg:shrink-0），本輪手機修正沒有連帶改掉桌機寬度策略", () => {
    expect(source).toMatch(/<div className="w-full sm:max-w-xl lg:max-w-none lg:w-\[440px\] lg:shrink-0 lg:pt-1">/);
  });

  it("desktop Header 仍是 lg:items-start，本輪手機修正沒有連帶改掉 Phase 4A-R2 的 top-align 設定", () => {
    expect(source).toMatch(/<div className="relative z-10 flex flex-col lg:flex-row lg:items-start gap-4 mb-6">/);
  });
});

describe("FactoryDetailView.tsx（Phase 4B）: 長聯絡窗口姓名不得把 CTA 撐爆（真實瀏覽器測試發現的回歸，見本輪報告）", () => {
  const source = readSource("client", "src", "components", "FactoryDetailView.tsx");

  it("CTA 按鈕本身有 min-w-0，讓它在 flex row 版面下可以縮到容器寬度以下，不被內容的 min-content 寬度撐開", () => {
    expect(source).toMatch(/className="flex-1 min-w-0 h-auto flex-col items-start whitespace-normal text-left gap-1 rounded-2xl px-4 py-3\.5"/);
  });

  it("contactPersonName 這一行本身也有 min-w-0（它是 CTA 內 flex-col 的 flex item，需要自己的 min-w-0，跟外層 Button 的 min-w-0 是兩層獨立設定）且有 break-words 讓無空格長字串正常換行", () => {
    const contactSpanMatch = source.match(/<span className="w-full min-w-0 text-sm font-normal text-primary-foreground\/90 break-words">/);
    expect(contactSpanMatch, "找不到帶 min-w-0／break-words 的聯絡窗口 span——真實瀏覽器測試中，無空格長字串會在這裡造成橫向 overflow").not.toBeNull();
  });
});
