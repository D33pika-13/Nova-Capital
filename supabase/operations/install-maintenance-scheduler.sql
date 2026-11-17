-- Owner operation, not a portable migration. Enable reviewed pg_cron separately first.
-- On the same owner session, set nova.scheduler_target=current_database(),
-- nova.scheduler_environment=test|staging|production, nova.scheduler_operation=UUID.
-- Optional nova.scheduler_verify_minute=true is allowed only in test/staging.
begin;
do $$
begin
  if not exists(select 1 from pg_database where datname=current_database() and pg_has_role(current_user,datdba,'MEMBER')) then
    raise exception 'Scheduler installation requires the database owner' using errcode='42501';
  end if;
  if current_setting('nova.scheduler_target',true) is distinct from current_database()
     or coalesce(current_setting('nova.scheduler_environment',true),'') not in ('test','staging','production')
     or nullif(current_setting('nova.scheduler_operation',true),'') is null then
    raise exception 'Explicit scheduler target, environment and operation are required';
  end if;
  perform current_setting('nova.scheduler_operation')::uuid;
  if coalesce(current_setting('nova.scheduler_verify_minute',true),'false') not in ('true','false')
     or (current_setting('nova.scheduler_verify_minute',true)='true' and current_setting('nova.scheduler_environment')='production') then
    raise exception 'Minute verification is limited to test and staging';
  end if;
end $$;
-- PostgreSQL 16+ role creators can have ADMIN without SET membership.
-- Permit this existing database owner to drop to the runtime role without inheriting it.
grant nova_app to current_user with inherit false, set true;
do $$ begin
  if to_regclass('cron.job') is null or to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'Enable the reviewed pg_cron provider before installing its job';
  end if;
end $$;
do $$
declare role_name text;
begin
  -- Web/database clients must not schedule SQL or inspect scheduler internals.
  revoke all on schema cron from public;
  revoke all on all tables in schema cron from public;
  revoke all on all functions in schema cron from public;
  foreach role_name in array array['nova_app','anon','authenticated','service_role'] loop
    if exists(select 1 from pg_roles where rolname=role_name) then
      execute format('revoke all on schema cron from %I',role_name);
      execute format('revoke all on all tables in schema cron from %I',role_name);
      execute format('revoke all on all functions in schema cron from %I',role_name);
    end if;
  end loop;
end $$;
do $$
declare environment text:=current_setting('nova.scheduler_environment');
  job_name text:='nova-maintenance-'||environment;
  cadence text:=case when current_setting('nova.scheduler_verify_minute',true)='true' then '* * * * *' else '*/15 * * * *' end;
  command_text text; scheduled_id bigint; prior jsonb; evidence jsonb;
begin
  if exists(select 1 from cron.job where jobname=job_name and username<>current_user) then
    raise exception 'Scheduler job belongs to a different operator';
  end if;
  evidence:=jsonb_build_object('provider','database','environment',environment,'jobName',job_name,'schedule',cadence,'commandVersion',2);
  select after_data into prior from public.audit_logs where action='SCHEDULER_CONFIGURE' and entity='operations'
    and entity_id=current_setting('nova.scheduler_operation')::uuid limit 1;
  if found and prior<>evidence then raise exception 'Scheduler operation identifier was reused'; end if;
  -- Job history is operational metadata only. Never prune business/audit records.
  -- Execution then drops to the existing least-privilege role and clears identity.
  command_text:=format($job$
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
DELETE FROM cron.job_run_details WHERE runid IN (
  SELECT r.runid FROM cron.job_run_details r JOIN cron.job j USING(jobid)
  WHERE j.jobname=%L AND j.username=current_user AND j.database=current_database()
    AND r.end_time<now()-interval '7 days' ORDER BY r.end_time,r.runid LIMIT 500
);
SET LOCAL ROLE nova_app;
SELECT set_config('app.provider','',true),set_config('app.subject','',true),set_config('app.assurance','',true);
SELECT * FROM private.run_maintenance_batch();
$job$,job_name);
  scheduled_id:=cron.schedule(job_name,cadence,command_text);
  perform cron.alter_job(job_id:=scheduled_id,active:=true);
  if prior is null then
    insert into public.audit_logs(actor_id,action,entity,entity_id,after_data)
      values(null,'SCHEDULER_CONFIGURE','operations',current_setting('nova.scheduler_operation')::uuid,evidence);
  end if;
end $$;
commit;
-- Inspect both cron.job_run_details and private.maintenance_runs. SQL dispatch
-- success alone does not prove a completed business batch. Pause with owner-only
-- cron.alter_job(active:=false); do not drop the extension or erase run history.
