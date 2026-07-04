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
| 5 | Brand assets | `packages/electron/{icon.icns,icon.ico,icon.png,nimbalyst-logo.png}`, `resources/{icon.icns,icon.ico,icon.png,trayTemplate.png,trayTemplate@2x.png}`, `src/renderer/public/{icon.png,nimbalyst-logo.png}` (content replaced, filenames kept) | The Auracle **launcher's** own app icon (the retro terminal with the green "A"), so the IDE and the desktop launcher are dock siblings — icns/ico copied verbatim from `auracle-desktop/src-tauri/icons/`, PNGs downscaled from its 1024px master. The upstream Nimbalyst artwork was a stylized "Z" monogram that read as Zed. The menu-bar tray glyph is a monochrome flame-"A" silhouette (the "A" from the launcher mark, drawn as a template image). Every in-app logo (`<img src="./icon.png">` in Workspace Manager / Unified Onboarding / Workspace Welcome) resolves to `src/renderer/public/icon.png`, so all in-app logos update from this one swap. | App/dock/about + in-app identity, unified with the launcher. |
| 6 | Outbound links | onboarding ToS/Privacy, help menu docs, feedback email/issues, exporter footers | Point at aurapointcapital.com / SiixQuant repos / support@aurapointcapital.com. Collab/sync/marketplace hosts intentionally untouched (see below). | Links a user can click should not land on the upstream vendor's site. |

| 7 | Engine bridge | `packages/electron/src/main/ipc/AuracleEngineHandlers.ts` (+ two registration lines in `src/main/index.ts`) | Main-process loopback bridge for the pack: engine requests with the cookie + double-submit CSRF contract, and the keyless sign-in device flow with hosted-identity-first / local-engine-fallback base pinning. | The renderer cannot set Cookie headers; built-in extensions using private host IPC is the established pattern (see the git extension). |

| 8 | Identity cutover | `packages/electron/src/renderer/components/GlobalSettings/panels/AuracleAccountPanel.tsx` (new), `Settings/SettingsView.tsx` (two case swaps), `packages/electron/src/main/ipc/AuracleEngineHandlers.ts` (session store) | The native Account & Sync and Shared Links pages render Auracle panels; the signed-in session lives in ONE main-process store (safeStorage-encrypted), shared with the pack's settings section. Upstream `SyncPanel.tsx`/`SharedLinksPanel.tsx` kept intact for merges. | Sign-in must be an Auracle account — the upstream panel routed through the vendor's Stytch tenant (Google consent literally said the vendor's name) and existed to power their hosted sync. |
| 9 | Vendor-infra severance | `ShareDialog.tsx` (honest early return), `dialogs/simpleDialogs.tsx` (Discord nudge dismissed), `packages/runtime/src/config/stytch.ts` (live tenant tokens blanked; env override kept) | Every user-reachable path into the vendor's hosted account/sync/share/community infrastructure now says exactly why it's unavailable instead of contacting third-party servers. | No user action should carry identity to infrastructure this product does not operate. |

| 10 | Binary-file preview | `packages/electron/src/renderer/utils/fileTypeDetector.ts`, `components/TabEditor/{BinaryFileView.tsx,TabEditor.tsx}`, `components/HistoryDialog/HistoryDialog.tsx`, `main/protocols/nimAssetProtocol.ts` | `getFileType` now routes `.pdf`→`'pdf'` (real inline Chromium viewer via `nim-asset://` iframe) and every other binary→`'binary'` (clean "no preview / reveal / open externally" panel), instead of falling through to the Monaco text editor which painted raw bytes as mojibake. Guarded in both the editor tab and the history diff/preview. `nim-asset` allowlist gains `.pdf`. | Upstream `getFileType` had an `isBinaryFile()` helper it never called; opening a tearsheet PDF dumped its bytes. This is an inherited bug fixed for the Auracle use case (tearsheet-heavy workspaces). |

## Known cosmetic TODOs

- (none outstanding — the icon/logo asset pass in divergence #5 replaced the Windows
  `.ico` and the menu-bar tray glyph along with the mac icon and every in-app logo.)

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
