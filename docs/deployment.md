# Containers and Azure workload deployment

Status: a Supabase Free project and Mailtrap Free sandbox are configured. Initial real-service journeys pass using a temporary Mac-hosted application/scanner behind Cloudflare HTTPS. Docker/Compose and Azure workload source remains prepared but unexecuted: image build/run, Azure deployment and remote CI are not verified. No paid plan, Azure resource or production deployment was selected.

## Current free staging

Created on 11 November 2026 at the user's request:

Restarted on 13 November 2026. The previous temporary hostname stopped working; the current URL below replaces it. Supabase Site URL and both exact callbacks were rotated to the replacement hostname, and the retired callbacks were removed. Existing test accounts were not changed.

| Component | Selected setup | Observed state |
|---|---|---|
| Identity/database/files | Supabase Free, `project-website-staging`, Mumbai (`ap-south-1`), project `zdzbyzomxmhgearjjfbe` | Eighteen migrations applied (including withdrawal history on 13 November); `nova_app` runtime role, verified client TLS, private report/image policies and API bucket checks pass |
| Application URL | `https://coverage-textbook-recognize-sms.trycloudflare.com` | Restored 13 November: HTTPS health/login, client sign-in and authenticated portfolio pass; Caddy ingress listens only on Mac loopback 3036; the isolated app listens on loopback 3038 (14 November) |
| File scanner | Native ClamAV 1.5.4 on Mac loopback port 3310 | Clean report published; harmless EICAR PDF rejected before another metadata/object write |
| Test email | Mailtrap Email Sandbox Free | SMTP connection verified; probe, application invitation, Supabase recovery and browser contact messages captured; these are not external inbox-delivery tests |
| Support/operations | FAQ-only AI, console telemetry, database scheduler selection | Direct Supabase pg_cron short-cadence execution/expiry is verified and normal fifteen-minute cadence configured; enabled contact through the owned loopback proxy and Mailtrap capture now pass; paid model inference, monitoring/alerts, hosted recovery and managed-host ingress remain separate gates |

The current browser and HTTP checks cover administrator MFA; Client A creation/invitation/password setup; recovery with old-password denial/new-password access; exact investment/snapshot readback; private PDF upload/download/hash/expiry; Client B isolation; suspension/reactivation; direct Storage/Data API denial; and logout-cookie replay denial. Client B is an explicitly synthetic operator-created identity/profile fixture, not a second browser onboarding test. See `verification/free-staging-result.json` and `implementation-status.md` for evidence and remaining gates.

On 14 November, another 125 actual client/finance HTTP/database checks passed using a dedicated synthetic MFA client: search/duplicates, competing edits/corrections, all asset classes, exact cash-flow-basis summaries, archive/history/audit and existing-session lifecycle revocation. The browser verified three dated chart points and mobile bounds; concurrent invitation/replay left one captured sandbox message. The dedicated client was restored active, the new invitation fixture deactivated, and test holdings archived with history retained. See `verification/client-finance-live-result-2026-11-14.json`.

On 14 November, actual support verification passed 56 HTTP/database result groups plus hosted clear/late-finish locking, shared public throttling and browser history/account-switch/mobile checks. The selected profile remains explicitly FAQ-only; this does not establish live AI inference or AI-backed personal financial answers. Owned synthetic test conversations were cleared with tombstones/audits retained. See `verification/support-live-result-2026-11-14.json`.

Deepika's 13 November feedback is implemented on this staging profile. `verification/deepika-feedback-staging-2026-11-13.json` records 52 live assertions covering international records, immutable withdrawal history, client reports and isolated client password/MFA flows. Clients can open **Account security** to change their password or enable authenticator MFA, and **Withdrawal history** to see completed broker withdrawals. Shared Client A/B/admin credentials were unchanged; a dedicated synthetic security-test fixture is stored in the ignored testing environment. An admin opening `/portal/reports` now receives an account-mismatch explanation instead of a redirect to admin. No third-party tester confirmation is implied by the agent's tests.

This is temporary hybrid staging. The Mac must remain running and awake, with the application, scanner and tunnel processes alive. A Quick Tunnel hostname changes on restart; update private `APP_URL`, Supabase Site URL and both exact callback entries together before using a new hostname. This does not establish a cloud application runtime, Linux container behavior, hosted scheduling/monitoring, recovery or sustained capacity.

