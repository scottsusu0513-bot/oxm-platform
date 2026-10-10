#!/usr/bin/env bash
# Codespace postStartCommand (runs on create, restart and resume): auto-start the
# OXM Agent Telegram runtime through its single-instance supervisor. Never fails the
# Codespace start; failures are recorded by the supervisor (pnpm orchestrator:telegram:status).
# Opt out per Codespace with OXM_AGENT_AUTOSTART=off (e.g. a Codespaces user secret).
set -u
cd "$(dirname "$0")/.." || exit 0
state_dir="${OXM_ORCHESTRATOR_STATE_DIR:-$HOME/.oxm-orchestrator}"
mkdir -p "$state_dir/supervisor" && chmod 700 "$state_dir" "$state_dir/supervisor" 2>/dev/null
note() { echo "[oxm-agent-autostart] $*"; echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [autostart] $*" >> "$state_dir/supervisor/runtime.log"; }

if [ "${OXM_AGENT_AUTOSTART:-on}" = "off" ]; then note "disabled by OXM_AGENT_AUTOSTART=off"; exit 0; fi
# Lifecycle commands may not see the login PATH; add the user-level CLI locations if present.
for d in "$HOME/.local/bin" "$HOME/nvm/current/bin"; do
  if [ -d "$d" ]; then case ":$PATH:" in *":$d:"*) ;; *) PATH="$d:$PATH" ;; esac; fi
done
export PATH
if ! command -v node >/dev/null 2>&1; then note "skipped: node not found"; exit 0; fi
if [ ! -d node_modules/tsx ]; then note "skipped: dependencies not installed (run pnpm install, then pnpm orchestrator:telegram:start)"; exit 0; fi
node --import tsx scripts/orchestrator-telegram-supervisor.ts start --autostart || true
exit 0
