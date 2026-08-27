import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * OXM Community 正式開放前 QA — Phase 2 回歸測試。
 *
 * 同 server/chatReturnNavigation.test.ts／server/factoryDetailScrollReset.test.ts
 * 的既有做法：本專案 vitest 只涵蓋 environment: "node"，沒有 jsdom／React
 * Testing Library（唯一例外是 client/**\/*.test.tsx，見另外的
 * MentionTextarea 行為測試），這裡改用原始碼內容斷言，鎖定這次要修的三個
 * 具體回歸情境：
 *   1. 貼文詳情「← 返回討論區」：CommunitySpace 進入貼文時帶 state.from，
 *      CommunityPost 用 isSafeCommunityReturnSource 驗證後才 history.back()，
 *      否則安全 fallback 回這個 spaceCode 的討論列表（不是 /community）。
 *   2. 第二層留言「引用」：isNested 時按鈕文字改「引用」、parentCommentId
 *      解析回第一層（comment.parentCommentId），quoteMention 帶入真正的
 *      mention（不是純字串），composer 端據此預填 @對象 文字並同步
 *      mentions[] 狀態。
 */

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

describe("CommunitySpace.tsx: 進入貼文詳情時帶入來源，供返回時優先 history.back()", () => {
  const source = readSource("client", "src", "components", "community", "CommunitySpace.tsx");

  it("goToPost 呼叫 navigate 時帶 state.from = 目前實際 pathname + search", () => {
    const match = source.match(/const goToPost = \(postId: number\) => \{[\s\S]*?\n  \};/);
    expect(match, "找不到 goToPost 函式定義").not.toBeNull();
    const body = match![0];
    expect(body).toMatch(/navigate\(`\/community\/\$\{spaceCode\}\/discussions\/\$\{postId\}`, \{/);
    expect(body).toMatch(/state: \{ from: window\.location\.pathname \+ window\.location\.search \}/);
  });

  it("貼文卡片點擊與新貼文建立後都透過 goToPost（不是各自重寫一份 navigate）", () => {
    expect(source).toMatch(/onClick=\{\(\) => goToPost\(post\.id\)\}/);
    expect(source).toMatch(/onCreated=\{\(postId\) => \{\s*\n\s*setShowNewPost\(false\);\s*\n\s*goToPost\(postId\);/);
  });
});

describe("CommunityPost.tsx: 返回討論區——context-aware，優先 history.back()，安全 fallback 回自己的討論列表", () => {
  const source = readSource("client", "src", "components", "community", "CommunityPost.tsx");

  it("匯入並使用 isSafeCommunityReturnSource 驗證 history.state.from，不是自己重寫一份驗證邏輯", () => {
    expect(source).toMatch(/import \{ isSafeCommunityReturnSource \} from ["']@\/lib\/communityReturnSource["']/);
    expect(source).toMatch(/isSafeCommunityReturnSource\(rawReturnSource\)/);
  });

  it("handleReturn：有可信來源時呼叫 window.history.back()，fallback 是 replace 到這個 spaceCode 的討論列表，不是 /community", () => {
    const match = source.match(/const handleReturn = \(\) => \{[\s\S]*?\n  \};/);
    expect(match, "找不到 handleReturn 函式定義").not.toBeNull();
    const body = match![0];
    expect(body).toMatch(/if \(returnSource && typeof window !== "undefined" && window\.history\.length > 1\) \{/);
    expect(body).toMatch(/window\.history\.back\(\);/);
    expect(body).toMatch(/navigate\(RETURN_FALLBACK_PATH, \{ replace: true \}\);/);
    expect(source).toMatch(/const RETURN_FALLBACK_PATH = `\/community\/\$\{spaceCode\}\/discussions`;/);
  });

  it("「返回討論區」按鈕呼叫 handleReturn，文案是「返回討論區」（不是舊版寫死 Link 的「返回討論列表」）", () => {
    const match = source.match(/<button\s+type="button"\s+onClick=\{handleReturn\}[\s\S]*?<\/button>/);
    expect(match, "找不到返回討論區按鈕").not.toBeNull();
    expect(match![0]).toMatch(/返回討論區/);
  });

  it("既有 breadcrumb（商案討論區／{spaceName}）維持不變，沒有被返回按鈕取代", () => {
    expect(source).toMatch(/<Link href="\/community" className="hover:text-foreground transition-colors">商案討論區<\/Link>/);
    expect(source).toMatch(/<Link href=\{`\/community\/\$\{spaceCode\}\/discussions`\} className="hover:text-foreground transition-colors">\{spaceName\}<\/Link>/);
  });
});

describe("CommunityPost.tsx: 第二層留言「引用」——維持兩層資料結構，不新增第三層", () => {
  const source = readSource("client", "src", "components", "community", "CommunityPost.tsx");

  it("CommentItemProps.onReply 簽名多帶一個可選的 quoteMention（MentionInput），不是重做一套 mention 型別", () => {
    expect(source).toMatch(/onReply: \(parentCommentId: number, toUserId: number \| null, toName: string, quoteMention\?: MentionInput\) => void;/);
  });

  it("isNested 時按鈕文字是「引用」、非 isNested 時仍是「回覆」", () => {
    const match = source.match(/\{isNested \? \(\s*<>\s*<Quote[\s\S]*?<\/>\s*\) : \(\s*<>\s*<Reply[\s\S]*?<\/>\s*\)\}/);
    expect(match, "找不到 引用／回覆 條件渲染區塊").not.toBeNull();
    expect(match![0]).toMatch(/引用/);
    expect(match![0]).toMatch(/回覆/);
  });

  it("isNested 時 onReply 的 parentCommentId 用 comment.parentCommentId（第一層 root），不是 comment.id（自己）", () => {
    const match = source.match(/if \(isNested\) \{[\s\S]*?onReply\(\s*comment\.parentCommentId!,\s*comment\.authorUserId,\s*`@\$\{name\}`,[\s\S]*?\);\s*\} else \{\s*onReply\(comment\.id, comment\.authorUserId, name\);\s*\}/);
    expect(match, "找不到 isNested 時解析回第一層 parentCommentId 的邏輯").not.toBeNull();
  });

  it("引用時帶入的 quoteMention 是 type: \"user\"，id 是被引用留言的 authorUserId（不是名字字串）", () => {
    const match = source.match(/\{ type: "user", id: comment\.authorUserId, displayName: name \}/);
    expect(match, "找不到正確結構的 quoteMention 物件").not.toBeNull();
  });

  it("composer 端收到 quoteMention 時，同步預填文字與 mentions[]（不是只顯示裝飾用文字）", () => {
    const match = source.match(/onReply=\{\(parentCommentId, replyToUserId, label, quoteMention\) => \{[\s\S]*?\}\}/);
    expect(match, "找不到 comments.map 裡的 onReply 實作").not.toBeNull();
    const body = match![0];
    expect(body).toMatch(/setReplyTo\(\{ parentCommentId, replyToUserId, label \}\);/);
    expect(body).toMatch(/if \(quoteMention\) \{/);
    expect(body).toMatch(/const insertText = `@\$\{quoteMention\.displayName\} `;/);
    expect(body).toMatch(/setCommentText\(insertText\);/);
    expect(body).toMatch(/setCommentMentions\(\[quoteMention\]\);/);
  });

  it("引用後把游標移到輸入框最後，透過 MentionTextareaHandle 的 focusEnd，不是自己重寫一套 focus/selection 邏輯", () => {
    expect(source).toMatch(/import MentionTextarea, \{ type MentionInput, type MentionTextareaHandle \} from "\.\/MentionTextarea";/);
    expect(source).toMatch(/const commentTextareaRef = useRef<MentionTextareaHandle>\(null\);/);
    expect(source).toMatch(/commentTextareaRef\.current\?\.focusEnd\(\)/);
    expect(source).toMatch(/<MentionTextarea\s*\n\s*ref=\{commentTextareaRef\}/);
  });
});

describe("MentionTextarea.tsx: dropdown 用 createPortal 掛到 document.body（修正 Dialog 內定位錯誤的根因）", () => {
  const source = readSource("client", "src", "components", "community", "MentionTextarea.tsx");

  it("匯入 createPortal，dropdown 透過 createPortal(..., document.body) 渲染，不是就地 render", () => {
    expect(source).toMatch(/import \{ createPortal \} from "react-dom";/);
    const match = source.match(/\{showDropdown && popoverAnchor && createPortal\(/);
    expect(match, "找不到 createPortal 呼叫——這是修正發文 Dialog 內下拉選單定位錯誤的關鍵").not.toBeNull();
    expect(source).toMatch(/,\s*\n\s*document\.body,\s*\n\s*\)\}/);
  });

  it("MentionTextareaHandle 暴露 focusEnd，供外部（引用自動預填）把游標移到文字最後", () => {
    expect(source).toMatch(/export interface MentionTextareaHandle \{\s*\n\s*focusEnd: \(\) => void;\s*\n\s*\}/);
    expect(source).toMatch(/useImperativeHandle\(ref, \(\) => \(\{\s*\n\s*focusEnd: \(\) => \{/);
  });
});
