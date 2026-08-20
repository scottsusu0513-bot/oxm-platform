import type { AiShellMessage } from "./AiShellContext";

export interface AiChatSendControllerCallbacks<TResult> {
  /** 真正的網路呼叫（Provider 端會包成 chatMutation.mutateAsync）。 */
  send: (content: string, priorMessages: AiShellMessage[]) => Promise<TResult>;
  /** 送出前（新訊息或 retry 都會呼叫）：新訊息時 isRetry=false，用來加入使用者 bubble；retry 時 isRetry=true，不加入。 */
  onBeforeSend: (content: string, priorMessages: AiShellMessage[], isRetry: boolean) => void;
  onSuccess: (result: TResult, priorMessages: AiShellMessage[]) => void;
  onError: (safeMessage: string, error: unknown) => void;
  resolveErrorMessage: (error: unknown) => string;
}

/**
 * Phase 7.2（見對話中「B：Retry 真實端到端驗證」「C：Provider concurrency
 * 真實驗證」）：把 sendMessage／retryLastMessage 的 concurrency guard 與
 * 重送邏輯，從 AiShellContext.tsx 的 React closure 裡抽成一個跟 React 完全
 * 無關的 plain class——這是本輪要求的「最小 integration seam」：不引入
 * jsdom／React Testing Library，改成讓這個 class 本身可以用真正的
 * async／await＋可控制 resolve／reject 時機的假 send() 做 integration test
 * （驗證兩次幾乎同時呼叫只有一次真的送出、retry 不重複加入使用者訊息、
 * pending guard 在失敗後正確釋放……），比原本「只測純函式」更接近真實行為。
 *
 * AiShellProvider 只需要建立唯一一個 instance（useRef）並把 trpc mutation／
 * React state setter 包成 callbacks 餵進來，本身的 UI 行為與既有邏輯完全不變。
 */
export class AiChatSendController<TResult> {
  private pending = false;
  private lastFailed: { content: string; priorMessages: AiShellMessage[] } | null = null;

  constructor(private readonly callbacks: AiChatSendControllerCallbacks<TResult>) {}

  /** Provider 的 chatMutation.isPending 已經是 React state、會驅動 re-render，這個 getter 只給測試／防禦性檢查用。 */
  get isPending(): boolean {
    return this.pending;
  }

  get canRetry(): boolean {
    return this.lastFailed !== null;
  }

  /** 使用者送出新訊息：一律清空舊的失敗紀錄（見「R6」），不能被舊的 retry 素材誤用。 */
  async send(content: string, priorMessages: AiShellMessage[]): Promise<void> {
    this.lastFailed = null;
    await this.performSend(content, priorMessages, false);
  }

  /** 沒有失敗紀錄時安全 no-op（例如上一輪已經成功、或還沒送過任何訊息）。 */
  async retry(): Promise<void> {
    const failed = this.lastFailed;
    if (!failed) return;
    await this.performSend(failed.content, failed.priorMessages, true);
  }

  private async performSend(content: string, priorMessages: AiShellMessage[], isRetry: boolean): Promise<void> {
    // Concurrency guard（見「八、Concurrency 必測」C1/C4）：任何時刻只允許一個
    // 真正在飛的 request，新訊息與 retry 共用同一個 guard；已經有一個在飛時
    // 安全 no-op，不 throw、不排 queue（見「二十六」：第一版只允許一次一個
    // AI turn）。
    if (this.pending) return;
    this.pending = true;
    this.callbacks.onBeforeSend(content, priorMessages, isRetry);
    try {
      const result = await this.callbacks.send(content, priorMessages);
      this.pending = false;
      this.lastFailed = null;
      this.callbacks.onSuccess(result, priorMessages);
    } catch (error) {
      // pending guard 在失敗後正確釋放（見「C3」），不會因為這次失敗永久卡住
      // 後續送出；lastFailed 保留這次素材供 retry() 使用。
      this.pending = false;
      this.lastFailed = { content, priorMessages };
      this.callbacks.onError(this.callbacks.resolveErrorMessage(error), error);
    }
  }
}
