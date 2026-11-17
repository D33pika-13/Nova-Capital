# Offers module

- Responsibility: Offers, publication windows, announcements and recipient visibility.
- Implement application behavior in focused classes behind typed interfaces with constructor injection. Follow parent backend rules.
- Enforce verified identity, role and ownership checks at service boundaries; do not accept request-supplied identity as authority.
- Required verification: Verify draft/published/expired visibility, timezone boundaries, recipient isolation and repeatable scheduled expiry.

- Announcements use explicit retained recipient memberships and versioned read acknowledgments. Clients receive no other recipient identities, cannot edit content or timestamps, and can acknowledge only their own currently published version.
- Scheduled expiry has a separate bearer credential and narrow database capability; never use caller-supplied expiry dates or impersonate an admin. Keep maintenance logs free of secrets and distinguish tested source from a verified hosted schedule.

- Offer images are scanned and normalized in a credential-free child process, stored privately and checksum verified before version-guarded attachment. Public delivery must use anonymous publication visibility, recheck after retrieval and bypass all optimizer/CDN caching. Failure cleanup may delete only confirmed aborted objects; never delete ready history.

- Maintenance terminal history is private, with origin/actor derived from trusted context. Commit safe ordinary failures after rolling back partial batch work; preserve connection/commit uncertainty. Read status only under independent admin MFA checks. Manual work and pre-recovery history must not establish scheduled freshness; use database observation time and a validated configured threshold.

- Derive maintenance telemetry provenance only from the authorized server path (`scheduler` versus verified `admin`); never accept it from request fields. Monitoring failures must not retry a committed batch. Keep confirmed failure and uncertain commit/transport outcomes distinct.
