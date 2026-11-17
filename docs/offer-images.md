# Offer images

## Current live verification — 14 November 2026 IST

`verification/phase8-live-result-2026-11-13.json` records actual native ClamAV and packaged Sharp normalization into private Supabase Storage, exact WebP/hash/dimensions, duplicate upload handling, a recognised harmless EICAR-in-ZIP PNG rejected without an additional stored object, private bucket denial for anonymous and authenticated clients, publication/unpublication/time-window checks, response headers and the exact earlier public image URL returning 404 after unpublication. Removal retained ready historical objects privately and was repeatable. The public browser loaded the 96×64 normalized image. The synthetic offer was returned to draft and its image detached.

These are Mac-hosted staging observations. Admin browser create/edit/upload/preview/publish/unpublish now also pass in `verification/admin-browser-result-2026-11-14.json`. Native concurrent races, exact deployed Linux image/resources, ongoing definition freshness, edge/load/recovery and complete release acceptance remain separate gates. The older local-only verification paragraph below is a historical description of that test suite, not a claim that configured staging is still absent.

## Configuration and setup

Apply migration `20261111000400_offer_images.sql` as the migration owner. With a Supabase Storage schema present, it creates/configures the private `offer-images` bucket, accepts only normalized `image/webp` objects and applies a restrictive policy denying direct `anon`/`authenticated` storage access, even alongside existing permissive policies. Backend upload/read also verify the bucket registry, restrictive policy and actual Storage API settings. A public bucket or changed MIME/size settings fail closed.

For a custom bucket, run this owner-only setup against the intended isolated environment and then configure the server accordingly:

```sql
select private.configure_offer_image_bucket('your-offer-images', 5242880);
```

Server settings:

```dotenv
OFFER_IMAGE_BUCKET=offer-images
OFFER_IMAGE_MAX_BYTES=5242880
IMAGE_PROCESSING_TIMEOUT_MS=5000
```

The maximum original upload is 5 MiB; a smaller configured cap is supported. Image/report bucket names must differ. Storage always permits normalized output up to 5 MiB, so use the default 5 MiB bucket limit even when lowering the original-upload cap. `CLAMAV_HOST`, port and scan timeout use the existing scanner adapter; no bypass is provided. Runtime needs Node and Sharp's native libraries for its OS/architecture. Deploy a build produced for the target platform, not a copied development-machine native binary.

## Admin workflow

At `/admin/offers`, create/save the offer first, open it, choose a non-animated PNG/JPEG and supply alt text. Save text edits before uploading. Upload/replacement checks the displayed offer version; a concurrent text/image/expiry change returns 409 rather than overwriting it. Removal also checks the version. Image changes increment the offer version, so other open editors must refresh.

Original bytes are scanned, then a separate decoder process validates real pixels with limits of 4096 pixels per side and 16,777,216 input pixels. APNG and other animated/unsupported formats are rejected. The decoder applies orientation, strips metadata, downsizes without enlargement to at most 1600 pixels per side, and generates WebP at quality 85. The generated copy is scanned again. This display workflow replaces the original image with a normalized copy; private PDF reports continue to preserve their original bytes.

The decoder receives only image bytes, no application credentials. It has a 64 MiB JavaScript heap, one native processing thread, bounded input/output pixels/bytes and a parent-enforced timeout. A native decoder crash is confined to the child process. These controls are not an OS filesystem/network sandbox and do not bound every native allocation; deployment memory/process limits and load checks remain release requirements.

## Storage and failure behavior

After scanning/decoding, an atomic idempotent reservation records source/output SHA-256, alt text, size, dimensions and expected offer version. Immutable objects use `offer UUID/image UUID.webp`, with overwrite disabled. A checksum readback precedes a transaction that marks the image ready and attaches it to the unchanged offer. Public DTOs expose only image ID, alt text and dimensions, never bucket paths or credentials.

A lost storage acknowledgment leaves a private quarantined reservation. Retry the same file, alt text and submission key. Already completed retries do not overwrite data or restore an image subsequently removed/replaced. Changed payloads under the same key return 409. An aborted reservation cannot be reactivated or recreated by retry; start a fresh submission after refreshing.

Corrupt or stale unpublished uploads are marked aborted before cleanup. Only a confirmed immutable aborted row permits object deletion; a ready image is never deleted by failure cleanup. Cleanup failures retain private objects for operator review. Suspended/revoked admins cannot attach a pending image; a private quarantine may remain for a later authorized retry or operator cleanup. Review `offer_images` rows with status `aborted`/`quarantined` and their audit events when reconciling Storage. Confirm the exact object and status before any owner-level cleanup; never delete a ready object or manually promote a quarantine. No automatic retention period is invented.

Replacement/removal retain prior metadata, audit history and ready objects privately. No destructive history deletion is exposed. Decoder upgrades may change normalized output hashes; a pending upload across such an upgrade may need a fresh submission and operator reconciliation rather than overwriting a previously reserved object.

## Public delivery and cache behavior

`GET /api/offers/:id/image` uses an anonymous application database context, even if the request has an admin cookie. It returns only the currently attached, ready image for a published offer within its UTC validity window. Admin previews use a separate independently authorized route. The backend verifies SHA-256 and rechecks the current attachment/publication after fetching bytes. Draft, expired, unpublished, detached and superseded images are unavailable through the public route.

Responses are `image/webp`, inline with a fixed filename, `nosniff` and `no-store`. There are no public bucket URLs or signed image URLs. Next's image optimizer is disabled globally so its alternate endpoint cannot cache an image beyond the publication check. Components use direct unoptimized image routes. Content already downloaded or retained by a viewer cannot be recalled after unpublishing. Edge/proxy configuration must preserve the no-store policy; this is a staging gate.

## Verification

Tests use real PostgreSQL migrations/RLS via PGlite, real Sharp child processes and synthetic image bytes. They cover normalization/orientation/transparency/metadata, invalid/animated/oversized input, deadlines, duplicate/lost acknowledgments, checksums, abort/retry cleanup, stale edits, publication rechecks, removal/history, revocation during upload, admin MFA and immutable associations. The actual Supabase SDK is exercised through intercepted test HTTP responses, not cloud Storage.

`pnpm check:image-package` copies standalone output to an isolated temporary directory, rejects package symlinks escaping that copy, and executes the packaged native decoder. `pnpm check:pdf-package` now uses the same isolation for the existing PDF worker. CI runs both. This verifies the build platform's package and prevents unnoticed fallback to workspace dependencies. Live Supabase/ClamAV, authenticated browser uploads, native concurrent locking, target-host resources and deployed cache behavior remain unverified until staging services are configured.
