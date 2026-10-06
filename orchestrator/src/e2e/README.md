# Orchestrator end-to-end smoke

The default command is fully fake and offline:

```bash
pnpm orchestrator:e2e-smoke
```

Live execution is manual only. It requires a clean non-protected branch, an
available matching Codespace, authenticated GitHub CLI, an available Codex
runtime, and exact repository/Codespace bindings:

```bash
OXM_E2E_SMOKE_RUN_ID=phase-2c-12-001 \
OXM_E2E_EXPECTED_REPO=OWNER/oxm-platform \
OXM_E2E_CODESPACE_NAME="$CODESPACE_NAME" \
OXM_E2E_SMOKE_CONFIRM=create-one-smoke-branch-and-pr-without-merge \
pnpm orchestrator:e2e-smoke -- --live
```

The live path modifies only
`orchestrator/smoke-fixtures/agent-e2e-smoke.txt`, pushes only the
planner-assigned `agent/task-*` branch, opens or reuses one open PR, and waits
for `verify` and `full-test` on the exact head SHA. It has no merge, deploy,
force-push, production database, branch deletion, PR close, or Codespace
start/stop capability.

Manual cleanup after inspection:

1. Close the smoke PR without merging.
2. Optionally delete its remote `agent/task-*` branch in GitHub.
3. Switch the local workspace back to the desired non-smoke branch (or `main`
   when it is safe to do so).
4. Delete the local smoke branch only after confirming no work is needed.
5. Leave the Codespace in place unless an operator separately chooses to
   delete it.

The harness performs no automatic cleanup because branch, PR, and Codespace
deletion are intentionally outside its authority.
