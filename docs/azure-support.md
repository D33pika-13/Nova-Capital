# Azure support AI profile

Status: implemented in source with intercepted HTTP/synthetic token tests. No Azure model deployment, managed identity assignment, paid inference or live model compatibility has been verified. The full Azure profile remains incomplete.

## Configuration and identity

Select AI independently from file storage or application login:

```dotenv
AI_PROVIDER=azure
AZURE_OPENAI_ENDPOINT=https://synthetic-nova.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=explicit-support-deployment
AZURE_OPENAI_API_VERSION=v1
AZURE_OPENAI_TOKEN_SCOPE=https://cognitiveservices.azure.com/.default
AZURE_CREDENTIAL_MODE=managed_identity
# AZURE_CLIENT_ID=<user-assigned-managed-identity-client-uuid>
SUPPORT_AI_TIMEOUT_MS=8000
SUPPORT_AI_MAX_OUTPUT_TOKENS=256
SUPPORT_AI_DAILY_REQUEST_LIMIT=1000
```

Replace the synthetic resource/deployment with an approved existing deployment supporting Responses v1 and strict Structured Outputs. The deployment name is passed as `model`; a model family name is not a substitute for the deployed resource name. There is no default deployment, model, endpoint, API key or paid fallback. The endpoint must be a public-cloud `https://<resource>.openai.azure.com` origin. Custom gateways, paths, ports, sovereign domains and preview/date-based API versions are rejected. Requests go only to the canonical `/openai/v1/responses` path and reject redirects.

Hosted staging/production require explicit managed identity; an optional `AZURE_CLIENT_ID` selects a user-assigned identity. Development/test may explicitly select `AZURE_CREDENTIAL_MODE=azure_cli` using an existing operator login; the application does not log in. The CLI process timeout uses the AI deadline. No automatic developer credential chain is used. Assign the selected identity the least-privilege inference role on the intended resource (for example, Cognitive Services OpenAI User), review network restrictions and verify actual access in staging. Selecting AI does not require an Azure storage account or change Supabase authentication/PostgreSQL/file settings.

The [Azure Responses REST reference](https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/responses) documents v1, bearer authentication and the Cognitive Services audience. The [Azure Responses guide](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses) currently shows `https://ai.azure.com/.default` in its managed-identity examples. Both exact audiences are allowed configuration values; the default is `https://cognitiveservices.azure.com/.default`. Verify the chosen audience against the actual resource in staging. No arbitrary audience is accepted and no audience retry occurs after a denied request.

## Shared safety and failure contract

`ResponsesSupportPlanner` owns the same prompt, strict schema, input validation and output parser for OpenAI and Azure. Provider-specific transports only authenticate and send the request. This uses the [official OpenAI Structured Outputs contract](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), with additional local validation.

Only a question and up to three approved prior topic labels are sent; there are no account records, client IDs, financial answer history, SQL or tools in the model context. The model returns approved topics and an optional currency. Financial facts and answers remain server-derived under current account authorization/RLS. Client history, quotas, idempotency, clear tombstones and FAQ fallback behavior are unchanged. See `support-assistant.md` for the complete support boundary and privacy limitations of user-entered questions.

The request sets `store:false` and bounded output tokens, with no remote conversation or previous-response ID. Review Azure account, abuse-monitoring, regional processing and retention settings before release; this flag does not prove zero retention. No token or provider error payload is exposed to the browser. Common credential-like input is rejected before identity-token acquisition or inference.

One application deadline covers token acquisition, HTTP headers and bounded response reading (32 KiB). Timeout aborts/cancels work; a late token cannot start inference. Expired/missing tokens, access denials, incompatible deployments, throttling, oversized/truncated/incomplete responses, refusals, unknown tools/topics/currencies and schema injection produce the existing safe FAQ fallback. No request is automatically retried, redirected to another provider or billed through a fallback deployment.

## Verification and remaining gates

Both transports run the same local Responses contract suite. Azure-specific tests cover endpoint/audience/version validation, bearer/deployment fields, safe credential failures, deadline/late-token handling, response cancellation and independent factory selection. Tests use synthetic credentials and intercepted fetch; they do not establish valid Azure signatures, role assignments, model behavior, quotas, latency, costs or region availability.

Before release, verify actual managed identity and role scope, resource/network access, selected audience, deployed model/schema compatibility, refusal/injection cases, quotas, timeout/fallback behavior and cost allowance. Repeat authenticated client/history/clear/suspension/isolation journeys with the selected provider and confirm logs contain no tokens or question/financial payloads. Obtain applicable authorization before provisioning resources or invoking paid inference. Key Vault has separate source/local verification in `azure-secrets.md`; SMTP is selected for Azure-hosted email. The remaining Azure identity/monitoring/hosting, live integrations and release deliverables remain separate work.
