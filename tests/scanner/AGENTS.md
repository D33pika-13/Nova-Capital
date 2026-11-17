# Real scanner verification

- Run only through `check-native-scanner.mjs` with reviewed ClamAV tools and official definitions. The runner creates its own private daemon/config/socket; never accept an arbitrary scanner endpoint.
- Verify the owned fixture marker and process before test traffic. Use synthetic clean bytes and the harmless EICAR test string only; never real malware or customer files.
- Keep real engine/transport results separate from signature freshness, hosted image compatibility and full authenticated storage/browser journeys. No skipped result counts as passed.
- Stop the owned process and remove its private fixture on all outcomes. Preserve operator-supplied tools and databases.
