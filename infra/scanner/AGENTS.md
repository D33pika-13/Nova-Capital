# Shared scanner policy

- This public configuration governs the reviewed ClamAV entrypoint environment and native engine test. Keep incomplete/limit-exceeded scans fail-closed, bounded resource use and regular definition checks.
- Verify Compose/Azure rendering agrees with this file. Changing a string in source is not proof an arbitrary image honors it; review the exact immutable image entrypoint and test its effective config.
- Retest actual clean/EICAR/limit behavior after policy or engine changes. Update checks and reload settings do not prove continuing signature freshness or operator-received alerts.
