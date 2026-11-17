# Native database verification

- Run only through check-native-database.mjs against its fresh temporary PostgreSQL cluster. Verify the loopback endpoint and random cluster marker before applying SQL.
- Use synthetic identities/records, generated test credentials/certificates and the actual least-privilege adapter. Never accept arbitrary database URLs or production data for these tests.
- Keep native results separate from PGlite and live cloud/browser verification. Stop the owned process and remove temporary data/keys even on failures.

- The restore rehearsal uses reviewed pg_dump/pg_restore only through the runner's explicit client-bin setting. Keep password files/archives inside its private owned root, restore only to a freshly generated database name, deny runtime CONNECT before restore, and verify data/effective privileges before reopening that owned target. Never use arbitrary archive/source/target inputs.
