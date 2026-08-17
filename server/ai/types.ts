/** 一則對話訊息（客戶端傳來的歷史紀錄，不含 system prompt）。 */
export interface AiChatTurn {
  role: "user" | "assistant";
  content: string;
}
