# Codex worker runtime smoke probe

The orchestrator unit tests use an injected fake Codex policy runtime and never
require or execute an installed `codex` binary.

To validate a Codespace or production worker host manually, run this read-only
probe from the repository root:

```sh
node --import tsx scripts/codex-worker-smoke.ts
```

The probe checks the pinned worker policy hash, Codex CLI discovery, required
strict-config and native sandbox capabilities, and native `execpolicy`
decisions for the required forbidden and allowed command set. It does not start
an agent run or contact a model.
