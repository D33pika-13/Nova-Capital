# Implemented API contracts — client and portfolio workflows

These source contracts are locally tested through services and real PostgreSQL RLS. They are not evidence of cloud deployment or live Supabase integration.

## Selected authentication entrypoints

Authentication is selected server-side by `AUTH_PROVIDER`. Entra mounts POST `/auth/entra/start`, `/auth/entra/recover`, `/auth/entra/logout` and GET `/auth/entra/callback`, with strict configured Origin/Host, empty initiation bodies and private responses. Unsupported GET/POST actions or Entra routes under Supabase return 404; other HTTP methods use framework method rejection. `/api/auth/mfa` dispatches to the selected controller; Entra accepts the strict actions detailed below. `/api/auth/login|reset|password` reject Entra credential actions with `BROWSER_AUTH_REQUIRED` before parsing the body. `/api/auth/logout` performs local Entra sign-out; native browser logout additionally initiates provider sign-out. The legacy `/auth/callback` cannot exchange Entra credentials. Provider and application sign-out completion remain distinct.

Conditional login/reset/MFA/logout pages and MFA-admin `/admin/security` use the matching controller. Historical unmounted/unselected qualifiers in the component sections below are superseded by this mounted source contract. Actual tenant/browser/mail and hosted lifecycle completion remain unverified.

## Identity, validation and errors

Every administrative operation requires an active application admin and verified MFA. Client identity is resolved from the verified session. `INV-1001` is a display/search identifier, not an authorization credential. Administrative `clientId` parameters contain the internal client UUID. Client portfolio reads accept no caller-selected identity.

Mutations require Origin to match APP_URL exactly. Local defaults consistently use `http://127.0.0.1:3000`; when changing host/domain, update APP_URL, Supabase site URL and callback allowlists together. Do not mix localhost and 127.0.0.1 in a session.

## Authentication callbacks

`GET /auth/callback` accepts one authorization `code` or one `token_hash` with `type=invite|recovery`. Mixed modes, duplicate/unknown parameters, empty/oversized credentials, whitespace/control characters and unsupported destinations fail before rate-limit/provider calls. The encoded query is limited to 4096 characters and credentials to 2048 ASCII token characters. Optional `next` is exactly `/password` or `/portal`; invitation/recovery links always lead to password setup. Optional `sb_flow_id` is accepted only for code exchange, with the installed Supabase SDK's 8–64-character alphanumeric/underscore/hyphen shape. Its exact verifier slot is used; a missing slot never falls back to a different flow's verifier.

The class-driven callback service consumes shared limits (100 callbacks/minute globally and five per credential fingerprint/15 minutes) before the provider adapter. Database limit keys contain SHA-256 fingerprints, never raw codes/hashes or callback URLs. The provider must return a session and matching user; protected operations still independently verify current identity, application role/status and admin MFA. Callback success itself grants no application role or financial access.

Responses are 303 redirects to the configured APP_URL with private/no-store caching and `Referrer-Policy: no-referrer`. Failure redirects uniformly to `/login?error=link` without provider payloads, query credentials or an account-existence detail. Configure ingress/access-log redaction to exclude callback query strings; response headers do not erase upstream logs. Invitation/reset completion, expiry/replay, cookie persistence and parallel real-browser flows remain live-provider gates. This callback boundary does not implement Entra federation or trust arbitrary OIDC claims.

JSON input is bounded and unknown fields are rejected. Responses are private/no-store. Error bodies contain a safe `error` and `code`: 401 unauthenticated, 403 forbidden/MFA/origin, 409 conflict/stale version, 422 invalid values, 429 limits, 503 unavailable/uncertain external operation. No provider errors or secrets are returned.

## Administrative client operations

| Method/path | Input / behavior |
|---|---|
| GET `/api/admin/clients` | Optional `query`, `status` (all/active/suspended/deactivated), `offset`; returns at most 50 records. Search treats input literally. |
| POST `/api/admin/clients` | `requestId`, `displayName`, `email`, optional exact `clientId` in INV format. Otherwise assign a unique number, skipping existing manual IDs. Creates a client record without sending email. |
| GET `/api/admin/clients/:id` | Return the client record, identity-link state and latest email-request state. |
| PATCH `/api/admin/clients/:id` | `requestId`, `displayName`, `status`, `expectedUpdatedAt`. The full-precision returned timestamp is an optimistic concurrency token. Login email, role, client ID and identity mappings are not editable through this operation. |
| GET/POST `/api/admin/clients/:id/notes` | Read private admin notes or append `requestId`, `note`. These notes are excluded from client portfolio DTOs. |
| POST `/api/admin/clients/:id/invitations` | `requestId`, `purpose` (setup/reset), optional `acknowledgeDuplicateRisk`. Recipient always comes from the client record. |

