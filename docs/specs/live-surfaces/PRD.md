# Live surfaces: visible hand-offs, streaming progress, honest misses

## Problem Statement

Actions land in invisible places. Deploy from the editor closes the results dock and opens nothing (the toggle event only reaches bottom-dock panels; Live Algorithms is a main-area panel). "Ask the agent" creates a prefilled session the open agent panel never shows. A finished backtest against an older engine renders charts as silent nothing. While a backtest runs, the panel shows placeholder skeletons instead of the work. The product's own principle — show the work in real time — is violated at every hand-off seam.

## Solution

Two small host lanes make hand-offs land where the user is looking: an open-main-panel lane (Deploy opens the Live Algorithms panel in the main area, pre-bound) and a send-to-active-agent-session lane ("Ask the agent" injects the prompt into the currently open agent conversation and sends it, streaming visibly; with no session open it falls back to launching one). The engine's backtest job gains a progress feed (stage, bars processed, current window) the panel renders live in place of skeletons. Chart fetches that miss because the engine predates the route say so explicitly. All panel copy gets a terse pass: one short line per state.

## User Stories

1. As a strategy developer, I want Deploy to visibly open the pre-bound wizard in the main area, so that the click has an unmistakable result and my results dock is untouched.
2. As a strategy developer, I want "Ask the agent" to send the backtest prompt into the agent session I already have open and watch it answer live, so that nothing happens behind my back.
3. As a strategy developer with no agent session open, I want the hand-off to open one and proceed, so that the button always works.
4. As a strategy developer, I want a running backtest to show the engine's actual progress (stage, bars, window) as it happens, so that I can see the work instead of placeholders.
5. As a user on an engine build that predates a data route, I want the panel to say exactly that, so that missing charts are explained, never silent.
6. As a user, I want panel copy short enough to scan, so that states inform without lecturing.

## Implementation Decisions

- **Host lane: open main panel.** A host event/API that activates a main-area extension panel by id (the system the left rail drives), distinct from the bottom-dock toggle. The Deploy header stops dispatching the bottom-dock toggle entirely.
- **Host lane: send to active agent session.** Inject a prompt into the currently focused agent session and submit it; return a distinguishable result when no session exists so the caller can fall back to the existing session-launch lane. The panel note then reflects what actually happened ("sent to your open session" / "opened a new session").
- **Engine: backtest job progress feed.** The job records progress (stage, bars processed, current date window) as it runs; expose it on the existing job-status seam (polled) and over the existing SSE infrastructure where available. Additive and dual-read safe: an older engine simply yields no progress and the panel shows the honest static running state with elapsed time.
- **Honest chart miss.** When the job-result fetch returns route-missing, the succeeded view renders an explicit engine-update note in the charts' place. Silent null is removed.
- **Terse copy pass** across auracle-pack panel states: one short sentence per state, no two-clause explainers; honesty rule unchanged.
- Locked invariants untouched: no fabricated state; fewer than two real points renders nothing; capital/live gates unchanged.

## Testing Decisions

- Host lanes: unit tests at the App event/registry seam (open-main-panel activates the right system; agent-send targets the active session and falls back cleanly).
- Pack: vitest for the hand-off result notes, the chart-miss note, and progress rendering (present, absent, malformed); existing suites stay green.
- Engine: container pytest for the progress feed at the job-status seam (stages recorded, shape stable, absent for legacy jobs).
- Visual verification through the harness routes plus a packaged-app pass over the four flows (deploy click, agent hand-off, running progress, chart miss) — the class of gap the harness alone provably misses.

## Out of Scope

- Engine partial-result chart streaming (charts still land on completion).
- Any change to the agent runtime itself; only where prompts land.
- The scheduler-module strategy ports (a2/a4) — separate strategy work.

## Further Notes

Root causes were confirmed live against the packaged app via its debug port: the bottom-dock-only toggle listener, the unfocused agent session, and the silent chart null. The fix round exists because hand-offs succeeded into surfaces the user could not see.
