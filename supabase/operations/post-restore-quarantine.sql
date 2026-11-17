-- OWNER-ONLY RECOVERY OPERATION, not an application migration.
-- Keep the restored database isolated from app/jobs/outbound providers.
-- Explicitly set nova.restore_target to this database and nova.restore_operation
-- to a reviewed operation UUID, and nova.restore_environment to test/staging/production
-- on the same owner session before executing.
begin;
do $$
begin
  if not exists(select 1 from pg_database where datname=current_database() and pg_has_role(current_user,datdba,'MEMBER')) then
    raise exception 'Restore quarantine requires the database owner' using errcode='42501';
  end if;
  if current_setting('nova.restore_target',true) is distinct from current_database() or nullif(current_setting('nova.restore_operation',true),'') is null or coalesce(current_setting('nova.restore_environment',true),'') not in ('test','staging','production') then
    raise exception 'Explicit restore target and operation are required';
  end if;
  perform current_setting('nova.restore_operation')::uuid;
end $$;
-- A point-in-time copy can resurrect sessions, pending protocol proofs and
-- recovery codes consumed after the backup. Deny those before reopening access.
update private.entra_sessions set revoked_at=clock_timestamp() where revoked_at is null;
delete from private.entra_login_transactions;
delete from private.entra_mfa_challenges;
delete from private.entra_mfa_factors where confirmed_at is null;
update private.entra_mfa_recovery set consumed_at=clock_timestamp() where consumed_at is null;
update private.entra_mfa_factors set last_step=greatest(last_step,floor(extract(epoch from clock_timestamp())/30)::bigint+1) where confirmed_at is not null;
insert into public.audit_logs(actor_id,action,entity,entity_id,after_data)
values(null,'AUTH_QUARANTINE','restore',current_setting('nova.restore_operation')::uuid,
 jsonb_build_object('databaseRole',current_user,'environment',current_setting('nova.restore_environment'),'confirmedFactorsRetained',true));
commit;
-- This does not grant CONNECT, resume jobs, revoke external Supabase sessions,
-- reconcile post-backup status/financial/mail/directory writes or restore files.
