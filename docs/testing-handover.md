# Testing handover and release decisions

Updated: 14 November 2026. Requested Deepika changes are implemented and current staging is ready for synthetic testing. Full production release acceptance is still open. The user selected “Finish the staging handover”; production release work is outside this handover. No production deployment, paid services or new external messages are authorized.

## Test links

| Purpose | Link |
|---|---|
| Website | https://coverage-textbook-recognize-sms.trycloudflare.com |
| Client sign-in | https://coverage-textbook-recognize-sms.trycloudflare.com/login |
| Administrator | https://coverage-textbook-recognize-sms.trycloudflare.com/admin |
| Client reports | https://coverage-textbook-recognize-sms.trycloudflare.com/portal/reports |
| Account security | https://coverage-textbook-recognize-sms.trycloudflare.com/portal/security |
| Withdrawal history | https://coverage-textbook-recognize-sms.trycloudflare.com/portal/withdrawals |
| Education | https://coverage-textbook-recognize-sms.trycloudflare.com/education |
| Education admin inbox | https://coverage-textbook-recognize-sms.trycloudflare.com/admin/education |
| Contact test | https://coverage-textbook-recognize-sms.trycloudflare.com/contact |

Use the existing shared synthetic Client A/B/admin credentials. They were not changed by the runtime update. Passwords, factor seeds and provider credentials are intentionally absent from this document. The authorized operator keeps them in the ignored mode-0600 `.env.staging.testing.local`; provider/operator secrets are separate. Admin access requires the existing authenticator code after password sign-in.

This is temporary hybrid staging: the application/scanner/proxy/tunnel depend on the Mac being awake and online. The database scheduler runs independently in Supabase. Restarting the Quick Tunnel can change the URL and requires coordinated callback/configuration updates. A working link now is not a production uptime commitment.

## Short tester pass

1. Open the public pages, FAQ and Benefits. Verify navigation and mobile layout. Legal/company text is marked for review; do not treat it as approved business information.
2. Sign in as Client A. Check the account name/ID, dated values, separate currencies, holdings, snapshot history and withdrawal history. Values are recorded reports, not a broker feed or money movement.
3. Open Private reports and download the assigned synthetic PDF. An administrator visiting that client URL should receive an account-mismatch explanation and sign-out option.
4. Use another browser/private session for Client B. It must not show Client A's records, reports or conversations. Switching accounts in one browser replaces that browser's current session.
5. Open Maya. FAQ-only behavior is expected: live AI is disabled and no fresh personalized financial answer should be invented. Check new chat, reopening own history and clear chat.
6. Inspect Account security. Actual password/MFA changes should use a dedicated test account because shared accounts are used by other testers. Dedicated-fixture password/MFA flows have already been verified.
7. With the authorized admin account, create/edit only clearly named SYNTHETIC clients and records. Check client search/status, financial correction history, report upload and offer/announcement drafts. Keep the shared tester fixtures intact.
8. Open Education and choose either service. Verify the request form preselects it, submit synthetic contact details and see the confirmation. An MFA-admin can review the saved request under Education requests; clients and guests cannot read the inbox.
9. Send only synthetic information through Contact. The page reports email-service acceptance separately from inbox delivery. Messages go to Mailtrap test capture; real company email delivery is not enabled.

For a problem, record the URL, browser/device, account role, steps, expected result, actual result and a screenshot. Do not include passwords, authenticator codes, tokens or provider keys. Tester acceptance is a separate result from the agent's verification; no new Deepika acceptance has been recorded.

## What is established

- Deepika's requested currency, withdrawal, FAQ, Maya, reports and account-security changes are implemented and have recorded staging evidence.
- The latest local checkpoint is 988 passing tests across 80 files, plus lint/type/format/build, package and browser-secret checks.
- Actual staging checks cover selected authentication/MFA, A/B isolation, financial corrections/archive/audit, private files, offers/announcements, contact capture, chat history and database scheduling.
- The final `education-final-20261114` build passes public/protected smoke checks plus actual FAQ fallback, replay and synthetic-chat cleanup (`verification/staging-handover-2026-11-14.json`).
- Node 24.22.3 is deployed. The latest six HTTP/auth/database smoke checks and remote Mailtrap TLS/auth verification pass. No mail was sent by that smoke check.
- An encrypted application-data/file capture was reconstructed in an isolated local cluster. This does not establish managed-cloud Auth/Storage recovery or offsite backups.

Evidence and precise limits: [implementation status](implementation-status.md), [requirements traceability](functional-requirements.md#traceability-and-release-evidence), [deployment profile](deployment.md), [recovery runbook](backup-and-restore.md).

## Inputs and remaining release work

| Item | Current state | Needed to close it |
|---|---|---|
| Company identity and legal content | Temporary NOVA CAPITAL brand; no verified jurisdiction/support identity | Actual company name, operating country/jurisdiction and verified support email; review company/privacy/terms/risk content |
| Hosting and production | Mac/temporary tunnel staging only; no production deployment | Selected production host/domain, reviewed costs/capacity and explicit deployment approval |
| Transactional email | Mailtrap capture verified | Approved real sender/domain and support recipient, then actual inbox verification |
| AI | Explicit FAQ-only profile; adapters locally tested | Provider/model access and authorized usage budget/privacy settings before live inference/financial-tool checks |
| Azure option | Partial adapters/infrastructure and local contracts; complete live profile unsupported | Tenant/resources and same-profile staging verification if Azure is selected; no paid provisioning is authorized |
| Managed database patch | Dashboard shows 17.11.0.018 and offers 17.11.0.019; upstream 17.12 security coverage is unverified | Provider-supported patch assessment/maintenance and post-upgrade checks; no upgrade has been run |
| Production operations | Selected staging tests and local recovery pass | Final recovery target/provider journeys, offsite schedule/key custody, approved RPO/RTO, monitoring/alert receipt, representative workload and target-runtime verification |
| Final acceptance | Agent verification recorded | Tester acceptance, concrete release review and authorized production smoke check |

These are separate release gates. No credentials, missing approvals or unverified provider behavior have been substituted with invented values or passing claims.

The previous classics-shoot-white-for tunnel expired on 14 November. Use only the replacement coverage-textbook-recognize-sms links above. Site URL, exact Auth callback allowlist, application origin and trusted ingress were rotated together. Credentials are unchanged.
