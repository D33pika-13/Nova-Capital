# Functional requirements — NOVA CAPITAL

Status: implementation contract. These requirements describe intended behavior, not completed features.

## Actors and boundaries

Visitors access public content and FAQs. Active clients access only their own records. Active admins with MFA manage clients/content/financial records. Operators configure services and deployments. No website custody, payment gateway, live broker integration, trading execution, broker passwords or guaranteed returns.

## FR-WEB-001 — Public website

- **Actor:** Visitor. **Phase:** 9.
- **Behavior:** Responsive Home, About, Services, Markets, Benefits, FAQ, Contact, legal pages and login navigation. Company/logo/contact/social/legal settings are editable configuration. No invented results, testimonials or regulatory claims.
- **Acceptance:** All navigation works by keyboard and on mobile; published offers only; legal review status visible; contact validation and rate limits applied.
- **Failure handling:** Deny unauthorized access; validate before mutation; preserve committed history; return safe actionable errors without secrets.

## FR-AUTH-001 — Authentication and authorization

- **Actor:** Client / admin. **Phase:** 3.
- **Behavior:** Login/logout, invitation/password setup, password reset, secure sessions, protected routes and explicit server-side roles. Admin access requires MFA; no public self-registration.
- **Acceptance:** Invalid or expired credentials rejected; signed-out/revoked/suspended users denied; clients cannot call admin operations or supply another identity.
- **Failure handling:** Deny unauthorized access; validate before mutation; preserve committed history; return safe actionable errors without secrets.

## FR-CLIENT-001 — Client lifecycle

- **Actor:** Admin. **Phase:** 4.
- **Behavior:** Create and edit client profiles with unique INV identifiers; invite by email; search/filter; activate, suspend or deactivate. Financial and administrative fields are read-only to clients.
- **Acceptance:** Duplicate IDs rejected; invitation retries handled; status change enforced on next protected request; each sensitive action has actor/time audit evidence.
- **Failure handling:** Deny unauthorized access; validate before mutation; preserve committed history; return safe actionable errors without secrets.

## FR-INV-001 — Investment records

- **Actor:** Admin. **Phase:** 5.
- **Behavior:** Enter asset class, client, description, currency, invested basis, current manually reported value, valuation date and notes. Edit with audit history; archive rather than delete.
- **Acceptance:** Amounts are exact decimals; dates and ownership validated; all four asset classes supported; no destructive loss of financial history.
- **Failure handling:** Deny unauthorized access; validate before mutation; preserve committed history; return safe actionable errors without secrets.

## FR-SNAP-001 — Portfolio snapshots and returns

- **Actor:** Admin. **Phase:** 5.
- **Behavior:** Append dated portfolio values with explicit invested basis/cash-flow assumptions and currency. Preserve prior snapshots and correction reasons.
- **Acceptance:** Known calculation fixtures match; zero or missing basis yields no percentage; no mixed-currency totals; snapshot write and audit are atomic.
- **Failure handling:** Deny unauthorized access; validate before mutation; preserve committed history; return safe actionable errors without secrets.

## FR-PORT-001 — Client portfolio

- **Actor:** Client. **Phase:** 6.
- **Behavior:** Show own client ID/status, welcome, latest reporting date, basis, value, P/L, return basis, asset allocation, holdings, charts and update history from stored records.
- **Acceptance:** Client A cannot access B, including direct API requests; empty states contain no invented numbers; chart points match dated snapshots.
- **Failure handling:** Deny unauthorized access; validate before mutation; preserve committed history; return safe actionable errors without secrets.

## FR-REPORT-001 — Private reports

- **Actor:** Admin / client. **Phase:** 7.
- **Behavior:** Admin uploads report with client/period/date metadata and may archive it. Client lists and downloads only own non-archived reports from private storage.
- **Acceptance:** File size/type/signature and malware policy enforced; arbitrary paths rejected; unauthenticated/cross-client access denied; download links expire.
- **Failure handling:** Deny unauthorized access; validate before mutation; preserve committed history; return safe actionable errors without secrets.

## FR-OFFER-001 — Offers and announcements

