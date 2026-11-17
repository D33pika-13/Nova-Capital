# Backend architecture

- Mark backend-only modules appropriately. Implement services, repositories and adapters as focused TypeScript classes with constructor-injected interfaces.
- Organize features under `modules/<feature>/`; each module owns its AGENTS.md, contracts and application behavior. Keep database/provider implementation details in adapters.
- Wire configured implementations in a composition root. Reject unavailable providers and invalid settings at startup. Never silently fall back for security-critical dependencies.
- Carry verified request-scoped identity explicitly; never store a user's session in a process-wide singleton. Use least-privilege repositories and enforce client ownership in every operation.
- Make financial writes and audit events atomic; use safe retry/idempotency behavior. Redact sensitive logs.
- Test behavior through interfaces, then verify real adapters and database isolation in integration tests.