Invitation preparation creates/reuses the provider identity, verifies its association, then sends a server-generated one-use setup/reset link through SMTP. Application tables/audits never store that link. Public signup remains disabled.

Invitation states: pending -> processing -> accepted/failed/unknown. Accepted means SMTP accepted the message, not delivered/read. Replaying the same accepted/uncertain request does not send again. Known preparation failure may retry with the same request ID. An uncertain request requires an explicit new request and duplicate-risk acknowledgement; a fresh processing request cannot be resent. After ten minutes, an unresolved processing request may be explicitly retried with acknowledgement. Lost responses must first be retried with the same key. Provider invitation/reset link expiry and replay protection remain subject to live integration verification.

## Financial operations

| Method/path | Input / behavior |
|---|---|
| POST `/api/admin/investments` | `requestId`, internal `clientId`, `assetClass`, `description`, `currency`, `investedAmount`, `reportedValue`, `reportedAt`. |
| PATCH `/api/admin/clients/:id/investments/:investmentId` | `requestId`, `expectedVersion`, asset/description/amount/value/date fields and client-visible `correctionReason`. Ownership, currency and original creator remain immutable. |
| POST `/api/admin/clients/:id/investments/:investmentId/archive` | `requestId`, `expectedVersion`, client-visible `reason`. Archives rather than deletes; archived records cannot be edited. |
| POST `/api/admin/snapshots` | `requestId`, internal `clientId`, `currency`, nullable `adjustedBasis`, `reportedValue`, `basisExplanation`, `reportedAt`, optional paired `correctionOf` and `correctionReason`. |
| GET `/api/admin/clients/:id/portfolio` | Client holdings, revisions, snapshot history, separate-currency summaries and allocation. |
| GET `/api/portal/portfolio` | The same client-safe reporting view for the verified account only; rejects query-selected identities. |

Amounts are decimal strings, at most 16 integer digits and four fractional digits; numeric JSON, exponents, commas, negatives and excessive precision are rejected. Stored values and calculations retain four decimals. Supported initial valuation currencies are INR, USD, EUR, GBP, AED, JPY, CAD, AUD, CHF and SGD, configured in `src/lib/portfolio-inputs.ts`. Asset classes are stocks, forex, commodities and crypto.

Reporting timestamps must be ISO datetimes, no more than millisecond precision, and cannot be future dates. API offsets normalize to UTC. The UI explicitly uses UTC. Snapshot corrections retain client, currency and reporting date; append a new snapshot for a different observation date. A correction supersedes the previous observation without deleting it. Duplicate original dates and multiple corrections of the same predecessor are rejected. Corrections can themselves be corrected.

P/L = reported value minus recorded adjusted basis. Return = P/L / adjusted basis * 100; a missing/nonpositive basis yields no percentage. Missing basis also yields no P/L. This is a simple, non-annualized return, not a time- or money-weighted return. Currencies are never aggregated together. Holding allocation uses active holdings at their individual reporting dates and is distinguished from portfolio snapshots. A holding edit does not automatically assert a new portfolio value.

## Idempotency, concurrency and history

Each financial/client write includes a UUID `requestId`. A successful replay with the same actor/key/action/payload returns the committed result. Reusing the key for different input returns 409. The idempotency record, mutation, audit and investment revision commit atomically; failures roll back together. Changed client versions or investment versions produce 409 rather than overwriting another change.

Frontend forms retain the same key for the same in-flight/retried submission; a new logical operation gets a new key. Idempotency is per request, not a promise that independently created requests represent the same business action.

Investment revisions are append-only and client-isolated. Financial audit rows include the acting admin. Admin dashboard counts and activity come from stored records. Empty client accounts show no fabricated balances or returns. The chart uses the latest 100 effective snapshot points per currency, with exact full history in tables; floating-point conversion is used only for chart positioning, never financial calculations.

## Private report operations