- **Actor:** Admin / visitor / client. **Phase:** 8.
- **Behavior:** Manage drafts, publication/expiry, title, description, image, category, eligibility and terms. Target notifications to intended clients; track read status.
- **Acceptance:** Draft/expired content hidden; inclusive start/exclusive end boundaries use UTC; targeted notices isolated; repeated expiry runs safe.
- **Failure handling:** Deny unauthorized access; validate before mutation; preserve committed history; return safe actionable errors without secrets.

## FR-CHAT-001 — Support assistant

- **Actor:** Visitor / client. **Phase:** 10.
- **Behavior:** Floating responsive chat with timestamps, suggestions, loading/error/retry, new/clear chat and isolated history. Public FAQs; authenticated read-only answers about own records/reports and published offers.
- **Acceptance:** Facts match authorized database context; no caller-selected client identity; no admin notes; no trades/advice/writes; prompt injection cannot expand permissions; outages fall back transparently.
- **Failure handling:** Deny unauthorized access; validate before mutation; preserve committed history; return safe actionable errors without secrets.

## FR-CONTACT-001 — Human support

- **Actor:** Visitor / client. **Phase:** 9.
- **Behavior:** Validated, rate-limited contact request with configured recipient and confirmation/error state. Do not claim delivery before provider acknowledgement.
- **Acceptance:** Test mailbox receives expected fields; header injection rejected; no personal data logged; disabled/misconfigured email reports safe unavailability.
- **Failure handling:** Deny unauthorized access; validate before mutation; preserve committed history; return safe actionable errors without secrets.

## FR-CONFIG-001 — Configurable providers

- **Actor:** Operator. **Phase:** 1.
- **Behavior:** Validated server-side configuration selects adapters for identity, PostgreSQL, private storage, SMTP/email, AI, shared rate limits, monitoring, scheduling and secrets.
- **Acceptance:** Unsupported/missing settings fail closed; no secret in browser; hybrid profiles documented; selecting a provider never silently migrates data.
- **Failure handling:** Deny unauthorized access; validate before mutation; preserve committed history; return safe actionable errors without secrets.

## FR-DATA-001 — Data protection and audit

- **Actor:** Operator. **Phase:** 2.
- **Behavior:** PostgreSQL migrations, constraints, least privilege and deny-by-default RLS. Stable internal identities map to external auth subjects. Sensitive changes produce immutable audit history.
- **Acceptance:** Fresh migration applies; direct cross-client access fails; role/status spoofing fails; privileged credentials absent from browser; backup/restore rehearsed.
- **Failure handling:** Deny unauthorized access; validate before mutation; preserve committed history; return safe actionable errors without secrets.

## FR-AZURE-001 — Azure deployment profile

- **Actor:** Operator. **Phase:** 11.
- **Behavior:** Provider adapters and deployment configuration for selected Azure identity/database/blob/email/AI/secrets/monitoring services.
- **Acceptance:** Same provider contract and isolation suite passes on actual staging services before Azure support is advertised.
- **Failure handling:** Deny unauthorized access; validate before mutation; preserve committed history; return safe actionable errors without secrets.

## FR-RELEASE-001 — Operational readiness

- **Actor:** Operator. **Phase:** 12.
- **Behavior:** Separate environments, security checks, logs/alerts, migration/restore/rollback/incident runbooks, reviewed legal content and authorized deployment.
- **Acceptance:** Full staging journey passes; restore verified; production smoke check recorded separately; exact unresolved checks listed.
- **Failure handling:** Deny unauthorized access; validate before mutation; preserve committed history; return safe actionable errors without secrets.

## Cross-cutting requirements

- SEC-001: Server-side role/ownership checks and database isolation apply to every personal-data operation; client state is rechecked on protected requests.
- SEC-002: Admin MFA, secure sessions, CSRF protection, rate limits and secret redaction are mandatory.
- SEC-003: Uploaded reports remain private and must satisfy the configured malware-scanning policy before availability.
- NFR-001: Keyboard-accessible responsive UI with explicit loading, empty, success and error states.
- NFR-002: Class-based backend services/repositories/adapters with interfaces and constructor injection; idiomatic React function components.
- NFR-003: Each feature is tested locally and then in staging; neither test state implies production deployment.
- NFR-004: No silent insecure fallback; optional AI may fall back to approved FAQs with disclosure.

