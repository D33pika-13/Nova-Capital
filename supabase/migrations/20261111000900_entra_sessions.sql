begin;
create table private.entra_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  realm_hash text not null check(realm_hash ~ '^[a-f0-9]{64}$'),
  profile_id uuid not null references public.profiles(id),
  identity_id uuid not null references public.provider_identities(id) on delete cascade,
  subject text not null check(length(subject)=73),
  created_at timestamptz not null,
  last_seen_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check(isfinite(created_at) and isfinite(last_seen_at) and isfinite(expires_at)),
  check(expires_at=created_at+interval '8 hours' and last_seen_at>=created_at and last_seen_at<=expires_at),
  check(revoked_at is null or (isfinite(revoked_at) and revoked_at>=created_at))
);
create index on private.entra_sessions(profile_id,realm_hash,created_at);
create index on private.entra_sessions(identity_id);
create index on private.entra_sessions(expires_at);
alter table private.entra_sessions enable row level security;
revoke all on private.entra_sessions from public,nova_app;

create function private.create_entra_session(p_token text,p_realm text) returns table(expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare principal uuid; mapping uuid; subject text; created timestamptz; session_id uuid;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_realm is null or p_realm !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid session proof' using errcode='22023';
  end if;
  if current_setting('app.provider',true) is distinct from 'entra' or current_setting('app.assurance',true) is distinct from 'aal1' then
    return;
  end if;
  select p.id,i.id,i.subject into principal,mapping,subject from public.profiles p join public.provider_identities i on i.profile_id=p.id
  where p.status='active' and i.provider='entra' and i.subject=current_setting('app.subject',true) for update of p;
  if not found then return; end if;
  created:=clock_timestamp();
  -- Keep at most ten active sessions per profile/realm. The profile lock serializes creation and global logout.
  with victims as (
    select s.id from private.entra_sessions s where s.profile_id=principal and s.realm_hash=p_realm and s.revoked_at is null
      and s.expires_at>created and s.last_seen_at>created-interval '30 minutes' order by s.created_at desc,s.id desc offset 9
  ), changed as (
    update private.entra_sessions s set revoked_at=created from victims v where s.id=v.id returning s.id
  ) insert into public.audit_logs(actor_id,action,entity,entity_id,after_data)
    select principal,'REVOKE','application_sessions',id,jsonb_build_object('provider','entra','reason','capacity') from changed;
  insert into private.entra_sessions(token_hash,realm_hash,profile_id,identity_id,subject,created_at,last_seen_at,expires_at)
    values(p_token,p_realm,principal,mapping,subject,created,created,created+interval '8 hours') returning id into session_id;
  insert into public.audit_logs(actor_id,action,entity,entity_id,after_data)
    values(principal,'CREATE','application_sessions',session_id,jsonb_build_object('provider','entra','expiresAt',created+interval '8 hours'));
  return query select created+interval '8 hours';
end $$;

create function private.resolve_entra_session(p_token text,p_realm text) returns table(subject text)
language plpgsql security definer set search_path='' as $$
declare target private.entra_sessions; observed timestamptz;
begin
  select s.* into target from private.entra_sessions s where s.token_hash=p_token and s.realm_hash=p_realm;
  if not found then return; end if;
  -- Match immutable session ownership and the current active profile/mapping before touching the session.
  perform p.id from public.profiles p join public.provider_identities i on i.profile_id=p.id
    where p.id=target.profile_id and p.status='active' and i.id=target.identity_id and i.provider='entra'
      and i.subject=target.subject for share of p;
  if not found then return; end if;
  perform s.id from private.entra_sessions s where s.id=target.id for update;
  observed:=clock_timestamp();
  return query update private.entra_sessions s set last_seen_at=observed
    where s.id=target.id and s.revoked_at is null and s.expires_at>observed and s.last_seen_at>observed-interval '30 minutes'
    returning s.subject;
end $$;

create function private.revoke_entra_session(p_token text,p_realm text,p_all boolean) returns void
language plpgsql security definer set search_path='' as $$
declare target private.entra_sessions; observed timestamptz;
begin
  select s.* into target from private.entra_sessions s where s.token_hash=p_token and s.realm_hash=p_realm;
  if not found then return; end if;
  if p_all then
    perform p.id from public.profiles p where p.id=target.profile_id and p.status='active' for update;
    if not found then return; end if;
    select s.* into target from private.entra_sessions s where s.id=target.id for update;
    if not found then return; end if;
    observed:=clock_timestamp();
    if target.revoked_at is not null or target.expires_at<=observed or target.last_seen_at<=observed-interval '30 minutes' then return; end if;
  else observed:=clock_timestamp(); end if;
  with changed as (
    update private.entra_sessions s set revoked_at=observed where s.revoked_at is null and
      ((p_all and s.profile_id=target.profile_id and s.realm_hash=p_realm) or (not p_all and s.id=target.id)) returning s.id
  ) insert into public.audit_logs(actor_id,action,entity,entity_id,after_data)
    select target.profile_id,'REVOKE','application_sessions',id,jsonb_build_object('provider','entra','reason',case when p_all then 'logout_all' else 'replaced' end) from changed;
end $$;

create function private.revoke_entra_profile_sessions() returns trigger language plpgsql security definer set search_path='' as $$
begin
  with changed as (
    update private.entra_sessions s set revoked_at=clock_timestamp() where s.profile_id=new.id and s.revoked_at is null returning s.id
  ) insert into public.audit_logs(actor_id,action,entity,entity_id,after_data)
    select private.current_profile_id(),'REVOKE','application_sessions',id,jsonb_build_object('provider','entra','reason','profile_changed') from changed;
  return new;
end $$;
create trigger revoke_entra_sessions after update of status,role on public.profiles for each row
when(old.status is distinct from new.status or old.role is distinct from new.role) execute function private.revoke_entra_profile_sessions();

create function private.revoke_entra_mapping_sessions() returns trigger language plpgsql security definer set search_path='' as $$
begin
  with changed as (
    update private.entra_sessions s set revoked_at=clock_timestamp() where s.identity_id=old.id and s.revoked_at is null returning s.id
  ) insert into public.audit_logs(actor_id,action,entity,entity_id,after_data)
    select private.current_profile_id(),'REVOKE','application_sessions',id,jsonb_build_object('provider','entra','reason','identity_changed') from changed;
  return new;
end $$;
create trigger revoke_entra_mapping_sessions after update of provider,subject,profile_id on public.provider_identities for each row
when(old.provider is distinct from new.provider or old.subject is distinct from new.subject or old.profile_id is distinct from new.profile_id)
execute function private.revoke_entra_mapping_sessions();

create function private.cleanup_entra_sessions() returns integer language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
  with expired as (
    select id from private.entra_sessions where revoked_at is not null or expires_at<=clock_timestamp() or last_seen_at<=clock_timestamp()-interval '30 minutes'
    order by expires_at,id limit 500 for update skip locked
  ) delete from private.entra_sessions s using expired e where s.id=e.id;
  get diagnostics removed=row_count; return removed;
end $$;
revoke all on function private.create_entra_session(text,text),private.resolve_entra_session(text,text),private.revoke_entra_session(text,text,boolean),
  private.revoke_entra_profile_sessions(),private.revoke_entra_mapping_sessions(),private.cleanup_entra_sessions() from public;
grant execute on function private.create_entra_session(text,text),private.resolve_entra_session(text,text),private.revoke_entra_session(text,text,boolean),private.cleanup_entra_sessions() to nova_app;
commit;
