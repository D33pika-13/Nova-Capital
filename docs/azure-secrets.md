# Azure Key Vault secrets profile

Status: implemented in source with intercepted REST/token and runtime configuration tests. No live vault, managed identity, role assignment, network policy or deployed secret rotation has been verified.

## Configuration

Non-secret bootstrap settings remain in the environment. Select the provider and map each required secret setting to a pinned `name/version` reference:

```dotenv
SECRETS_PROVIDER=azure_key_vault
AZURE_KEY_VAULT_URL=https://synthetic-vault.vault.azure.net
AZURE_KEY_VAULT_SECRET_MAP={"DATABASE_URL":"nova-database-url/00000000000000000000000000000000","SUPABASE_SERVICE_ROLE_KEY":"nova-service-role/00000000000000000000000000000000"}
AZURE_KEY_VAULT_TIMEOUT_MS=10000
AZURE_CREDENTIAL_MODE=managed_identity
# AZURE_CLIENT_ID=<user-assigned-managed-identity-client-uuid>
```

Replace every synthetic name/version with the intended approved resource and its actual 32-hex-character version. A version is required; there is no implicit latest-version lookup. The allowlist is `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SMTP_PASSWORD`, `OPENAI_API_KEY`, `CRON_SECRET`, `CONTACT_HASH_SECRET`, `ENTRA_CLIENT_SECRET`, `ENTRA_DIRECTORY_CLIENT_SECRET`, `ENTRA_MFA_ENCRYPTION_KEYS` and `AZURE_MONITOR_CONNECTION_STRING`. Include every secret required by the selected services. Other application/provider selectors, endpoints, email addresses, public auth key, limits and identity settings remain validated environment configuration. Values cannot replace arbitrary settings, `NEXT_PUBLIC_*` fields, system variables or the application's trust configuration.

In Key Vault mode, leave **all allowlisted secret environment values unset**, including ones not mapped. Any nonempty allowlisted environment secret causes a configuration failure; it is never a fallback. Empty `.env` placeholders are ignored. A missing required secret still fails final service configuration validation. The map must be nonempty and cannot contain URLs, traversal, unversioned references or unknown keys. Public-cloud `https://<vault-name>.vault.azure.net` origins are supported; custom/sovereign endpoints, credentials, ports, paths, queries and fragments are rejected.

Hosted staging/production use explicit managed identity. An optional client UUID selects a user-assigned identity; otherwise the system-assigned identity is used. Explicit Azure CLI credentials are permitted only in development/test with an existing operator login. The application does not log in or use an automatic credential chain. Grant read-only secret-value access to the intended application/environment vault (for example, Key Vault Secrets User), without administration/write/delete permissions, and restrict network access appropriately. Follow Microsoft's [Key Vault RBAC guidance](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide) and verify actual scopes in staging.

## Resolution and lifecycle

`SecretProvider` has environment and Azure adapters. `RuntimeConfigurationLoader` validates bootstrap settings, resolves the selected provider, merges only the exact mapped results into a private snapshot, then runs the full `ConfigurationService` validation. It never writes resolved secrets into `process.env`. The final immutable configuration is server-only. Every server entrypoint awaits configuration before using dependencies; same-origin checks remain awaited on mutations.

Root instrumentation awaits configuration. This Next version omits that entrypoint from standalone output and may defer hook registration until requests, so the build packages its generated trace and `scripts/standalone-entry.mjs` explicitly completes registration before importing the listener. Start from the workspace with `pnpm start`, or run `node scripts/standalone-entry.mjs` inside the packaged standalone root. Direct `server.js` invocation bypasses the eager readiness guard; deployment commands must use the provided entrypoint. Build with the public-shell environment profile below, without vault access. Independent server/proxy runtime contexts may resolve their own snapshots; they do not depend on shared globals. Each loader shares one promise across concurrent callers and caches success **or failure**. There is no per-request polling, automatic retry or environment fallback. Failed bootstraps require remediation and restart. Proxy/API failures use safe unavailable responses without secret/provider payloads.

