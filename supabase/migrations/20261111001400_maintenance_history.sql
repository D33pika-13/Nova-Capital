begin;
create table private.maintenance_runs (
  id bigint generated always as identity primary key,
  origin text not null check(origin in ('scheduler','admin')),
  actor_id uuid references public.profiles(id),
  started_at timestamptz not null check(isfinite(started_at)),
  finished_at timestamptz not null check(isfinite(finished_at) and finished_at>=started_at),
  outcome text not null check(outcome in ('completed','failed')),
  expired_offers integer check(expired_offers between 0 and 500),
  check((origin='scheduler' and actor_id is null) or (origin='admin' and actor_id is not null)),
  check((outcome='completed' and expired_offers is not null) or (outcome='failed' and expired_offers is null))
);
create index maintenance_run_origin_time on private.maintenance_runs(origin,finished_at desc,id desc);
create index maintenance_run_retention on private.maintenance_runs(finished_at,id);
alter table private.maintenance_runs enable row level security;
revoke all on private.maintenance_runs from public,nova_app;

-- Auth is checked before the exception subtransaction. Clients cannot turn a
-- forbidden call into an operational failure record or a scheduler heartbeat.
create function private.run_maintenance_batch() returns table(outcome text,expired_offers integer)
language plpgsql security definer set search_path='' as $$
declare started timestamptz:=clock_timestamp(); affected integer; result_status text; source text; actor uuid;
begin
  if nullif(current_setting('app.subject',true),'') is not null then
    if not private.is_admin() then raise exception 'Maintenance denied' using errcode='42501'; end if;
    source:='admin'; actor:=private.current_profile_id();
  else
    source:='scheduler'; actor:=null;
  end if;
  begin
    perform private.cleanup_entra_transactions();
    perform private.cleanup_entra_mfa();
    perform private.cleanup_entra_sessions();
    affected:=private.expire_offers();
    if affected is null or affected<0 or affected>500 then raise exception 'Invalid maintenance count'; end if;
    result_status:='completed';
  exception when others then
    -- Inner writes/audits roll back. Return a safe terminal outcome so the outer
    -- transaction can commit its failure record; never retain SQLERRM or tokens.
    result_status:='failed'; affected:=null;
  end;
  insert into private.maintenance_runs(origin,actor_id,started_at,finished_at,outcome,expired_offers)
    values(source,actor,started,clock_timestamp(),result_status,affected);
  delete from private.maintenance_runs where id in (
    select r.id from private.maintenance_runs r where r.finished_at<clock_timestamp()-interval '30 days'
    order by r.finished_at,r.id limit 500 for update skip locked
  );
  return query select result_status,affected;
end $$;
revoke all on function private.run_maintenance_batch() from public;
grant execute on function private.run_maintenance_batch() to nova_app;

create function private.maintenance_status() returns table(
  observed_at timestamptz,last_scheduled_success_at timestamptz,
  last_scheduled_finished_at timestamptz,last_scheduled_outcome text,
  last_scheduled_expired_offers integer,last_admin_finished_at timestamptz,recovery_boundary_at timestamptz
) language plpgsql security definer set search_path='' as $$
begin
  if not private.is_admin() then raise exception 'Maintenance status denied' using errcode='42501'; end if;
  return query with recovery as (select max(a.created_at) boundary from public.audit_logs a where a.entity='restore' and a.action='AUTH_QUARANTINE') select clock_timestamp(),
    (select max(r.finished_at) from private.maintenance_runs r where r.origin='scheduler' and r.outcome='completed' and (recovery.boundary is null or r.started_at>recovery.boundary)),
    scheduled.finished_at,scheduled.outcome,scheduled.expired_offers,manual.finished_at,recovery.boundary
  from recovery
  left join lateral (select r.finished_at,r.outcome,r.expired_offers from private.maintenance_runs r where r.origin='scheduler' and (recovery.boundary is null or r.started_at>recovery.boundary) order by r.finished_at desc,r.id desc limit 1) scheduled on true
  left join lateral (select r.finished_at from private.maintenance_runs r where r.origin='admin' order by r.finished_at desc,r.id desc limit 1) manual on true;
end $$;
revoke all on function private.maintenance_status() from public;
grant execute on function private.maintenance_status() to nova_app;
commit;
