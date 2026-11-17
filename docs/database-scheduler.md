# Database maintenance scheduler

`SCHEDULER_PROVIDER=database` selects an owner-installed PostgreSQL job rather than an HTTP invoker. The existing `MaintenanceService` still authorizes admin work and reads the authoritative private ledger; `/api/maintenance` stays unavailable in this profile, even when a bearer value is supplied. No shared HTTP secret, `pg_net`, Vault secret, Edge Function or additional application credential is needed.

## Prerequisites and installation

Use the isolated staging database first. Apply all normal migrations, including the maintenance ledger. Enable the reviewed `pg_cron` provider separately using the [Supabase installation instructions](https://supabase.com/docs/guides/cron/install). The owner operation deliberately does not recreate/upgrade the extension or grant extra access to provider-managed objects. It checks for the existing Cron relation and scheduling capability. Enabling the extension does not install the application job.

Run `supabase/operations/install-maintenance-scheduler.sql` on the same reviewed database-owner session after setting these intent values:

```sql
select set_config('nova.scheduler_target',current_database(),false);
select set_config('nova.scheduler_environment','staging',false);
select set_config('nova.scheduler_operation','<reviewed-operation-uuid>',false);
select set_config('nova.scheduler_verify_minute','false',false);
-- Execute the reviewed install-maintenance-scheduler.sql file on this session.
```

Use environment-based owner credentials with verified TLS; never pass passwords as command arguments, inject them into the web process or put them in job commands. Only an owner can install or pause this job. The guard checks database ownership, exact database target, environment, operation UUID and cadence intent. The fixed job is `nova-maintenance-<environment>`, active every fifteen minutes. Repeating an unchanged operation is safe; reusing its UUID for a different intent is rejected. Preserve the owner operation/audit ID for review.

For a bounded initial verification in test/staging, `nova.scheduler_verify_minute=true` installs the same job every minute. Production refuses that override. After observing actual executions and business outcomes, rerun with a new operation UUID and `false` to select fifteen minutes. Confirm the final schedule and active state independently through Cron, rather than assuming the install response proves execution. The [Cron quickstart](https://supabase.com/docs/guides/cron/quickstart) documents the provider's schedule and activation APIs.

## Execution and permissions

The fixed command sets a ten-second statement timeout and two-second lock timeout, prunes at most 500 of this job's operational run records older than seven days, switches to `nova_app`, clears request identity and invokes the existing `private.run_maintenance_batch()` capability. Business and audit history is not pruned by Cron metadata cleanup; the private terminal ledger retains its separate thirty-day bounded cleanup policy. Each maintenance batch handles at most 500 ended offers plus its bounded authentication cleanup. More backlog is handled by later scheduled runs and surfaced by admin status.

PostgreSQL 16+ can give a role creator ADMIN membership without SET permission. The installer explicitly permits the existing database owner to switch into the lower-privilege `nova_app` role with `SET TRUE, INHERIT FALSE`; it creates no new login or client grant. See [PostgreSQL role attributes](https://www.postgresql.org/docs/17/role-attributes.html). Application/client roles lose Cron schema/table/function administration; verify effective privileges, including inherited grants, on the actual provider.

Preserve the provider's owner grants. Do not add broad self-grants on provider-owned Cron tables or blindly rerun extension DDL: provider maintenance hooks may need to revise those grants. Initial live verification exposed both the missing SET permission and an installer self-grant conflict. The final installer requires the pre-enabled provider, preserves its owner grants, and the earlier installer-created self-grants were removed without CASCADE. Failed attempts remain visible in Cron history and were not counted as successful maintenance.

## Observation, pausing and recovery

Require both a successful `cron.job_run_details` execution and a committed `private.maintenance_runs` record with `origin=scheduler`, null human actor and `outcome=completed`. The function may commit a safe business failure while the outer SQL dispatch succeeds; SQL dispatch alone is insufficient. Admin `/admin/operations` and its private API show ledger freshness/outcome, not a full cloud-control-plane health report or proof that an operator received an alert.

Pause the exact owned job with an owner call:

```sql
select cron.alter_job(job_id:=jobid,active:=false)
from cron.job
where jobname='nova-maintenance-staging' and database=current_database();
```

Do not drop the extension or erase history to pause work. Before restoring a database, pause matching jobs in the source and restore target and keep workers stopped through authentication quarantine and external side-effect reconciliation. A restored copy must not silently resume an active job before review. Explicitly re-enable after cutover and require a fresh post-quarantine scheduled completion. Hosted restore/recovery and alert delivery remain independent release gates.

The database job does not depend on the Mac-hosted Next.js process or temporary hostname. It still depends on the Supabase database being available; Free-plan pausing, provider outages and capacity limits remain relevant. It does not host the website, scan files, deliver mail or prove Linux container behavior.

## Verification

`database-scheduler.test.ts` uses synthetic Cron functions to test the unchanged owner-operation SQL: owner/intent guards, accelerated production denial, retry/conflict behavior, effective role membership, cleared identity, scheduler-origin terminal rows, limited metadata retention and application-role denial. It does not run the real extension. Configuration and maintenance service tests separately prove provider selection without an HTTP key and denial of HTTP execution.

Actual provider execution, command versions, terminal results, final schedule and current admin status belong in the dated verification artifact and `implementation-status.md`. The portable migration count is unchanged; the provider operation is not a migration or a production authorization.
