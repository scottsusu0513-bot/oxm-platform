/**
 * Minimal structural subset of the Cloudflare Workers / Durable Object APIs the
 * Wake Gateway uses. Declared locally so the Gateway type-checks and unit-tests
 * without the Workers runtime; the real runtime objects satisfy these shapes.
 */
export type SqlValue = string | number | null;

export interface SqlCursorLike {
  toArray(): Record<string, unknown>[];
}

export interface SqlStorageLike {
  exec(query: string, ...bindings: SqlValue[]): SqlCursorLike;
}

export interface DurableStorageLike {
  sql: SqlStorageLike;
  transactionSync<T>(fn: () => T): T;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number): Promise<void>;
}

export interface DurableObjectStateLike {
  storage: DurableStorageLike;
}

export interface DurableObjectStubLike {
  fetch(request: Request): Promise<Response>;
}

export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

/** Worker bindings. Every credential is a Worker secret; nothing here is committed. */
export interface GatewayEnv {
  OWNER_QUEUE: DurableObjectNamespaceLike;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_WEBHOOK_PATH?: string;
  TELEGRAM_OWNER_CHAT_ID?: string;
  GITHUB_WAKE_TOKEN?: string;
  AGENT_TOKEN_SHA256?: string;
  CODESPACE_NAME?: string;
  EXPECTED_REPO?: string;
}

/** Only the Telegram fields the Agent's existing parseUpdate reads. */
export interface ProjectedUser {
  id: number;
  is_bot: boolean;
}
export interface ProjectedChat {
  id: number;
  type: string;
}
export interface ProjectedMessageUpdate {
  update_id: number;
  message: {
    message_id: number;
    chat: ProjectedChat;
    from: ProjectedUser;
    text: string;
    reply_to_message?: { message_id?: number; chat?: Partial<ProjectedChat>; from?: Partial<ProjectedUser>; text?: string };
  };
}
export interface ProjectedCallbackUpdate {
  update_id: number;
  callback_query: {
    id: string;
    from: ProjectedUser;
    data: string;
    message: { message_id: number; chat: ProjectedChat };
  };
}
export type ProjectedUpdate = ProjectedMessageUpdate | ProjectedCallbackUpdate;
export type ProjectedKind = "message" | "callback_query";

/** Structured, content-free log line: event name plus numbers / booleans / short enum codes. */
export type LogFields = Record<string, number | boolean | string>;
export type GatewayLog = (event: string, fields?: LogFields) => void;
