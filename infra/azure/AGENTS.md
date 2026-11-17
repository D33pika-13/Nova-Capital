# Azure deployment templates

- Keep templates and parameter examples free of credentials. Use pinned images and versioned Key Vault references; scope managed identities to selected resources.
- Compile with the pinned Bicep version and inspect the generated resource/security contracts before any deployment. Compilation does not prove live Azure policy, connectivity or runtime behavior.
- Maintain separate environments, bounded scaling, probes and an explicit rollback procedure. Template application can create billable resources and needs applicable authorization.
