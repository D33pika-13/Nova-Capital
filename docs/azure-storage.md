# Azure Blob storage profile

Status: implemented in source with synthetic SDK/HTTP and PostgreSQL contract tests. No Azure account, managed identity, RBAC assignment, container, live delegation link or deployed application has been provisioned or verified.

## Configuration

Select `STORAGE_PROVIDER=azure`, set `AZURE_STORAGE_ACCOUNT_NAME` and the matching `AZURE_STORAGE_ACCOUNT_RESOURCE_ID`, and retain distinct `REPORT_BUCKET` / `OFFER_IMAGE_BUCKET` container names. Resource IDs must identify a storage account in a UUID subscription. This adapter supports Azure public-cloud canonical Blob endpoints and StorageV2 accounts; custom/sovereign endpoints are not supported.

The remaining provider settings are independent: Supabase authentication and PostgreSQL are still required. Existing Supabase credentials support identity/invitations, even when files are in Azure. Azure AI and Key Vault have separate locally contract-tested selectors (see `azure-support.md` and `azure-secrets.md`). Entra application login, monitoring and hosting remain incomplete. SMTP is the selected email path for Azure hosting.

Hosted staging/production use explicit `ManagedIdentityCredential`. Omit `AZURE_CLIENT_ID` for a system-assigned identity; supply the user-assigned identity's client UUID when applicable. No account key, storage connection string or automatic credential fallback is accepted. `AZURE_CREDENTIAL_MODE=azure_cli` is permitted only in development/test and requires an operator's existing CLI login. The application does not perform that login. `AZURE_STORAGE_TIMEOUT_MS` bounds each operation from 1–20 seconds, default 10 seconds.

## Operator prerequisites

`infra/azure/storage.bicep` now defines an optional new public-Azure StorageV2 account and the two private containers. Its synthetic parameter example compiles locally; it has not been applied. Use only when selecting Azure storage, with a separate account per staging/production resource group. Default redundancy is Standard_ZRS; Standard_LRS is an explicit alternative after reviewing regional availability, cost and recovery requirements. The template never silently switches redundancy. Prefixes must be lowercase alphanumeric, begin with a letter and satisfy Azure naming availability.

The template disables anonymous Blob access, Shared Key, cross-tenant replication, SFTP/NFS/local users and hierarchical namespaces. It requires HTTPS/TLS 1.2 and encrypted Blob data. The authenticated public endpoint remains enabled for current direct user-delegation downloads; containers are private and no CORS origins are configured. Public network reachability does not grant anonymous access. A private-only replacement needs a separately designed recipient network or download proxy and its tests.

