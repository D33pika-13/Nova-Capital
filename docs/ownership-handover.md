# Ownership handover

Prepared 17 November 2026. Intended ongoing project owner: **Deepika**, verified GitHub account **D33pika-13**. Developer: **Sunny Chandel**. Repository must remain private. Source delivery and technical account ownership are tracked separately.

| Asset | Current handover state | Completion evidence needed |
|---|---|---|
| GitHub source repository | Private [sunny-chandel/nova-capital-website](https://github.com/sunny-chandel/nova-capital-website) created and source pushed; write-access invitation sent to `D33pika-13`; ownership transfer initiated and awaiting her acceptance | Private repo pushed, exact account verified, targeted invite/transfer accepted and resulting owner verified |
| Supabase project/Auth/DB/Storage/Cron | Existing developer-managed staging project; owner access not transferred | Owner invitation sent to the privately confirmed email after explicit user approval; acceptance still pending |
| Mailtrap sandbox/Auth SMTP | Existing test capture profile; owner access not transferred | Current Free account blocks another user; owner-controlled free sandbox requested on WhatsApp, then private SMTP configuration and capture verification required |
| Website admin/test accounts | Existing synthetic fixtures; owner-specific credentials/factor handover separate | Owner can sign in with independent MFA and operate safely |
| Hosting/domain/scanner/ingress | Temporary developer Mac and Quick Tunnel | Owner-selected durable hosting/domain and actual deployment checks, or an explicitly accepted temporary local arrangement |
| Private environment and backup keys | Remain outside Git | Confirmed private credential/key delivery and successful owner-run checks |
| Production release | Not deployed or accepted | Business/legal inputs, provider/operational gates, explicit deployment authorization and production verification |

## Source handover procedure

1. Review repository candidates for environment files, credentials, cookies, signed URLs, private exports and screenshots. Commit only source, configuration templates, migrations, synthetic tests, infrastructure definitions and reviewed documentation/result summaries.
2. Create a private repository under the verified `sunny-chandel` account. Until a verified transfer is accepted, Sunny remains its technical GitHub owner. A collaborator invitation is not an ownership transfer.
3. Use the verified Deepika GitHub account/email from the existing WhatsApp contact. Do not choose a similar public profile by name alone. Arrange the targeted invite/transfer and send the actual acceptance link/instructions in that conversation.
4. Keep the repository private through the transfer. Confirm the resulting namespace, visibility and owner permissions. Update this file after observed changes.
5. Transfer each provider separately; GitHub repository ownership does not grant Supabase, Mailtrap, hosting, domain, backup or MFA access. Do not delete current resources or revoke working developer access before accepted owner operation.

The initial source push uses a skip-CI commit marker to avoid launching the four potentially expensive workflow jobs before the owner reviews runner budgets. Workflow source remains included. No remote CI success is implied; remove the skip marker on a future reviewed commit or run the configured checks through an approved workflow trigger. No production deployment workflow is configured by this handover.

For integration details and a private credential checklist see [integrations and operations](integrations-and-operations.md) and [credential handover](credential-handover.md).

## Source publication verification — 17 November 2026

Initial source commit `b868ded58c999e39d83be833dbdb04d8f7cdcc8b` was pushed to `main` and matched GitHub’s remote commit. The initial remote tree contained 490 source/documentation/result files, with `.env.example` as its only environment file. A pre-publication scan found no exact matches to the existing private app/operator/test secret values and no matching private-key or real-token patterns. Raw screenshots, backups and private environment material remain excluded. GitHub confirmed `PRIVATE`, current technical owner `sunny-chandel`, current developer permission `ADMIN`. No Actions run was triggered by the skip-CI source commit. These checks concern source delivery, not new feature/staging/production tests.

Deepika’s GitHub identity was subsequently confirmed as `D33pika-13`. Write-access invitation `344454179` was created and repository transfer was initiated; GitHub settings showed “being transferred to @D33pika-13.” Both require her acceptance. Supabase Owner invitation was sent with the user’s explicit confirmation. Provider acceptance and private credential delivery remain pending.

The repository/README links and integration handover summary were delivered to Deepika/dipu on WhatsApp on 17 November at 6:27 pm IST. The message explicitly explains that access/transfer are still pending her GitHub identity; no invitation acceptance link has been fabricated.

## Clean source checkout verification — 17 November 2026

Cloned the private repository through the verified developer GitHub account into an isolated temporary directory; Git integrity and the 491-file source tree passed. A frozen-lockfile offline pnpm install completed, the production build/type phase and browser-canary scan passed, and a loopback-only packaged start served Home, login, Education and its preselected webinar form. Protected Education admin services returned 503 as expected for the disabled-provider public-shell profile. The owned test server was shut down. No real Supabase/SMTP credentials or existing staging listeners were used. Evidence: `verification/github-clean-checkout-2026-11-17.json`. This proves source setup with existing developer access, not Deepika’s invitation acceptance or connected-provider operation.

## Targeted invitations and provider handover — 17 November 2026

GitHub verified `D33pika-13` (user ID 177202704). The actual private-repository acceptance link is https://github.com/sunny-chandel/nova-capital-website/invitations . GitHub’s transfer confirmation goes to the email registered on the recipient account and must be accepted within one day, per the official transfer guidance reviewed today. Until acceptance is observed, technical owner remains `sunny-chandel`; privacy remains `PRIVATE`. Do not create a new repository at the old namespace after transfer, because that would disrupt its redirect.

The dedicated Supabase Free organization contains only `project-website-staging`. After the user explicitly approved the full-access Owner role, the dashboard confirmed the invitation was sent and displays the recipient as “Invited · Owner.” No accepted membership is claimed. Existing owner access and all resources are retained.

Mailtrap User Management explicitly reports “Upgrade to add more users” and that the current plan’s user limit is reached. No upgrade or personal-password sharing was performed. Deepika was asked on WhatsApp to create her own free Email Sandbox account, then arrange private replacement SMTP settings; app SMTP and Supabase Auth SMTP must be updated/tested together only after those settings are available.

GitHub acceptance instructions were delivered at 10:34 pm IST; Supabase acceptance and free Mailtrap setup instructions were delivered at 10:38 pm IST. Owner acceptance, free Mailtrap readiness and any owner-specific app-admin/credential cutover remain outstanding.
