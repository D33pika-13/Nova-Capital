# NOVA CAPITAL

Investment-firm website and private reporting portal. Temporary brand; company facts and legal documents require review before public launch. Client funds remain at their brokers. No deposits, automated trading or broker passwords are supported.

## Start here — owner handover

Developed for **Deepika**, who is intended to take over ongoing ownership and maintenance. The GitHub repository is private. GitHub access/ownership, provider-account access and production deployment are distinct steps; see the [ownership handover](docs/ownership-handover.md) for the recorded state.

- **[Integration and operations guide](docs/integrations-and-operations.md):** Supabase Auth, PostgreSQL, private file storage, Mailtrap SMTP, authenticator MFA, Cloudflare/Caddy ingress, ClamAV, scheduler, secrets, optional Azure/AI and how they connect.
- **[Credential handover checklist](docs/credential-handover.md):** which account invitations and secret settings the new owner needs. **No passwords, API keys, MFA seeds or recovery codes belong in this repository.** Actual credentials are delivered separately.
- **[Testing handover](docs/testing-handover.md):** last verified staging links, tester steps and limits.
- **[Implementation status](docs/implementation-status.md):** actual local/staging evidence and unfinished production gates.

Last complete feature checkpoint: **14 November 2026 — 988 tests across 83 files, build/type/lint/format/package checks and selected actual staging/browser journeys passed.** The GitHub handover on 17 November is documentation/source packaging; it is not a new production release or a claim that an old temporary link is still live.

Fresh private GitHub clone checked on **17 November 2026**: frozen-lockfile offline install, production build/type pass, browser-secret canary scan, and five local public-shell/disabled-service HTTP checks passed without real provider credentials. This validates the delivered setup; it does not establish Deepika’s account access or reverify connected providers.

### How the current system works

```text
Browser → Cloudflare HTTPS Quick Tunnel → Caddy (127.0.0.1:3036)
        → Next.js frontend + server-side services (127.0.0.1:3038)
           ├─ Supabase Auth: sessions, invitations/recovery, TOTP MFA
           ├─ PostgreSQL: private records, RLS, audit, limits, Education inbox
           ├─ Supabase Storage: private PDFs and normalized offer images
           ├─ ClamAV: file scanning before publication
           └─ Mailtrap Sandbox via SMTP: captured test email
Supabase pg_cron → bounded database maintenance every 15 minutes
```

This is one Next.js deployment with internal backend modules, not separately deployed microservices. Supabase manages cloud identity/database/storage; the web app, proxy, tunnel and scanner currently depend on the developer Mac. Maya uses FAQ-only mode. No live broker integration, deposits, automatic trading, payment, production email sender or durable production hosting is configured.

