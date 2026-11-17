# Owner operations

- Keep optional provider setup and recovery outside portable application migrations.
- Require explicit owner, database target, environment and operation intent before mutation; never assume a session is staging.
- Preserve provider-managed owner grants, business/audit history and least-privilege runtime boundaries. Never add passwords/tokens to SQL, commands or output.
- Database scheduler jobs must use bounded work, no human identity and protected operational records. Pause the exact owned jobs before restore; no automatic post-restore reactivation.
- Test guards and denial locally, then separately verify actual provider execution/terminal results. Synthetic Cron functions do not establish a live schedule. No paid resources or production operations without user authorization.