The checked free limits are Supabase's 500 MB database, 1 GB object storage and two active projects, with pausing after a week of inactivity; Mailtrap Sandbox Free allows 50 test messages/month and ten retained messages per sandbox. Cloudflare Quick Tunnels provide temporary testing URLs without an account/domain, with no uptime guarantee and no SSE support. Keep fixtures small and stay within the displayed quotas; no automatic upgrades or paid AI were enabled. Sources: [Supabase pricing](https://supabase.com/pricing), [Mailtrap pricing](https://mailtrap.io/pricing/), [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/). Recheck provider terms and quotas before extending the setup.

### Recovery verification boundary

On 14 November, the current staging database and four private Storage objects were captured into a private authenticated encrypted bundle, then reconstructed in a new disposable local PostgreSQL cluster/filesystem with 104 integrity/security/isolation checks. The source app, objects, accounts and active Cron were unchanged. This is actual-source backup/local reconstruction, not a restored managed Supabase Auth/Storage service or a production cutover. The build ID matches the deployed copy. See `backup-and-restore.md` and `verification/staging-recovery-result-2026-11-14.json`; offsite retention/key custody, RPO/RTO, provider recovery and recovered-cloud journeys remain release work.

The 14 November security refresh runs the app with the verified private Node 24.22.3 binary and copied `education-final-20261114` standalone release. The same public URL, environment, proxy, scanner and database job are preserved. Runtime guards, local checks and actual staging smoke evidence are in `verification/security-baseline-result-2026-11-14.json`. Managed PostgreSQL security patch coverage and production deployment remain separate.

### Current background session

The 14 November contact increment preserves the current tunnel URL. The app now runs a copied standalone package from `/Users/sunny/.cache/nova-staging/releases/education-final-20261114`; its private runtime environment is `/Users/sunny/.cache/nova-staging/session/staging.env`. Caddy runs a private copy of `infra/ingress/Caddyfile` from the session directory. Both the app and proxy reject off-machine direct connections by binding loopback. The Desktop checkout is not read by those launchd jobs. Keep the ignored checkout environment and private deployed environment consistent on changes; do not print either. See `infra/ingress/README.md` for verification and rollback. Contact is enabled only to Mailtrap capture, with a synthetic-details notice; no verified company inbox or production sender is configured.

The latest restart uses four per-user launchd jobs: `com.unleashs.nova-staging.app`, `.ingress`, `.scanner` and `.tunnel`. They run independently of the Codex execution session. Their private job definitions and logs are in `/Users/sunny/.cache/nova-staging/session`; no automatic-login startup was installed. They are not configured to restart automatically, because a new Quick Tunnel address must be coordinated with application/Auth settings. The Mac must remain awake and online. To stop the owned session, use `launchctl bootout gui/501/com.unleashs.nova-staging.app`, then the corresponding `.ingress`, `.tunnel` and `.scanner` service names. Inspect those exact jobs before restarting; do not launch duplicate listeners.

### Private files and restart

The untracked `.env.staging.local` contains runtime credentials for the least-privilege application role. `.env.staging.operator.local` contains owner credentials used for migrations/bootstrap; never inject it into the web process. `.env.staging.testing.local` contains only synthetic test-account credentials/factors. All three were checked as mode 0600, are ignored by `.gitignore`, and are excluded from the Docker context. Do not paste their values into chat or commit them.

Reviewed `cloudflared` 2026.10.7 and Supabase CLI 3.1.0 binaries plus the public database CA are cached in `/Users/sunny/.cache/nova-staging/tools`. The current session job definitions/logs are under `/Users/sunny/.cache/nova-staging/session`; temporary native scanner/tool configuration remains under `/tmp/nova-staging-tools`. The scanner uses the separately reviewed native tools/definitions at `/tmp/nova-clamav-tools-xpWRGo`; those must be reacquired if removed. No global service or automatic startup was installed.

After confirming the previous owned listeners have stopped, the current scanner configuration starts with:

```sh
CVD_CERTS_DIR=/tmp/nova-clamav-tools-xpWRGo/tools/etc/certs \
  /tmp/nova-clamav-tools-xpWRGo/tools/sbin/clamd \
  --config-file=/tmp/nova-staging-tools/clamd.conf
```

The current launchd job uses the private copied package, not the Desktop checkout. For a foreground diagnostic after stopping the corresponding owned job, use the supported Node runtime and the same prepared package:

```sh
HOSTNAME=127.0.0.1 PORT=3038 \
  node --env-file=/Users/sunny/.cache/nova-staging/session/staging.env \
  /Users/sunny/.cache/nova-staging/releases/education-final-20261114/scripts/standalone-entry.mjs
```

