---
description: Re-rank the top research findings with sharpened hypotheses
---

Deep-rank the research feed. $ARGUMENTS

1. Call the `research_top` MCP tool (limit 10). If it errors or returns nothing, stop and say so.
2. For the top 5 findings (or the count I asked for): judge tradability-in-Auracle from the title, abstract, and current hypothesis. Fetch the paper (`pdf_url`) only when the abstract is too thin to judge — and say when you did. Re-score 0–1 and rewrite the hypothesis as ONE measurable statistical phenomenon (what is computed, over what horizon, with what expected sign). No technical-analysis or fundamental narratives, no invented evidence.
3. Write each back with the `research_refine` MCP tool (finding id, score, hypothesis, confidence low|medium|high). Use the exact ids `research_top` returned; if unsure about a finding, skip it and say so rather than guessing.
4. Finish with a short table — title, old composite → new composite, the sharpened hypothesis. The Research panel re-sorts from the engine's numbers; nothing else changes, and the nightly scan stays heuristic-only.
