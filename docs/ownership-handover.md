# Ownership handover

Prepared 17 November 2026. Intended ongoing project owner: **Deepika**. Developer: **Sunny Chandel**. Repository must remain private. Source delivery and technical account ownership are tracked separately.

| Asset | Current handover state | Completion evidence needed |
|---|---|---|
| GitHub source repository | Private [sunny-chandel/nova-capital-website](https://github.com/sunny-chandel/nova-capital-website) created and source pushed; Deepika’s GitHub identity requested on WhatsApp (delivered 17 November) | Private repo pushed, exact account verified, targeted invite/transfer accepted and resulting owner verified |
| Supabase project/Auth/DB/Storage/Cron | Existing developer-managed staging project; owner access not transferred | Correct workspace/project invitation accepted or a verified owner-resource migration |
| Mailtrap sandbox/Auth SMTP | Existing test capture profile; owner access not transferred | Owner workspace/inbox access or replacement transport and capture verification |
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

Deepika’s targeted access invitation and repository ownership transfer are pending her verified GitHub identity. Provider ownership and secret delivery are also pending; source publication does not complete them.
