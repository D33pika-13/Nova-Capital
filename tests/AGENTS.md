# Verification

- Use unit tests for domain calculations/configuration, integration tests for adapters/RLS/audit behavior, and end-to-end tests for admin/client journeys.
- Prioritize negative access cases: anonymous users, client A/B isolation, forged IDs/roles, expired sessions, suspended accounts and unauthorized report downloads.
- Test admin MFA, financial history/corrections, duplicate requests, upload validation/scanning, chat isolation and read-only tools as features land.
- Use synthetic fixtures and isolated test services. Mocks do not prove cloud integration or RLS.
- Run applicable checks locally and repeat provider-dependent checks in staging. Record exact outcomes and limitations; never report skipped tests as passing.