The proxy is also required before the tunnel can serve requests:

```sh
INGRESS_LISTEN_PORT=3036 INGRESS_UPSTREAM_PORT=3038 \
INGRESS_PUBLIC_HOST=classics-shoot-white-for.trycloudflare.com \
  /Users/sunny/.cache/nova-staging/tools/caddy run \
  --config /Users/sunny/.cache/nova-staging/session/Caddyfile --adapter caddyfile
```

Keep the existing tunnel running during app/proxy restarts. Only when intentionally replacing the temporary hostname, start a new tunnel in another terminal:

```sh
/Users/sunny/.cache/nova-staging/tools/cloudflared tunnel \
  --no-autoupdate --url http://127.0.0.1:3036 --protocol http2 \
  --metrics 127.0.0.1:0
```

For a new tunnel, record its new HTTPS origin, update both private environment copies, the proxy's allowed public host and exact Supabase URLs, then restart only the app/proxy. The already saved email templates use `.SiteURL` and token hashes; do not replace them with fragment-token links. Keep public signup and anonymous sign-in disabled. Definition updates/reload/freshness need operational verification; one successful antivirus fixture is not ongoing update monitoring.

Supabase CLI 3 renamed the local SMTP configuration section, while this checkout retains its prior local-stack config. The remote apply used an isolated minimal CLI-3 work directory containing exact copies of the seventeen migrations, with verified TLS, a dry run, `--skip-vault`, no seeds and the normal Supabase migration ledger. Do not run a remote reset or edit applied migrations. A local-stack CLI-3 upgrade is separate from this hosted setup.

### Remaining setup and release work

For another environment, prepare the following in order:

1. Identify an isolated staging Supabase project and an application host with an HTTPS URL. Review the selected services' current quotas and costs before provisioning. Keep production resources and real client data separate.
2. Follow `../supabase/SETUP.md` for migrations, the least-privilege runtime role, private buckets, Auth callback allowlists and the owner-only first administrator. Use two synthetic client identities plus an MFA administrator for verification.
3. Populate a private runtime environment using `.env.example`. Select `APP_ENV=staging`, the actual HTTPS `APP_URL`, `SERVICES_ENABLED=true`, `AUTH_PROVIDER=supabase`, `DATABASE_PROVIDER=postgres`, `STORAGE_PROVIDER=supabase`, `EMAIL_PROVIDER=smtp`, `RATE_LIMIT_PROVIDER=postgres` and `AI_PROVIDER=disabled`. Supply the selected providers' credentials through the host's secret mechanism; never commit them or paste them into chat.
4. Configure an isolated mail capture/test recipient arrangement and a private scanner with verified definitions and the reviewed limits. Keep contact sending disabled until its recipient, consent, proxy trust and delivery checks are configured. FAQ-only support does not verify an AI provider.
5. Build and verify the exact deployment artifact, then run the staging journeys below. Record the URL, provider profile, artifact version and observed results without recording credentials, callback tokens or private client content. Console telemetry and a manually run scheduler do not satisfy the hosted monitoring/scheduling gates.

For this environment, the initial gates above are observed. Complete the remaining offer/image/announcement, contact/proxy, support/history, maintenance, recovery/load and operational checks before declaring the selected profile release-ready. Company/legal acceptance and production authorization remain separate.

## Application image

The Dockerfile builds with pinned Node 24.22.3 Debian slim image content and pnpm 11.25.0, uses a frozen lockfile and runs the existing test/build/packaging/secret-canary checks. Its build context allowlist includes application source and required build/test inputs; local environments, infrastructure parameters, credentials and unrelated workspace files stay outside it. Build-stage canaries are synthetic. Production credentials belong in runtime configuration only.

The runtime contains the prepared standalone output, static/public assets and native decoder dependencies. It runs as `node`, invokes the verified pre-listener bootstrap and has an HTTP configuration/liveness check. The Compose shell and container verification use a read-only root filesystem, writable bounded temporary/cache mounts, dropped Linux capabilities and no new privileges. Azure uses the same non-root image; its platform filesystem/capability controls require a separate target-host review.

On a machine with a **local** Docker engine:

```sh
docker build --platform linux/amd64 --tag nova-capital:verify-local .
CONTAINER_IMAGE=nova-capital:verify-local pnpm check:container
```

