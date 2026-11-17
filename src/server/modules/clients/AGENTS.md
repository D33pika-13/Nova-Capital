# Clients module

- Responsibility: Admin client records, unique client IDs, invitations and lifecycle management.
- Implement application behavior in focused classes behind typed interfaces with constructor injection. Follow parent backend rules.
- Enforce verified identity, role and ownership checks at service boundaries; do not accept request-supplied identity as authority.
- Required verification: Verify admin-only CRUD, client ID uniqueness, safe invitation retries, status transitions and actor audit records.