See `private-reports.md` for the implemented raw-PDF upload, quarantine/publication, immutable original-file storage, business-date timezone, archive and authorized-download contracts. Report JSON uses an explicit allowlist and excludes storage paths, provider details, content hashes and credentials. The storage interface supports configuration verification, immutable put-if-absent, bounded checksum reads, short-lived attachment links and cleanup of failed unpublished objects.

## Offer content

`GET /api/admin/offers` lists up to 200 offers, newest start first. `POST /api/admin/offers` creates; `POST /api/admin/offers/:id` edits. All require an active admin with MFA; mutations also require the configured Origin. Bodies contain `requestId` (UUID), title (200 characters), description (5000), category (`member`, `promotion`, `travel`), eligibility (5000), terms (10000), startsAt/endsAt (ISO instants with offset), and status (`draft`, `published`, `expired`). Edit bodies require `expectedVersion`. All text is required. The end must follow the start, and an already ended offer cannot be published. Dates normalize to UTC.

Saves are transactional, audited and idempotent per actor/submission key. Changed payloads under a reused key and stale versions return 409. Ownership is immutable. The public `/benefits` page reads only published offers whose start is at or before the database clock and whose end is after it. Expiry visibility works independently of maintenance. Draft status unpublishes. HTML is rendered as escaped text. Offer images use the dedicated workflow below. Announcements and expiry maintenance are described below; hosted scheduler verification remains pending.

## Private announcements

MFA-admin routes: `GET /api/admin/announcements?offset=0`, `POST /api/admin/announcements`, `POST /api/admin/announcements/:id`. Create/edit bodies are strict objects with `requestId` UUID, `title` (1–200 characters), `body` (1–5000), `status` (`draft`, `published`, `archived`), and `clientIds` (1–200 distinct internal client UUIDs). Edits additionally require `expectedVersion`. Recipients must be client profiles; status enforcement still blocks suspended/deactivated users. Saving updates the parent, recipients and audit evidence atomically. Submissions are idempotent; changed payloads under a reused key and stale edits return 409.

Client-only routes: `GET /api/portal/announcements?offset=0` and `POST /api/portal/announcements/:id/read`. Read bodies contain `requestId` UUID and `expectedVersion`. Acknowledgment is intrinsically idempotent for that notice/version and never changes another client's state. The server clock records read time. Changed, hidden or unavailable notices return the same 409 response. Clients cannot submit a client identity, edit the notice, change membership, forge timestamps or acknowledge a future version. All mutation routes require the configured Origin. Responses are private/no-store.

Lists return at most 50 entries and accept only an integer offset from 0 to 1000000. Management DTOs include selected recipients and their read versions; client DTOs include only the notice and the caller's receipt. Read status means `readVersion === version`. Every saved edit creates a new version. See `announcements-and-maintenance.md` for behavior and verification limits.

## Offer maintenance

`POST /api/admin/maintenance` requires the configured Origin and active admin MFA. `POST /api/maintenance` uses a server-side Bearer scheduler credential instead of cookie authorization. Both return `{expiredOffers, batchLimit: 500, mayHaveMore}`. The scheduled endpoint requires a configured secret and external mode in staging/production. Local mode with a secret is available only in development/test. No caller-supplied identity or expiry timestamp is used. The narrow database operation expires only already-ended published offers, retains audit history and is safe to repeat.

## Offer images

`POST /api/admin/offers/:id/image` requires active admin MFA and the configured Origin. It accepts raw PNG/JPEG bytes with matching Content-Type (up to OFFER_IMAGE_MAX_BYTES, maximum 5 MiB). `X-Image-Metadata` is percent-encoded JSON containing `requestId` UUID, `expectedVersion` positive integer and `alt` (1–200 characters); headers are capped at 8192 characters. Unknown fields and caller-selected object paths are rejected. The service scans, decodes/normalizes, scans the output, reserves an immutable private object and verifies readback before atomic attachment. It returns `{offer, current}`. `current=false` on a completed replay means a later image change exists; the old image is never restored.

`GET /api/admin/offers/:id/image` is an MFA-protected preview. `POST /api/admin/offers/:id/image/remove` requires Origin/admin MFA and JSON `{requestId, expectedVersion}`. Removal detaches without deleting history. `GET /api/offers/:id/image` is public only for the currently attached image on a current published offer. It never uses the caller's privileged session. Both GET routes accept an optional `version` query containing the expected image UUID; a superseded ID returns 404 so an older page cannot display a replacement under stale alt text. Both return checksum-verified WebP bytes with no-store; paths, storage tokens and signed URLs are never serialized.