`check:container` requires a local Unix/named-pipe Docker endpoint. It checks the image's non-root user/bootstrap command and absence of credential environment settings, starts one owned temporary container, checks public/denied-private HTTP behavior and removes that container. It does not push, delete other images, connect cloud services or send messages. This check is configured in CI but has not run locally because no engine is installed. Run an approved image vulnerability scan and review the results before selecting a release digest. Refresh base/service image pins through a reviewed release rather than relying on mutable tags.

## Shutdown and runtime upgrades

The application uses the standard Next 16.4.6 server with a small, version-pinned pnpm patch in `patches/next@16.4.6.patch`. Both CommonJS and ESM cleanup paths invoke the trusted process-local application hook after HTTP drain and Next server cleanup (including its `after()` work), before trace flushing and the original signal exit. The patch retains Next signal handling and its duplicate-signal guard. There is no public cleanup endpoint or environment-selected hook.

Node instrumentation installs one shutdown coordinator. It closes the process pool first (three-second budget), then the process telemetry provider (five-second budget), allowing pool cleanup events to be queued before telemetry stops. Concurrent cleanup calls share one promise. New service composition is rejected once application cleanup begins. Only fixed `application.shutdown` status fields are logged; resource errors remain private. An absent resource is also reported as `closed`; this does not establish database connectivity or remote telemetry acceptance.

Those are soft deadlines: they cannot cancel arbitrary pending work. The patched Next hook has a separate ten-second outer deadline, then retains signal exit code 130/143. HTTP/Next draining happens before that deadline starts. SIGKILL, a host grace period shorter than request drain plus cleanup, crashes and persistent export failures can lose work/telemetry. Verify the actual platform termination grace, representative long requests, background work and ingestion in staging; local success does not establish those properties.

Docker copies `patches/` before `pnpm install --frozen-lockfile`; its build context explicitly includes the patch. The standalone bootstrap rejects an unexpected Next version, missing cleanup marker or any nonempty `NEXT_MANUAL_SIG_HANDLE` (including the string `false`). Use the documented bootstrap rather than generated `server.js` directly. On a Next upgrade, review the new server cleanup implementation, rebase or remove the patch, update the explicit compatibility guard and rerun frozen installation, application checks and `pnpm check:shutdown-package`. Never bypass a failing patch to proceed with deployment.

The isolated package probe copies the artifact and uses private fixture sinks, without adding production routes. It pauses a real HTTP response, verifies cleanup starts after response drain, checks pool-before-telemetry order and duplicate signals, tests SIGINT/SIGTERM, redacted failure, a hung hook and missing-patch startup rejection. Unit tests separately cover deadlines and real Azure exporter queue shutdown through an intercepted transport. A native PostgreSQL test holds a checked-out connection to prove pool closure waits before telemetry. The package probe does not separately execute an `after()` callback or contact Azure. CI now includes the probe; remote CI and image/host execution remain unobserved.

## Local profiles

Public shell:

```sh
docker compose up --build
```

The application binds to host loopback port 3000 and explicitly disables services/AI. It supplies no fake login, client identity or financial data. Stop with `docker compose down`.

Integrated helpers use an **existing local Supabase stack** for Auth, PostgreSQL and private Storage. Follow `supabase/SETUP.md` to start that stack, apply reviewed migrations, enable the least-privilege runtime login and bootstrap synthetic test identities/admin MFA. Seed is disabled; synthetic SQL profiles alone are not usable auth accounts. Copy and edit the ignored integration settings securely:

```sh
cp infra/local.env.example .env.integration
docker compose --env-file .env.integration -f compose.yaml -f compose.integrated.yaml up --build
```

Use the same Supabase project's database and Storage. The example's database connection points to the local Supabase port 54322 and Auth/Storage to 54321 via `host.docker.internal`; confirm container-to-host routing on the actual platform (Linux may require a host-gateway mapping). A separate PostgreSQL database cannot verify Supabase bucket policies stored in another database. Use only a synthetic local/test project with exact application callbacks and no production mail delivery configuration.

The integrated overlay adds Mailpit (loopback inbox UI 8025, SMTP 1025) and an internal ClamAV service. App invitation/contact mail goes to Mailpit; Supabase's own auth reset flow uses its configured local auth-mail capture (normally 54324). Verify the correct capture surface for each flow. Docker Mailpit's `mail` hostname is allowed plaintext only with explicit development/test capture configuration and no SMTP credentials. Authenticated or remote SMTP requires TLS, including authenticated loopback connections.

