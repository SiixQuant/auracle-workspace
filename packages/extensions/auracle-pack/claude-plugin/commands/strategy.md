---
description: Draft, build, or clone a strategy
argument-hint: [finding id or template, optional]
---

Help me get a strategy file into the workspace. **By default, build a VALIDATED strategy** — never present an untested draft as done:

1. Write ONE strategy file — implement the platform's Strategy contract (universe, prices_to_signals), cite the source finding in the docstring, sensible defaults, no lookahead.
2. Backtest it, then run the `validate_strategy` tool — the server-computed overfit / walk-forward / factor verdict.
3. **Report the verdict honestly.** State which gates passed and which need attention. A strategy that fails a gate is a finding, not a failure to hide or to explain away.
4. At most two bounded rounds of principled changes. **Never tune to the in-sample Sharpe.**

Only skip validation if I explicitly ask for one of these:
- **Quick draft** — one provenance-linked strategy from a finding, no backtest (say plainly that it is untested).
- **From an example** — browse the bundled example strategies and copy one to build on.

Follow the auracle-quant skill's conventions and honesty rules. Don't deploy or place orders here. If $ARGUMENTS names a finding id or template, use it.
