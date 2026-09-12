// 聊天室「建立訂單」功能教育提示——共用判斷邏輯。
//
// 背景：聊天室左下角「建立合作確認單」入口目前只有工廠端（factory owner／
// co-manager）看得到、點得到（見 client/src/pages/ChatPage.tsx 的
// isFactorySide 判斷），買方（詢價人）完全沒有這個按鈕，只能等工廠端建立後
// 按「同意」。因此這個功能拆成三層、且刻意不對稱：
//   1. 工廠端 Spotlight——第一次進入 conversation 時，凸顯真正的建立訂單入口。
//   2. 買方端提醒——買方在一個新 conversation 成功送出第一則訊息後，用一般
//      modal（不挖洞、不凸顯任何元素，因為買方端根本沒有這個按鈕）提示買方
//      可以請工廠端建立訂單追蹤。
//   3. 20 則訊息輕提醒（Bubble）——只提醒工廠端（同樣因為只有工廠端能真的
//      建立訂單），對話累積到一定活躍度後再提醒一次。
//
// 這支檔案只放純函式：訊息型別分類、Bubble 觸發門檻判斷、帳號 lifetime 次數
// 上限判斷。同時被 server（server/db.ts 的 claimChatEducationTip／
// getHumanMessageCounts）與 client（ChatPage 的教育提示 hook）匯入，確保
// 「多少則算數」「帳號最多提醒幾次」這兩個門檻只定義一次，不會前後端各自
// 重複一份、將來改門檻只改一邊。

/** 真人主動送出的聊天訊息型別。刻意排除：
 *  - co_manager_invite：系統邀請訊息，不是聊天內容。
 *  - collaboration_order：訂單狀態事件（建立/接受/拒絕/取消/重複下訂…等），
 *    即使 senderId 是真人，內容也是系統產生的狀態卡片，不是使用者主動打字
 *    或選擇要傳送的聊天內容。
 * text／product／pdf 三種都是使用者主動觸發的動作（打字、選擇商品傳送、
 * 上傳 PDF 型錄），依需求「文字、圖片或附件，只要是使用者主動發出的聊天
 * 訊息，都可以視為 1 則」全部計入。
 */
export const HUMAN_CHAT_MESSAGE_TYPES = ["text", "product", "pdf"] as const;
export type HumanChatMessageType = (typeof HUMAN_CHAT_MESSAGE_TYPES)[number];

export function isHumanChatMessageType(type: string): type is HumanChatMessageType {
  return (HUMAN_CHAT_MESSAGE_TYPES as readonly string[]).includes(type);
}

/** 20 則有效人工聊天訊息門檻（雙方合計）。 */
export const ORDER_TIP_MESSAGE_THRESHOLD = 20;

/** 每個帳號 lifetime 最多觸發幾個不同 conversation 的「首次教育提示」
 * （工廠端 Spotlight／買方端首次提醒各自獨立計算，見 server/db.ts）。 */
export const MAX_LIFETIME_CHAT_EDUCATION_TIPS = 5;

export interface ChatHumanMessageCounts {
  /** 詢價人（conversations.userId，senderRole="user"）送出的有效聊天訊息數 */
  requesterCount: number;
  /** 工廠端（senderRole="factory"）送出的有效聊天訊息數 */
  factoryCount: number;
}

/**
 * 20 則小提醒（Bubble）是否符合觸發條件：
 *   1. 雙方有效訊息合計 >= ORDER_TIP_MESSAGE_THRESHOLD
 *   2. 雙方都至少各自送出過 1 則有效訊息（單方灌訊息不算「談得差不多」）
 * 不判斷「是否已顯示過」「是否已建立訂單」——那些由呼叫端（server 端交易／
 * client 端 hook）另外檢查，這支函式只回答「訊息量本身是否達標」。
 */
export function isOrderTipMessageThresholdMet(counts: ChatHumanMessageCounts): boolean {
  const total = counts.requesterCount + counts.factoryCount;
  return total >= ORDER_TIP_MESSAGE_THRESHOLD && counts.requesterCount >= 1 && counts.factoryCount >= 1;
}

/** 帳號 lifetime 次數是否還沒用滿（< 5 次才允許再觸發一次新的 conversation）。 */
export function hasLifetimeChatEducationQuota(lifetimeCount: number): boolean {
  return lifetimeCount < MAX_LIFETIME_CHAT_EDUCATION_TIPS;
}
