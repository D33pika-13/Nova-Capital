# Private report implementation and setup

Status: source implementation with local PostgreSQL, protocol, parser, SDK-contract and presentation checks. Real Supabase Storage, ClamAV definitions/engine and authenticated browser flows still require an integrated environment.

## Publication and original-file integrity

An active MFA-verified admin selects a client, original PDF, title, reporting period and report date. Client IDs are internal UUIDs in API paths; the admin screen also shows the human INV identifier. The backend validates the client association and metadata before sending bytes to the configured private scanner.

Only PDFs are supported initially. Default maximum is 5 MiB, configurable up to 10 MiB. Files must have a valid PDF header, parse successfully, fit the configured page limit and contain no encrypted content, scripts, automatic actions, XFA or embedded attachments. Validation runs in a worker with a processing timeout and heap limit; it is not an operating-system security sandbox. Worker environment variables do not include application credentials. The file is never rewritten or regenerated.

ClamAV must explicitly return a clean INSTREAM result after the complete upload. Unavailable scanners, incomplete/unknown results and processing-limit results do not publish a report. Configure current signatures and engine limits as part of deployment, not as an assumed property of a successful TCP connection.

After validation, a transaction reserves an immutable report record and a generated `<client UUID>/<report UUID>.pdf` object key. The record remains quarantined until an immutable upload and SHA-256 readback verification succeed. Publication records an audit event and timestamp. Retrying the same request, metadata and original file reuses the same record/key; existing objects are never overwritten. A lost acknowledgement can resume safely. Altered input with the same key is rejected.

Storage failures leave a private quarantine record for retry. A checksum-mismatched unpublished report is archived before cleanup is attempted, preventing a concurrent publish after deletion. Published reports are not automatically deleted. Archival retains records and original clean files; clients lose access to newly issued links. Admins may retrieve previously published archived files for historical review, subject to current MFA and checksum checks. Unpublished/legacy quarantined files cannot be downloaded through the application.

## Storage installation

Apply all migrations as the owner to a dedicated app database/project. Migration `20261110000300_private_reports.sql` configures a private `client-reports` bucket when a Supabase Storage schema is present. It installs a restrictive policy denying direct `anon`/`authenticated` access even if another permissive policy exists. The backend service key performs storage operations only after application authorization and metadata RLS checks.

For a different dedicated report bucket, set REPORT_BUCKET and, as the migration owner, run:

```sql
select private.configure_report_bucket('your-dedicated-report-bucket', 10485760);
```

This is an owner-only installation action. Do not point it at an unrelated bucket. The application runtime role cannot change bucket policy or registry. Runtime checks require private bucket visibility, the expected restrictive policy, PDF-only MIME restrictions and a bounded file-size limit. Missing/tampered policy or a public bucket fails closed.

