# Support assistant

## Scope and configuration

The floating Support panel appears on public pages and the client portal. It supports question suggestions, user/assistant bubbles with UTC timestamps, a pending indicator, retries, new/clear chat, previous client conversations, mobile layout and Escape-to-close with focus return. Public conversations exist only in panel memory and reset when it closes or navigation changes. Client history belongs to the verified active client and resumes from the newest non-cleared conversation. Admin accounts receive public support; reviewing other clients' conversations is not enabled.

`AI_PROVIDER=disabled` is the default. This is explicitly FAQ-only: questions about private values link to the portal; the assistant does not retrieve fresh personal financial facts. Connected clients can still see their own historical chats, whose answers retain their original reporting dates. Public-shell development serves only static approved guidance, without a database, fabricated identity or values.

For the OpenAI adapter, configure the model explicitly and provide the server-side key:

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_MODEL=
SUPPORT_AI_TIMEOUT_MS=8000
SUPPORT_AI_MAX_OUTPUT_TOKENS=256
SUPPORT_AI_DAILY_REQUEST_LIMIT=1000
```

The initial integrated service profile must also be configured. No model is silently selected; verify compatibility, account access, latency, quotas and costs before enabling. No paid request or cloud provisioning has been performed in local verification. Timeout is bounded to 1–20 seconds; output allowance to 64–1024 tokens. The browser has a 30-second request deadline and never retries the model automatically.

`AI_PROVIDER=azure` independently selects the locally contract-tested Azure Responses adapter with an explicit resource endpoint/deployment and managed identity. See [Azure AI setup](azure-support.md) for configuration, supported token audiences and outstanding live gates. OpenAI and Azure share the strict planner/parser; provider transport changes do not change financial permissions. No live Azure inference has been performed.

## AI and financial boundary

The adapter follows the official [Responses API guidance](https://developers.openai.com/api/docs/guides/migrate-to-responses) and [Structured Outputs format](https://developers.openai.com/api/docs/guides/structured-outputs). It calls the fixed HTTPS `/v1/responses` endpoint, sets `store:false`, requests a strict JSON schema and validates the result again locally. The response selects at most three approved topics plus an optional supported currency. Refusals, incomplete responses, unknown tools/prose/extra properties, oversize output, invalid currency/topic and transport failures are rejected. API response-body reading is capped at 32 KiB. There are no model tools or arbitrary executable calls.

Only the current user question and prior topic labels are sent to the model. Prior labels come from the same client's stored conversation. Names, account IDs, snapshots, amounts, holdings, report storage paths, signed URLs, admin notes and prior assistant financial answers are not supplied as model context. User-entered questions themselves can contain private details, so the interface explains that enabled AI receives the question. Common credential/token patterns are rejected before storage/transmission; this is not comprehensive data-loss prevention. Review provider account/data-handling settings before release; `store:false` alone is not a blanket zero-retention assurance.

A server-owned dispatcher runs only fixed read queries using the verified client identity and RLS. The model selects no client identity or SQL. It never writes investments, changes accounts/allocations, executes trades or marks notices read. Financial answers are assembled from database facts by server code, not from model-generated amounts/prose. The supported lookups are:

- Latest non-superseded snapshot per currency, with exact decimal values and reporting dates.
- Snapshot P/L against recorded adjusted basis and simple non-annualized return; missing/zero basis is explained without inventing a percentage. Basis explanations are labeled excerpts.
- Latest snapshot recording time and its separate reporting date.
- Active investment values grouped by asset class within each currency, with exact allocation percentages; these are distinct from snapshot totals.
- Up to five available own report titles/dates, linked to the separately authorized report page.
- Current public offer titles/expiry, linked to full eligibility/terms.
- Up to three published recipient-only announcement excerpts, linked to their full page/read controls.

Currencies are never summed or converted without an authorized conversion basis. Empty/missing data is not displayed as zero. Links are application-owned paths; neither model output nor message text creates a download URL or arbitrary link. Financial answers can become stale after recording and always identify their dates. No advice, forecasts, guaranteed returns or other-client retrieval capability is supplied. Advice/write requests receive a limitation and human-support link. A misclassified request can select only another allowed read operation on the same account, not expand permissions.

If classification fails, the service supplies approved FAQs and contact/portal links without inventing a portfolio answer. Authentication, account status and database/rate-limit dependencies remain fail-closed. Active client status is checked again after retrieval and by the history commit function, so suspension during processing prevents a personal response from being delivered/committed.

## History, replay and clear semantics

Migration `20261111000600_support_history.sql` adds ordered messages, client session titles/clear markers and a private per-client request ledger. Each logical question has a UUID, immutable payload digest and committed send claim before model work. No transaction/connection lock spans the external AI call. Concurrent/repeated claims return the existing completed result or a processing status; they do not call the model twice. Reusing a key with changed question/session is a conflict. A processing request older than two minutes becomes failed, not automatically recharged/replayed.

The actor profile is locked before session/request rows inside the narrow database functions. Only an active client is accepted. Requests contain no caller-selected client ID or role. Sessions/history remain under client RLS; the ledger is not directly readable by the runtime role. User text is persisted when claimed; an assistant reply is appended only on successful authorized completion. A safe FAQ fallback may be recorded when an AI/fact dependency fails. Lost history-commit acknowledgments can be checked by retrying the exact request key.

Clear chat removes current message rows, replaces the session title with a clear marker and nulls cached reply content in the request ledger. A tombstone retains only request/session identifiers, payload digests and statuses, preventing an old/late completion from recreating cleared messages. The UI invalidates pending responses during clear/navigation and blocks new sends while clearing. Clear does not erase provider logs, database backups or already delivered browser content; retention/restore behavior remains an operational review gate. A status-only clear audit records the active client without copying the cleared conversation.

An unanswered final user message after reopening is labeled processing/interrupted. Refresh chat re-reads stored history without another model request; a fresh chat remains available if the original request cannot complete. New chat preserves previous client conversations; they are listed in pages of twenty. A conversation is bounded to one hundred stored messages. Client chat attempts are bounded to thirty/minute and two hundred/day. Support inference is limited to ten/minute and one hundred/day per client; anonymous/public AI shares that allowance. A separate configured global AI daily allowance defaults to one thousand. Failed model attempts still consume allowance; no automatic paid fallback or retry exists. Hosted ingress must add appropriate traffic controls before deployment.

## Verification

Local tests exercise real PostgreSQL migrations/RLS through PGlite, exact financial fixtures, own/cross-client queries, missing/zero bases, reports/offers/recipient notice filters, no notice read-state changes, authenticated revocation, prompt/schema injection, credentials, rate limits, history ordering/replay, ownership, stale claims, conversation bounds/pagination and clear-versus-late-response behavior. OpenAI HTTP requests are intercepted synthetic responses; no live API/model was invoked. Public browser tests verify actual FAQ exchange, absence of private values in FAQ-only mode, clear chat, mobile bounds, Escape/focus and no observed console errors.

On 14 November 2026, the current Supabase/SMTP staging profile passed 56 live HTTP/database result groups (43 initial checks and 13 finalization checks). Actual Client A/B logins establish different verified viewer contexts; anonymous and admin access to client history is denied. Client B cannot list/read/append/clear Client A conversations. Strict input rejects caller identity/role fields and credential patterns, and cross-origin changes fail. Exact and concurrent retries retain a single turn, changed payloads conflict, and FAQ-only replies disclose their limitations without reading personal facts. A bounded live public-limiter test received ten HTTP 200 replies and then safe no-store HTTP 429, within the same window.

Two real least-privilege PostgreSQL connections separately verify clear versus late finish: the clear transaction holds the actor lock, an observer confirms the other backend is blocked using its actual `pg_backend_pid()`, then clear commits and late finish fails with P0002. The ledger stays cancelled with null result, messages remain absent and one status-only clear audit is retained. The initial observer used the pooler connection ID and did not observe the wait; that failed observation is not counted as a pass. The final test uses the actual backend PID inside the transaction. Test fixtures are synthetic and cleared through the supported workflow; no existing tester conversation or financial record was edited.

The browser verifies public FAQ exchange, real Client A login/history selection, new chat, persistence after closing/reopening, clear, and logout/login to Client B with no prior A conversation visible. The 390-pixel panel stays within the viewport; Escape closes it and returns focus to Maya. No console warnings/errors were observed. Exact browser-created history removal and cancelled/null ledger state were independently checked in PostgreSQL. Evidence: `verification/support-live-result-2026-11-14.json` and `support-client-a`, `support-client-mobile`, and `support-client-b-isolation` screenshots dated 2026-11-14.

This verifies the explicitly selected AI-disabled FAQ profile and actual hosted history/isolation/concurrency boundaries, not live model inference. Model compatibility/refusals/timeout, actual financial topic dispatch under inference, provider privacy review, broader pagination/limits, mid-inference suspension/expiry and operational recovery remain separate gates. Existing local intercepted model tests do not replace those live checks. Human escalation uses the existing contact workflow and never automatically sends chat/financial history to another recipient.
