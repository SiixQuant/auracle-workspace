---
description: Transmog a research finding into a validated trading strategy
---

Transmog research finding $ARGUMENTS (a finding id from the Research panel) into a working, provenance-linked Auracle strategy. "Transmog" means: take the paper and carry it all the way to a backtested, overfit-checked strategy the user can review and deploy — not just a stub. Work the pipeline end to end, and be honest at every gate.

Follow the auracle-quant skill's conventions and honesty rules throughout (measurable statistical phenomena only, no lookahead, no fabricated numbers, server-computed verdicts).

## 1. Understand the research
- Call the `research_finding` MCP tool with the id to get the hypothesis, abstract, factors, and paper links. If it errors or the finding is unknown, stop and say so.
- Fetch and read the full paper (`pdf_url` or the open-access page) before writing any code. If the fetch fails, state exactly what you could and could not read and ask whether to proceed from the abstract alone — never silently build from the abstract.
- In one or two sentences, state the tradable edge as a **measurable statistical phenomenon**: what is computed, over what horizon, on what universe, with what expected sign. If you cannot phrase it that way, say the finding isn't tradable as stated and stop.

## 2. Build the strategy
- Write ONE new strategy file into the workspace (it lands in the user's Auracle strategies folder), implementing the platform's Strategy contract: `universe`, `prices_to_signals`, and optionally `signals_to_target_weights` (conventions in the auracle-quant skill).
- The module docstring MUST state the measurable hypothesis and cite the paper: source, paper id, title, and URL. Sensible, defensible parameter defaults. No lookahead (signals lag prices), no survivorship-biased universe, no fabricated constants.
- Prefer a small, robust implementation over a many-knobbed one — every parameter you add is a degree of freedom the overfit checks will (correctly) punish.

## 3. Backtest it
- Run a vectorized backtest with the `run_backtest_now` MCP tool (or the `/auracle:run-backtest` path). Report the headline stats plainly: return, Sharpe, max drawdown, trade count.
- If data is missing for the universe, ingest what's needed (`ingest_data`) and re-run; if you can't, say which symbols lack data rather than reporting a partial result as if it were complete.

## 4. Check it for overfitting
- Run the validation / walk-forward machinery (the `validation` route's seven-signal rail via the engine, or `/auracle:walk-forward`) so the verdict is **server-computed**, not your own judgment.
- Read the verdict: how many of the seven signals are green vs red, and why. State it honestly — a strategy that fails the gates is a finding, not a failure to hide.

## 5. Iterate — but bounded and honest
- If the strategy fails the overfit gates, make at most **two** rounds of principled changes (simplify the signal, widen the universe, lengthen the holding period, drop a fragile parameter) and re-check. Explain each change and what it did to the verdict.
- Do NOT tune parameters to chase in-sample Sharpe — that is exactly what the checks exist to catch. If it still fails after two rounds, say so and hand back the honest verdict; a clearly-explained negative result is a good outcome.

## 6. Record and report
- Record the provenance link with the `research_mark_drafted` MCP tool: the finding id and the file's path relative to the strategies root. If it refuses, the file isn't where the engine can see it — say so rather than retrying blindly.
- Do NOT deploy, schedule, or place any order in this command.
- Finish with a short brief: the file path, the one-line measurable hypothesis, the backtest headline, and the overfit verdict. The user reviews the file in the editor (the Research panel card flips to Drafted with an Open strategy action) and decides whether to deploy.