Image changes advance offer versions. Stale/changed submissions return 409; unavailable public images return 404; input/decoder rejection returns 422; rate limits return 429; scanner/storage/processor outages fail closed. See `offer-images.md` for limits, retry/cleanup semantics, setup and outstanding live verification.

## Public contact

`POST /api/contact` requires the configured Origin and explicit CONTACT_ENABLED. The strict JSON body (at most 24,000 bytes) is `{requestId, name, email, topic, message, consent, website?}`. Name is 1–150 characters without newlines; email is a valid address (254 max); topic is `general`, `account`, `reports`, or `other`; message is 10–5000 characters; consent must be true; the optional website bot trap must be empty. Caller-supplied recipient, headers, client/network identity or other fields are rejected.

The server derives trusted network context from the configured ingress header, HMACs private payload/rate identifiers, applies shared limits, and atomically claims a send before using the fixed support recipient. It returns `{reference, status, message}` with HTTP 200 for `accepted` or 202 for `processing`/`unknown`, always private/no-store. New-send limits do not cause an existing claim to send again. Validation, conflict, limit and service errors return 422/409/429/503 respectively. Replaying the same key with changed normalized content or destination is a conflict.

The browser retry uses the same body/key. A processing or uncertain claim is never reclaimed automatically; accepted status is immutable. Only service acceptance is reported, never inbox delivery or a response. See `contact-workflow.md` for exact limits, trusted ingress, privacy, timeouts, secret rotation and staging gates.

## Support and chat

`GET /api/support` returns `{audience, mode, viewerKey?}` for the verified current account; an unconfigured shell is public FAQ-only. `POST /api/support/public` accepts only `{message}` (1–2000 characters) and never reads a private identity, even with session cookies. `POST /api/support/messages` requires an active client and strict `{requestId, sessionId?, message}`; sessionId defaults to null to create a new chat. No role, client ID, tool operation, provider instructions or arbitrary history is accepted. Common credential/token patterns are rejected. JSON bodies are bounded to 10,000 bytes and every mutation requires APP_URL Origin.

Client-only `GET /api/support/sessions?offset=0` returns twenty own sessions per page; `GET /api/support/sessions/:id` returns at most one hundred ordered own message rows. `POST /api/support/sessions/:id/clear` clears current content and makes late/replayed turns unavailable. New chats are created by the first claimed message, not by GET requests. Clear is repeatable and preserves a minimal tombstone/digest ledger. Responses are private/no-store. Unknown/foreign/cleared sessions return 404; pending/changed/full/interrupted requests return 409; invalid input 422, limits 429 and unavailable dependencies 503.

A completed send returns `{sessionId, requestId, reply, createdAt}`. Reply contains plain text, approved application links, mode (`ai`, `faq`, `fallback`), topic IDs and optional currency. It contains no raw provider result, secret, signed file URL or storage path. Mode `ai` means model-guided topic selection; the server renders financial facts. Questions/history are scoped from verified session context. Prior topics are read server-side from the same conversation. See `support-assistant.md` for state, quota, privacy and verification contracts.

## Entra MFA service boundary (not mounted)

`EntraMfaService.prepare(sessionToken)` derives the active admin profile from the opaque session proof, then returns either enrolled status/factor ID or a local provisioning URI for recent-primary enrollment. `verify(sessionToken, code, recovery=false)` accepts a six-digit TOTP or an explicitly selected formatted recovery secret. It commits one-use proof verification and token rotation before returning a replacement cookie token and original expiry; ten plaintext recovery codes return only on initial committed enrollment. Tokens, provisioning secrets and recovery codes must never appear in telemetry or cacheable responses.