## Traceability and release evidence

| Requirement | Backend/UI area | Local verification | Staging verification |
|---|---|---|---|
| FR-WEB-001 | Public pages, configurable public branding/social links, shared FAQ and anonymous offers / phase 9 | `public-branding.test.tsx`, `public-faq.test.tsx`, `public-offers.test.tsx`, existing offer isolation tests; `verification/public-scope-browser.json` records the preceding public-shell browser scope | Published-provider benefits/images are verified by phase-8 browser/API evidence; enabled contact capture is separately verified. Company/legal review and complete release acceptance remain open |
| FR-AUTH-001 | Identity services, provider-selected auth pages/routes / phase 3 | `auth-service.test.ts`, `authorization.test.ts`, `auth-callback.test.ts`, `auth-callback-route.test.ts`, `provider-routes.test.ts`, `provider-pages.test.tsx`; synthetic provider sessions and callback exchanges. Separate `native/database.test.ts` covers native session/one-use/MFA database boundaries | Initial real Supabase admin MFA, client invite/setup/login/recovery, old-password denial, suspension and logout-cookie replay pass in `verification/free-staging-result.json`; broader expiry/outage/session/browser cases and Entra remain open |
| FR-CLIENT-001 | Client lifecycle / phase 4 | `client-workflow.test.ts`, `invitations.test.ts`, `reporting-journey.test.ts`; local database workflows, configured email subjects, invitation retry/denial and loopback SMTP boundaries | Prior admin UI/setup and the 125-check live client/finance increment verify exact search/filter, duplicate/stale/concurrent edits, existing-session lifecycle revocation/reactivation, atomic actors and one captured concurrent-invitation send. See `verification/client-finance-live-result-2026-11-14.json`; provider expiry/uncertain-send recovery and real company inbox delivery remain separate |
| FR-INV-001 | Portfolio service/repository and admin investment forms / phase 5 | `portfolio-workflow.test.ts`: exact decimals, revisions, archive, ownership/date validation and atomic audit; `native/database.test.ts`: duplicate submissions, competing corrections and isolation on real connections | Actual hosted four-asset writes, exact decimals, replay/conflict, competing edits, client/currency/date denial, archive/revision chains and verified actor audits pass in the 125-check `verification/client-finance-live-result-2026-11-14.json` increment. Operational load/recovery and release acceptance remain separate |
| FR-SNAP-001 | Snapshot writes, correction chains and financial calculator / phase 5 | `portfolio-workflow.test.ts`: corrections, currencies and zero/missing basis; `native/database.test.ts`: concurrent corrections, exact summaries and audit-failure rollback | Actual correction chains/competing successor, cross-client/currency/date denial, seven row audits, separate currencies, manual cash-flow bases and zero/missing basis pass in `verification/client-finance-live-result-2026-11-14.json`; wider load/recovery remains separate |
| FR-PORT-001 | Portfolio service, view and chart / phase 6 | `portfolio-workflow.test.ts`, `portfolio-ui.test.tsx`, `reporting-journey.test.ts`: isolated records and presentation with synthetic identities; native exact-summary checks are separate | Actual synthetic MFA-client/browser/API reconciliation now includes three effective dated USD chart points and matching tooltip, exact records/revisions, missing/zero basis, separate currencies and archive display; the 390-pixel portal has no root overflow. See `verification/client-finance-live-result-2026-11-14.json`; broader accessibility and operational acceptance remain separate |
| FR-REPORT-001 | Report service, private-storage adapters and upload/download UI / phase 7 | `report-workflow.test.ts`, `reports-ui.test.tsx`, `pdf-validator.test.ts`, `clamav-scanner.test.ts`, `storage-policy.test.ts`, `supabase-storage.test.ts`; separate `scanner/clamav.test.ts` uses real local ClamAV. Metadata policy fixtures and intercepted Storage HTTP are not hosted Storage | Actual private policies, clean UI upload/publication/download/hash, harmless EICAR rejection, signed-link expiry and cross-client/direct/public/suspension denial pass; exact Linux image, ongoing freshness, archive/quarantine/recovery and broader acceptance remain open |
| FR-OFFER-001 | Offers/images, announcements and maintenance / phase 8 | `offers.test.ts`, `offer-images.test.ts`, `announcements.test.ts`, `maintenance.test.ts`, `maintenance-history.test.ts`, associated UI tests; native maintenance rollback/history checks. `public-offers.test.tsx` verifies anonymous presentation | 67 actual Supabase/Storage/scanner/API assertions plus public-image and Client A announcement browser verification pass in `verification/phase8-live-result-2026-11-13.json`; authenticated admin editor/upload/search/publish/archive also pass in `verification/admin-browser-result-2026-11-14.json`; real direct-database Cron execution and expiry pass in `verification/database-scheduler-result-2026-11-14.json`, including the first normal-cadence tick at 19:00 UTC. Concurrent races, exact Linux image/freshness, alerts and wider load/recovery remain open |
| FR-CHAT-001 | Support planner, authorized fact retrieval and isolated history / phase 10 | `support-service.test.ts`, `chat-history.test.ts`, `openai-support.test.ts`, `azure-support.test.ts`, `support-ui.test.tsx`: synthetic/intercepted inference, database fact isolation, refusal/fallback/retry. Public-shell browser evidence is limited to its recorded scope | 56 live HTTP/database checks, hosted clear/late-finish concurrency, shared public throttling and public/client browser history/mobile/account-switch checks pass for AI-disabled staging in `verification/support-live-result-2026-11-14.json`. Real model/financial-tool/refusal/timeout, mid-inference authorization, wider quotas/history bounds and operational recovery remain unverified |
| FR-CONTACT-001 | Contact form/service, private ledger and SMTP / phase 9 | `contact.test.ts`, `contact-ui.test.tsx`, `smtp-email.test.ts`: loopback mail fields, acceptance/uncertainty, replay, limits, injection denial and trusted-header rules | Temporary owned Mac/tunnel proxy and enabled browser/Mailtrap receipt pass with 14 live API/database result groups in `verification/contact-live-result-2026-11-14.json`; 28 native proxy checks pass. Managed-host ingress, verified company sender, approved company recipient and real external inbox receipt remain unverified |
| FR-CONFIG-001 | Runtime configuration, composition and provider factories / phase 1 | `config.test.ts`, `database-settings.test.ts`, `provider-selection.test.ts`, `storage-factory.test.ts`, `azure-key-vault.test.ts`; package startup and browser-secret probes. Intercepted secret/provider responses do not prove cloud access | Selected Supabase/SMTP environment and verified runtime TLS/private role work; other profiles, hosted managed identities, secret rotation and full fail-closed service/outage behavior remain open |
| FR-DATA-001 | Migrations, RLS, runtime database context and audit / phase 2 | `database.test.ts` uses PGlite; `native/database.test.ts` separately covers verified TLS, pool identity cleanup, role/MFA denial, financial concurrency and a quarantined logical restore | Eighteen migrations, runtime TLS/isolation, hosted financial races and selected audits pass. Actual encrypted staging export restores 33 tables/306 rows with effective-grant/RLS checks and four object-byte reconstructions in `verification/staging-recovery-result-2026-11-14.json`. Provider file/identity/managed restore, RPO/RTO, sustained workload and cutover remain open |
| FR-AZURE-001 | Entra, Blob, AI, Key Vault, Monitor and Azure infrastructure / phase 11 | `entra-*.test.ts`, related Entra UI tests, `azure-*.test.ts`; SDK/protocol transports are synthetic/intercepted. `scripts/check-infra.mjs` compiles templates/examples; compilation is not Azure validation | Actual tenant/managed-identity policies, storage/inference/secrets/telemetry, image execution, alert queries/receivers and complete profile contract journeys remain unverified; Azure is not advertised as verified |
| FR-RELEASE-001 | Deployment/incident/recovery runbooks, CI and release verification / phase 12 | Package probes cover local workers/startup/shutdown/secrets; separate owned native restore and bounded load checks are recorded in `implementation-status.md`. Runbooks and CI definitions exist; remote CI and image execution have not been observed | Selected real staging gates and actual encrypted capture/local reconstruction now pass (104 recovery checks); legal/company approval, cloud runtime/monitoring/provider recovery/load, offsite schedule/key custody, RPO/RTO and separately authorized production deployment/smoke checks remain open |

