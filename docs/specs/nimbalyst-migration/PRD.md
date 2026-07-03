# PRD — Auracle IDE on Nimbalyst

**Status:** v2 (post-adversarial-review) — for owner approval · 2026-07-02
**Replaces direction of:** Zed/GPUI fork (SiixQuant/auracle-ide source lineage) as the Auracle IDE.
**Evidence:** 5-agent discovery (workflow `wf_6ddaa08a-083`) + 3-lens adversarial review (`wf_047bd94c-936`, 22 findings folded in). The five discovery maps must be archived into the new repo at `docs/specs/nimbalyst-migration/maps/` in P0a (they currently live only in session scratch).

---

## 1. Problem statement

The Auracle IDE is today a fork of Zed (Rust/GPUI). It gave us a native editor but at a permanent cost: every finance surface is hand-built GPUI, mac-CI-only builds, a huge upstream-parity debt, and an editor-first (not AI-first) interaction model. The owner's product thesis — *AI leads strategy development* — matches the shape of nimbalyst (MIT): an Electron/React visual agent workspace whose core product is managing Claude Code sessions with visual editors, tasks, and a first-class extension system.

We will wrap the Auracle brand around nimbalyst, keep the Auracle engine as the backend, hand sign-in to the Auracle marketing site (HQ), and port **only the finance features** from the Zed fork. Settings/editor/infra customizations from the Zed era are explicitly dropped.

## 2. Solution overview

**Thin fork + ONE pre-bundled first-party extension.**

