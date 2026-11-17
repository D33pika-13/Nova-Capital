# Pinned dependency patches

- The Next 16.4.6 shutdown patch awaits the trusted process-local NOVA hook after HTTP/after work drains and before signal exit. It retains Next's signal handling and adds a fixed outer deadline with redacted errors.
- Keep this patch limited to the production cleanup boundary in the pinned CommonJS/ESM entrypoints. Review/rebase or remove it with a Next upgrade; never bypass a failed patch or silently omit it from Docker/CI.
- Verify frozen installation, full application checks and the isolated packaged shutdown probe (in-flight response, callback ordering, both signals, failure privacy and timeout). Local proof does not establish a hosted drain budget or Azure ingestion.