Azure reads use the documented [Get Secret REST operation](https://learn.microsoft.com/en-us/rest/api/keyvault/secrets/get-secret/get-secret?view=rest-keyvault-secrets-2025-07-01), API version `2025-07-01`, and the fixed `https://vault.azure.net/.default` token scope. Requests reject redirects and remain on the configured vault. One 1–20 second deadline (default 10 seconds) bounds the entire profile's token/read operations. Response bodies are capped at 64 KiB, individual UTF-8 values at 16 KiB, and NUL/empty values are rejected. Returned IDs must match the requested version, with an enabled secret and valid expiry/not-before attributes at load time. Values are published only after every read succeeds; partial profiles are discarded. A late token cannot begin a read after timeout, and abort cancels a stalled response body.

The verified snapshot remains in server memory until the instance stops. Changing/disabling a secret or revoking vault access does not erase already-loaded values. Schedule restarts before expiry and perform controlled version rotation/revocation, including the underlying database/email/AI credential where applicable. This is startup secret resolution, not continuous revocation enforcement. Do not dump configuration, process memory, crash payloads or provider responses into logs/support tools.

Resolved database URLs also pass the strict policy in `database-verification.md`: verified TLS is default and driver override queries are rejected. `DATABASE_TLS_MODE` and an optional public `DATABASE_CA_CERT` are non-secret trust configuration, not allowlisted vault secret-map keys.

## Build, rotation and operations

Build the image/package in an explicit public-shell test profile with `SECRETS_PROVIDER=env`, `SERVICES_ENABLED=false`, synthetic canaries and no production credentials/vault access. Inject the Key Vault profile only at runtime. An example build command is:

```sh
APP_ENV=test SERVICES_ENABLED=false SECRETS_PROVIDER=env pnpm build
```

For rotation, prepare a new credential/version without revoking the current working credential; update the pinned map in staging; restart all instances; verify the complete service journey; then deploy the approved map and restart all production instances before revoking the old credential. Where two credentials cannot coexist, plan a tested maintenance window. Rollback requires the prior version **and** a still-valid underlying credential. Coordinate contact HMAC changes with the replay ledger: a new digest key cannot silently reinterpret existing request hashes. Existing session cookies, download links, database pools, SMTP sessions and request histories have their own lifetimes and must be included in the rotation plan.

The web server resolver does not modify the standalone maintenance CLI's environment. A separate scheduler/job must receive its own approved secret injection (for example, platform-managed Key Vault references supplying its bearer credential), or remain in a documented environment-secret profile. CLI-native Key Vault retrieval and deployed jobs are not verified by these web-server tests. Health status remains dependency-unverified until actual external checks establish otherwise.

## Verification gates

Local tests cover exact pinned requests/audience, bad configuration, active/expiry/ID checks, body/value limits, denied/malformed responses, deadline cancellation, late credentials, all-or-nothing results, concurrent resolution, immutable snapshots, failure caching, forbidden environment fallback, provider result overrides and an enabled hybrid configuration using resolved database/service credentials. `pnpm check:startup-package` copies the standalone output outside the workspace, rejects escaping symlinks, verifies normal environment-profile startup and asserts that unresolved vault configuration terminates without a synthetic secret in logs. This catches missing instrumentation/traces and early Next Node-global initialization failures. It is configured in CI; remote CI execution is not established here. All cloud calls use intercepted HTTP and synthetic credentials; no vault or real secret is read.

Staging must prove actual managed identity, read-only RBAC, network restrictions, enabled/disabled/expired versions, startup readiness/failure, secret-free browser assets/logs and the full auth/database/email/storage/AI journey with vault-resolved credentials. Rehearse rotation, rollback, scale-out/restarts and outage recovery before release. Provisioning, paid resources and production deployment still require applicable authorization.