- **Fork surface (small, upstream-mergeable):** de-Nimbalyst rebrand + Auracle theme, phone-home removal, marketplace-install removal, sync/mobile/share strip, Auracle sign-in transport (replacing Stytch), default-agent-provider patch, packaging/release pipeline. Every core touch is logged in `FORK_NOTES.md`.
- **The Auracle pack is a SINGLE extension** (`auracle-pack`) contributing multiple panels, settings pages, custom editors, commands, and the claudePlugin — not N separate extensions. Rationale (review finding): extensions load as isolated blob-URL modules sharing only host-provided externals; a single extension makes the shared engine transport, in-process state, and the connect-generation re-poll broadcast trivial, with no cross-extension channel or externals-list core patch needed. It is pre-bundled into `resources/extensions` at package time (first-party trust domain, consent auto-granted, `packages/electron/build/build-extensions.js`).
- **Engine code unchanged — but v1 requires an engine RELEASE.** The money path depends on the 2026-07-02 live-deploy train (simulator zero-config paper #332, live-supervisor daemon + compose service #340, fills→ledger #330, ledger route #328-lineage, AUM basis #336, agent tier leg-router #325) which is merged on engine main but exists in **no released image** (newest tag v2.6.0, 2026-06-27). Cutting engine **≥v2.7** and confirming the launcher-provisioned stack pulls it is a hard dependency of the v1 gate (§8).
- **HQ (marketing site) owns identity.** Sign-in UX is nimbalyst-identical (optional, Settings-based, browser round-trip, deep-link return, keychain storage). The device flow (`/auth/device/*` → Ed25519 entitlement JWT) is **engine-side code that HQ runs as a deployment of the same codebase** — HQ is currently a stale build (404 on `/auth/device/start`) and needs the owner's Railway redeploy + Resend/SMTP key before HQ sign-in works; the identical flow against the local engine is the interim target and also needs the email key configured wherever it's tested.

## 3. Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Sign-in gate | **Identical UX to nimbalyst**: optional, never blocks startup; Settings → Account; browser round-trip → deep link back. Provider = Auracle HQ (engine codebase deployed at HQ). Email magic link first; "Continue with Google" is a follow-up slice (HQ needs OAuth). |
| D2 | v1 scope | **Money path first**: engine transport + Connections + status + quant agent + backtest workflow + Deploy wizard + Live Algorithms + orders ledger. Monitoring panels = v2. Studio/Flow/QC import = v3. |
| D3 | Repo topology | **New PUBLIC source repo** (working name `SiixQuant/auracle-workspace`); public keeps mac CI free per the lean-and-free architecture and puts the repo under the standing commit-style rule (generalized/obscure, single-author). Releases keep publishing to `SiixQuant/auracle-ide` with the `auracle-v*` tag + dmg + `.sha256` sidecar convention → zero launcher changes for users. Zed fork stays intact as porting reference. |
| D4 | Mobile/sync/share | **Stripped from v1** — surfaces *removed*, not disabled-in-place (no dead controls). Wire protocol is open (`packages/collab-protocol`); an Auracle sync worker is a possible later project. iOS/Android packages deleted from the fork. |
| D5 | Updates | **Launcher remains the sole updater.** In-app electron-updater is removed/disabled (it's hardcoded to `nimbalyst/nimbalyst` — would pull upstream builds and desync `~/.auracle/ide_version`). |
| D6 | Product name | **"Auracle IDE"** (`productName` → dmg contains `Auracle IDE.app`, matching the launcher's install path expectation exactly). |
| D7 | Agent/AI | **v1 = nimbalyst-native providers.** Coding agent = user's own Claude Code auth (SDK-direct to Anthropic; the merged engine leg-router `/ui/api/agent/chat` is unused in v1); BYO keys live in nimbalyst's provider settings/keychain, never env vars. Keyless AI is served by the existing local chat providers (LM Studio et al.) staying available. The hosted metered leg follows the standing **hybrid-gateway PRD** (`auracle/docs/specs/auracle-agent-hybrid-gateway/PRD.md`, engine slice #325 merged); only S2 (HQ metered proxy + allowance/pricing numbers + HQ deploy) remains owner-gated. **Owner note:** agent-led research therefore requires the user's Claude auth in v1 — this is an explicit, flagged narrowing of keyless-by-default for the agent leg, accepted because the agent literally is Claude Code here. |
| D8 | Visual identity | **v1 ships an Auracle default theme** (charcoal + Nous-blue per the Hermes-on-dark design language) via nimbalyst's CSS-variable/themes seam, plus icon set and dmg background — a rebrand is not a name-swap on upstream visuals. Sized S/M as its own slice (P1b). |
| D9 | Upstream policy | **Fork pinned at nimbalyst v0.33.1. No upstream merges before `auracle-v1.0.0` ships.** Any post-v1 merge re-runs the P0a outbound sweep + FORK_NOTES review; a CI grep guard over built output (posthog / nimbalyst.com / stytch / sync.nimbalyst.com) fails the build on reintroduction. |

Standing owner rules that bind this project: keyless-by-default (engine legs: backtest/paper need zero credentials; D7 flags the agent-leg narrowing explicitly); honesty invariants (no fabricated status, no dead controls, "connected" only from a real engine round-trip); quantitative-measures-only product language; public-repo commit style; no Co-Authored-By.

## 4. Domain model (ubiquitous language)

Existing terms carry over unchanged: **Engine** (local Houston API at `127.0.0.1:1969`), **Connector** (broker | data_provider | integration, with `ConnStatus.state`), **Deployment** (live/paper algorithm instance with lifecycle `starting/running/stopped/errored…`), **Ledger** (per-deployment orders), **Entitlement** (Ed25519-signed JWT: email/tier/license), **Capability** (engine-computed `live_allowed`/active-broker truth).

New terms from the host platform: **Workspace** (a directory opened in a window), **Session** (an agent conversation, SDK-driven), **Extension** (manifest-declared contribution bundle), **Panel** (sidebar/bottom/fullscreen/floating surface), **Custom editor** (glob-bound file editor via the `EditorHost` contract), **Agent workflow** (skills/commands surfaced to sessions), **Auracle pack** (our single pre-bundled extension).

Invariants:
1. Only a completed engine round-trip may render "Connected" (port of `PanelStatus` honesty rule).
2. **LLM provider keys** live only in nimbalyst provider settings/OS keychain — never env vars (upstream hard rule after their billing incident; `sdkOptionsBuilder` strips them). Engine credentials come from the launcher-provisioned 0600 config file; the `AURACLE_API_KEY` env override is a documented dev-only affordance.
3. Every mutation to the engine speaks the double-submit CSRF dance; every GET sends both `X-API-Key` and the `auracle_session` cookie. This applies equally to `/ui/api/*` and the root-mounted `/deploy/live` + `/deployments/*` routes.
4. Lifecycle actions are offered only where the engine's lifecycle table allows (`available_actions` port), and destructive actions (Liquidate) confirm.
5. The signed-out IDE is fully functional for engine-side work — backtest and paper-deploy on yfinance/simulator with zero credentials. (Agent features additionally need the user's own Claude auth per D7, independent of sign-in state.)

## 5. User stories (money path)

1. As a quant, I open Auracle IDE and it auto-connects to my local engine using `~/.config/auracle/auracle.json` written by the launcher, with an honest status chip.
2. As a quant, I open Settings → Connections and see brokers/data providers with real status, connect/test/save/disconnect, secrets in the keychain or engine vault, and tier-gated rows labeled honestly.
3. As a quant with Claude auth configured, I ask the agent to research an idea, and it uses engine MCP tools (`research_scan`, `run_backtest_now`, `run_walkforward`, `premarket_check`) with a finance persona and my workspace's strategy conventions.
4. As a quant, I type `/backtest` on an open strategy file and get results in the session, grounded in the engine's actual backtest job.
5. As a quant, I click Deploy, fill the wizard (mode, broker, **AUM required**, compute, data sources, resilience), and the deployment appears in a Live Algorithms panel with equity/return and Stop/Liquidate/Restart per lifecycle rules.
6. As a quant, I expand a deployment to see its orders ledger (fills, avg price, status) polled live.
7. As an owner, I sign in from Settings → Account via magic link in my browser; the IDE deep-links back, stores the entitlement in the keychain, and shows my tier/license; signed-out I can still do everything local.
8. As a user on a Mac with the Zed-era IDE installed, the launcher upgrades me to this IDE exactly as any update (dmg + checksum), and the release only exists once the parity gate is green.
9. As a user, nothing reaches Nimbalyst Inc. infrastructure — no PostHog, no upstream update feed, no Stytch, no sync server, and no marketplace downloads from their CDN (the install surface is removed; the pack is the only extension source in v1).
10. As an agent, I can read the live state the user is looking at (panel AI-context) and, in v3, operate the Flow canvas through registered editor APIs.

## 6. Phases (bite-sized, independently verifiable)

Sizing: S ≈ ≤1 day, M ≈ 1–3 days, L ≈ 3–6 days. Each phase ends green (typecheck + vitest + app boots) and is committed on its own. **Port sources are named per phase** (the Zed fork's main is NOT a complete finance-surface source — two diverged lineages).

### Wave 0 — Foundation (v1)

- **P0a · Fork bootstrap + network tripwire kill (M).** Fork nimbalyst@v0.33.1 → new public repo; archive the five discovery maps into `docs/specs/nimbalyst-migration/maps/`; dev-environment bring-up (electron-vite, native module rebuilds: better-sqlite3/node-pty/pglite). Remove: electron-updater (feed hardcoded to `nimbalyst/nimbalyst` — `src/main/services/autoUpdater.ts` + UpdateToast), PostHog keys (renderer `index.tsx:203`, `AnalyticsService.ts:9`), Stytch live tokens (`packages/runtime/src/config/stytch.ts`), **the entire marketplace install surface** (remote registry AND the bundled `extensionRegistry.json` full of `extensions.nimbalyst.com` URLs — pre-bundled pack becomes the only extension source), iOS/Android packages. Add the D9 CI grep guard. **Acceptance:** a minimal local unsigned electron-builder dmg is produced *in this phase* and a proxy sweep on that artifact **with `OFFICIAL_BUILD=true`** shows zero outbound requests at rest AND under user-triggered flows (update check, extension browse); vitest + typecheck green.
- **P0b · Sync/share/mobile UI strip (S/M).** Remove Account & Sync's sync sections, SharedLinksPanel, device pairing, DiscordInvitation, mobile mentions — *removed, not disabled* (no dead controls). **Acceptance:** UI sweep shows no sync/share/mobile affordances; settings render clean; no orphaned IPC handlers referenced from the renderer.
- **P1 · Rebrand (M).** `productName` "Auracle IDE", appId `com.aurapointcapital.auracle` (fresh userData path — no migration needed, we have no nimbalyst userbase), protocol scheme `auracle://` (registration + deep-link handler), icons/logo/about, user-visible strings, ToS/Privacy links → aurapointcapital.com, `.nimbalyst/` → `.auracle/` workspace dotfolder. **Beyond renderer strings (review):** exported-HTML brand links (`FileHtmlExporter.ts:128`, `SessionHtmlExporter.ts:394`), feedback targets (`FeedbackIntakeDialog.tsx:26` support@ + `GitHubIssueUrlBuilder.ts:4` upstream issue URLs), UpdateToast download fallback. Internal identifiers (npm scope imports, `.nimext`, code symbols) stay — invisible to users, keeps upstream merges cheap (Zed-rename precedent). **Acceptance:** repo-wide sweep of user-reachable output (rendered UI, menus, exports, feedback URLs, deep links) shows zero "Nimbalyst".
- **P1b · Auracle theme (S/M, D8).** Default dark theme (charcoal + Nous-blue, Hermes-on-dark) via the CSS-variable theme system + themes contribution; app icon set; dmg background. **Acceptance:** packaged app boots in Auracle theme by default; visual pass against the launcher's design language.
- **P2 · Engine transport core + pack skeleton (M).** Scaffold the single `auracle-pack` extension. Inside it: one TS transport module — reads `~/.config/auracle/auracle.json` (+ dev-only env overrides), `getJson/postJson` with `X-API-Key` + `auracle_session` cookie, CSRF fetch from `GET /ui/api/status` + double-submit on **all** mutations (including root-mounted deploy routes), SSE reader for `/ui/api/events/stream`, connect-check (`GET /ui/api/ide/connect-check`), and an in-pack connect-generation broadcast so all pack surfaces re-poll after a saved connection. Port the `auracle_connect`/`auracle_connections` pure helpers **with their unit tests** (source: Zed fork `feat/live-deploy-panel`). **Status chip** ships here as a pack contribution (mount point named in-phase: hostComponent or documentHeader — resolve against the SDK during the slice). **Acceptance:** vitest ports green; chip shows all four truth states against a running + stopped engine; a mutation round-trip (any owner-gated POST) succeeds proving the CSRF dance.
- **P3 · Connections page (L).** `settingsPanel` contribution in the pack: master-detail per kind from `GET /ui/api/connections?kind=`, detail + fields (`has_value` preview, never fetch secrets), test/save/disconnect, capability display, tier-gate chips (`gated`, `gated_reason`), keyless rows ("Ready — no key needed" for yfinance/simulator), broker logos (port SVGs). Source: `feat/live-deploy-panel` + engine contract on main. **Acceptance:** connect→test→save→disconnect round-trip against the local engine for one broker + one data provider; secrets appear only as previews.

### Wave 1 — AI + money path (v1)

- **P4 · Auracle sign-in (M).** Settings → Account panel in the pack (+ the deep-link handler in fork surface): email → `POST {base}/auth/device/start`, magic-link browser round-trip, 6-digit fallback (`/auth/device/verify`), poll (`/auth/device/poll`), keychain storage of `signed_jwt` + `refresh_token`, tier/license display, sign out, silent refresh via `/auth/refresh` (fixing the launcher's known gap). Topology: HQ-first with local-engine fallback — **the reference implementation is launcher `auth_device.rs` as merged in PR #100 on `auracle-desktop` origin/main (2026-07-02; note the local checkout predates it)**. `auracle://auth/callback` deep link supported. Strip `StytchAuthService` usage. **Preconditions (owner inputs, already on the standing list):** HQ Railway redeploy of current engine code + Resend/SMTP key — until then acceptance runs against the local engine *with an email key configured* (the flow emails both the link and the code; an unconfigured mailer sends nothing). **Acceptance:** full magic-link round trip + tier display + signed-out degradation; expired-JWT silent refresh exercised.
- **P5a · Agent foundation spike (M).** In the pack: engine MCP server registration via `McpConfigService` (endpoint reachability without Caddy verified here); persona injection through the `prompt.ts` append seam verified in a real session; workspace template (`CLAUDE.md` + `.claude/` tree) for strategy repos; **2 pilot commands** (RunBacktest, ResearchIdeas) as claudePlugin slash commands producing engine-grounded results. **Acceptance:** both pilots return real engine numbers in a live session; MCP + persona seams documented in FORK_NOTES if any core touch was needed (target: none).
- **P5b · Command set completion (M).** Remaining 10 commands (WalkForward, PreMarketCheck, OpenTearsheet, BrowseTemplates, CloneTemplate, RunPreflight, IngestData, DraftManifest, ValidateManifest, BacktestManifest), mechanical on the P5a pattern. Deploy-path commands check `GET /ui/api/capabilities.active_broker` and route to Connections when unconfigured (ported behavior). **Acceptance:** spot-check each command grounded; no fabricated numbers (honesty sweep).
- **P5c · Default-provider core patch (S).** The one agent-side core touch: default new sessions to Claude Code with the Auracle persona configuration and de-emphasize non-finance stock providers. Isolated micro-slice with its own FORK_NOTES entry so the upstream-hot change is independently revertable. **Acceptance:** fresh install → first session lands on the Auracle-configured provider; stock providers still reachable (nimbalyst-identical freedom).
- **P6 · Backtest workflow (M).** Strategy list (`GET /ui/api/backtest/strategies`) + run/validate (`POST /ui/api/backtest/run`, job-status polling, `POST /ui/api/strategy/validate`) as pack panel + agent tools. **Acceptance:** run a real backtest from the IDE and read results without touching Houston's web UI.
- **P7a · Deploy reducer port (S/M).** Port `auracle_live` to TS **with its full unit-test suite** (wizard validation incl. AUM-required + live/cloud rules, `to_request`, lifecycle `available_actions`, destructive-confirm, selection model, formatting). **Source: Zed fork `feat/live-deploy-panel` (+ `feat/live-deploy-reducer`) — this crate does not exist on the fork's main.** Pure TS; green on vitest alone. **Acceptance:** ported test suite passes 1:1.
- **P7b · Deploy wizard (M).** Wizard UI (floating panel or virtual tab) over the P7a reducer; broker list driven by `GET /ui/api/connections?kind=broker` (NOT the old hardcoded trio); `POST /deploy/live` proven against a live engine — root-mounted path with cookie + CSRF (de-risks FR2 fully). **Acceptance:** paper deploy on simulator accepted by the engine end-to-end with zero credentials.
- **P7c · Live Algorithms + ledger (M).** Fullscreen panel: deployments table (20s poll of `GET /deployments`), per-row ledger expansion (`GET /deployments/{id}/orders`), lifecycle actions (`POST /deployments/{id}/{stop|liquidate|restart}`) gated by `available_actions`, Liquidate confirms. **Acceptance:** create → running → ledger rows → stop → restart → liquidate on simulator, all against the **released** engine image (see P8/§8), panel AI-context exposes the visible table to the agent.

### Wave 2 — Ship (v1)

- **P8 · Packaging + staged release pipeline (M/L).** electron-builder mac arm64 dmg (`Auracle IDE.app`, readable `CFBundleShortVersionString`); CI workflow adapted from `electron-build.yml` (notarization behind `SKIP_NOTARIZE` until Apple certs land — standing owner input); release automation generating the **bare-hex `.sha256` sidecar in the workflow** (closes the manual-step trap). **Staging first (review blocker):** publish the candidate to a scratch repo (e.g. `SiixQuant/auracle-ide-staging`) and verify with a locally built launcher whose release-repo coordinate is pointed at staging (test-only patch — shipped launchers stay untouched, FR9 holds): download → sha256 verify → hdiutil → atomic swap → version marker → boot → auto-connect. **Also rehearse:** upgrade-in-place over an existing Zed-era "Auracle IDE.app", and rollback (re-publish prior known-good dmg as a newer tag; launcher recovers). Only then cut the byte-identical release on `SiixQuant/auracle-ide` as `auracle-v1.0.0`. **Engine dependency:** engine **≥v2.7** (containing the live-deploy train incl. live-supervisor compose service and the ledger route) must be released and pulled by the launcher-provisioned stack **before or lockstep with** this publish. **Acceptance:** §8 checklist green against the exact staged artifact; production publish is a promotion, not a first test.

### Wave 3 — Console parity (v2)

- **P9 · Monitoring panels (L, one slice per panel).** Shared `usePolledFeed` + `PanelPlaceholder` (4-state) first, then: blotter (`/ui/api/orders`, cancel-all; per-row cancel stays withheld until the engine ships `broker_order_id` — honesty carry-over), incidents (+dismiss w/ CSRF), schedules (run/toggle/delete), validation (7 overfit signals), runway (6-stage spine), runs/events (SSE tail). Source: `feat/live-deploy-panel` lineage panels + engine main.

### Wave 4 — Studio lineage (v3)

**Before any v3 phase starts:** diff the required endpoints against the engine release that will ship — `POST /ui/api/quantconnect/compare`, `POST /backtest/studio`, `GET /ui/api/overview`, `POST /ui/api/strategy/source` originate in the unmerged Zed-fork lineage and their engine counterparts may equally be unmerged; schedule any missing routes as engine dependencies (do NOT assume "engine unchanged" extends to v3).

- **P10 · Studio results + cockpit actions (L).** Port `auracle_studio_results` + cockpit verbs. **Source: `studio` branch tip.**
- **P11 · Flow canvas (L).** Custom editor on the `datamodellm` pattern: `useEditorLifecycle` over the ported `auracle_flow` reducer, source mode, transcript embed, `registerEditorAPI` for agent graph mutation. **Source: `feat/flow-shell` branch tip.**
- **P12 · QC import (M).** Port `auracle_qc_import` state machine + views. **Source: `qc-import-divergence` / `qc-import-viewstate` branch tips.**

### Later / explicitly deferred
Google OAuth on HQ (D1) · Auracle sync worker + mobile (D4) · marketplace/registry self-hosting (install surface stays removed until a considered decision — trading credentials adjacency) · hosted AI metered leg (D7/hybrid-gateway S2, owner-gated) · Windows/Linux builds.

## 7. Functional requirements (numbered, testable)

FR1. Packaged app performs no network requests to Nimbalyst-controlled or analytics endpoints — at rest AND under user-triggered flows (P0a sweep + D9 CI guard).
FR2. All engine mutations succeed against the released engine image — cookie + CSRF verified for `/ui/api/*` AND root-mounted `/deploy/live`, `/deployments/*` (P2/P7b).
FR3. Wizard rejects live deploys with AUM ≤ 0 and cloud compute without a data provider (ported reducer tests) (P7a).
FR4. Lifecycle buttons render only engine-allowed actions per state; Liquidate requires confirm (P7c).
FR5. Signed-out, credential-less: backtest + paper-deploy on yfinance/simulator work end-to-end (engine legs). Agent features additionally require the user's own Claude auth (D7 carve-out) (P7b/P7c).
FR6. Sign-in stores tokens only in the OS keychain; sign-out wipes them; expired JWTs refresh silently or degrade honestly to signed-out (P4).
FR7. Connections never render a secret value; only `has_value` previews (P3).
FR8. The status chip's "Connected" appears only after a successful engine round-trip (P2).
FR9. Users' installed launchers need zero changes to receive the new IDE (D3/P8; the staging launcher patch is test-only and unshipped).
FR10. Slash commands produce engine-grounded results (no fabricated numbers) via MCP tools (P5a/P5b).

## 8. v1 cutover gate (release checklist for `auracle-v1.0.0`)

Verification target: **the exact staged artifact** (packaged dmg, not dev build) against **the released engine image (≥v2.7)** users will actually run.

- [ ] Engine ≥v2.7 released (live-deploy train + live-supervisor service + ledger route) and pulled by a launcher-provisioned stack
- [ ] Auto-connect from launcher-provisioned config
- [ ] Status chip truth (4 states, incl. engine-down)
- [ ] Connections: list/detail/test/save/disconnect/gating for brokers + data + QC integration
- [ ] Sign-in round trip + tier display + signed-out degradation (HQ if redeployed; else local engine with mailer configured)
- [ ] Agent: persona + 12 commands + engine MCP tools live (with user Claude auth)
- [ ] Backtest run + validation from the IDE
- [ ] Paper deploy on simulator end-to-end + ledger + stop/liquidate/restart, zero credentials
- [ ] Zero Nimbalyst phone-home (proxy sweep on the artifact) + zero visible Nimbalyst branding (incl. exports/feedback/deep links)
- [ ] Packaged deep-link sign-in return works (`auracle://auth/callback` in the built app, not dev)
- [ ] Staged install via locally-built repointed launcher: download → sha256 → swap → version marker → boot
- [ ] Upgrade-in-place over an existing Zed-era install on a real machine succeeds and boots connected
- [ ] Rollback rehearsed: prior known-good dmg re-published as a newer tag; unmodified launcher recovers
- [ ] Playwright money-path e2e green on the artifact
- [ ] Production publish = promotion of the byte-identical staged artifact + sidecar

## 9. Constraints, dependencies, risks

**Owner inputs (all pre-existing on the standing list, now with v1 phase bindings):** Apple Developer certs (P8 notarization; unsigned interim OK as today) · HQ Railway redeploy + Resend/SMTP key (P4 full HQ path; local-with-mailer interim) · engine ≥v2.7 release cut (P8 gate; agent-executable except that publishing images is release-pipeline owner policy) · AI metered-leg pricing (post-v1, hybrid-gateway S2).

**Verification items (resolve in-phase, don't assume):** engine MCP endpoint reachability from the IDE without Caddy (P5a) · deep-link return support in the magic-link page (P4; 6-digit fallback exists server-side) · `@anthropic-ai/claude-agent-sdk` pin (^0.3.198) behavior under persona injection (P5a) · status-chip mount point in the SDK (P2) · v3 endpoint diff (Wave 4 preamble).

**Risks:**
- *Upstream drift* → D9 pin + CI guard + FORK_NOTES; the only standing conflict points are the P5c default-provider patch and the P4 deep-link/auth touches.
- *Two-lineage porting hazard* → source branches are now named per phase (P2/P3/P7a ← `feat/live-deploy-panel`(+`feat/live-deploy-reducer`); P10 ← `studio`; P11 ← `feat/flow-shell`; P12 ← `qc-import-*`); maps archived in-repo (P0a).
- *Upstream DB migration mid-flight* (PGLite↔SQLite) → build against the SDK only; avoid `host.data.query()` (documented unstable).
- *Release tripwire* → §8 staging + promotion flow; production publish is never the first test.
- *Trust boundary* → marketplace install surface removed in v1; pre-bundled pack is the only extension source while trading credentials are in reach.
- *Nondeterministic agent acceptance* (P5) → pilot-first split; acceptance = engine-grounded outputs (numbers must match engine job results), not transcript aesthetics.

## 10. Testing decisions

- Ported reducers keep their unit tests: Rust cases from `auracle_live`, `auracle_connect`/`auracle_connections`, and (v3) the flow-shell `*_state` crates translate to vitest as the behavioral spec — external behavior only.
- Engine integration: container pytest suite untouched (engine unchanged); IDE-side integration verified against a locally running engine in each phase's acceptance.
- E2E: Playwright (in-repo) for the money path (connect → backtest → paper deploy → ledger → stop) — required green on the staged artifact (§8).
- Honesty regression guard: vitest suite asserting the 4-state chip/panel mapping and the lifecycle-action table against the engine's `lifecycle.py` semantics.
- Release pipeline rehearsal is itself a test (staging repo + repointed local launcher + upgrade + rollback) before any production publish.

## 11. Out of scope

Settings-remodel features from the Zed fork (native settings home, AI-model mirror, GitHub identity panel) · engine behavior changes (only a release cut) · Houston web UI changes · mobile/sync/share (D4) · marketplace hosting (removed surface) · Windows/Linux packaging · hosted AI metered leg (D7) · Zed-fork maintenance beyond critical fixes until cutover.