These are server-internal methods. The unmounted `EntraMfaHttp` controller accepts same-Origin/Host POST requests at `/api/auth/mfa` with strict flat JSON: `{action:"setup"}`, `{action:"verify",code:"123456"}`, or `{action:"recover",code:"<formatted recovery code>"}`. It installs the replacement host-only secure cookie, cleans up known minted tokens on response-installation failure, delivers recovery codes only through private no-store JSON and returns safe errors. The mounted route still serves Supabase; Entra runtime/route/form composition remains incomplete. `EntraMfaForm` source supports manual setup and one-time code-save acknowledgement, pending browser verification. Self-service regeneration/removal are implemented in source under the same boundary: `{action:"regenerate"|"remove",method:"totp"|"recovery",code:"..."}`. Both require recent primary sign-in plus a fresh factor proof. Regeneration revokes prior realm sessions/codes and returns ten new codes with a replacement secure cookie; removal revokes all realm sessions, clears cookies and returns `{redirect:"/login",removed:true}`. No replacement session is minted after removal. The unmounted management form confirms removal and displays regenerated codes once. All-proofs-lost recovery and real response-loss/browser policy remain release gates; no automatic retry or email-only bypass exists. Entra provider selection remains disabled. See `azure-identity.md` for exact SQL ownership, attempt, expiry and assurance policies.

## Entra dependency composition (not selected)

`EntraRuntimeFactory.create(request)` returns request-bound identity/authorization plus shared browser-auth/MFA controllers and an immutable capability descriptor. Identity verification uses a copied incoming header snapshot and current SQL state, without Supabase or caller-claim fallback. Browser login/logout must use the HTTP controller; the common identity interface deliberately refuses password sign-in/headless logout and unimplemented reset/password lifecycle calls. No new public factory/raw-token endpoint or environment provider selection is exposed. `azure-identity.md` records composition tests and remaining runtime/lifecycle gates.

## Entra customer directory driver (not selected)

Internal methods `findByEmail(email)`, `getById(objectId,email)` and `createCustomer(email,displayName)` target fixed Microsoft Graph v1.0 users endpoints. Results contain only verified object ID, tenant/object subject and normalized email; Graph filter matching alone cannot attach an identity. Creation performs one POST then exact-ID identity readback. `ACCOUNT_CREATION_UNCERTAIN` means a write may have committed and must be reconciled before any further creation; there is no automatic retry, guest-invitation fallback or password exposure. This protocol driver has no public route and is not connected to the invitation service. The private leased provisioning service now orchestrates durable intent, read-only reconciliation and atomic stable mapping; the unselected account adapter supplies a fixed hosted-recovery destination and provider-specific invitation text. Runtime selection, public delegated recovery and real first-password/mail/tenant verification remain required; see `azure-identity.md`.

## Entra provisioning/invitation orchestration (not selected)

The invitation provider receives a server-derived `AccountInvitationContext` in addition to repository-owned email/subject/purpose. `EntraProvisioningService.prepare` requires current admin MFA, derives canonical client data from the locked database profile and uses private tenant/client/email-fingerprint leases. No caller-supplied recipient/provider identity authorizes creation. The one-use SQL start transition commits before Graph POST. Possible creation survives lease expiry as reconciliation-only state; email duplicate-risk acknowledgement cannot bypass it. Verified directory subject and ledger-ready state commit with the provider mapping. Existing mapped accounts use exact-ID verification for setup/reset rather than new account creation.

`PreparedInvitation.linkKind` is optional for legacy single-use links and explicitly `hosted_recovery` for Entra. Hosted messages direct recipients to the fixed application sign-in page and provider verification. `ACCOUNT_PROVISIONING_UNCERTAIN`, `DELIVERY_UNCERTAIN` and `INVITATION_TRACKING_UNCERTAIN` distinguish account preparation, unknown SMTP acceptance and known SMTP acceptance/unconfirmed tracking respectively. No new public provisioning/override endpoint is exposed. See `azure-identity.md` for retained uncertainty, ownership and live gates.

## Entra account factory (not selected)

The trusted factory's optional `directory` constructor group composes account provisioning/invitations for the already selected tenant. Request scopes return `accounts` plus an explicit `accountInvitations` capability; absent directory configuration returns null/false. Neither value authorizes an operation: callers use the scope's current admin MFA authorization through `InvitationService` and server-derived client context. `accountLifecycle` stays false until public hosted recovery/runtime routing is complete. No new endpoint, environment provider selection or browser credential surface is exposed.

## Entra hosted recovery entry (not mounted)