| Need | Where to start |
|---|---|
| Run the public site locally | Node/pnpm setup below; `.env.example`, `SERVICES_ENABLED=false` |
| Run real protected services | Copy `.env.example` into an ignored local environment file, then follow the integration guide with owner-supplied values |
| Admin login | `/admin` after password login and authenticator MFA; site admin is separate from Supabase/GitHub administration |
| Client login | `/login`, then `/portal`; enrolled client MFA must be completed |
| Review Education requests | `/admin/education`, active MFA-admin only |
| Change content/branding | `src/lib/site-config.ts` and public page components |
| Change provider | Validated selectors in `.env.example`; implemented adapters still require the selected profile’s live verification |
| Deploy/recover/migrate | `docs/deployment.md`, `docs/backup-and-restore.md`, [incident response guidance](docs/azure-monitoring.md#response-and-recovery) |


## Setup

Use Node.js 24.22.3 (or a newer stable 24.x patch) and pnpm 11.25.0. The reviewed baseline is pinned in `.node-version`; build, development and packaged startup reject older or unreviewed major runtimes. From a clean checkout:

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Open http://127.0.0.1:3000. Default settings run the public-shell development profile without creating usable login accounts. Protected services are implemented, but remain disabled until their environment and providers are connected. See `docs/implementation-status.md` for actual feature/test status.

On this Mac, the separately verified staging runtime can be used without replacing the shared Codex runtime:

```sh
export PATH="/Users/sunny/.cache/nova-staging/tools/node-v24.22.3-darwin-arm64/bin:$PATH"
pnpm dev
```

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm test
APP_ENV=test SUPABASE_SERVICE_ROLE_KEY=local-build-canary-not-a-real-key pnpm build
SUPABASE_SERVICE_ROLE_KEY=local-build-canary-not-a-real-key pnpm check:secrets
APP_ENV=development pnpm start
```

The build is not a service-integration test. Local, staging and production verification are separate. Never use real client data in tests.

The build also prepares the traced instrumentation and bootstrap entrypoint. `pnpm check:startup-package` verifies startup and missing-secret failure in an isolated copy. Use `pnpm start` from this workspace, or `node scripts/standalone-entry.mjs` inside the packaged standalone root; that entrypoint validates configuration before opening the listener.

The pinned Next 16.4.6 runtime includes a reviewed pnpm shutdown patch. `pnpm check:shutdown-package` tests packaged request draining, ordered resource cleanup, both signals, private failure handling and cleanup deadlines. Keep `patches/next@16.4.6.patch` with the frozen dependency inputs; the bootstrap rejects missing patches, other Next versions and `NEXT_MANUAL_SIG_HANDLE`. See [shutdown and upgrade instructions](docs/deployment.md#shutdown-and-runtime-upgrades). Hosted termination remains a staging gate.

## Service configuration

[PostgreSQL security and native checks](docs/database-verification.md) describe verified TLS defaults, explicit local-only plaintext, safe pool cleanup and `pnpm check:native-database`. Twenty-five native checks, including an isolated logical backup/restore and authentication quarantine, have run on an owned temporary PostgreSQL 17.11 cluster; hosted database verification remains separate.

`pnpm check:load-native` runs a separate fixed mixed-workload check using the same reviewed PostgreSQL tools and owned-cluster safeguards. It checks pooled client isolation, financial/audit/idempotency invariants and shared rate limits while printing aggregate latency. It is separate from the 25 native correctness checks and does not establish hosted capacity. See [workload scope and measurements](docs/database-verification.md#bounded-local-mixed-workload).

`pnpm check:scanner-native` separately starts an owned ClamAV 1.5.4 daemon with reviewed official definitions and exercises the actual scan adapter. Five local engine/publication checks pass; provide `CLAMD_BIN`, `CLAMAV_DATABASE_DIR` and, for relocated tools, `CLAMAV_CERTS_DIR`. This does not verify the container's effective policy or hosted signature maintenance. See [native scanner setup and evidence](docs/private-reports.md#real-local-engine-verification).

[Container and Azure deployment instructions](docs/deployment.md) cover the digest-pinned image, local Compose profiles, scoped workload/job/access templates and separate local/live gates. Offline infrastructure checks use `pnpm check:infra` and `pnpm check:compose`; a built image can be checked with `pnpm check:container` on a local Docker engine. Docker/Azure deployment has not been verified in this checkout.

Azure Blob storage, Azure AI and Key Vault secrets can be selected independently for hybrid profiles. Their source and local contract tests are present; live Azure verification is pending. See [Azure storage setup](docs/azure-storage.md), [Azure AI setup](docs/azure-support.md) and [Key Vault setup](docs/azure-secrets.md). SMTP remains the selected email path for Azure hosting; ACS Email's retirement is recorded in the project brief. Other Azure adapters and infrastructure remain incomplete.

`.env.example` documents server-only provider selectors and settings. For an enabled profile set `SERVICES_ENABLED=true` and supply PostgreSQL, SMTP, scanning and the selected provider settings. `AUTH_PROVIDER=supabase|entra` selects authentication; Supabase credentials are required only for selected Supabase authentication/storage. See [Entra configuration and mounted routes](docs/azure-identity.md) for the source-selectable Entra profile and its outstanding live verification gates. Select `AI_PROVIDER=openai` only with a key and explicit model; disabled mode is FAQ-only. Unsupported adapters fail configuration validation. No credentials belong in `NEXT_PUBLIC_*`, source code or frontend imports.

Staging/production require explicit `APP_ENV`, HTTPS `APP_URL`, enabled services and all selected dependencies. Keep separate projects/databases/storage/credentials for each environment. Supabase redirect allowlists and SMTP sender settings must match the environment. Read `supabase/SETUP.md` for migration, least-privilege runtime role, email templates and owner-only admin bootstrap. The isolated Supabase Free staging profile now passes initial real identity/mail, manual reporting, private-report and isolation journeys. Full release gates remain open; do not attempt a production launch from this checkpoint.

## Structure and requirements

- `src/app`: Next.js pages and thin server entrypoints.
- `src/components`: accessible React UI.
- `src/server`: class-driven services, interfaces and provider composition.
- `supabase`: database/storage migrations and synthetic seed data.
- `infra`: deployment profiles and operational guidance.
- `tests`: behavioral and security verification.
- `docs/functional-requirements.md`: numbered feature requirements and acceptance gates.
- `docs/technical-specification.md`: architecture, security and financial rules.
- `investment_firm_website_coding_instructions.md`: original brief and agreed sequence.

Read root and scoped AGENTS.md before changing an area. The requirements plan is saved in `docs/requirements-and-specification-plan.md`.

## Deployment status

A Supabase Free staging project and Mailtrap Free sandbox are configured. The application and native scanner run temporarily on the Mac behind a Cloudflare HTTPS testing tunnel. See [free staging setup, current URL and restart notes](docs/deployment.md#current-free-staging) and [live evidence](docs/verification/free-staging-result.json). This verifies selected real Supabase journeys, not a cloud application runtime or complete release. No paid plan, Azure resource or production deployment was selected. Azure and remaining operational/provider contracts retain their own live gates.

## Framework reference

Authentication follows the [Supabase server-side guide](https://supabase.com/docs/guides/auth/server-side/creating-a-client). Script nonces and dynamic rendering follow the documentation bundled with the installed Next.js version. ESLint 9 is pinned for compatibility with the current Next.js plugin peer requirements; recheck plugin support before upgrading to ESLint 10.

`pnpm start` runs the standalone production build and copies its static assets. It binds to loopback by default; set `APP_HOST=0.0.0.0` only for an intended hosted/container deployment, and set `PORT` as needed. Local `.env.local` is loaded without copying secrets into the standalone artifact. Runtime staging/production settings must be injected securely.

## Client and portfolio workflows

After configuring services and bootstrapping an MFA-protected admin, use `/admin/clients` to create a client record. Open that client to request a setup email, manage status, add private notes and enter investments/snapshots. Client login opens `/portal` with only the verified account’s records. Financial corrections preserve revisions and snapshot history. Read `docs/api-specification.md` for amounts, dates, idempotency, invitation states and concurrency contracts. Use the exact APP_URL origin in your browser and auth allowlists.

The full local check pipeline is `APP_ENV=test SUPABASE_SERVICE_ROLE_KEY=local-build-canary-not-a-real-key pnpm check`; the value is a non-secret canary used to verify browser bundles. `pnpm format:check` verifies readable source formatting. A scoped minimatch override in pnpm-workspace.yaml patches the current linter dependency advisory; remove it when the upstream parser resolves a patched compatible release.

## Private reports

Admins can upload validated private PDFs from each client detail page; clients access published reports at `/portal/reports`. Configure the private bucket and ClamAV connection using [the report setup guide](docs/private-reports.md). Original bytes and Unicode filenames are preserved, failed uploads remain private, and downloads reauthorize before issuing short-lived attachment links. `pnpm check:pdf-package` verifies that the built standalone worker includes its parser dependencies. These features have local tests; live Storage/scanner/browser verification remains pending service configuration.

## Offers, announcements and maintenance

MFA admins manage offers at `/admin/offers` and targeted client notices at `/admin/announcements`. Clients access notices at `/portal/announcements`; read status is tied to the current version. The public `/benefits` page lists only currently valid published offers. Admins can upload scanned PNG/JPEG offer images; private normalized WebP delivery follows current publication visibility. See [offer image setup and verification](docs/offer-images.md).

See [announcements and maintenance](docs/announcements-and-maintenance.md) for recipient controls, acknowledgment semantics and scheduler setup. `pnpm maintenance:watch` uses ignored `.env.local` against an integrated local app. Hosted single-run jobs use `pnpm maintenance` with securely injected configuration and `SCHEDULER_PROVIDER=external`. No hosted job has been deployed or verified.

## Contact support

`/contact` provides a validated, consent-based service enquiry form. It stays disabled until CONTACT_ENABLED and the integrated configuration are supplied. Mail goes only to SUPPORT_EMAIL; Reply-To is the visitor's unverified address. A durable private claim prevents retries from resending a processing/uncertain enquiry. Acceptance means email-service acceptance, not inbox delivery. Follow [contact setup and failure handling](docs/contact-workflow.md), especially the trusted proxy requirement in staging/production.

## Support assistant

The floating Support panel provides public FAQs and private client history. AI disabled mode is explicitly FAQ-only. With an explicitly configured OpenAI model/key, a validated topic planner selects fixed read-only account lookups; exact amounts come from the server/database and are not generated or sent as model context. Chat retries, clear tombstones and account isolation are locally tested. See [support setup and security boundaries](docs/support-assistant.md) for limits, privacy and the outstanding live checks.

## Operational telemetry

Console remains the default. `OBSERVABILITY_PROVIDER=azure_monitor` selects the server-only OpenTelemetry operational-event adapter with a fixed event/attribute vocabulary, bounded memory queue and no automatic request/SQL capture. Read [Azure monitoring configuration and limits](docs/azure-monitoring.md) before enabling it. Local SDK/payload tests are separate from real Azure ingestion, managed-identity ingestion and alert-delivery verification.

## Backup and recovery

[Backup/restore tooling and runbook](docs/backup-and-restore.md) describe the real native archive/restore rehearsal, owner-only authentication quarantine and separate cloud/file/provider recovery gates. PostgreSQL dump/restore clients are now required for `check:native-database`; an explicit integrity-checked source builder prepares them. Local restore evidence does not establish hosted recovery, retention or a verified production cutover.

## Maintenance status

After applying all migrations through `20261111001400_maintenance_history.sql`, MFA admins can use `/admin/operations` to inspect durable scheduled batch outcomes and freshness. Configure `MAINTENANCE_STALE_AFTER_SECONDS` for the actual cadence (default 45 minutes). Manual batches and pre-recovery history cannot mark the scheduler current. See [maintenance evidence and limits](docs/announcements-and-maintenance.md). This is separate from verified hosted scheduling and live alerts.
