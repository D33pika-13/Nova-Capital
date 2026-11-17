begin;
create table private.entra_mfa_factors (
  id uuid primary key,
  profile_id uuid not null references public.profiles(id),
  identity_id uuid not null references public.provider_identities(id) on delete cascade,
  realm_hash text not null check(realm_hash ~ '^[a-f0-9]{64}$'),
  encrypted_secret text not null check(length(encrypted_secret) between 1 and 256),
  created_at timestamptz not null,
  confirmed_at timestamptz,
  last_step bigint check(last_step>=0),
  unique(profile_id,realm_hash),
  check(isfinite(created_at) and (confirmed_at is null or (isfinite(confirmed_at) and confirmed_at>=created_at))),
  check((confirmed_at is null and last_step is null) or (confirmed_at is not null and last_step is not null))
);
create table private.entra_mfa_recovery (
  factor_id uuid not null references private.entra_mfa_factors(id) on delete cascade,
  digest text not null check(digest ~ '^[a-f0-9]{64}$'),
  consumed_at timestamptz,
  primary key(factor_id,digest)
);
create table private.entra_mfa_challenges (
  proof_hash text primary key check(proof_hash ~ '^[a-f0-9]{64}$'),
  factor_id uuid not null references private.entra_mfa_factors(id) on delete cascade,
  session_id uuid not null references private.entra_sessions(id) on delete cascade,
  purpose text not null check(purpose in ('enroll','verify','recovery')),
  expires_at timestamptz not null check(isfinite(expires_at))
);
create index on private.entra_mfa_challenges(expires_at);
create index on private.entra_mfa_challenges(session_id);
create table private.entra_mfa_limits (
  profile_id uuid not null references public.profiles(id),
  realm_hash text not null check(realm_hash ~ '^[a-f0-9]{64}$'),
  window_at timestamptz not null check(isfinite(window_at)),
  attempts integer not null check(attempts between 1 and 10),
  primary key(profile_id,realm_hash)
);
alter table private.entra_mfa_factors enable row level security;
alter table private.entra_mfa_recovery enable row level security;
alter table private.entra_mfa_challenges enable row level security;
alter table private.entra_mfa_limits enable row level security;
revoke all on private.entra_mfa_factors,private.entra_mfa_recovery,private.entra_mfa_challenges,private.entra_mfa_limits from public,nova_app;
alter table private.entra_sessions add column mfa_factor_id uuid references private.entra_mfa_factors(id) on delete set null;
alter table private.entra_sessions add column mfa_verified_at timestamptz;
alter table private.entra_sessions add column mfa_expires_at timestamptz;
alter table private.entra_sessions add constraint mfa_times check(
  (mfa_verified_at is null and mfa_expires_at is null) or
  (mfa_verified_at is not null and mfa_expires_at is not null and isfinite(mfa_verified_at) and isfinite(mfa_expires_at) and mfa_verified_at>=created_at and mfa_expires_at>mfa_verified_at and mfa_expires_at<=expires_at and mfa_expires_at<=mfa_verified_at+interval '15 minutes')
);

-- All MFA mutations serialize on the current profile, then session, then factor.
-- A cookie proof, current mapping and current admin status are required, not GUC roles.
create function private.lock_entra_mfa_session(p_token text,p_realm text) returns private.entra_sessions
language plpgsql security definer set search_path='' as $$
declare target private.entra_sessions; observed timestamptz;
begin
  select s.* into target from private.entra_sessions s where s.token_hash=p_token and s.realm_hash=p_realm;
  if not found then return null; end if;
  perform p.id from public.profiles p join public.provider_identities i on i.profile_id=p.id
    where p.id=target.profile_id and p.role='admin' and p.status='active' and i.id=target.identity_id and i.provider='entra' and i.subject=target.subject for update of p;
  if not found then return null; end if;
  select s.* into target from private.entra_sessions s where s.id=target.id for update;
  observed:=clock_timestamp();
  if target.revoked_at is not null or target.expires_at<=observed or target.last_seen_at<=observed-interval '30 minutes' then return null; end if;
  return target;
