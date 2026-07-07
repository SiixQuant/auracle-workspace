---
description: Draft a provenance-linked strategy from a research finding
---

Draft a strategy from research finding $ARGUMENTS (a finding id from the Research panel).

1. Call the `research_finding` MCP tool with that id to get the hypothesis, abstract, and paper links. If the tool errors or the finding is unknown, stop and tell me.
2. Fetch the full paper before writing any code — download the `pdf_url` (or the open-access page) and read it. If the fetch fails, say exactly what you could and could not read and ask whether to continue from the abstract alone; never silently draft from the abstract.
3. Write ONE new strategy file under `strategies/` implementing the platform's Strategy contract (`universe`, `prices_to_signals`, optionally `signals_to_target_weights` — conventions in the auracle-quant skill). The module docstring must state the tradable hypothesis as a measurable statistical phenomenon (what is computed, over what horizon, with what expected sign) and cite the paper: source, paper id, title, and URL. Sensible parameter defaults, no lookahead, no fabricated numbers.
4. Record the link by calling the `research_mark_drafted` MCP tool with the finding id and the file's path relative to `strategies/` (for example `momentum_from_paper.py`). If it refuses, the file is not where the engine can see it — say so instead of retrying blindly.
5. Do NOT run a backtest, deploy, or schedule anything in this command. Finish by telling me the file path and the one-line hypothesis; I review the file in the editor (the Research panel card flips to Drafted with an Open file action).
