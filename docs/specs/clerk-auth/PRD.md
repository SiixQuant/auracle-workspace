# PRD — Auracle Authentication & Subscription Gating (Clerk)

> Status: approved-pending. Synthesized from the 2026-07-04 grill/design session
> (docs-grounded against Clerk's own documentation). Supersedes the dropped
> Stytch + self-run-HQ plan.

## Problem Statement

A user cannot reliably sign in to Auracle or prove their paid subscription:

- The IDE's sign-in is email-magic-link only and **doesn't deliver** (no email
  transport is configured on the engine), so it looks like it works but no code
  ever arrives.
- There is **no shared identity** across the launcher, the IDE, and the planned
  web + mobile apps — the roadmap is all four surfaces working and syncing
  together, but today each is an island.
- There is **no way to unlock live trading by paid tier** without either
  shipping secrets inside the app (which any customer could extract to mint
  themselves an Enterprise entitlement) or standing up and babysitting bespoke
  identity/billing infrastructure.

The owner's hard requirement: the **fewest steps and least ongoing operations**
possible — "drop in and forget."

## Solution

**Clerk becomes the single hosted authority for identity *and* billing.** The
user signs in once — with Google or email — through Clerk's hosted page opened
in the system browser. The local **Houston** engine holds **one session** that
both the launcher and the IDE read, verifies Clerk's token **offline**, and
unlocks **live trading** according to the user's **plan** (tier). Subscriptions
are flat tiers managed in Clerk Billing; the paid entitlement is delivered
**invisibly** as a claim in the token — there is no license key to paste.

Because Clerk hosts login, billing, and user management, Auracle runs **no
always-on server of its own**, wires **no Stripe** by hand, and **ships no
secrets** — the apps and engine hold only public values (an OAuth Client ID /
publishable key and the issuer URL). The same Clerk identity powers the future
web and mobile apps, so all surfaces share one account and can sync.

## User Stories

1. As a new user, I want to sign in with Google in one click, so that I don't have to create or remember another password.
2. As a user without a Google account, I want to sign in with my email, so that I can still get in.
3. As a user, I want to sign in once and be recognized in *both* the launcher and the IDE, so that I never log in twice.
4. As a user, I want to start sign-in from the launcher (the app I open first), so that setup flows naturally from the front door.
5. As a user, I want the sign-in page to open in my normal web browser, so that it looks and behaves like every other app I sign into.
6. As a user, I want to land back in the app automatically after signing in, so that the hand-off is seamless.
7. As a user, I want to see which plan/tier I'm on inside the app, so that I know what I've paid for.
8. As a paying user, I want live trading to unlock automatically when I sign in, so that I never paste or manage a license key.
9. As a free (Community) user, I want backtesting and paper trading to keep working without an account, so that I can evaluate the product first.
10. As a user whose internet briefly drops, I want my running live strategies to keep operating, so that a connectivity blip never harms my open positions.
11. As a user who has been offline a long time, I want the app to re-verify my entitlement when I reconnect, so that access stays honest without nagging me constantly.
12. As a user, I want to sign out, so that I can hand the machine to someone else safely.
13. As a subscriber, I want to upgrade or downgrade my plan, so that my access changes to match what I pay for.
14. As a user who cancels, I want live trading to lapse at the next check, so that billing and access stay consistent.
15. As a security-conscious user, I want no secret keys stored in the desktop apps, so that a stolen laptop can't be used to forge entitlements.
16. As the owner, I want no customer to be able to self-mint a higher tier, so that revenue is protected.
17. As the owner, I want to run no always-on server of my own for auth, so that operations stay near-zero.
18. As the owner, I want billing and identity in one dashboard, so that I have the fewest systems to manage.
19. As the owner, I want to define my tiers and prices in one place, so that changing pricing is a dashboard edit, not a deploy.
20. As a future web-app user, I want the same account to work on the website, so that my identity is continuous across surfaces.
21. As a future mobile user, I want the same account on my phone, so that my sessions and data sync.
22. As an enterprise buyer (future), I want to sign in with my company's SSO (SAML/OIDC), so that Auracle fits our identity policy.
23. As a team lead (future), I want to invite teammates under one organization, so that we collaborate under a shared plan.
24. As a user, I want a clear message if sign-in fails, so that I know whether to retry or check my connection.
25. As a user, I want the sign-in window to confirm success and tell me to return to the app, so that I'm not left wondering if it worked.
26. As a user on a fresh install, I want to reach paper trading and backtests before signing in, so that the account is never a wall in front of evaluation.
27. As the engine, I want to verify the user's token without calling out to the internet on every check, so that gating is fast and works offline.
28. As the engine, I want to reject a tampered or expired token, so that only genuine entitlements unlock paid features.
29. As a returning user, I want my session to refresh silently, so that I stay signed in for a long time without re-authenticating.
30. As a user with an unpaid account, I want to be told how to subscribe when I try to go live, so that the upgrade path is obvious.
31. As the owner, I want Clerk to send the sign-in emails, so that the old "no mailer configured" problem disappears.
32. As a user, I want my token stored securely (OS keychain), so that it isn't sitting in plain text on disk.

## Implementation Decisions

**Identity/billing authority.** Clerk is the single hosted authority for login,
user management, and subscription billing (Clerk Billing, Stripe under the
hood). Auracle runs no HQ, no Stripe integration on the engine, and ships no
secret keys. Apps/engine hold only public values: an OAuth **Client ID** /
publishable key and the Clerk **issuer** (Frontend API) URL.

**Desktop sign-in transport.** Desktop surfaces do **not** embed Clerk (Clerk
has no official Electron support, and packaged Electron disables cookies/storage
on the app's custom scheme). Instead they use a Clerk **OAuth Application** with
**Authorization Code + PKCE (S256)** and a **`127.0.0.1` loopback** callback
(RFC 8252), opening the hosted sign-in in the **system browser**. The interim
hosted page is Clerk's Account Portal; it swaps to the branded website sign-in
later with **no desktop rework** (same mechanism, different URL).

**PKCE flow (from the working prototype — the decision-bearing shape):**
```
1. code_verifier = base64url(32 random bytes); code_challenge = base64url(SHA256(verifier))
2. start loopback http server on 127.0.0.1:0 (OS-assigned port); generate `state`
3. open browser → {issuer}/oauth/authorize?response_type=code&client_id&redirect_uri=
      http://127.0.0.1:{port}/callback&scope=profile email offline_access&
      code_challenge&code_challenge_method=S256&state
4. loopback catches ?code (+ state, checked against expected → CSRF guard)
5. POST {issuer}/oauth/token (grant_type=authorization_code, code, redirect_uri,
      client_id, code_verifier) → { access_token, refresh_token, expires_in }
6. store tokens in the OS keychain
```
Token lifetimes (Clerk): access **1 day**, refresh **never expires**, auth code
10 min → silent refresh whenever online; graceful offline.

**One shared session, engine-held.** The app that initiates sign-in runs the
PKCE flow (it can open a browser + bind a loopback; the containerized engine
cannot) and hands the resulting token to Houston. Houston stores it encrypted as
**the** session and exposes signed-in state + plan to *both* apps, so signing in
on the launcher makes the IDE signed-in too. This reuses the engine's role as
the local source of truth.

**Offline-verifiable gating.** Houston verifies the Clerk token against Clerk's
**JWKS** (`{issuer}/.well-known/jwks.json`), checking signature, `exp`/`nbf`,
and `azp`. The token is the offline-verifiable **identity proof**; the **plan**
is resolved and cached, and live trading unlocks if the plan qualifies. The
last-known plan is cached so a connectivity blip never kills a running strategy,
and is re-verified on reconnect.

**Identity + plan resolution — RESOLVED by the live spike (2026-07-04).** The
Clerk **OAuth-application access token is minimal by design** — it carries
`sub`, `iss`, `azp`, `exp`/`iat`/`nbf`, `jti`, `scope`, and **no email and no
plan**. (Clerk **JWT-template custom claims**, which could embed the plan, apply
only to **session tokens** obtained via the frontend SDK on a real web origin —
not to OAuth-app access tokens, and not available in packaged Electron.) So the
resolver is two steps, both **secret-free**:
1. **Verify** the access token against JWKS (RS256, offline) → genuine + unexpired
   + correct `azp`. Yields the stable `sub`.
2. **Resolve** `email` + `plan` from **`{issuer}/oauth/userinfo`**, called with
   the **Bearer access token only (no secret)**. userinfo returns claims per
   granted **scope**; the OAuth app must grant **`email`** (→ email) and
   **`public_metadata`** (→ `public_metadata.plan`). The plan is cached
   last-known for offline gating.

Because Clerk Billing does **not** auto-mirror the subscribed plan into
`public_metadata`, a **scale-to-zero webhook function** (Cloudflare Worker /
Vercel fn) is the source of the plan value: on Clerk Billing `subscription.*`
events it writes `public_metadata.plan` via the Clerk Backend API — the Clerk
**secret lives only in that function, never in the shipped app or engine**
(**DECIDED 2026-07-04: build the webhook now**, not deferred; it is the only
piece of standing infra in the whole design, event-driven and scale-to-zero, so
ops stay near-zero). The function verifies the Clerk webhook signature (Svix)
and is idempotent per event id. Manual Dashboard editing of `public_metadata`
remains the trivial fallback for the owner's own account during development.
Reading `has()`/the Billing Backend API directly from the app is rejected — it
requires the secret key, which cannot ship. The future branded web app collapses
even this:
its frontend-SDK session token auto-carries the billing `pla` claim, minted via
a JWT template and handed to the desktop over the same loopback — no sync, no
function. Same single engine resolver either way.

**Subscription model.** Flat tiers (Community $0 → Pro → Institutional →
Enterprise) defined in Clerk Billing; the paid entitlement is the plan value in
the token (invisible license, no pasted key). Live trading is the primary gated
capability. Metered billing is reserved for hosted cloud compute (future).

**Engine integration seams (existing, reused).** Auth routes live under the
already-CSRF-exempt `/auth/*` surface, served in all web profiles. New user
identities are upserted idempotently through the existing passwordless
account-creation path; the default tier for a brand-new signed-in user with no
subscription is **community**. The live-trading gate reuses the existing
entitlement-gate seam — it is simply fed the Clerk-derived plan instead of the
prior Ed25519 entitlement.

## Testing Decisions

Good tests here assert **external behavior at the fewest, highest seams** — a
token/identity in, an allow/deny + resolved plan out — never the internals of
the OAuth dance or Clerk's SDK.

**Seam 1 (engine, primary): `resolve_plan_from_clerk_token(token) → {email, plan, valid, offline}`.**
One pure function that both the live-trading gate and the shared auth-state
endpoint call. Test with fabricated tokens signed by a test key served from a
fake JWKS: valid token → correct email+plan; expired/tampered/wrong-`azp` →
rejected; unreachable JWKS with a cached plan → last-known returned as
`offline`. This is the single most important seam and mirrors the existing
signed-JWT (Ed25519 entitlement) verification already in the engine, plus the
device-flow tests, as prior art.

**Seam 2 (desktop): `acquire_clerk_token(issuer, client_id) → tokens`.**
The PKCE + loopback flow tested against a **mock** OAuth authorize/token server
(no real Clerk). Prior art: the working `clerk-pkce-spike.mjs` self-test already
proves PKCE generation, loopback capture, and the `state` CSRF guard.

**Seam 3 (gate, existing): live-trading gate allows iff the resolved plan
qualifies.** Reuse the existing entitlement-gate test surface, feeding it the
Clerk-derived plan.

Only these three seams need coverage; everything else is Clerk's or the OS's
responsibility.

## Out of Scope

- The **dropped Stytch + self-run HQ** plan (secrets-at-HQ, engine-brokered
  Stytch) — abandoned; nothing was built.
- **Web app and mobile app implementations** — future; they use the same Clerk
  identity and the same engine-verification seam, but their UI is not built
  here.
- **Enterprise SSO (SAML/OIDC)** and **teams/organizations** — future Clerk
  capabilities, additive on top of this.
- **Metered billing** for hosted cloud compute — future.
- **Retiring the existing Ed25519 entitlement issuance** — kept as-is for now;
  may be simplified once Clerk gating is proven.
- **Branded website sign-in** (custom domain) — the interim uses Clerk's Account
  Portal; branding is a later swap with no desktop rework.

## Further Notes

- **Roadmap context:** Auracle = desktop + web + mobile, all synced. This
  confirms the multi-surface cloud product and makes Clerk (first-party web +
  mobile, desktop delegates to hosted sign-in) the right fit. The Yjs/CRDT sync
  machinery already present in the fork keys off the shared Clerk identity.
- **Docs-verified mechanism:** Clerk officially supports the OAuth-App + PKCE +
  loopback pattern for CLI/desktop apps; this is a paved road, not a hack.
- **Proven already:** the PKCE + loopback + CSRF-state plumbing self-test passes
  (`scratchpad/clerk-pkce-spike.mjs`).
- **Owner setup (public values only):** create a Clerk OAuth Application (public
  client + PKCE, redirect `http://127.0.0.1/callback`, scopes
  `profile email public_metadata offline_access` — `email`+`public_metadata`
  are what let the engine read identity+plan from userinfo secret-free,
  `offline_access` yields the durable refresh token); enable Google; create
  Clerk Billing plans; send the Client ID + Frontend API URL. The Secret key is
  never shipped (needed only inside the optional billing-sync webhook function).
- **Live-proven (2026-07-04):** full OAuth+PKCE+loopback round-trip against the
  real Clerk instance succeeded with **client_id only (public client)** and
  returned an access token + never-expiring refresh token. The access token is
  minimal (no plan); plan resolution is `userinfo → public_metadata` per the
  Implementation Decisions. Spike: `scratchpad/clerk-pkce-spike.mjs` (now also
  probes userinfo + JWKS).
- **Phasing:** P1 desktop PKCE sign-in (spike → IDE Account panel) → P2 engine
  JWKS verify + `userinfo` identity/plan resolution + offline last-known cache +
  live-trading gate → **P2.5 Clerk Billing plans + subscription→`public_metadata`
  webhook function (built now)** → P3 launcher sign-in + engine shared session →
  P4 in-app upgrade/checkout hand-off → later: enterprise SSO, teams, web,
  mobile. P2 is built and tested against the engine resolver seam with
  fabricated `userinfo` payloads, so it does not block on P2.5 being live.
