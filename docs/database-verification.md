# PostgreSQL connection policy and native verification

Status: application policy/cleanup tests and twenty-five native PostgreSQL 17.11 checks pass locally on macOS ARM64. The existing PGlite suite remains separate. Real Supabase/Azure PostgreSQL networking, hosted trust chains, pooling/quotas and browser/auth/file journeys still require staging verification.

## Connection configuration

```dotenv
DATABASE_URL=postgresql://nova_app:<url-encoded-runtime-password>@<database-host>:5432/postgres
DATABASE_TLS_MODE=verify_full
# Optional public CA PEM bundle with actual newlines:
DATABASE_CA_CERT=
```

`DatabaseConnectionSettings` parses the URL and creates explicit driver fields; it does not pass a connection string back to `pg`. The default verifies the server certificate chain and hostname with TLS 1.2 or stronger and enables supported SCRAM channel binding. An optional public CA bundle is validated as CA certificates. Node's default trusted roots are used when no bundle is supplied. Certificate files, private keys and client-certificate authentication are not accepted through URL parameters.

Supported URL protocols are `postgres:` / `postgresql:`, with an explicit host, nonempty user/password, valid port and a 1–63 character ASCII database identifier. Percent-encode credentials. The only allowed query option is a single matching `sslmode=verify-full`, or `sslmode=disable` in the explicit local mode below. Remove legacy `require`, `verify-ca`, `no-verify`, `uselibpqcompat`, `host`, `user`, `options`, certificate paths and other driver overrides. Invalid configuration reports setting names without the URL, password or PEM payload.

