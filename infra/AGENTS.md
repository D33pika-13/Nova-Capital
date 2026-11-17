# Infrastructure and deployment

- Maintain separate local, staging and production profiles. Inject secrets securely; use Azure managed identity and Key Vault where supported.
- Keep deployments reproducible, with health checks, restricted service access, logs, alerts, backups and rollback procedures.
- Verify current service quotas, commercial terms and expected costs before provisioning. No paid provisioning or production deployment without applicable authorization.
- Staging must verify real auth callbacks/email, HTTPS/session cookies, database RLS, private storage, shared limits and provider connectivity.
- Rehearse migrations and restore. Production verification uses safe smoke checks; do not perform destructive tests against real client data.
