import { getRecentMessages, RECENT_MESSAGE_WINDOW } from "./conversationService";
import type { AiConversation } from "../../drizzle/schema";
import type { AiChatTurn } from "./types";
import type { ConversationState } from "./conversationState";

/**
 * 集中管理「Layer 1 / Layer 2 這一輪實際會看到什麼」——這是本輪要求的硬規則
 * 落地位置：不要把 30 天內幾百則訊息全部送給模型，也不要讓 diagnosis.ts /
 * routing.ts 各自直接查 DB 決定要拿多少歷史。
 *
 * V1 策略刻意簡單：固定拿最近 RECENT_MESSAGE_WINDOW（見
 * conversationService.ts，目前是 10）則訊息 + Current Conversation State，
 * 不做複雜的 token 動態優化——state 已經把「目前聊到哪」濃縮成結構化摘要，
 * 所以不需要更長的原始訊息視窗也能讓模型接得上話。
 */
export interface TurnContext {
  history: AiChatTurn[];
  previousState: ConversationState | null;
}

export function parseConversationState(raw: AiConversation["currentStateJson"]): ConversationState | null {
  if (!raw) return null;
  // 這個欄位只會被 conversationService.updateConversationState() 寫入，寫入的
  // 值永遠來自 deriveConversationState()，形狀保證跟 ConversationState 一致。
  return raw as unknown as ConversationState;
}

export async function buildTurnContext(conversation: AiConversation): Promise<TurnContext> {
  const messages = await getRecentMessages(conversation.id, RECENT_MESSAGE_WINDOW);
  const history: AiChatTurn[] = messages.map(m => ({ role: m.role, content: m.content }));
  return {
    history,
    previousState: parseConversationState(conversation.currentStateJson),
  };
}
