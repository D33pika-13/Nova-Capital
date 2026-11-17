# Owned local load checks

- Run only through `check-native-database.mjs --load`; reuse the verified NativeFixture cluster ownership checks. Never accept arbitrary database URLs, remote endpoints or real customer records.
- Keep the workload fixed and bounded. Measure aggregate latency and pool pressure while asserting identity isolation, audit/idempotency and shared-limit invariants.
- Do not turn local timings into hosted throughput promises or business SLOs. Keep load results separate from ordinary native tests, staging journeys and production evidence.
- Drain all workers before closing pools. Print only fixed aggregate operational fields; no identities, connection settings, credentials or records.