Private buckets and service-key behavior follow the [Supabase access-control model](https://supabase.com/docs/guides/storage/security/access-control). Downloads use [short-lived signed URLs](https://supabase.com/docs/guides/storage/buckets/fundamentals); permanent public URLs are never returned.

Existing metadata rows without verified hashes/scans are demoted to quarantine by the migration. Preserve their original private objects and review/rescan them through a new upload before publication. Do not edit already-applied migrations. Storage provider/bucket changes require an explicit, audited file and metadata migration; changing configuration alone does not migrate old reports.

## ClamAV connection

Configure MALWARE_SCANNER_PROVIDER=clamav, CLAMAV_HOST, CLAMAV_PORT, and SCAN_TIMEOUT_MS. CLAMAV_HOST is required for an enabled service profile. There is no production skip-scanning option. The development public shell still runs without connected services.

Run the daemon on loopback or an isolated private service network. The [ClamAV TCP protocol does not authenticate or encrypt traffic](https://docs.clamav.net/manual/Usage/Scanning.html); do not expose it to the public Internet. The driver sends binary chunks using [INSTREAM framing](https://docs.clamav.net/manual/Usage/ClamdProtocol.html), with no user-supplied filesystem paths.

Install and operate a supported ClamAV release using the [official setup guidance](https://docs.clamav.net/manual/Installing/Docker.html). Maintain signatures with FreshClam. Configure daemon stream/file limits to accommodate the application's maximum upload size, enable PDF scanning and encrypted/limit alerts, and bound expanded scan size, recursion, scan time and concurrency. Reserve memory using the vendor's current recommendations; daemon startup and signature reload need more than the app worker's heap limit.

No Docker/daemon installation or cloud provisioning was performed in this task. Local protocol tests use a deliberately synthetic loopback daemon response; they do not prove a live malware engine or current definitions. Verify those separately in staging.

## Dates, downloads and APIs

Report/period dates are calendar dates in REPORT_TIME_ZONE (default Asia/Kolkata). The report date cannot be future in that business timezone, and period start <= period end <= report date. Upload/publication timestamps remain UTC instants. Investment/snapshot reporting timestamps retain their separate UTC policy.

- GET/POST `/api/admin/clients/:id/reports`: list all admin metadata, or upload raw application/pdf bytes. POST carries percent-encoded JSON metadata in X-Report-Metadata: requestId, title, fileName, periodStart, periodEnd, reportDate. Metadata is bounded; unknown fields are rejected.
- POST `/api/admin/reports/:id`: archive using requestId and expectedStatus (quarantined/available).
- GET `/api/portal/reports`: list only the verified client's published reports, without private object paths, hashes or credentials.
- GET `/api/reports/:id/download`: reauthorize, verify original-file checksum and redirect to a short-lived attachment URL. Original Unicode filenames are preserved. No caller-selected client identity or object path is accepted.

Download TTL defaults to 60 seconds and is bounded to 10–120 seconds. Issued URLs are bearer capabilities and may remain valid until expiry after suspension/archival. New URL issuance holds a shared lock on the active profile during the final readback/signing operation so a committed status change cannot be bypassed by a stale earlier profile check. Reproduce concurrency checks on native PostgreSQL in staging.

New upload limits do not retroactively prevent downloading a previously validated file within the global 10 MiB supported limit. Readback verification consumes storage bandwidth. API routes bypass proxy body cloning, perform their own session refresh, enforce same-origin mutations and read bodies with explicit byte limits. Page routes retain proxy session refresh and nonce-based scripts.

## Verification gates

Local tests cover: metadata RLS, restrictive object policies, original-byte preservation, parser rejection, scanner framing/failure behavior, interrupted uploads, idempotency, corruption cleanup, archival, cross-client denial, suspension, TTL, SDK operations, original filenames and safe presentation. The production build includes a packaged-worker dependency check and browser-secret canary scan.

Before release verify actual Storage bucket policies and signed-link expiry, real scanner clean/detection/limit behavior with maintained definitions, native PostgreSQL locking, authenticated upload/download journeys, large/chunked request rejection, Unicode attachment filenames, archive/suspension behavior, backup and recovery. Local synthetic adapters do not satisfy these live gates.

## Scanner protocol completion

`ClamAvScanner` uses one NUL-framed INSTREAM command per connection. A clean result is accepted only after all payload/chunk writes and the zero-length terminator have completed, the ordinary response reaches EOF within `SCAN_TIMEOUT_MS`, and the entire bounded response is exactly one NUL-terminated `stream: OK` record. A reply observed before stream completion, missing terminator, duplicate/trailing records (including later TCP packets), unknown result or non-ending response fails closed. A complete single `stream: … FOUND` record returns the fixed malware rejection without exposing the engine's signature text. The existing 4 KiB response cap and per-scan deadline remain in force. Valid fragmented responses are supported.

The framing and normal single-command read-through-EOF behavior follow the [official ClamD protocol examples](https://docs.clamav.net/manual/Usage/ClamdProtocol.html). This adapter does not use IDSESSION. The selected daemon must complete/close ordinary command responses within the configured deadline. TCP is not authenticated/encrypted by this adapter; deployment must keep the daemon on the reviewed loopback/private service network. A correctly framed reply cannot establish that an untrusted daemon actually scanned the file, nor that its engine/definitions/limits are current.

Loopback TCP regression fixtures reproduce early clean replies under backpressure, coalesced/delayed trailing records, incomplete/non-ending responses and valid fragmented replies. A composed service/metadata test proves an ambiguous TCP result neither stores bytes nor publishes a report. These are protocol fixtures, not a real malware-engine run. Actual clean/EICAR/limit tests, maintained definitions, daemon compatibility/capacity and authenticated file journeys remain required staging checks; no public fault endpoint or scanner bypass is provided.


## Real local engine verification

Run the dedicated command with reviewed ClamAV 1.5.4 tools and official definition archives (daily/main/bytecode). It never downloads tools/definitions, modifies their directory or targets an existing scanner service:

```sh
CLAMD_BIN=/absolute/reviewed/sbin/clamd \
CLAMAV_DATABASE_DIR=/absolute/reviewed/definitions \
CLAMAV_CERTS_DIR=/absolute/reviewed/certs \
pnpm check:scanner-native
```

Absolute canonical paths without whitespace/config metacharacters are required. The certificate path may be omitted only when using the daemon's properly installed default certificate directory; a relocated 1.5.4 build needs it explicitly. The runner also passes the supported `CVD_CERTS_DIR` setting to its child so database verification uses the same roots. Obtain tools/updates from [official ClamAV sources](https://www.clamav.net/downloads) and keep database verification enabled. A version string alone is not a publisher/integrity check.

The command creates a private temporary directory, random ownership marker, daemon config, PID file and Unix socket. It binds only loopback TCP on a freshly selected port and proves readiness through its private Unix socket plus the exact child PID. Tests validate the marker, owner, process and bounded endpoint before sending synthetic bytes. The runner closes test/daemon children with bounded termination and removes its config/socket/fixture even on failure, preserving reviewed input tools/databases. Unknown target/daemon arguments fail before setup. It requires an unprivileged process and refuses missing tools/archives or a different engine version. The default 905-test suite excludes this five-test gate; missing prerequisites cannot silently count as a passing native engine check.

The owned daemon loads `infra/scanner/policy.json`, the same reviewed policy used for Azure environment rendering and checked against Compose. It sets a 32 MiB file limit, 128 MiB total scan limit, 64 MiB stream limit, heuristic/limit alerts, two scan threads and a bounded queue. Results observed on macOS ARM64:

1. Clean generated PDF and PNG streams pass through the real application adapter, including its EOF requirement.
2. The [harmless EICAR antivirus test pattern](https://www.eicar.org/download-anti-malware-testfile/) is detected both as raw bytes and inside a PDF attachment, with a fixed safe error.
3. A 33 MiB file triggers the engine's limit rejection; a 65 MiB stream triggers transport-limit rejection. Neither returns a clean result.
4. Six simultaneous clean/detected streams retain independent verdicts.
5. `ReportService` publishes a clean PDF through real scanning, PDF validation and PGlite metadata/RLS with an in-memory private-object adapter. A detected PDF adds neither an object nor metadata.

The official macOS 1.5.4 package was verified with Apple's package tools: Cisco Developer ID Installer `DE8Y96K9QP`, trusted timestamp and notarization. Its SHA-256 is `df7fa753e2f9f67f3bc99b2a40a3be7ef559088c68ad6bdf66b4b5764e965bd6`. It was extracted without running its installer or scripts. Because executables hard-code `/usr/local/clamav/lib`, separate temporary test copies received a library rpath and ad-hoc signatures; those copies are modified local tools, not the original notarized binaries. The original signed package is unchanged. No system directory/account/service or global signing/protection policy was changed.

FreshClam downloaded official daily 28179, main 63 and bytecode 339 archives and passed each database load test with `TestDatabases yes`. Daily's recorded build date is 10 November 2026; the main and bytecode bases have older published build dates. The first load test failed because its child used the compiled certificate path; the supported certificate environment setting resolved it without disabling verification. Package provenance, archive input versions/dates and scope are saved in `verification/native-scanner-result.json`. Version/build-date inspection is an observation, not a continuing freshness guarantee.

This closes the local real-engine compatibility/detection gap only for the stated policy and tools. The deployed image's effective config still needs explicit limits and fail-closed `AlertExceedsMax` behavior, maintained definitions/alerting, actual capacity/reload tests and the same clean/EICAR/limit checks. Do not infer that the shipped container defaults apply the native test policy. Full authenticated upload/download, real private storage, hosted networking and production deployment remain open. CI does not yet prepare/run this native engine command; the source command and successful local evidence are separate from a remote job result.


## Shared deployment policy

`infra/scanner/policy.json` is the source for reviewed scanner settings. Azure imports it into `CLAMD_CONF_*` / `FRESHCLAM_CONF_*` environment values and `FRESHCLAM_CHECKS`; offline Compose checks require its literal environment map to agree. The native engine gate reads the same ClamD settings, so its limit tests exercise the policy rather than smaller unrelated test values. The policy enables `HeuristicAlerts` and `AlertExceedsMax`, bounds file/total/stream bytes, recursion/files, threads and queue, and disables concurrent database reload to limit duplicate engine memory. Its file/stream ceilings exceed the application's independently enforced report/image upload ceilings; this does not enlarge application uploads.

FreshClam is configured for twelve checks per day and database testing, with ClamD self-checking every sixty seconds. These settings express update/reload intent, not a successful current update or continuing freshness guarantee. The upstream initial empty-database bootstrap has its own behavior; the daemon must still load/verify usable definitions before serving. The scanner's exact image, effective config, actual updates/reloads, memory/queue behavior and failure states need staging execution and freshness monitoring. A TCP readiness probe alone proves neither updated definitions nor complete scanning.

The pinned image index `sha256:45fe5149fbee5a46509c9848ef20d0c354b7b2323c9369f285939a37cf33422a` was inspected through the official registry. Linux amd64 platform/config and selected layer digests were verified before reading `/init` and default config files. The actual entrypoint supports the environment prefixes and check-count variable, and its default config has commented entries for the policy fields, so the source mapping has been checked against this pin. No image was built or run; a different digest/repository must be reviewed for the same contract. Environment support from an unrelated image/readme is insufficient. `verification/scanner-policy-result.json` records the exact source evidence and native limits exercised.

Azure sets `CLAMD_CONF_TCPAddr=127.0.0.1` to restrict the sidecar listener; Compose sets `0.0.0.0` within its private bridge without exposing a host port. Keep ingress/firewall and container configuration reviews separate from these source values. Before release, inspect the running daemon's effective settings and repeat clean PDF/PNG, EICAR, engine/stream limit, stale/update failure, reload and capacity checks against the exact deployed image. No source check authorizes provisioning or external notifications.
