# PRD — Panel ↔ Agent interconnection (Phase 1)

Status: ready-for-agent · Owner: Auracle · Repo: SiixQuant/auracle-workspace (auracle-pack)

## Problem Statement

The Auracle IDE has a set of custom gutter panels (Research, Live Algorithms,
Blotter, Incidents, Schedules, Runway, Validation, QC Import) that each talk to
the trading **engine** over HTTP, but — except for Research — none of them are
connected to the IDE's **AI/coding core** (the Agent). A trader looking at a
failed validation, a stalled live deployment, or a half-translated QuantConnect
project cannot get the Agent's help on what they're looking at without manually
re-describing it in the chat. The panels feel like dashboards bolted next to an
AI, not one AI-native product.

An audit (2026-07-08) confirmed the platform already ships every primitive
needed — the panels simply never opt in:
- `host.launchAgentSession(prompt, {title})` hands a prefilled prompt to a new
  Agent session (proven in `ResearchPanel.tsx`).
- A panel that declares `aiSupported: true` and calls `host.ai.setContext(...)`
  has its live state surfaced to the main AI chat as a context document
  (`PanelContainer.tsx` → `App.tsx` `extensionPanelDocumentContext` →
  `<ChatSidebar documentContext=…>`), and the chat sidebar is auto-shown for
  `aiSupported` panels.

## Solution

Wire the panels to the Agent through those two existing lanes, extension-only,
no Electron-host changes:

1. **Ambient context bus** — each panel publishes what the user is currently
   looking at via `host.ai.setContext(...)`, so the Agent can answer about it in
   any conversation, and the chat is present alongside the panel.
2. **Explicit hand-offs** — Validation, Live Algorithms, and QC Import get a
   one-click "⚡ Ask the agent" action that hands the current context to a
   prefilled Agent session (the user reviews and presses Send).

This is Phase 1. **Out of scope:** proactive/unsolicited Agent reactions
(panel-switch or incident-fire triggers), which require un-stubbing
`PanelAIContext.notifyChange` in the Electron host — a separate Phase 2 PRD.

## User Stories

1. As a strategy developer, when a Validation run flags overfit signals, I want a one-click hand-off so the Agent explains each flag for my specific strategy and proposes minimal fixes.
2. As a strategy developer, when I'm on the Validation panel, I want the Agent to already know the verdict I'm looking at so I can just ask "how do I fix the Sharpe decay?" without re-pasting anything.
3. As a trader, when a live deployment is down or underperforming, I want a one-click hand-off so the Agent investigates the deployment state and recent errors.
4. As a trader on the Live Algorithms panel, I want the Agent aware of the deployment I've selected so I can ask about it conversationally.
5. As a quant importing a QuantConnect project, I want a one-click hand-off so the Agent finishes/repairs the Auracle translation using the source project and generated scaffold.
6. As a user on any wired panel, I want the AI chat to appear alongside it, primed with the panel's context.
7. As a user on an older IDE build that predates `launchAgentSession`, I want the hand-off control to fail honestly ("update the IDE") rather than silently do nothing.
8. As a user who navigates away from a panel, I want the Agent's ambient context cleared so it never reasons from a stale verdict/deployment.
9. As a maintainer, I want each panel's context payload and hand-off prompt to be pure, unit-tested functions so their content is verifiable without a running IDE.

## Implementation Decisions

- **Modules:** all changes live in `packages/extensions/auracle-pack`. No Electron/runtime changes; the host lanes already exist.
- **Manifest:** set `"aiSupported": true` on each wired panel's contribution (`manifest.json`). `PanelRegistry` already forwards this to `PanelContainer`, which creates `host.ai` and syncs context via `onContextChanged`.
- **Ambient publish:** a shared effect hook publishes `host.ai.setContext(<panel context>)` when the panel's focused entity changes and calls `host.ai.clearContext()` otherwise. `notifyChange` is unused (it is a host stub); `setContext`→`onContextChanged` is the live path.
- **Hand-off:** reuse the proven pattern — feature-detect `host.launchAgentSession`, call it with a per-panel prompt, surface an honest note (success / "update the IDE" / hand-off failed). Never auto-submit (host enforces `autoSubmit:false`).
- **Per-panel pure helpers:** each panel gets `xContext(state) → Record<string,unknown>` and `xPrompt(state) → string` in its engine view-model module (mirrors the shipped `validationContext` / `validationPrompt`). The prompt embeds the concrete state so a fresh session has it even without the ambient doc.
- **Shared seam:** extract the `PanelHostLike` structural type, the ambient-publish effect, and the hand-off helper into one small module so Live/QC don't duplicate the Validation spike.
- **No engine changes:** panels already fetch this data; the helpers consume the same view-models.

## Testing Decisions

- **What a good test is:** the observable behavior is the *content* handed to the Agent — the context payload and the prompt string. Test the pure `xContext`/`xPrompt` builders (given a verdict/deployment/project, assert panel tag, embedded fields, that only actionable items are listed, and the fallback summary). Do **not** test React rendering — the pack has no component-test harness and it would couple to implementation.
- **Modules under test:** `engine/validation.ts`, `engine/live.ts`, `engine/quantconnect.ts` helper additions.
- **Prior art:** `src/engine/__tests__/validation.test.ts` (already extended for `validationContext`/`validationPrompt`, 9/9 green) is the template.

## Out of Scope

- Phase 2 proactive push (host `notifyChange` un-stub, panel-switch/incident triggers).
- Hand-off buttons on Blotter/Incidents/Runway/Schedules (ambient-only for the read panels; owner deferred the buttons).
- Registering extension **AI tools** (that lane appears to target the voice agent, not the main coding Agent).
- Any Electron/runtime/main-process change.

## Further Notes

- Validation is already built and green (the de-risking spike): manifest flag +
  `validationContext`/`validationPrompt` + ambient effect + "⚡ Ask the agent"
  button + 6 unit tests. It is the reference implementation for the rest.
- Real-desktop click-verification (ambient doc actually appearing in the chat,
  the Send-gated hand-off) happens at the ship slice on a full IDE build; the
  partial dev clone can't run the Electron shell.
- Architecture reference: memory `reference_ide_panel_ai_core_wiring`.
