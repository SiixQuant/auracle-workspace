# Fork notes

This repository is a downstream distribution of an upstream MIT-licensed workspace app
(pinned at upstream tag `v0.66.9`). The product intent is: **identical to upstream in all
facets except (a) the brand and (b) a pre-bundled first-party extension pack.** Every
deliberate divergence from upstream is logged here so upstream merges stay cheap and each
change stays independently revertable.

## Core divergences

| # | Area | Files | What changed | Why |
|---|------|-------|--------------|-----|
| 1 | Auto-update | `packages/electron/src/main/services/autoUpdater.ts`, `packages/electron/src/main/menu/ApplicationMenu.ts` | `UPDATES_MANAGED_EXTERNALLY = true` no-ops feed configuration and every check entry point; the two "Check for Updates…" menu items are removed. | Updates for this distribution are installed by the desktop launcher, which verifies a checksum sidecar before swapping the bundle. Leaving electron-updater live would race the launcher and, worse, self-replace this build from the upstream feed. |
| 2 | Telemetry | `packages/electron/src/renderer/index.tsx`, `packages/electron/src/main/services/analytics/AnalyticsService.ts` | Renderer PostHog runs with a disabled key, `before_send → null`, decide/surveys/external-deps off; main-process project key blanked so no client is ever constructed. Provider tree and session plumbing left intact. | The upstream project key would send this distribution's usage data to the upstream vendor's analytics project. |

| 3 | Brand | word-level sweep across shipped packages (374+10 files) | Standalone display word "Nimbalyst" → "Auracle" in strings/JSX/comments (with a/an article fixes). Compound identifiers (`NimbalystEditor`, …), lowercase functional ids (`@nimbalyst/*`, `.nimext`, `NIMBALYST_*` env, `.nimbalyst/` dotfolder) untouched. | User-visible rebrand with the smallest possible upstream-merge cost. |
| 4 | Identity | `packages/electron/package.json`, `packages/electron/bin/auracle` | `productName` "Auracle IDE", appId `com.aurapointcapital.auracle`, deep-link scheme `nimbalyst://` → `auracle://` (also in `src/main/index.ts` protocol registration and all URL builders), publish coordinates repointed, bin renamed. | The desktop launcher installs this app as "Auracle IDE.app" and the deep-link scheme is the product's own. |
| 5 | Brand assets | `packages/electron/icon.icns`, `icon.png`, `nimbalyst-logo.png` (content replaced, filename kept) | Auracle mark (generated from the existing product icon at 1024px). | App/dock/about identity. |
| 6 | Outbound links | onboarding ToS/Privacy, help menu docs, feedback email/issues, exporter footers | Point at aurapointcapital.com / SiixQuant repos / support@aurapointcapital.com. Collab/sync/marketplace hosts intentionally untouched (see below). | Links a user can click should not land on the upstream vendor's site. |

| 7 | Engine bridge | `packages/electron/src/main/ipc/AuracleEngineHandlers.ts` (+ two registration lines in `src/main/index.ts`) | Main-process loopback bridge for the pack: engine requests with the cookie + double-submit CSRF contract, and the keyless sign-in device flow with hosted-identity-first / local-engine-fallback base pinning. | The renderer cannot set Cookie headers; built-in extensions using private host IPC is the established pattern (see the git extension). |

## Known cosmetic TODOs

- `packages/electron/icon.ico` (Windows) and `resources/trayTemplate*.png` (menu-bar glyph)
  still carry the upstream artwork — Windows builds are not shipped, and the tray glyph is
  an abstract mark; replace when a proper asset pass happens.

## Deliberately unchanged (for now)

- **Marketplace, sync/share sign-in (Stytch), mobile companions** — left as upstream ships
  them. Sign-in transport is scheduled to be replaced by this product's own identity flow in
  a later phase; the account/settings surfaces will be revisited there rather than stripped.
- All internal identifiers (`@nimbalyst/*` module scope, `.nimext`, env var names, IPC
  channel names) — invisible to users; renaming them buys nothing and costs every future
  upstream merge.

## Merge policy

Pinned at upstream `v0.66.9`. No upstream merges before the first shipped release. Any
later merge must re-check divergences #1 and #2 (both live in upstream-hot files).
