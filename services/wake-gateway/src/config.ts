import type { GatewayEnv, LogFields } from "./types";

/**
 * Gateway configuration. Credentials are Worker secrets; failures name the
 * variable, never its value. Three credentials are deliberately separate and
 * must never be equal: the Telegram bot token, the Telegram webhook secret,
 * the GitHub wake token, plus the Agent pull token (stored here only as a hash).
 */
export interface GatewayConfig {
  botToken: string;
  webhookSecret: string;
  webhookPath: string;
  ownerChatId: number;
  githubToken: string;
  agentTokenSha256: string;
  codespaceName: string;
  expectedRepo: string;
  /** Non-secret digest of the wake binding; a changed binding lifts a previous fail-closed block. */
  wakeBindingFingerprint: string;
}

export interface GatewayPolicy {
  queueCap: number;
  ttlMs: number;
  /** How long Telegram update_ids are remembered for retry de-duplication (beyond any Telegram retry window). */
  seenRetentionMs: number;
  /** The Agent counts as online while its last pull is younger than this. */
  onlineWindowMs: number;
  /** How long after a start the Agent has to come online. */
  agentTimeoutMs: number;
  /** Re-check interval while a wake cycle waits for the Codespace / Agent. */
  pollMs: number;
  /** Global minimum spacing between two start requests (wake-storm guard). */
  cooldownMs: number;
  maxStartsPerCycle: number;
  /** Consecutive retryable GitHub failures tolerated in one cycle. */
  maxRetries: number;
  backoffBaseMs: number;
  backoffCapMs: number;
  /** Start requests allowed per rolling 24 h. */
  dailyStartCap: number;
  /** Fail-closed block after a non-retryable failure (bad credential, wrong repo, deleted Codespace...). */
  blockMs: number;
  pullLimit: number;
  longPollMaxMs: number;
  noticeIntervalMs: number;
}

export const DEFAULT_POLICY: GatewayPolicy = Object.freeze({
  queueCap: 500,
  ttlMs: 7 * 24 * 60 * 60_000,
  seenRetentionMs: 14 * 24 * 60 * 60_000,
  onlineWindowMs: 90_000,
  agentTimeoutMs: 12 * 60_000,
  pollMs: 30_000,
  cooldownMs: 10 * 60_000,
  maxStartsPerCycle: 2,
  maxRetries: 5,
  backoffBaseMs: 30_000,
  backoffCapMs: 10 * 60_000,
  dailyStartCap: 12,
  blockMs: 6 * 60 * 60_000,
  pullLimit: 100,
  longPollMaxMs: 25_000,
  noticeIntervalMs: 10 * 60_000,
});

export const MAX_WEBHOOK_BYTES = 64 * 1024;

const TOKEN = /^[0-9]{5,16}:[A-Za-z0-9_-]{30,64}$/;
const WEBHOOK_SECRET = /^[A-Za-z0-9_-]{32,256}$/;
const WEBHOOK_PATH = /^[A-Za-z0-9_-]{24,128}$/;
const CHAT_ID = /^[1-9][0-9]{0,15}$/;
/** Fine-grained PAT only: a classic PAT's `codespace` scope can also create and delete Codespaces. */
const GITHUB_TOKEN = /^github_pat_[A-Za-z0-9_]{20,250}$/;
const SHA256 = /^[0-9a-f]{64}$/;
export const CODESPACE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
export const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

const encoder = new TextEncoder();

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Length-independent comparison: both sides are hashed first, then compared without early exit. */
export async function secretEquals(presented: string, expected: string): Promise<boolean> {
  return digestEquals(await sha256Hex(presented), await sha256Hex(expected));
}

export function digestEquals(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export type ConfigResult = { ok: true; config: GatewayConfig } | { ok: false; reason: string };

export async function loadGatewayConfig(env: GatewayEnv): Promise<ConfigResult> {
  const v = (key: keyof GatewayEnv) => (typeof env[key] === "string" ? (env[key] as string).trim() : "");
  const botToken = v("TELEGRAM_BOT_TOKEN");
  if (!TOKEN.test(botToken)) return { ok: false, reason: "TELEGRAM_BOT_TOKEN is missing or malformed" };
  const webhookSecret = v("TELEGRAM_WEBHOOK_SECRET");
  if (!WEBHOOK_SECRET.test(webhookSecret)) return { ok: false, reason: "TELEGRAM_WEBHOOK_SECRET is missing or malformed" };
  const webhookPath = v("TELEGRAM_WEBHOOK_PATH");
  if (!WEBHOOK_PATH.test(webhookPath)) return { ok: false, reason: "TELEGRAM_WEBHOOK_PATH is missing or malformed" };
  const owner = v("TELEGRAM_OWNER_CHAT_ID");
  if (!CHAT_ID.test(owner) || !Number.isSafeInteger(Number(owner))) return { ok: false, reason: "TELEGRAM_OWNER_CHAT_ID must be a private (positive) chat id" };
  const githubToken = v("GITHUB_WAKE_TOKEN");
  if (!GITHUB_TOKEN.test(githubToken)) return { ok: false, reason: "GITHUB_WAKE_TOKEN is missing or not a fine-grained personal access token" };
  const agentTokenSha256 = v("AGENT_TOKEN_SHA256").toLowerCase();
  if (!SHA256.test(agentTokenSha256)) return { ok: false, reason: "AGENT_TOKEN_SHA256 must be a lowercase hex SHA-256 digest" };
  const codespaceName = v("CODESPACE_NAME");
  if (!CODESPACE_NAME.test(codespaceName)) return { ok: false, reason: "CODESPACE_NAME is missing or malformed" };
  const expectedRepo = v("EXPECTED_REPO");
  if (!REPO.test(expectedRepo)) return { ok: false, reason: "EXPECTED_REPO is missing or malformed" };

  // Credential separation: no credential may double as another.
  const secrets = [botToken, webhookSecret, webhookPath, githubToken];
  if (new Set(secrets).size !== secrets.length) return { ok: false, reason: "Gateway credentials must all be distinct" };
  for (const s of secrets) if (digestEquals(await sha256Hex(s), agentTokenSha256)) return { ok: false, reason: "the Agent pull token must not reuse another credential" };

  const wakeBindingFingerprint = (await sha256Hex(`${githubToken}\n${codespaceName}\n${expectedRepo.toLowerCase()}`)).slice(0, 16);
  return {
    ok: true,
    config: { botToken, webhookSecret, webhookPath, ownerChatId: Number(owner), githubToken, agentTokenSha256, codespaceName, expectedRepo, wakeBindingFingerprint },
  };
}

/** Content-free structured log; values are clipped so nothing long (e.g. a message) can ride along. */
export function consoleLog(event: string, fields: LogFields = {}): void {
  const safe: LogFields = {};
  for (const [k, value] of Object.entries(fields)) safe[k] = typeof value === "string" ? value.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 40) : value;
  console.log(JSON.stringify({ gw: event, ...safe }));
}
