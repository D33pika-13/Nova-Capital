# Provider adapters

- Implement typed interfaces as classes for auth, persistence, storage, email, AI and operational dependencies.
- Keep provider SDKs and secrets here or in approved infrastructure modules; expose provider-neutral results and safe errors.
- Validate issuer/audience/session claims and map external identities to stable internal IDs. Preserve application roles/status checks.
- Apply bounded timeouts, safe retry rules and private-file access controls. Do not log tokens or financial payloads.
- Run shared contract tests for every advertised adapter. Configuration examples alone do not establish support.