Actual check outcomes belong in `implementation-status.md`; absent evidence means not verified.

### Evidence limits and remaining inputs

The table identifies existing verification sources, not a declaration that every requirement has passed. Standard tests use PGlite, synthetic identities, loopback services and intercepted provider requests where indicated. The native database, load and scanner commands are separate checks with their own recorded results; running the standard suite does not run them. Earlier browser artifacts cover their recorded public-shell scope. `verification/free-staging-result.json` separately records actual Supabase/Mailtrap/Mac-scanner/browser and HTTP checks with synthetic accounts.

The current source checkpoint is 943 tests across 79 files, lint/type/build/package/secret and formatting checks. Separate live evidence now establishes the selected temporary staging profile; local checks alone do not do so. Real company/contact/legal approval, complete feature/recovery/operational acceptance and production authorization remain open. Use `deployment.md` for the current setup, private credential boundaries and restart constraints; do not invent missing business inputs or reuse production data to close the gaps.

## FR-FEEDBACK-001 — Deepika staging feedback, 13 November 2026

- Support 42 explicit international valuation/withdrawal currencies; show amounts with currency codes and separate totals, without implicit FX conversion.
- Remove the portfolio manual-update badge and the two requested public FAQ questions; preserve dated reporting, no-custody and risk disclosures. Approved support answers remain available.
- Name the configurable support assistant Maya in its launcher, heading, welcome and replies.
- A client sees only their private reports. An admin session opening the client reports page receives an account-mismatch explanation and client sign-out/sign-in controls, never a silent redirect to admin.
- Record completed broker withdrawal amount, currency, date and reference through MFA-admin controls; clients can read their own history. Corrections are append-only, retain original client/currency, require a reason and preserve audit/idempotency. No money movement or automatic valuation adjustment.
- Add client Account security navigation, password changes and optional authenticator-MFA enrollment on the selected Supabase profile. After enrollment, every protected personal-data request requires AAL2. Password changes sign out globally; suspended users and caller-selected identities are denied. Entra continues its existing delegated password recovery and admin MFA; client Entra MFA is not newly advertised.
- Acceptance: local validation, fresh migrations, authorization/isolation/history/audit tests and a real Supabase staging rerun with synthetic accounts. Record results separately from production.

