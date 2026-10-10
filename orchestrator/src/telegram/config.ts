/**
 * Telegram control-plane configuration. Values are read from the environment
 * and validated without ever being echoed: every failure reason names the
 * variable, never its value.
 */
export interface TelegramConfig {
  /** Secret. Never logged, never placed in errors, audit, or notices. */
  botToken: string;
  /** Private chat id of the only human allowed to act (equals the owner's user id). */
  ownerChatId: number;
  /** Expected bot username (without @); null skips the identity check. */
  expectedBotUsername: string | null;
}

export type TelegramConfigResult = { ok: true; config: TelegramConfig } | { ok: false; reason: string };

const TOKEN = /^[0-9]{5,16}:[A-Za-z0-9_-]{30,64}$/;
const CHAT_ID = /^[1-9][0-9]{0,15}$/;
const USERNAME = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

export function readTelegramConfig(env: Readonly<Record<string, string | undefined>>, defaults: { expectedBotUsername?: string } = {}): TelegramConfigResult {
  const token = env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  if (!token) return { ok: false, reason: "TELEGRAM_BOT_TOKEN is not set" };
  if (!TOKEN.test(token)) return { ok: false, reason: "TELEGRAM_BOT_TOKEN is malformed" };
  const owner = env.TELEGRAM_OWNER_CHAT_ID?.trim() ?? "";
  if (!owner) return { ok: false, reason: "TELEGRAM_OWNER_CHAT_ID is not set" };
  // Only a positive id is a private user chat; groups/channels are negative and never allowed.
  if (!CHAT_ID.test(owner) || !Number.isSafeInteger(Number(owner))) return { ok: false, reason: "TELEGRAM_OWNER_CHAT_ID must be a private (positive) chat id" };
  const expected = (env.TELEGRAM_EXPECTED_BOT_USERNAME?.trim() || defaults.expectedBotUsername || "").replace(/^@/, "");
  if (expected && !USERNAME.test(expected)) return { ok: false, reason: "TELEGRAM_EXPECTED_BOT_USERNAME is malformed" };
  return { ok: true, config: { botToken: token, ownerChatId: Number(owner), expectedBotUsername: expected || null } };
}

/**
 * Where the Agent reads Telegram updates from.
 *   telegram (default): direct getUpdates long polling — the rollback mode.
 *   gateway: the always-on Wake Gateway queue (Telegram in webhook mode). The Agent
 *            then never calls getUpdates; outbound messages still go to the Bot API.
 * Telegram allows only one of webhook / getUpdates, so exactly one source is active.
 */
export type TelegramSourceConfig = { source: "telegram" } | { source: "gateway"; gatewayUrl: string; agentToken: string };
export type TelegramSourceResult = { ok: true; config: TelegramSourceConfig } | { ok: false; reason: string };

const AGENT_TOKEN = /^[A-Za-z0-9_-]{43,256}$/;

export function readTelegramSourceConfig(env: Readonly<Record<string, string | undefined>>): TelegramSourceResult {
  const source = env.OXM_AGENT_TELEGRAM_SOURCE?.trim() || "telegram";
  if (source === "telegram") return { ok: true, config: { source: "telegram" } };
  if (source !== "gateway") return { ok: false, reason: "OXM_AGENT_TELEGRAM_SOURCE must be telegram or gateway" };
  const rawUrl = env.OXM_WAKE_GATEWAY_URL?.trim() ?? "";
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "OXM_WAKE_GATEWAY_URL is not set or not a URL" };
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return { ok: false, reason: "OXM_WAKE_GATEWAY_URL must be a plain https URL" };
  const agentToken = env.OXM_WAKE_GATEWAY_AGENT_TOKEN?.trim() ?? "";
  if (!AGENT_TOKEN.test(agentToken)) return { ok: false, reason: "OXM_WAKE_GATEWAY_AGENT_TOKEN is not set or too weak (43+ URL-safe characters)" };
  // Credential separation: the pull token is its own secret, and Gateway-only credentials never live in the Agent.
  if (agentToken === env.TELEGRAM_BOT_TOKEN?.trim()) return { ok: false, reason: "OXM_WAKE_GATEWAY_AGENT_TOKEN must not reuse TELEGRAM_BOT_TOKEN" };
  for (const key of ["GITHUB_WAKE_TOKEN", "TELEGRAM_WEBHOOK_SECRET"])
    if (env[key]?.trim()) return { ok: false, reason: `${key} is a Gateway-only credential and must not be present in the Agent environment` };
  return { ok: true, config: { source: "gateway", gatewayUrl: url.toString().replace(/\/+$/, ""), agentToken } };
}
