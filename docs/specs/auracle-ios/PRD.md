# PRD — Auracle iOS (fork of nimbalyst iOS): mobile IDE + agent

Status: draft · Repo: SiixQuant/auracle-workspace (`packages/ios`) · Build: Xcode 16 on a Mac (owner)

## Problem / context

Auracle wants a native iOS **mobile IDE + agent** — view and interact with Auracle
Agent coding sessions, and edit strategies, from the phone. The fastest base is
nimbalyst's iOS app, which already ships in our fork at `packages/ios` (MIT).

**But the discovery (2026-07-08, see `reference_ide...`/task `wjiaied7i`) found it is
NOT a standalone IDE.** It is a native Swift/SwiftUI **thin viewer that mirrors a
paired desktop Electron app's AI-coding sessions** over a **hosted CollabV3
Durable-Object WebSocket sync server**, end-to-end-encrypted, authed via **Stytch**
(B2B org), keyed by `PBKDF2(seed, "nimbalyst:<userId>")`. Text agent runs on the
desktop; mobile views transcripts + queues prompts. Voice = direct OpenAI Realtime
with a key synced from the desktop. This collides with Auracle's locked architecture
three ways: (1) no hosted sync backend (Auracle is local-first; Houston is REST
`/ui/api/*` + `/auth/*`), (2) **Clerk, not Stytch** (verified: iOS = 35 Stytch refs,
0 Clerk; engine already has `clerk_auth.py`/`clerk_session.py`/`auth.py`), (3) agent
is the Auracle Agent → Anthropic in the engine, not a desktop peer.

**Reusable (why forking still wins):** the native WKWebView shell, the file://-safe
IIFE Vite build, the JS↔Swift bridge, APNs push, and — critically — the transcript +
editor webviews render the **same `@nimbalyst/runtime` React the desktop IDE uses**
(`AgentTranscriptPanel`, `projectRawMessagesToViewMessages`, editor). Presentation is
done; only the **data spine (sync→engine)** and **auth (Stytch→Clerk)** need rebuilding.

## Solution

Fork in place and take it in two tracks:
- **Track A — Identity rebrand (no-regret, mostly buildable-by-inspection).** Rename
  every Nimbalyst identity/brand surface to Auracle. Produces a rebranded app that
  still can't reach Auracle until Track B lands (expected).
- **Track B — Engine-direct spine (the real project).** Replace the desktop-mirror
  spine with a direct client to the Auracle engine + Clerk auth, reusing the shell +
  `@nimbalyst/runtime` panels.

## Goals / Non-goals

- Goal: a native iOS app, Auracle-branded, that signs in with **Clerk**, connects to
  the user's **Auracle engine** (remote), and views/drives **Auracle Agent** sessions
  + edits strategies, reusing the existing native shell + runtime webviews.
- Non-goal (this PRD): keeping the hosted CollabV3 sync server or Stytch; running any
  new hosted backend; the desktop-pairing/QR mirror model; Android (mirrors iOS 1:1 —
  follows after).

## User stories

1. As a user, I sign into the iOS app with my Auracle (Clerk) account — the same identity as desktop/launcher/web.
2. As a user, I connect the app to my Auracle engine (remote access), not a hosted sync server.
3. As a user, I see my Auracle Agent sessions/transcripts on the phone, rendered by the same runtime as desktop.
4. As a user, I can send a prompt / drive an agent session from the phone.
5. As a user, I can view/edit a strategy file in the mobile editor.
6. As a user, the app is branded Auracle end-to-end (name, icon, colors, copy) with no "Nimbalyst" left.
7. As a user, I get push notifications for agent/session events (APNs already wired).
8. As the owner, I can build, sign, and ship it under my Apple Developer team.

## Implementation decisions

- **Track A (identity), sequenced to avoid blind-rename compile risk (no build env here):**
  - Safe string/config first: app display name, permission copy, `@nimbalyst/ios`→`@auracle/ios`, privacy link, demo/test data. (display name + permission copy DONE.)
  - Keep **internal Swift module names** (`NimbalystNative`/`NimbalystApp`) initially — mirror the desktop precedent of keeping `zed::` internals; rename is a later mechanical ripple once buildable.
  - `NimbalystColors`→`AuracleColors` is a symbol-ripple (~25 files) — do as one atomic replace_all when buildable; values already = `#60A5FA`.
  - Bundle id, URL scheme, and Apple team are **coordinated with Track B** (the scheme + callback get redesigned for Clerk) — do them in the auth slice, not as loose cosmetic edits.
- **Track B (spine):**
  - **Auth:** replace `AuthManager` Stytch flow with Clerk — reuse the hosted Clerk page (`accounts.auracle-engine.com/sign-in`) via `ASWebAuthenticationSession` + `auracle://auth/callback`, and/or the engine's `/auth/*` device flow (`clerk_session.py`); verify offline via JWKS as elsewhere. Move the JWT off the WS query param into a header (prior "no secrets in URLs" rule).
  - **Data spine:** replace `SyncManager`/`DocumentSyncManager`/CollabV3 with a client to a **new engine-side mobile surface** — sessions/transcripts over the engine (WebSocket `/ui/api/.../ws` or REST polling). This is engine work (Houston) + iOS data-layer rewrite. E2EE drops (or is redesigned) since there's no desktop peer sharing keys; the engine is the trusted source over an authenticated channel.
  - **Remote access:** the engine is `127.0.0.1:1969`; the app needs a secure path — same-LAN bind, a tunnel (Tailscale/Cloudflare), or the future cloud tier. This is a prerequisite, tracked separately.
  - **Agent/voice:** point model list + execution at the Auracle Agent (Anthropic) via the engine; the OpenAI-Realtime voice path is desktop-key-dependent → gate off or re-architect against an engine-mediated path.

## Testing decisions

- Keep the existing Swift test suites green (~68 tests: Database/Crypto/Sync/ModelLabel/…) as the acceptance harness through the rebrand; update `CryptoCompatibility` vectors only if the salt namespace changes (avoid).
- Track B: unit-test the new engine-client data layer (session/transcript mapping) at the view-model seam, mirroring the desktop panels' pure-helper test style.
- All builds/signing/simulator runs happen in Xcode on the owner's Mac (cannot be verified headless in this environment).

## Owner inputs required (blocking)

1. **Apple Developer Team ID** — replaces nimbalyst's `DEVELOPMENT_TEAM: X8S24QHAT9`.
2. **Bundle identifier** — e.g. `com.auracle.app` vs `com.aurapointcapital.auracle` (permanent App Store identity).
3. **PostHog decision** — repoint to an Auracle PostHog project key, or remove analytics (currently ships nimbalyst's key `phc_s3lQ…`).
4. **Remote-engine access model** for Track B — LAN, tunnel, or cloud (decides how the app reaches the engine).
5. Xcode 16 + Mac + provisioning to build/sign/ship (TestFlight/App Store).

## Out of scope

Hosted CollabV3 sync server; Stytch; desktop QR-pairing/mirror model; Android (follows iOS); the full cloud tier.
