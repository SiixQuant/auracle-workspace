---
description: Draft, build, or clone a strategy
argument-hint: [finding id or template, optional]
---

Help me get a strategy file into the workspace. Ask which I want (a short list I can pick from), then do it:

1. **Draft from a research finding** — write one provenance-linked strategy that implements a finding's hypothesis (cite the source in the docstring, sensible defaults, no lookahead).
2. **Build a tested strategy** — take a finding all the way through: write it, backtest it, run the overfit / walk-forward checks (server-computed verdict), and report honestly — a strategy that fails the gates is a finding, not a failure to hide. Two bounded rounds of principled changes at most; never tune to in-sample Sharpe.
3. **Start from an example** — browse the bundled example strategies and copy one to build on.

Follow the auracle-quant skill's conventions and honesty rules. Write ONE strategy file, implementing the platform's Strategy contract (universe, prices_to_signals). Don't deploy or place orders here. If $ARGUMENTS names a finding id or template, use it.
