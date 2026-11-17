# Support module

- Responsibility: Public FAQs, contact escalation, AI adapters and client-isolated chat.
- Implement application behavior in focused classes behind typed interfaces with constructor injection. Follow parent backend rules.
- Enforce verified identity, role and ownership checks at service boundaries; do not accept request-supplied identity as authority.
- Required verification: Verify minimum-data retrieval, session-derived ownership, read-only tools, prompt-injection resistance, safe outages, shared limits and chat isolation. Never send external messages unless authorized.

- Contact sends only to the configured support recipient. Do not persist/log raw contact bodies, emails or network addresses in the request ledger. Use durable one-send claims and exact-payload replay; uncertain/processing submissions never auto-resend. Distinguish provider acceptance from inbox delivery. Trust network headers only behind verified restricted ingress.

- The model selects only validated topics/currency; fixed server queries/renderers supply facts. Never forward stored financial facts, account identities, notes or prior financial answers as model context. Keep the AI endpoint fixed and reject unknown output/tools/prose.
- Persist client turn claims before AI I/O without holding a transaction open. Clear must delete active content/null cached answers and retain a tombstone so late/replayed turns cannot restore it. UI requests must invalidate stale responses on clear, close and account/navigation changes.
