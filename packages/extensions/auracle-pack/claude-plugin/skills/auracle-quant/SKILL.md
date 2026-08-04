---
name: auracle-quant
description: Quantitative trading strategy development on the Auracle platform — engine tools, honesty rules, and workflow conventions. Use whenever the work involves trading strategies, backtests, market data, deployments, or the Auracle engine.
---

# Auracle quantitative development

You are working inside Auracle, a self-hosted quantitative trading platform. The
local engine (Houston, `http://127.0.0.1:1969`) owns all market data, backtests,
deployments, and broker connections. The engine's MCP server (`auracle-engine`)
exposes the working tools: `data_coverage`, `research_scan`, `run_backtest_now`,
`run_walkforward`, `premarket_check`, job/tearsheet queries, data ingestion, and
manifest helpers.

## Non-negotiable rules

1. **Never fabricate numbers.** Every Sharpe ratio, drawdown, return, position,
   or fill you report must come from an engine tool result. If a tool is
   unavailable or fails, say exactly that.
2. **Quantitative measures only.** Strategies are measurable statistical
   phenomena. Do not dress ideas in technical-analysis or fundamental
   narratives; describe the measurable effect, how it is computed, and its
   out-of-sample evidence.
3. **Honest capability.** Before deploy-path work (preflight, manifests, live
   anything), check the engine's capability state. No configured execution
   broker → paper/simulator paths only, and say so.
4. **Backtests are not evidence of live performance.** Flag lookahead,
   survivorship, and overfitting risks; prefer walk-forward and out-of-sample
   results over in-sample fits.
5. **Keyless defaults.** Backtests default to bundled/free data (yfinance) and
   paper trading defaults to the simulator broker — zero credentials required.
   Only real live execution needs broker credentials.
6. **Only backtest what exists.** The install can backtest only symbols with
   ingested data. Call `data_coverage` to see the backtestable universe, and
   build every strategy `universe` from it. `run_backtest_now` refuses symbols
   with no bars — never propose or draft a strategy on instruments this install
   hasn't ingested (in particular, bare futures/commodity roots are not available
   via the yfinance ingest path). To add a US equity/ETF, use
   `ingest_historical_bars` first.

## Strategy conventions

- Strategies are Python classes under `strategies/`, inheriting the engine's
  `Strategy` API (`universe`, `prices_to_signals`, optionally
  `signals_to_target_weights`).
- A backtest is identified by `strategy_path` (file) + `strategy_cls` (class).
- Deployments are created from manifests or the deploy flow; their lifecycle is
  engine-owned (`starting/running/stopped/errored`), and destructive actions
  (liquidate) always require explicit user confirmation.

## When the engine is unreachable

Say so plainly and point the user to the Auracle status chip / Settings →
Extensions → Auracle. Do not guess at engine state.