This avoids the [node-postgres connection-string SSL override behavior](https://node-postgres.com/features/ssl). PostgreSQL explains why [certificate and hostname verification protect server identity](https://www.postgresql.org/docs/17/libpq-ssl.html). Explicit driver TLS fields preserve verification despite `PGSSLMODE` defaults. A fixed public search path prevents `PGOPTIONS` from injecting alternate startup settings. Runtime role checks still reject owner/superuser/BYPASSRLS connections; the URL alone is not authority.

Plaintext needs `DATABASE_TLS_MODE=disable`, a development/test environment and one exact local host: localhost, 127.0.0.1, ::1, host.docker.internal or database. It cannot use a CA bundle. Staging/production and remote development hosts cannot disable verification. The local integrated Compose example selects this mode explicitly for local Supabase; the Azure workload fixes verified TLS and may receive a public CA bundle through its sealed connection settings.

Keep database credentials server-only, in the selected environment/Key Vault provider. A CA certificate is public configuration, not a private key. Verify the selected host, certificate chain, network path and least-privilege login against the actual managed database before release. Do not bypass verification to make an untrusted certificate connect.

## Transaction and pool lifecycle

`PostgresDatabase` checks the runtime role, begins a transaction, applies verified identity/MFA context with transaction-local settings, runs the repository operation and commits. A confirmed commit or successful rollback can return the connection to the pool. Unsafe roles, failed begins/role checks, uncertain commits and failed rollbacks discard the connection. This prevents a failed cleanup from leaving a transaction reusable by another request. Unit fault tests preserve the original application error while checking eviction.

`PostgresPoolFactory` handles idle connection errors through fixed operational telemetry fields. It does not forward provider exceptions, URLs, credentials or SQL payloads to the logger. The global pool holds connections only; user identity remains transaction/request scoped.

## Native test runner

With reviewed PostgreSQL 17 server/client binaries and OpenSSL available:

```sh
POSTGRES_BIN_DIR=/path/to/postgresql/bin POSTGRES_CLIENT_BIN_DIR=/path/to/client/bin pnpm check:native-database
```

The restore case also requires `pg_dump` and `pg_restore`; clients default to the server bin directory if `POSTGRES_CLIENT_BIN_DIR` is unset. `build-postgres-test-clients.mjs` provides an explicit source-integrity-checked PostgreSQL 17.11 build into an owned temporary prefix. See [backup/restore tooling and runbook](backup-and-restore.md). Missing clients fail rather than skipping recovery verification.

The runner requires an unprivileged OS user. It creates an owned temporary directory, random database credentials, a test CA/server certificate, a fresh SCRAM-authenticated cluster and a random loopback port. It enables server TLS and passes a private fixture file to the native Vitest configuration. Before migrations, the fixture checks the random cluster marker and owned data directory. It never accepts an arbitrary database URL or seeds an existing database. PostgreSQL roles are created only inside the owned cluster; no OS user or global PostgreSQL service is created.

The runner supervises the server/test process, stops the owned server and removes temporary data, credentials and generated keys on success or failure. Native files are excluded from the default test run; `check:native-database` invokes them explicitly. A missing binary or failed native gate is not counted as a passing/skipped default test.

Local execution used the native binaries in `@embedded-postgres/darwin-arm64@17.11.0-beta.19`, downloaded into a temporary tools directory and checked against npm's SHA-512 package integrity. Package lifecycle scripts were not run; the actual `initdb` identifies PostgreSQL 17.11. The [tool package project](https://github.com/leinelissen/embedded-postgres) documents its platform binaries and symlink manifest. This is test tooling, not an application/runtime dependency.

The CI native job installs the pinned Linux counterpart into the runner's temporary directory without lifecycle scripts. `prepare-postgres-test-tools.mjs` verifies package identity/version and restores only contained manifest links before invoking the owned-cluster runner. It also builds the pinned official dump/restore client source before the native gate. That remote Linux job is configured but has not been observed running.

## Observed native checks

1. All project migrations apply to a fresh real PostgreSQL 17 cluster. The app role connects with verified TLS; an untrusted chain or hostname mismatch fails using the actual `pg` driver.
2. Client A, client B and anonymous operations reuse the same physical connection without crossing profile visibility; transaction identity is cleared after commit.
3. A real SQL failure rolls back before reuse. An owner connection is rejected before application work.
4. Concurrent duplicate financial submissions across separate connections create one record/audit entry and preserve exact decimal values; another client cannot read that investment.
5. Role-column changes are denied by column privileges; client/anonymous/low-assurance admin contexts cannot bypass native authorization/RLS.
6. Two corrections against the same version produce one accepted change and one conflict, leaving one next version.
7. The active-profile lock blocks a competing suspension while a synthetic download capability operation runs; after release/commit the suspended account is denied.
8. Concurrent login-transaction creation across real connections respects the five-flow per-browser capacity, and five competing consumers yield exactly one nonce/verifier result with the row committed deleted.
9. Wrong browser/configuration proofs and expired login transactions are denied; the runtime role cannot directly read private protocol secrets. Bounded cleanup removes expired rows. The owned native runner applies the new migration before these checks; it does not exercise a live Entra exchange or browser session.
10. Concurrent application-session verification and global logout leave prior sessions revoked. Suspension/reactivation does not revive them, runtime direct session-table reads fail, and twelve concurrent issuances retain at most ten active sessions across real connections.
11. A session lookup blocked on an actual PostgreSQL row lock until after expiry returns no identity after the lock is released. The time decision is made after acquiring the lock, not before waiting.

12. The real authenticator service enrolls a synthetic admin and two concurrent TOTP uses yield one elevated session. Competing uses of one recovery code likewise yield exactly one success and one consumed digest; direct factor-table access is denied.
13. A valid recovery challenge blocked on a factor-row lock until after expiry is denied and committed consumed. Its existing elevated session remains usable; an expired challenge cannot rotate it.

14. Concurrent recovery regeneration yields one winner and invalidates prior realm sessions/codes. Concurrent factor removal likewise yields one winner, revokes the remaining realm sessions and requires a new primary session/enrollment.
15. A valid removal proof waiting on a factor lock until the ten-minute recent-primary deadline passes is denied and its challenge consumed. The recovery code remains unused and the current session/factor remain valid.

16. Four competing provisioning claims yield one active checking lease, repeated start attempts yield one creation intent, and an expired creating lease can only reconcile. Stale holders cannot write/complete; three competing completions yield one stable provider mapping. Direct private-ledger reads are denied.
17. A creation-intent request waiting on the actual client profile lock until its lease expires returns false without changing checking state. Lease decisions use current database time after lock acquisition.

18. Recovery purpose survives atomic native transaction consumption: legacy SQL consumers cannot discard it and five competing flow-aware consumers yield one nonce/verifier/purpose result.
19. Verified recovery commits prior-session revocation before minting a new aal1 session. A subsequent synthetic mint failure cannot restore prior sessions; caller-supplied aal2 cannot invoke the first-factor recovery revocation capability.
20. A valid recovery transaction held behind a private protocol-row lock until after expiry returns no nonce/verifier. This case reproduced a pre-fix DELETE-time expiry bug, then passed after consumption explicitly locked before checking time.

21. A consistent real custom archive restores into a fresh CONNECT-quarantined database with matching table digests, sequences, columns/constraints, effective ACLs, RLS, functions and indexes. Damaged archives and DDL conflicts fail without partial restore. Guarded owner quarantine preserves business/audit history, invalidates stale sessions/recovery codes, retains confirmed MFA factors and rechecks runtime isolation/permissions. This is a same-cluster logical restore; cloud/file/external-provider recovery remains separate.

22. Native maintenance commits confirmed terminal history, including an ordinary SQL failure after an offer update; its partial offer/audit changes roll back while the safe failed outcome persists. Client history reads and capability/status calls are denied. The restore rehearsal requires new scheduled evidence after its quarantine audit instead of trusting restored history.

23. A real checked-out native pool connection prevents pool closure and telemetry shutdown until released. After release, pool closure completes before telemetry and further pool queries are rejected. This is a local resource lifecycle test, separate from hosted request draining.

24. Duplicate snapshot submissions across real connections retain one result; two competing corrections have one winner, one conflict and no losing submission marker. A second correction preserves the full immutable chain and one audit per row. Real client reads return exact currency-separated summaries, unknown/zero-basis rules and corrected values; another client cannot read the rows. Client/weak-admin writes, cross-client/changed-date corrections and direct updates/deletes are denied.
25. An owned temporary audit trigger rejects a snapshot's audit insertion. The snapshot, audit and submission marker all roll back. Removing that trigger permits the identical request to succeed and replay with one audit. The trigger/function are removed before the wider restore rehearsal; no production fault mechanism is added.

These checks use synthetic verified-identity fixtures. They do not prove live JWT/session/MFA verification, all concurrency histories, real Storage policies/objects, signed URLs, malware scanning, external email delivery, cloud backups/restore or production deployment. Continue the broader feature/staging/release gates in `implementation-status.md`.


## Bounded local mixed workload

Run a separate fresh cluster using the same reviewed binaries/client tools:

```sh
POSTGRES_BIN_DIR=/path/to/postgresql/bin POSTGRES_CLIENT_BIN_DIR=/path/to/client/bin pnpm check:load-native
```

The runner accepts only no arguments (the 25 correctness checks) or the exact `--load` mode. Unknown options/target arguments fail before cluster setup. Load mode selects `vitest.native-load.config.ts`; the default test run excludes `tests/load/` and cannot count this check as passed without running it. No workload size, database URL or target endpoint is accepted. The same marker, owned-directory, verified TLS, unprivileged role and cleanup rules apply.

Eight workers each execute twelve logical operations through a four-connection application pool: 24 duplicate investment pairs, 24 snapshot writes, 24 own-client reads (each also checks direct cross-client denial), and 24 attempts on one shared database rate-limit key. Admin and client role fixtures are synthetic; real login/session verification and HTTP/UI are outside this check. Exactly seven quota attempts succeed and seventeen are expected denials. Final checks require twelve investments and twelve snapshots per client, exact separate totals and snapshot returns, 48 one-per-row audits, 48 completed submission markers and no pending markers. Four simultaneously retained physical connections must have cleared subject/assurance context. Every worker settles and acquired connections release before pool cleanup, including failure paths.

The final local run passed with four active workload connections and eight peak queued waits. Aggregate measurements are saved in `verification/native-mixed-load-result.json`. Per-logical-operation p95 was 43.89 ms for duplicate writes, 46.53 ms for snapshots, 53.23 ms for isolated reads and 35.27 ms for shared limits; measured elapsed time was 162.20 ms. Operation timings include their service calls/assertions and initial connection setup; total elapsed also includes final integrity checks. Cluster/tool initialization is outside that elapsed time. The owned runner removed data, credentials and TLS keys after completion. Its console interception is disabled only for the fixed load file so its aggregate result remains visible; do not add record/credential logging there.

These are observations from one short macOS ARM64 run, with small synthetic data and no independent production latency target. They are neither a sustained stress test nor a throughput/SLO promise. The local result cannot validate hosted network latency/pooling, realistic database growth, scanner/model/storage/email throughput, multi-replica ingress, external token lifecycle, autoscaling or overload recovery. Staging still requires an approved representative data/traffic model, explicit latency/error/queue budgets, sustained and burst runs, dependency failures, identity-isolation checks throughout, alert evidence and recovery verification. Do not direct this runner at staging/production. The CI native job now invokes load mode after correctness mode on a second owned cluster; remote Linux results remain unobserved.
