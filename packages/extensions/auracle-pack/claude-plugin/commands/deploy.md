---
description: Prepare and check a live deployment
argument-hint: [strategy or manifest, optional]
---

Help me get a strategy ready to deploy. Ask which I want (a short list I can pick from), then do it:

1. **Draft a deployment manifest** — auto-draft a manifest for a strategy.
2. **Validate a manifest** — check a deployment manifest for problems.
3. **Backtest a manifest** — backtest a manifest with no broker calls.
4. **Pre-market check** — a one-shot readiness check: broker connectivity, net liquidation value, current positions, open orders, the last 24h of job outcomes, and the strategy's **backtest ↔ live parity** (run `check_parity` — are live and backtest the same signal code?). Put any failures, and any parity that isn't certified, at the top.

Do NOT place any live order from this command — this only prepares and checks. Deploying and turning a strategy live stays a deliberate, separate action. If $ARGUMENTS names a strategy or manifest, start there.