end $$;
create function private.consume_entra_mfa_limit(p_profile uuid,p_realm text) returns boolean
language plpgsql security definer set search_path='' as $$
declare current_attempts integer;
begin
  insert into private.entra_mfa_limits(profile_id,realm_hash,window_at,attempts) values(p_profile,p_realm,clock_timestamp(),1)
    on conflict(profile_id,realm_hash) do update set
      attempts=case when private.entra_mfa_limits.window_at<=clock_timestamp()-interval '15 minutes' then 1 else private.entra_mfa_limits.attempts+1 end,
      window_at=case when private.entra_mfa_limits.window_at<=clock_timestamp()-interval '15 minutes' then clock_timestamp() else private.entra_mfa_limits.window_at end
    where private.entra_mfa_limits.window_at<=clock_timestamp()-interval '15 minutes' or private.entra_mfa_limits.attempts<10 returning attempts into current_attempts;
  return found;
end $$;

create function private.entra_mfa_profile(p_token text,p_realm text) returns uuid
language plpgsql security definer set search_path='' as $$
declare target private.entra_sessions;
begin
  target:=private.lock_entra_mfa_session(p_token,p_realm);
  return target.profile_id;
end $$;

create function private.prepare_entra_mfa(p_token text,p_realm text,p_factor uuid,p_envelope text)
returns table(factor_id uuid,profile_id uuid,encrypted_secret text,enrolled boolean)
language plpgsql security definer set search_path='' as $$
declare target private.entra_sessions; factor private.entra_mfa_factors; observed timestamptz;
begin
  target:=private.lock_entra_mfa_session(p_token,p_realm);
  if target.id is null then return; end if;
  if not private.consume_entra_mfa_limit(target.profile_id,p_realm) then return; end if;
  select f.* into factor from private.entra_mfa_factors f where f.profile_id=target.profile_id and f.realm_hash=p_realm for update;
  observed:=clock_timestamp();
  if target.expires_at<=observed or target.last_seen_at<=observed-interval '30 minutes' then return; end if;
  if found and factor.identity_id<>target.identity_id then return; end if;
  if found and factor.confirmed_at is not null then
    return query select factor.id,factor.profile_id,null::text,true; return;
  end if;
  -- Only recent primary authentication may create or reveal a pending enrollment.
  if target.created_at<=observed-interval '10 minutes' then return; end if;
  if factor.id is not null and factor.created_at<=observed-interval '10 minutes' then
    delete from private.entra_mfa_factors where id=factor.id; factor:=null;
  end if;
  if factor.id is null then
    if p_factor is null or p_envelope is null or length(p_envelope) not between 1 and 256 then return; end if;
    insert into private.entra_mfa_factors(id,profile_id,identity_id,realm_hash,encrypted_secret,created_at)
      values(p_factor,target.profile_id,target.identity_id,p_realm,p_envelope,observed) returning * into factor;
    insert into public.audit_logs(actor_id,action,entity,entity_id,after_data)
      values(target.profile_id,'CREATE','mfa_factors',factor.id,jsonb_build_object('provider','entra','state','pending'));
  end if;
  return query select factor.id,factor.profile_id,factor.encrypted_secret,false;
end $$;

create function private.begin_entra_mfa(p_token text,p_realm text,p_proof text,p_recovery boolean)
returns table(factor_id uuid,profile_id uuid,encrypted_secret text,last_step bigint,enrolling boolean)
language plpgsql security definer set search_path='' as $$
declare target private.entra_sessions; factor private.entra_mfa_factors; observed timestamptz;
begin
  if p_proof is null or p_proof !~ '^[a-f0-9]{64}$' or p_recovery is null then return; end if;
  target:=private.lock_entra_mfa_session(p_token,p_realm);
  if target.id is null then return; end if;
  if not private.consume_entra_mfa_limit(target.profile_id,p_realm) then return; end if;
  select f.* into factor from private.entra_mfa_factors f where f.profile_id=target.profile_id and f.realm_hash=p_realm and f.identity_id=target.identity_id for update;
  if not found then return; end if;
  observed:=clock_timestamp();
  if target.expires_at<=observed or target.last_seen_at<=observed-interval '30 minutes' then return; end if;
  if factor.confirmed_at is null and (p_recovery or factor.created_at<=observed-interval '10 minutes' or target.created_at<=observed-interval '10 minutes') then return; end if;
  -- At most one outstanding challenge per session; replacement invalidates the previous proof.
  delete from private.entra_mfa_challenges where session_id=target.id;
  insert into private.entra_mfa_challenges(proof_hash,factor_id,session_id,purpose,expires_at)
    values(p_proof,factor.id,target.id,case when p_recovery then 'recovery' when factor.confirmed_at is null then 'enroll' else 'verify' end,least(observed+interval '2 minutes',target.expires_at));
  return query select factor.id,factor.profile_id,case when p_recovery then null::text else factor.encrypted_secret end,factor.last_step,factor.confirmed_at is null;