## FR-EDU-001 — Education service requests

- **Actors:** Visitor, client, MFA-admin. **Phase:** 9 extension.
- **Behavior:** Education navigation/page with two separate service cards; public request page preselects the chosen service. Required name/email/phone/service, optional message, explicit contact/storage permission. Confirm receipt only after durable commit.
- **Administration:** Bounded newest-first private listing, service filter and pagination; name/contact details/service/message/time/reference available to verified MFA-admins only. No automatic email/WhatsApp or booking/payment.
- **Acceptance:** Guest and signed-in submissions persist once; exact replay remains stable, conflicting reuse fails; invalid input, oversized bodies, bot trap, cross-origin and rate limits enforced; unauthenticated/client/AAL1-admin listing denied. PII omitted from audit/log/public response; storage and metadata audit commit atomically. Desktop/mobile and both service selections verified separately.
- **Configuration:** `EDUCATION_ENABLED` defaults false; enabling requires connected services, a valid `CONTACT_HASH_SECRET` (namespaced education HMAC) and trusted ingress in staging/production. Email enablement is independent.

## FR-PORT-002 — Follow-up presentation

Remove the screenshot-marked explanatory return paragraph. Dates, recorded basis and risk/legal information remain. Supported chart choices include USD, EUR and GBP even when the current fixture contains only NZD/INR; missing-currency history is explicitly empty, with no implicit conversion or invented records.