Blob and container soft delete default to 14 days, configurable from 7–90 days. Deleted bytes remain recoverable and billable during that interval. [Microsoft's soft-delete documentation](https://learn.microsoft.com/en-us/azure/storage/blobs/soft-delete-blob-overview) distinguishes this in-account recovery from broader backup protection. Versioning is explicitly disabled: application uploads are immutable and runtime cleanup does not remove versions/snapshots. No lifecycle rule deletes ready reports or offer images. Confirm retention/legal policy and costs before deployment; backup, recovery credentials, restore rehearsal and account-deletion protection remain separate release gates. Changing these settings on an existing account needs an explicit reviewed data-retention change.

After authorized foundation/storage provisioning, map template outputs `accountName` and `accountResourceId` to runtime `AZURE_STORAGE_ACCOUNT_NAME` and `AZURE_STORAGE_ACCOUNT_RESOURCE_ID`; map `reportContainer`/`imageContainer` to `REPORT_BUCKET`/`OFFER_IMAGE_BUCKET`. Use the same names in `access.bicep`'s Azure storage variant. Apply scoped runtime roles, verify actual account/container policy and register the owner-controlled database locations below before deploying an enabled Azure-storage workload. Template outputs contain no keys or SAS tokens. Provisioning does not migrate existing objects or update the database registry.

Use separate approved resources and identities for each environment. Before use, configure a StorageV2 account with anonymous Blob access disabled, Shared Key disabled, HTTPS required, minimum TLS 1.2 or stronger and Blob encryption enabled. Containers must be private. The application reads account properties through ARM and container properties through the SDK before using files; a missing permission or unverifiable policy fails closed. The database registration below does not prove cloud policy.

Grant the runtime identity account-property read access (`Microsoft.Storage/storageAccounts/read`), container property access, and only the required read/write/delete Blob data capabilities on the report/image containers. Report signing also requires `Microsoft.Storage/storageAccounts/blobServices/generateUserDelegationKey/action` at the account or a parent scope. Select/review role definitions and scopes for the actual environment; do not grant account keys, Owner or resource modification privileges to the runtime. Plan network access so the application can reach ARM, identity and Blob endpoints, and intended report recipients can reach the authorized Blob URL. Private endpoints without recipient access will not support the current direct-download flow.

Microsoft documents the [ARM properties operation](https://learn.microsoft.com/en-us/rest/api/storagerp/storage-accounts/get-properties?view=rest-storagerp-2026-09-01), [delegation signing and its required permission](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-create-user-delegation-sas-javascript), and [user delegation SAS compatibility with Shared Key disabled](https://learn.microsoft.com/en-us/azure/storage/common/shared-key-authorization-prevent).

Apply migrations as the database owner. Migration `20261111000700_azure_storage.sql` adds the owner-controlled location registry and immutable account namespaces. If a database already contains Azure-labeled metadata without an account namespace, investigate and perform a reviewed migration/backfill before applying this constraint; the migration does not guess which account owns a file.

After independently verifying the actual private resources, register their exact account/container/purpose/capacity as the owner, replacing these synthetic examples:

```sql
select private.register_azure_storage('syntheticnova', 'client-reports', 'reports', 5242880);
select private.register_azure_storage('syntheticnova', 'offer-images', 'offer_images', 5242880);
```

The runtime cannot register or directly read registry rows. Configured report capacity must be covered by registration; normalized image output needs 5 MiB capacity even if the original image upload limit is smaller. Registration caps are bounded by the application hard limits (reports 10 MiB; images 5 MiB).

## File behavior and migration

The existing scan/parse/normalize, quarantine, authorization, checksum, audit and publication rules still apply. Uploads use generated UUID paths and `If-None-Match: *`. A duplicate object never overwrites original bytes; the service verifies its SHA-256 before publication. Reads validate MIME, declared length, streamed length and configured bounds. Invalid/truncated responses close the SDK stream. Requests are restricted to the configured HTTPS Blob origin and native transport rejects redirects. Failures return safe errors without tokens or Azure payloads.

Reports receive a read-only, single-blob HTTPS user delegation SAS, with a configured lifetime of 10–120 seconds and no-store disposition. Tokens are bearer capabilities: already-issued links may work until expiry. Fresh links require current application authorization and original-byte verification. Delegation permission failures do not fall back to account keys or public access. Offer images use the existing publication-rechecking application proxy and receive no public or signed Blob URL.

Metadata records the provider, container and account namespace. Account changes are immutable at the database layer and part of Azure upload idempotency. Changing accounts/provider configuration does not move files and makes mismatched records unavailable. Supabase retry payload hashes remain compatible with their existing format. Plan an audited migration of bytes and metadata with checksum inventories, explicit authorization, staging rehearsal and rollback before switching an existing dataset. There is no automated migration tool yet. Cleanup does not delete snapshots; retained Azure snapshots/versions require an operator retention policy and may prevent deletion.

## Verification gates

Local tests use the actual Azure Blob SDK against intercepted fetch responses with synthetic credentials. They cover immutable upload, private account/container policies, bounded/truncated reads, delegation parameters and permission denial, path rejection, deadlines, account registry permissions, immutable metadata and cross-account replay. These tests do not verify Azure RBAC, managed identity, real signatures, encryption, network rules or service availability.

Before advertising Azure support, run staging with real managed identity and least-privilege roles; verify fail-closed policy/permission cases, actual private PDF/image journeys, cross-client and suspended-account denial, original checksums, read-only/expired/tampered SAS behavior, logs without URLs/tokens, publication revocation/cache behavior, native PostgreSQL locking and migration/restore rollback. Complete the other selected Azure adapters and release gates separately. No production or paid provisioning is authorized by this document.