ClamAV has no host-published port. Its image health check gates web startup, and uploads remain fail-closed if scanning fails. The local container allows 4 GiB RAM; signature download/reload and network availability require real checks. Official [ClamAV guidance](https://docs.clamav.net/manual/Installing/Docker.html) recommends at least 3 GiB and prefers 4 GiB. Application images and private PDFs remain in their configured private storage, not a public container directory.

A separate native PostgreSQL rehearsal is available for migrations, concurrency and restore work:

```sh
docker compose --env-file .env.integration -f compose.database.yaml up -d
```

It binds to loopback 54329 and uses a dedicated named volume and synthetic owner password. It is separate from the integrated Supabase database, and does not create application logins, apply migrations or seed records automatically. Preserve volumes when stopping services; destructive reset/volume removal needs explicit operator intent. The separate owned native runner has verified PostgreSQL TLS/isolation and a logical restore rehearsal; execution of this Compose rehearsal and the actual scanner remain unverified.

`pnpm check:compose` validates all three configurations with an isolated synthetic environment fixture and checks loopback bindings, private scanning, image digests and separate database wiring. It needs the Compose plugin; `COMPOSE_BIN` may point to a verified standalone Compose binary. Local validation used Compose 5.7.0, without a daemon or service startup.

## Azure workload prerequisites

Workload/access/job templates reference a managed Container Apps environment, Azure Container Registry, Key Vault and two user-assigned identities in the target resource group. `foundation.bicep` now defines those prerequisites for a new environment. Prepare separate resource groups, credentials and data for staging and production. Registry access must support the `AcrPull` role used here; an ABAC repository-permission registry requires an explicitly reviewed alternative role configuration. Preserve identity principals across routine releases and reconcile role bindings if identities are recreated.

Configure the app/environment vault with RBAC, soft deletion/purge protection and appropriate network access. Store the runtime secrets as pinned versions. Select PostgreSQL TLS/least-privilege access and apply migrations before application rollout. Supabase remains the default login provider; Entra is source-selectable with the tenant/directory/MFA configuration in `azure-identity.md`. An Azure workload deployment does not establish working Entra login or Azure PostgreSQL verification. Blob selection requires the private account/container policies and owner registration in `azure-storage.md`. Azure AI selection requires a compatible reviewed deployment and its inference role, described in `azure-support.md`; the default workload example disables AI.

Foundation provisioning remains unrun. A header-replacing proxy, database migration/restore automation, service-specific resource provisioning and live monitoring/alert verification remain separate deliverables. Review region support, registry/network reachability, consumption quotas and an actual cost estimate before authorizing provisioning. The web/scanner pair requests 2 vCPU/4 GiB per replica, with one minimum and at most three replicas; the scanner receives the 3 GiB minimum. Actual capacity/signature reload/load tests may require a larger workload profile. This is not a free-hosting claim.

## Foundation and deployment order

`infra/azure/foundation.bicep` targets an existing resource group in public Azure. It defines a workload-profiles Container Apps environment with a Consumption profile, external ingress and a dedicated delegated subnet; a separate private-endpoint subnet; two user-assigned identities; Basic ACR with admin/anonymous access disabled; and an RBAC vault with public access disabled, private endpoint/DNS, soft deletion and purge protection. Defaults reserve a /16 network, /23 application subnet and separate /27 endpoint subnet. Review nonoverlap, subnet sizing and existing DNS ownership before deploying. The [Container Apps network rules](https://learn.microsoft.com/en-us/azure/container-apps/custom-virtual-networks) distinguish workload-profile delegation from consumption-only environments; this template uses the former. It does not create an NSG/firewall or restrict outbound destinations.

ACR remains reachable over its authenticated public endpoint; Basic does not provide the private registry endpoint of Premium. The vault is private. Secret population/rotation therefore requires an authorized operator or deployment runner with VNet routing and private DNS resolution, plus appropriate data-plane secret-write RBAC. The foundation creates no operator secret-writer grants or credential values. Do not enable public vault access to bypass missing runner connectivity. Test DNS and vault access from both the web replica and the platform job's versioned-secret reference in staging.

The workspace retains logs for 30 days, disables local key authentication and defaults to a 1 GB daily ingestion quota (configurable 1–10 GB). Environment diagnostic settings route console/system logs through Azure Monitor without retrieving workspace keys, following [Microsoft's logging configuration](https://learn.microsoft.com/en-us/azure/container-apps/log-options). A quota can stop ingestion and is not a total cost cap; alerting, log access/PII review, retention requirements and OpenTelemetry/Application Insights remain release work. Review network/private endpoint, managed infrastructure, registry, log and runtime costs before applying.

After deployment authorization, the operator sequence is:

1. Validate/what-if the foundation against the actual subscription and region. Check naming (lowercase alphanumeric prefix beginning with a letter), network ranges, resource-provider registration, budgets and DNS ownership. Provision separate stage/production foundations; preserve their nonsecret output names.
2. From the private runner, populate reviewed pinned secret versions in the app/environment vault. Prepare actual Supabase callbacks, PostgreSQL roles/migrations and selected storage/AI prerequisites. Foundation does not create Azure PostgreSQL, Entra identities, SMTP accounts or AI deployments. When selecting Azure Blob, the separate `storage.bicep` defines its account/private containers; map outputs, grant runtime access and register exact database locations as described in `azure-storage.md` before workload rollout.
3. Build/scan/push the immutable application image through a separately authorized build identity. Map foundation `managedIdentityName` to access `webIdentityName`, and `maintenanceIdentityName` to access `jobIdentityName` and maintenance `managedIdentityName`; use the same environment/registry/vault outputs throughout. Apply `access.bicep` after the maintenance secret exists. Wait for actual permissions to propagate.
4. Deploy the web workload with the reviewed digest, pinned secret references and matching environment location. Verify private vault resolution and current runtime configuration before enabling traffic/features. Configure the exact application origin/callbacks and then deploy the separate maintenance job with the matching secret version.
5. Run the staging gates below, including actual log arrival, private DNS, image pull and separate job-secret access. Routine releases update workload/job images and configuration; they do not recreate identities/networks/vaults. Purge protection prevents immediate vault deletion/reuse; deletion is not a routine rollback.

## Templates and permissions

- `infra/azure/storage.bicep`: Optional dedicated StorageV2 account, private report/image containers, no Shared Key/anonymous access, HTTPS and Blob encryption, explicit redundancy and bounded Blob/container soft-delete retention. Its public endpoint supports authorized direct report downloads; this is not anonymous file hosting. No credential outputs, lifecycle deletion rules, object migration or owner database registrations are created. See `azure-storage.md` for retention and restore boundaries.
- `infra/azure/monitoring.bicep`: Replica absence and ingress 5xx metric alerts against an existing web app, with a separately managed action group. Alerts default disabled pending metric/receiver validation and authorized notification enablement. No recipients, automated remediation or credential values are created. See `azure-monitoring.md` for exact conditions, missing-data limitations, staging verification and incident response.
- `infra/azure/availability.bicep`: Disabled-by-default Standard HTTPS test and location-failure alert for the existing app's managed direct-ingress hostname. It verifies TLS, HTTP 200 and configured liveness without dependency assertions. Probe and notification flags are separate. It is unsuitable for proxy-restricted/private origins without a separate approved monitor; do not widen ingress controls. See `azure-monitoring.md` for settings, pricing review and staging evidence gates.
- `infra/azure/scheduler-monitoring.bicep`: Disabled scheduled-success freshness and scheduled-failure log alerts against the selected Application Insights rows in an existing workspace. Uses an existing dedicated user-assigned query identity, without creating recipients/identities/grants. Requires real schema/query access, separate environment resources and receiver verification. See `azure-monitoring.md` for cadence, recovery/ingestion limits and live test gates.
- `infra/azure/workload.bicep`: One frontend/modular-backend Container App with web and private scanner containers, digest-only image references, user-assigned identity, TLS ingress, configuration/startup/readiness/liveness probes, bounded scaling and versioned Key Vault resolution. Use a `linux/amd64` release image for the target platform. These [Container Apps probes](https://learn.microsoft.com/en-us/azure/container-apps/health-probes) indicate process/configuration and scanner socket readiness; `/api/health` still reports dependencies unverified.
- `infra/azure/maintenance.bicep`: A separate scheduled single-run job using the same application image and maintenance CLI. Its identity reads only the pinned bearer secret through a native platform [Key Vault reference](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets); it receives no database/AI/storage secrets. The UTC schedule is fifteen minutes or hourly, with one replica, no automatic job retries and a 180-second execution bound. This connects the documented CLI secret-injection boundary without changing its one-run behavior.
- `infra/azure/access.bicep`: Registry pull access for both identities, read-only app-vault access for the web identity and single-secret access for the job. Optional Azure Blob custom roles allow only container-property reads, blob read/write/delete, account-property read and delegation signing, scoped to the selected account/containers. They grant no account keys, container/resource writes, Owner or role administration to the runtime. Verify effective permissions, existing grants and propagation in staging. Azure AI permissions remain a separate selected-service prerequisite.

The web vault should hold only this app/environment's secrets because the web identity can read that vault. The application loader further limits which settings it resolves. The job's separate identity is scoped to the maintenance secret. See the [built-in Key Vault roles](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/security) and [registry roles](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/containers) supporting these bindings.

Direct ingress derives the application origin from the managed environment's default domain and disables contact submission. The `trusted_proxy` parameter variant enables contact only with an explicit public origin and a nonempty proxy CIDR allowlist; the origin ingress then permits those ranges. Before using it, verify that the separate proxy replaces user-supplied `X-Real-IP`, routes the intended host/API paths and prevents direct origin bypass. Supply the matching contact HMAC secret and test spoofing/rate limits. A CIDR parameter alone does not prove trusted header replacement. Coordinate Supabase callback allowlists and the scheduled job origin with the configured public application origin.

## Compile, review and rollout

Use verified Bicep 0.49.2 (the CI download has a pinned checksum):

```sh
pnpm check:infra
```

Set `BICEP_BIN` if the verified compiler is outside PATH. The check compiles eight templates and their example parameter files, verifies metric and HTTPS probe scopes/thresholds/TLS/content/notification defaults, private-storage/retention, foundation network/vault/registry/logging and bootstrap/identity/ingress/secret/scaling/scheduler policies and rejects empty action-group names, zero error thresholds, unsupported storage SKUs, disabled retention, plaintext connection credentials, mutable image identifiers and unrestricted contact parameters. It performs no Azure deployment or account access. Local compiler binary and Compose binary downloads were verified against the official GitHub release digests.

Example parameter files use synthetic names, zero application digests and zero secret versions. They compile for review and cannot serve as a working deployment. Prepare actual environment-specific parameter files outside the build context, replace every synthetic reference, coordinate the web/job maintenance secret and origin, and select reviewed application/scanner image digests. Set app location to match the existing Container Apps environment. Never paste secret values into parameter files or deployment arguments.

Before applying anything: review the generated ARM template, live Azure validation/what-if, resource scopes, effective permissions, network configuration, image scan results, budget and rollback plan. Changes can create billable resources and grant permissions; deployment needs applicable authorization. No apply/deploy command or image push has been executed in this workspace.

In staging, prove actual managed identity/image pull/vault access; fresh scanner definitions and safe clean/EICAR cases; admin MFA and invite/reset mail; exact investment/snapshot/client isolation; report upload/download/expiry/suspension; offer/announcement visibility; verified contact ingestion/acceptance/inbox state; chatbot identity/history/privacy/outage behavior; and real scheduler execution/audit evidence. Rehearse backup/restore, schema compatibility, secret rotation, rollback and representative load before production approval.

Release one immutable image and matching pinned configuration at a time. Keep the prior reviewed image/map and compatible database backup available. To roll back application code, use the prior image/configuration with a new release revision and verify readiness and safe smoke checks; a container revision does not undo migrations, financial corrections, emails or identity changes. Restore/cutover must follow a rehearsed data-preserving procedure. Remaining release runbooks and live verification are tracked in `implementation-status.md`.

## CI and evidence boundaries

CI now defines an offline infrastructure job (verified Bicep compiler plus Compose configuration checks) and a Linux image build/non-root/read-only smoke job. The application job retains its unit/integration/build/package/secret/audit gates. These definitions have not been observed running remotely. Compilation and a healthy public shell do not establish a local Docker image, hosted scheduler, foundation resource or Azure deployment. Separate owned native PostgreSQL and ClamAV processes have been exercised locally; see `implementation-status.md` for their exact scope. They do not establish container or hosted-service behavior.

## Selected authentication and operational telemetry

`workload.bicep` defaults to `authentication={provider:'supabase'}` and `telemetry={provider:'console'}`. Existing initial-profile parameters remain usable. Supabase settings are optional in the deployment connection/reference shapes so an Entra + Azure Blob profile can omit them; startup validates every dependency required by the actual selected authentication/storage providers. Selecting Entra while retaining Supabase storage still requires the Supabase URL/service-role reference.

The sealed Entra selector requires tenant/client/subdomain, separate login and directory secret references, directory client ID, MFA issuer/active key/reference and literal `hosted_sspr` recovery mode. Non-secret settings enter the environment; the three secret references merge into the allowlisted Key Vault map. The selected monitor group requires its connection secret reference, selects `azure_monitor` and explicitly disables SDK Statsbeat. Secret values belong in Key Vault; selector groups carry names/versions. Pinned reference validation and canonical endpoint/origin checks run again at startup. All hosted Azure SDK credentials use the workload's explicit managed identity.

`workload.entra.example.bicepparam` is a complete synthetic selector example with Azure Blob and telemetry; replace reviewed resource IDs, provider settings, immutable application image digest and pinned references before applying. Create/configure the actual External ID application/user flows/consent, operator bootstrap, storage registration and Application Insights prerequisites through authorized operations. This template does not create an External ID tenant/app, directory consent, PostgreSQL service, SMTP account, Application Insights resource or identity migration.

For an approved existing Application Insights resource in the same resource group, the optional access-template `telemetry={provider:'azure_monitor',applicationInsightsName:'...'}` grants Monitoring Metrics Publisher to the **web** identity at that exact resource. Console is the access-template default; the job identity receives no telemetry grant. The telemetry role does not grant query/admin privileges or change local authentication. Review/disable local authentication through the approved resource-management process and verify bearer-only acceptance; review existing settings before updating a resource. Match the connection setting to that resource and keep staging/production scopes distinct.

Run `pnpm check:infra` with the pinned compiler before review. It compiles both workload examples, rejects incomplete/unsupported selector groups and plaintext credential connection fields, checks generated environment/reference mappings and inspects the exact publisher role scope/principal. These offline checks do not apply roles, resolve Key Vault values, verify Graph consent, obtain a real managed token or establish service/browser/ingestion behavior. Repeat those gates in staging after authorization.

## Recovery rehearsal

The owned native gate now includes a real PostgreSQL 17.11 custom-archive restore, exact data/security comparison, corrupted/conflicting restore denial and guarded authentication quarantine. Dump/restore clients are mandatory; CI source prepares them from a pinned official archive. See `backup-and-restore.md` for tooling, the owner-only operation, post-cut-point side-effect reconciliation, external object/provider recovery and staged cutover/rollback evidence. Hosted recovery, offsite retention and production cutover remain unverified.

## Local contention versus hosted load

`pnpm check:load-native` now provides a fixed, owned-cluster service/database contention check, separate from native correctness and production HTTP/package checks. It checks exact writes/audits, duplicate submissions, mixed client isolation, shared quotas and pool context cleanup while reporting aggregate latency. See `database-verification.md` and `verification/native-mixed-load-result.json` for the measured scope. CI invokes it on a fresh cluster. It does not complete the representative sustained staging-load gate: that needs an authorized target, realistic data/traffic, reviewed latency/error budgets, actual dependencies, overload recovery and operator-observed alerts.

## Scanner policy wiring

`infra/scanner/policy.json` supplies the reviewed ClamD and FreshClam settings. Azure imports the policy and binds the scanner sidecar to loopback. The integrated Compose environment must match the same settings, with an internal bridge listener and no published scanner port. The native real-engine gate consumes these settings and tests the larger effective file/stream limits. See `private-reports.md` for bounds, source verification of the pinned entrypoint and live effective-policy/freshness/reload gates. Bicep/Compose checks verify rendering and policy retention; they do not run a container or establish actual update health.

### Direct database maintenance

The current staging runtime uses `SCHEDULER_PROVIDER=database`. Supabase pg_cron owns the `nova-maintenance-staging` SQL job, independent of the temporary web URL and Mac app. The owner-guarded operation, role boundaries, actual execution/expiry evidence, normal cadence and first-tick evidence are in `database-scheduler.md` and `verification/database-scheduler-result-2026-11-14.json`. No shared HTTP scheduler key was added. Pause the exact database job before restore/quarantine and rearm it only after reviewed cutover. Monitoring/alert delivery and cloud web hosting are not established by this job.

## Education staging refresh — 14 November 2026

The old classics-shoot-white-for Quick Tunnel expired. Current origin is https://coverage-textbook-recognize-sms.trycloudflare.com . Site URL and both exact Auth callbacks were rotated to this origin, old callbacks removed, and the application/private runtime environment and ingress host updated together. The current copied standalone release is `education-final-20261114`; existing ports/jobs and Node 24.22.3 remain. `EDUCATION_ENABLED=true` uses the existing namespaced contact HMAC secret and trusted ingress; email sending is not part of Education. Migration `20261114000100_education_requests.sql` is applied to the existing staging project. See `verification/education-live-result-2026-11-14.json` for local/staging evidence. Shared test credentials are unchanged; no paid resource or production deployment occurred.
