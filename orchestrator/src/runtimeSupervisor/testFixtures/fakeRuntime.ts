// Test double for scripts/orchestrator-telegram.ts: same log markers, no network.
const say = (line: string) => process.stdout.write(`[oxm-agent] ${line}\n`);
if (process.env.FAKE_RUNTIME_FAIL === "1") {
  say("FAILED: simulated startup failure");
  process.exit(1);
}
say(`Telegram bot connected; debug echo of token=${process.env.TELEGRAM_BOT_TOKEN} chat=${process.env.TELEGRAM_OWNER_CHAT_ID}`);
say(`codespace binding ${process.env.OXM_AGENT_CODESPACE_NAME} confirm=${process.env.OXM_AGENT_CONFIRM}`);
say("polling started");
process.on("SIGTERM", () => {
  say("SIGTERM received; stopping");
  process.exit(0);
});
setInterval(() => undefined, 60_000);
