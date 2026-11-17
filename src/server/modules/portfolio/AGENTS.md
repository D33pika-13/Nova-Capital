# Portfolio module

- Responsibility: Investment records, snapshots, allocation, valuations and return calculations and append-only broker withdrawal reporting.
- Implement application behavior in focused classes behind typed interfaces with constructor injection. Follow parent backend rules.
- Enforce verified identity, role and ownership checks at service boundaries; do not accept request-supplied identity as authority.
- Required verification: Verify ownership, decimal precision, currency/cash-flow assumptions, missing basis, history-preserving corrections and atomic audit writes. Withdrawal records never transfer funds or silently adjust snapshots; corrections retain originals and client/currency ownership.