`EntraHttp.recover` accepts an empty same-Origin/public-Host `POST /auth/entra/recover` with no query/fragment/body parameters. It starts browser-bound PKCE with persisted recovery purpose and `prompt=login`. The callback consumes stored purpose through `completeFlow`; callers cannot select recovery via callback query fields. Verified recovery invokes committed own-realm identity-session revocation before a fresh aal1 mint, returning admins to MFA. No identity, code or role is taken from request-supplied profile fields.

The source form delegates email/password/verification entry to the provider. Responses/audits do not claim a password changed. Existing mounted password/reset routes remain Supabase-specific until runtime selection is implemented. Migration `20261111001300_entra_hosted_recovery.sql` is required; transaction expiry is decided after row-lock acquisition and legacy SQL consumers cannot drop recovery purpose. See `azure-identity.md` for scope and live gates.

## Entra browser provider sign-out (not mounted)

`EntraHttp.logoutBrowser` accepts empty same-Origin/public-Host `POST /auth/entra/logout`, revokes proven own-realm application sessions, clears secure session/binding cookies and returns a private 303 to the authority-approved `end_session_endpoint` with only fixed `post_logout_redirect_uri=<APP_ORIGIN>/login`. No caller redirect, email, hint or token enters that URL. Unconfirmed local revocation returns `LOGOUT_UNAVAILABLE` without a provider redirect. Confirmed local revocation followed by unavailable provider discovery/destination returns `PROVIDER_LOGOUT_UNAVAILABLE` with `applicationSignedOut:true` and cleared cookies.

The source native form is unmounted; the selected Supabase AJAX button remains unchanged. Initiation is not proof of provider completion or cross-application/federated logout. The exact return URI, account-picker behavior, browser cookie state and upstream revocation policy require live verification; see `azure-identity.md`.

## Maintenance run status

`GET /api/admin/maintenance` requires an active MFA admin and returns private/no-store operational evidence: `{observedAt,recoveryBoundaryAt,lastScheduledSuccessAt,lastScheduledFinishedAt,lastScheduledOutcome,lastScheduledExpiredOffers,lastAdminFinishedAt,state,staleAfterSeconds}`. Times are UTC ISO strings or null; outcome is `completed|failed|null`, count is 0–500 or null, and state is `never|failed|stale|backlog|current`. It accepts no caller-selected actor/task/time. The database independently authorizes the summary function. Raw ledger access is denied to the application role; error/provider details and actor identifiers are omitted.

`POST /api/admin/maintenance` and bearer-authorized `POST /api/maintenance` retain their batch response contract. Current repository execution records confirmed terminal outcomes, including zero-work batches. Ordinary inner SQL failure rolls back partial work/audits and commits safe failure history before `MAINTENANCE_FAILED` 503. Transport/cancellation/commit uncertainty is not reported as a known database failure. Freshness uses server database time and only scheduled rows started after the latest owner restore-quarantine audit. Apply migration `20261111001400_maintenance_history.sql` first; missing new functions fail safely rather than falling back to unrecorded maintenance.

## Withdrawal reporting (13 November 2026)

- `POST /api/admin/withdrawals`: active MFA-admin, same-origin, bounded strict JSON. Fields: `requestId`, `clientId` (internal UUID), `currency` (shared supported allowlist), positive exact `amount` (up to four decimals), `withdrawnAt` (ISO offset timestamp, up to millisecond precision, not future), `reference` (1–300 characters), optional paired `correctionOf` / `correctionReason` (1–1000 characters). Returns the recorded row with HTTP 201. Replays return the same row; changed payload keys, stale/competing corrections fail 409. Corrections preserve client and currency. No payment is executed and no snapshot is recalculated.
- `GET /api/portal/withdrawals`: active client, own identity from session only, no query parameters. Returns all own records with supersession flags. Admins are denied client API access. Anonymous requests fail 401, cross-client data stays hidden through RLS, and clients cannot insert/update/delete records.
- `POST /api/auth/change-password`: selected Supabase profile; active verified account and enrolled-factor AAL2 required. Strict `{password}` of 12–128 characters, shared attempt limits and Origin checks. Success signs out globally and directs to login. Existing invite/recovery password flow also enforces enrolled MFA.
- `POST /api/auth/mfa`: Supabase clients may prepare and verify their own authenticator factor using the existing strict `setup`/`verify` schema. Setup returns a transient QR/manual key only for an unverified factor; after confirmation the server requires AAL2 on protected requests. Admin MFA remains mandatory. No client role or caller-selected profile is accepted.
