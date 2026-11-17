# Database and authentication setup

## Local integrated environment

The container helpers and a separate native PostgreSQL rehearsal are documented in `../docs/deployment.md`. The integrated Supabase Storage profile must use its own Supabase database for storage-policy verification; the standalone rehearsal database is separate. These Compose files do not create usable Auth accounts or seed production data.

Install Docker and the Supabase CLI if needed. Neither was available on the initial execution shell; installation/provisioning has not been performed automatically. From this checkout run `supabase start`, then `supabase db reset`. Seed is disabled by default. `seed.sql` is synthetic database-test data and does not create usable auth accounts. Do not apply it to production.

The portable core migration creates `nova_app` as NOLOGIN/NOBYPASSRLS. As the database owner, provision a unique runtime password through a secure interactive administration channel and enable LOGIN for nova_app. Put that role's PostgreSQL URL in the server's DATABASE_URL. Never use the owner, postgres or service_role database connection at runtime. Do not weaken TLS for remote databases. The adapter refuses elevated/wrong runtime roles.

The default is `DATABASE_TLS_MODE=verify_full`; use a public CA PEM bundle in `DATABASE_CA_CERT` when required by the database trust chain. Legacy/insecure URL driver overrides are rejected. A local development/test Supabase instance without TLS requires the explicit local-only `disable` mode. See `../docs/database-verification.md` for the policy and the separate native PostgreSQL 17.11 results.

## Supabase Auth settings

Disable public registration, enable TOTP MFA, configure the application URL and exact allowed callback URLs. Configure SMTP and a verified sender; local Supabase mail capture is available on port 54324. Never reuse production SMTP for automated tests.

Set the Invite User email template link to:

```html
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite">Set up your account</a>
```

Set the Reset Password email template link to:

```html
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery">Reset your password</a>
```

These server-side token-hash callbacks also work across browsers. Standard PKCE callbacks are supported for flows that originate in the same browser. Do not use fragment-only access-token links with the server-only session implementation. Restrict access logs so callback token query strings are not retained.

## First administrator

Bootstrap is an owner-only operation. Create/invite the intended admin using Supabase's secure account setup flow, verify the exact auth subject UUID, then insert an application profile with role=admin and a matching provider_identities row as the migration owner. Use the real approved name/email and never commit them. The runtime role cannot create admin profiles. Complete password setup and enroll/verify TOTP at `/mfa` before accessing `/admin`.

No initial password is bundled. No default administrator or public registration endpoint exists. Account recovery for a lost admin MFA factor is an audited operator procedure through the identity provider, not an application bypass.

## Verification limits

PGlite tests execute the portable migration and RLS on a local PostgreSQL WASM engine. They do not verify Supabase Auth, SMTP, native extensions, cloud TLS, connection pooling or Storage. Run those checks against isolated local Supabase and staging before release.

Migration filenames follow the [Supabase UTC timestamp convention](https://supabase.com/docs/guides/ai-tools/ai-prompts/database-create-migration). All seventeen migrations through `20261111001400_maintenance_history.sql` were applied to the isolated Supabase Free staging project on 11 November 2026. Their hashes are recorded in `../docs/verification/free-staging-result.json`. They are now deployed history: add new migrations rather than editing these files. No production migration was applied. See `../docs/deployment.md` for the exact hosted setup and CLI-version boundary.

## Private reports

Migration 20261110000300 installs report verification fields, immutable metadata/status guards and owner-only private-bucket configuration when the Supabase Storage schema is available. Follow `docs/private-reports.md` before enabling uploads. Configure a reachable private ClamAV daemon and set CLAMAV_HOST; no scan-bypass mode is supported. Direct browser storage access remains denied. Existing unverified report records become quarantined, not deleted.

## Offer images

Migration `20261111000400_offer_images.sql` installs immutable image reservations, ready-image associations, RLS and owner-only private image bucket setup. The bucket is separate from reports and denies direct browser access. Follow `docs/offer-images.md` for setup, native decoder requirements, fail-closed scanning and retry/cleanup behavior. Never set this bucket public.

## Recovery operations

`operations/post-restore-quarantine.sql` is an explicit owner-only recovery operation, outside migrations and application routes. Use it on a reviewed isolated recovery target before reopening access; it invalidates restored authentication proofs while preserving financial history and confirmed factors. Read `../docs/backup-and-restore.md` for intent/environment guards, external provider/file/side-effect reconciliation and the separate authorization/verification gates. Do not run it as routine setup or assume it restores upstream accounts or object bytes.
