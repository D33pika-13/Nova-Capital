# Private credential and account handover checklist

This file is a checklist, not a credential store. Do not fill it with secret values. Send actual credentials separately to the verified owner using an agreed private channel. Prefer account/workspace invitations and owner-controlled secret rotation to sharing the developer’s personal account password. Record acceptance separately from a message being sent.

| Access item | What the owner needs privately | What must not be placed in Git |
|---|---|---|
| GitHub | Verified username, targeted invite/transfer and repository acceptance | Personal access tokens, SSH private keys or account password |
| Supabase dashboard | Invitation to the correct organization/project and confirmation of the intended role | Developer’s personal provider login, OTP or recovery codes |
| Supabase app integration | Project URL, anon/publishable setting and server-only service role value for the selected SDK profile | Service role/secret key and refreshed Auth session tokens |
| PostgreSQL runtime | `DATABASE_URL` for `nova_app`, verified TLS/CA settings | Database password/complete credential URL |
| PostgreSQL owner/operator | Separate migration/backup owner connection, project reference and maintenance authority | Owner password/URL in application env, logs or CI |
| Private Storage | Exact buckets/namespaces, owner project access and object export plan | Signed download/upload URLs, private customer files or raw object exports |
| Mailtrap app SMTP | Workspace/inbox access, SMTP host/port/username/password and synthetic sender/recipient | SMTP credentials or mailbox access tokens |
| Supabase Auth SMTP | Dashboard transport settings, templates and callback URLs | SMTP password in templates/source |
| Website administrator | A correctly mapped owner admin, password delivered privately and own authenticator factor | Admin password, TOTP setup seed, recovery codes or six-digit codes |
| Synthetic test clients | Named synthetic A/B credentials and account roles | Test passwords/factor seeds in README/screenshots/commits |
| Public request protection | Independently delivered `CONTACT_HASH_SECRET`, profile enablement and trusted ingress settings | HMAC secret; caller-supplied IP headers are not a substitute |
| Optional HTTP scheduler | `CRON_SECRET` only if explicitly selecting local/external HTTP mode | Shared Cron secret in commands/URLs; current database scheduler needs no HTTP credential |
| Backup custody | Encrypted bundle, independently protected key and recovery instructions | Backup key, plaintext database dump, cookies or downloaded private reports |
| Optional AI/Azure | Only selected provider’s model/key/managed-identity/Key Vault settings after approval | OpenAI keys, Entra client secrets/MFA encryption keys and unrelated tenant credentials |

## Owner acceptance steps

1. Verify the owner’s GitHub identity and provider invitation email through the existing Deepika/dipu conversation.
2. Accept the private repo invite/ownership transfer. Confirm the GitHub owner/visibility on the repository, not just in WhatsApp.
3. Accept provider workspace/project invitations, or create owner-controlled replacement resources. Do not change project location while the app still points to the old DB/storage without a migration/cutover plan.
4. Transfer private app/operator/test settings separately, with clear environment and purpose labels. Keep owner access out of the app runtime. Do not paste secrets into an issue, PR, commit, README or public CI log.
5. Verify the owner’s independent admin MFA and recovery process before removing developer access or rotating keys. Credential-changing browser steps require the account holder’s own entry.
6. Rotate the selected secrets deliberately; update the app and provider configuration together, run staging checks, then acknowledge successful owner operation. Remove temporary developer access only after verified takeover.

No private credentials or provider ownership are transferred merely because this checklist exists. See `ownership-handover.md` for the current observed state.
