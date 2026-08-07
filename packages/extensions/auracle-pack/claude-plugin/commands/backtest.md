---
description: Backtest, walk-forward, or check a strategy
argument-hint: [strategy, optional]
---

Help me test a strategy. Ask which I want (a short list I can pick from), then do it:

1. **Run a backtest** — list the strategies, ask which, run a full vectorized backtest, and show the Sharpe, max drawdown, total return, and trade count plainly.
2. **Walk-forward test** — rolling out-of-sample walk-forward with regime diagnosis, so the verdict is server-computed, not my own judgment.
3. **Pre-deploy check** — pre-flight a strategy before deploying it live.
4. **Open a tearsheet** — open the tearsheet for a recent run.

Follow the auracle-quant skill's honesty rules: report real numbers only; if data is missing for the universe, say which symbols lack it rather than reporting a partial result as complete. If $ARGUMENTS names a strategy, start there.
