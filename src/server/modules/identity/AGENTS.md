# Identity module

- Responsibility: Authentication, sessions, internal identity mapping, roles and account status.
- Implement application behavior in focused classes behind typed interfaces with constructor injection. Follow parent backend rules.
- Enforce verified identity, role and ownership checks at service boundaries; do not accept request-supplied identity as authority.
- Required verification: Verify login/logout/reset, invitation expiry, admin MFA, role escalation denial, suspended sessions and shared login rate limits.
