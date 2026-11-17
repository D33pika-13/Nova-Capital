# Reports module

- Responsibility: Private report metadata, uploads and authorized downloads.
- Implement application behavior in focused classes behind typed interfaces with constructor injection. Follow parent backend rules.
- Enforce verified identity, role and ownership checks at service boundaries; do not accept request-supplied identity as authority.
- Required verification: Verify ownership, file type/size and malware-scanning policy, path validation, expiring downloads and upload failure cleanup. Fail closed when required scanning is unavailable.

- A scanner clean prefix is insufficient: require full stream transmission and a single complete bounded reply before publication. Verify early replies, later/trailing records, timeouts and fragmented valid replies; keep actual engine/signature checks separate from protocol fixtures.