end $$;

create function private.finish_entra_mfa(p_token text,p_realm text,p_proof text,p_step bigint,p_recovery text,p_new_token text,p_codes text[])
returns table(expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare target private.entra_sessions; factor private.entra_mfa_factors; challenge private.entra_mfa_challenges; observed timestamptz; new_id uuid; changed integer;
begin
  target:=private.lock_entra_mfa_session(p_token,p_realm);
  if target.id is null then return; end if;
  select f.* into factor from private.entra_mfa_factors f where f.profile_id=target.profile_id and f.realm_hash=p_realm and f.identity_id=target.identity_id for update;
  if not found then return; end if;
  delete from private.entra_mfa_challenges c where c.proof_hash=p_proof and c.session_id=target.id and c.factor_id=factor.id returning c.* into challenge;
  if not found then return; end if;
  observed:=clock_timestamp();
  -- Denials return normally so an invalid/expired proof remains consumed after commit.
  if target.expires_at<=observed or target.last_seen_at<=observed-interval '30 minutes' or challenge.expires_at<=observed or p_new_token is null or p_new_token !~ '^[a-f0-9]{64}$' or p_new_token=p_token then return; end if;
  if challenge.purpose='recovery' then
    if factor.confirmed_at is null or p_step is not null or p_codes is not null then return; end if;
    update private.entra_mfa_recovery r set consumed_at=observed where r.factor_id=factor.id and r.digest=p_recovery and r.consumed_at is null;
    get diagnostics changed=row_count;
    if changed<>1 then return; end if;
  else
    if p_recovery is not null or p_step is null or p_step<floor(extract(epoch from observed)/30)-1 or p_step>floor(extract(epoch from observed)/30)+1 or (factor.last_step is not null and p_step<=factor.last_step) then return; end if;
    if challenge.purpose='enroll' then
      if factor.confirmed_at is not null or factor.created_at<=observed-interval '10 minutes' or target.created_at<=observed-interval '10 minutes' or p_codes is null or cardinality(p_codes)<>10 then return; end if;
      if (select count(distinct c) from unnest(p_codes) c where c ~ '^[a-f0-9]{64}$')<>10 then return; end if;
      insert into private.entra_mfa_recovery(factor_id,digest) select factor.id,c from unnest(p_codes) c;
      update private.entra_mfa_factors set confirmed_at=observed,last_step=p_step where id=factor.id;
      insert into public.audit_logs(actor_id,action,entity,entity_id,after_data)
        values(target.profile_id,'UPDATE','mfa_factors',factor.id,jsonb_build_object('provider','entra','state','confirmed'));
    else
      if factor.confirmed_at is null or p_codes is not null then return; end if;
      update private.entra_mfa_factors set last_step=p_step where id=factor.id;
    end if;
  end if;
  update private.entra_sessions set revoked_at=observed where id=target.id;
  insert into private.entra_sessions(token_hash,realm_hash,profile_id,identity_id,subject,created_at,last_seen_at,expires_at,mfa_factor_id,mfa_verified_at,mfa_expires_at)
    values(p_new_token,p_realm,target.profile_id,target.identity_id,target.subject,target.created_at,observed,target.expires_at,factor.id,observed,least(observed+interval '15 minutes',target.expires_at)) returning id into new_id;
  insert into public.audit_logs(actor_id,action,entity,entity_id,after_data) values
    (target.profile_id,'REVOKE','application_sessions',target.id,jsonb_build_object('provider','entra','reason','mfa_rotation')),
    (target.profile_id,'CREATE','application_sessions',new_id,jsonb_build_object('provider','entra','assurance','aal2','method',challenge.purpose));
  return query select target.expires_at;
end $$;

create function private.resolve_entra_session_assured(p_token text,p_realm text) returns table(subject text,assurance text)
language plpgsql security definer set search_path='' as $$
begin
  return query select resolved.subject,case when s.mfa_expires_at>clock_timestamp() and f.confirmed_at is not null and f.identity_id=s.identity_id and f.profile_id=s.profile_id and f.realm_hash=s.realm_hash then 'aal2' else 'aal1' end
    from private.resolve_entra_session(p_token,p_realm) resolved join private.entra_sessions s on s.token_hash=p_token and s.realm_hash=p_realm
    left join private.entra_mfa_factors f on f.id=s.mfa_factor_id;
end $$;

-- Identity/status changes invalidate enrollment as well as application sessions.
create function private.invalidate_entra_mfa() returns trigger language plpgsql security definer set search_path='' as $$
begin
  with removed as (
    delete from private.entra_mfa_factors f where
      (tg_table_name='profiles' and f.profile_id=old.id) or (tg_table_name='provider_identities' and f.identity_id=old.id)
    returning f.id,f.profile_id
  ) insert into public.audit_logs(actor_id,action,entity,entity_id,after_data)
    select r.profile_id,'REVOKE','mfa_factors',r.id,jsonb_build_object('provider','entra','reason','account_changed') from removed r;
  return new;
end $$;
create trigger invalidate_entra_profile_mfa after update of status,role on public.profiles for each row
when(old.status is distinct from new.status or old.role is distinct from new.role) execute function private.invalidate_entra_mfa();
create trigger invalidate_entra_mapping_mfa after update of provider,subject,profile_id on public.provider_identities for each row
when(old.provider is distinct from new.provider or old.subject is distinct from new.subject or old.profile_id is distinct from new.profile_id) execute function private.invalidate_entra_mfa();
create function private.cleanup_entra_mfa() returns integer language plpgsql security definer set search_path='' as $$
declare removed integer; pruned integer;
begin
  with expired as (select proof_hash from private.entra_mfa_challenges where expires_at<=clock_timestamp() order by expires_at,proof_hash limit 500 for update skip locked)
    delete from private.entra_mfa_challenges c using expired e where c.proof_hash=e.proof_hash;
  get diagnostics removed=row_count;
  with expired as (select id from private.entra_mfa_factors where confirmed_at is null and created_at<=clock_timestamp()-interval '10 minutes' order by created_at,id limit 500 for update skip locked)
    delete from private.entra_mfa_factors f using expired e where f.id=e.id;
  get diagnostics pruned=row_count; removed:=removed+pruned;
  with expired as (select profile_id,realm_hash from private.entra_mfa_limits where window_at<=clock_timestamp()-interval '24 hours' order by window_at,profile_id,realm_hash limit 500 for update skip locked)
    delete from private.entra_mfa_limits l using expired e where l.profile_id=e.profile_id and l.realm_hash=e.realm_hash;
  get diagnostics pruned=row_count; return removed+pruned;
end $$;
revoke all on function private.entra_mfa_profile(text,text),private.lock_entra_mfa_session(text,text),private.consume_entra_mfa_limit(uuid,text),private.prepare_entra_mfa(text,text,uuid,text),private.begin_entra_mfa(text,text,text,boolean),private.finish_entra_mfa(text,text,text,bigint,text,text,text[]),private.resolve_entra_session_assured(text,text),private.invalidate_entra_mfa(),private.cleanup_entra_mfa() from public;
grant execute on function private.entra_mfa_profile(text,text),private.prepare_entra_mfa(text,text,uuid,text),private.begin_entra_mfa(text,text,text,boolean),private.finish_entra_mfa(text,text,text,bigint,text,text,text[]),private.resolve_entra_session_assured(text,text),private.cleanup_entra_mfa() to nova_app;
commit;
