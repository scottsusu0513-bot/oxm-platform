import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { isOrderTipMessageThresholdMet } from "@shared/chatEducation";

/**
 * 聊天室「建立訂單」功能教育提示——狀態機 hook。
 *
 * 背景：左下角「建立合作確認單」入口只有工廠端（owner／co-manager）看得到、
 * 點得到，買方（詢價人）完全沒有這個按鈕。因此拆成三種、且刻意不對稱的提示
 * （完整規則見 shared/chatEducation.ts 與 server/db.ts 的
 * claimChatEducationTip）：
 *   - factorySpotlight：工廠端第一次進入 conversation 時的 Spotlight 強提醒。
 *   - buyerTip：買方在新 conversation 成功送出第一則訊息後的一般 modal 提醒
 *     （買方端沒有按鈕可挖洞凸顯）。
 *   - orderTipBubble：雙方有效聊天訊息達門檻（且雙方都至少各 1 則）後，給
 *     工廠端看的小提醒 Bubble。
 *
 * 同一時間最多只顯示一個（activeOverlay），且 factorySpotlight／
 * orderTipBubble 互斥優先權由「同一 effect 內 factorySpotlight 尚未認領時
 * 直接 return，不會同一輪一起評估 bubble」保證——bubble 只會在
 * factorySpotlightShown 已經是 true（不論是這次認領還是更早之前）之後才被
 * 評估。buyerTip 與另外兩者角色互斥（買方／工廠端不會是同一次瀏覽），不需要
 * 額外互斥處理。
 *
 * 「認領」一律由 server 端 claimChatEducationTip mutation 做最終判斷
 * （lifetime 上限、是否已顯示過、是否已建立訂單、訊息門檻皆在 server 重新
 * 驗證），這裡只做「什麼時候值得嘗試認領」的前置篩選，避免明知不該顯示
 * （例如另一個 modal 正開著、頁面還在載入）也送出認領請求，白白浪費使用者
 * 帳號的 lifetime 名額。
 */

type ChatEducationOverlayKind = "factorySpotlight" | "buyerTip" | "orderTipBubble";

interface UseChatEducationTipsParams {
  /** null／isNewChat 草稿階段一律不啟用 */
  conversationId: number | null;
  isFactorySide: boolean;
  isBuyer: boolean;
  /** conversation meta／訊息都已載入完成，避免在載入中途誤判 */
  pageReady: boolean;
  /** ChatPage 內任何其他 modal／選單目前是否開著（附件選單、商品選擇、
   * 建立合作確認單 Dialog…等）；為 true 時暫緩認領嘗試，不會消耗帳號名額。 */
  blockedByOtherUi: boolean;
}

export function useChatEducationTips({
  conversationId,
  isFactorySide,
  isBuyer,
  pageReady,
  blockedByOtherUi,
}: UseChatEducationTipsParams) {
  const { user } = useAuth();
  const typedUser = user as { needsConsent?: boolean } | null;
  const needsConsent = Boolean(typedUser?.needsConsent);

  const utils = trpc.useUtils();
  const enabled = !!conversationId && !needsConsent && (isFactorySide || isBuyer);

  // 工廠端輪詢（跟 chat.getMessages 同一個 5 秒間隔）：20 則 Bubble 的門檻可能
  // 因「對話持續開著、對方送出跨過門檻的那一則」而達標，不是只有「自己剛送出
  // 訊息」才會達標。買方端只需要一次性讀取（自己的提醒只在自己送出第一則訊息
  // 後才判斷），不需要背景輪詢。
  const stateQuery = trpc.chat.getChatEducationState.useQuery(
    { conversationId: conversationId ?? 0 },
    { enabled, refetchInterval: isFactorySide ? 5000 : false },
  );
  const claimMut = trpc.chat.claimChatEducationTip.useMutation();

  const [activeOverlay, setActiveOverlay] = useState<ChatEducationOverlayKind | null>(null);
  const attemptedKeyRef = useRef<string | null>(null);
  const buyerFirstMessagePendingRef = useRef(false);

  // 切換 conversation 時重置——不重置 buyerFirstMessagePendingRef：買方送出
  // 第一則訊息時 conversationId 還是 null（/chat/new 草稿），signal 必須撐過
  // 這次「null → 新 conversationId」的切換才能被下面的 effect 消費到。
  useEffect(() => {
    attemptedKeyRef.current = null;
    setActiveOverlay(null);
  }, [conversationId]);

  const attemptClaim = useCallback((kind: ChatEducationOverlayKind) => {
    if (!conversationId) return;
    const key = `${conversationId}:${kind}`;
    if (attemptedKeyRef.current === key) return;
    attemptedKeyRef.current = key;
    claimMut.mutate({ conversationId, kind }, {
      onSuccess: (res) => {
        if (res.allowed) setActiveOverlay(kind);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    if (!enabled || !pageReady || blockedByOtherUi) return;
    if (activeOverlay) return; // 同時間最多一個
    const d = stateQuery.data;
    if (!d || d.hasOrder) return;

    if (isFactorySide) {
      if (!d.factorySpotlightShown) {
        attemptClaim("factorySpotlight");
        return; // 優先權：Spotlight 尚未認領過，這一輪不評估 bubble
      }
      if (
        !d.orderTipBubbleShown &&
        isOrderTipMessageThresholdMet({ requesterCount: d.requesterMessageCount, factoryCount: d.factoryMessageCount })
      ) {
        attemptClaim("orderTipBubble");
      }
    } else if (isBuyer && buyerFirstMessagePendingRef.current && !d.buyerTipShown) {
      buyerFirstMessagePendingRef.current = false;
      attemptClaim("buyerTip");
    }
  }, [enabled, pageReady, blockedByOtherUi, activeOverlay, stateQuery.data, isFactorySide, isBuyer, attemptClaim]);

  const dismiss = useCallback(() => {
    setActiveOverlay(null);
    if (conversationId) utils.chat.getChatEducationState.invalidate({ conversationId });
  }, [utils, conversationId]);

  /** ChatPage 的 handleSend 在買方「開新對話」分支成功送出第一則訊息後呼叫。 */
  const signalBuyerFirstMessageSent = useCallback(() => {
    buyerFirstMessagePendingRef.current = true;
  }, []);

  const refreshEducationState = useCallback(() => {
    if (conversationId) utils.chat.getChatEducationState.invalidate({ conversationId });
  }, [utils, conversationId]);

  return {
    factorySpotlightOpen: activeOverlay === "factorySpotlight",
    buyerTipOpen: activeOverlay === "buyerTip",
    orderTipBubbleOpen: activeOverlay === "orderTipBubble",
    dismiss,
    signalBuyerFirstMessageSent,
    refreshEducationState,
  };
}
