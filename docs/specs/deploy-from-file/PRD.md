# Deploy from file + honest strategy discovery

## Problem Statement

Deploying the strategy you are looking at takes a detour: open the Live Algorithms panel, open the wizard, and find your strategy in a picker — a picker that silently omits files. Discovery drops a file when its import fails or when it defines no deployable object, and nothing in the product ever says which files were dropped or why. A trader staring at five .py files and a two-entry dropdown has no way to know the difference between "not deployable" and "broken".

## Solution

Two compact actions live directly in the .py editor header: **Run backtest** (existing, refit) and **Deploy** (new). Deploy resolves the current file to its strategy and opens the existing deploy wizard **pre-bound** — the strategy picker is replaced by a fixed identity row naming the file's strategy. Mode, brokerage, and capital stay on the wizard (capital remains required for live, optional for paper). The strategy *list* exists in exactly one place: the wizard opened from the Live Algorithms page — and that list becomes honest, gaining a "N files can't be deployed — why" expander fed by a new `excluded` field on the discovery endpoint that carries each dropped file and its reason.

## User Stories

1. As a strategy developer, I want a Deploy button in the file I am editing, so that deploying does not require finding the strategy again in a list.
2. As a strategy developer, I want Deploy to already know which strategy I mean (the current file), so that I never pick from a picker in that flow.
3. As a strategy developer, I want the pre-bound wizard to still ask mode/brokerage/capital, so that a deploy stays deliberate and live deploys keep the required-capital rule.
4. As a strategy developer, I want Run backtest and Deploy to sit side by side and fit the slim header, so that the two everyday actions are one glance apart.
5. As a strategy developer, I want Deploy on a non-deployable file to open the wizard in an honest "can't deploy this file" state naming the exact reason, so that I know what to fix instead of guessing.
6. As a strategy developer, I want a file with several Strategy classes to offer a chooser scoped to that file only, so that ambiguity is resolved without the global list.
7. As a trader on the Live Algorithms page, I want the wizard's picker to keep listing all deployable strategies, so that the browse-then-deploy flow still works.
8. As a trader, I want the picker to tell me how many of my files were excluded and why (import error text, backtest-function only, no Strategy class), so that a missing strategy is explainable in-product.
9. As a user on an older engine, I want the IDE to tolerate the absence of the exclusions field, so that the panels degrade gracefully instead of erroring.
10. As a user, I want deploys started from the file header to land in the same Live Algorithms dashboard with stop/liquidate/restart, so that there is one operational surface.

## Implementation Decisions

- **Reuse the existing resolution seam.** Deploy-from-file calls the same file-path→discovery-id resolution Run backtest uses (`one` / `many` / `none`); no new resolution machinery.
- **Reuse the existing wizard.** The pre-bound flow opens the Live Algorithms panel's wizard via the same panel-toggle + module-store handoff pattern the backtest header already uses (a small deploy handoff store mirroring the backtest one). No new editor-tab wizard.
- **Pre-bound means picker-less.** When a binding is present the wizard renders a static strategy identity row (class + module path) instead of the select. Everything else in the wizard is unchanged.
- **Non-deployable files still open the wizard**, which owns the honest failure state and the reason text. The header buttons always render; no eager per-file engine round-trip.
- **Button label is "Deploy"** (not "Deploy Live") — the wizard defaults to Paper; the label must not imply real money.
- **Engine: additive `excluded` field** on the deployable discovery response: for each file discovery saw but dropped, the file's workspace-relative path and a human reason (import error message, "defines only backtest functions", "no Strategy class"). Additive and dual-read safe; the IDE treats the field as optional.
- **Scheduler-style modules stay scheduler-run.** Cron-port files remain outside the wizard's deploy contract; they appear as exclusions with a reason, not as deployable entries. Porting them to Strategy classes is separate strategy work.
- Locked invariants untouched: capital required for live; live keeps the paid-tier + broker hard gate; no fabricated state anywhere.

## Testing Decisions

- Test external behavior only, at the existing seams: the engine's discovery endpoint (container pytest via the test-exec harness and scratch DB) and the pack's pure logic + components (vitest under the package's `__tests__`, run from the workspace root).
- Engine: a fixture strategies tree exercising each exclusion class — import-failure file (reason carries the error), function-only module, class-less module — asserting they appear in `excluded` with reasons while deployable entries are unchanged.
- IDE: resolution→binding tests (one/many/none paths); wizard-state tests for the pre-bound identity row, scoped chooser, and honest non-deployable state; picker expander renders exclusions and renders nothing when the field is absent (older engine).
- Visual verification through the existing panel harness routes before release; prior art: the shipped harness screenshot-verify workflow.

## Out of Scope

- Porting a2/a4 (scheduler-style modules) to Strategy classes.
- Deploying cron/scheduler modules through the wizard (a second deployment kind).
- Any change to wizard fields, the deploy endpoint contract, capital/tier gating, or the Live dashboard.
- One-click/instant deploys with defaults.

## Further Notes

Discovery's silent-skip behavior is the root defect this PRD fixes at the product level; the engine keeps silently *skipping* (a broken file must never break the form) but stops silently *hiding*.
