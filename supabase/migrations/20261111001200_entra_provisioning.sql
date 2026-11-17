begin;
create table private.entra_provisioning (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  tenant_domain text not null check(tenant_domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.onmicrosoft\.com$'),
  profile_id uuid not null references public.profiles(id),
  email_hash bytea not null check(octet_length(email_hash)=32),
  status text not null check(status in ('checking','creating','unknown','rejected','ready')),
  object_id uuid,
  actor_id uuid not null references public.profiles(id),
  lease_id uuid not null,
  lease_until timestamptz not null check(isfinite(lease_until)),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(tenant_id,profile_id),unique(tenant_id,email_hash),unique(tenant_id,object_id),
  check((status='ready')=(object_id is not null))
);
alter table private.entra_provisioning enable row level security;
revoke all on private.entra_provisioning from public,nova_app;

create function private.lock_entra_provisioning_client(p_profile uuid) returns public.profiles
language plpgsql security definer set search_path='' as $$
declare target public.profiles;
begin
  if not private.is_admin() then raise exception 'administrator verification required' using errcode='42501'; end if;
  perform p.id from public.profiles p where p.id=private.current_profile_id() and p.status='active' and p.role='admin' for share;
  if not found then raise exception 'administrator verification required' using errcode='42501'; end if;
  select p.* into target from public.profiles p where p.id=p_profile and p.role='client' and p.status='active' for update;
  if not found then raise exception 'active client required' using errcode='42501'; end if;
  return target;
end $$;

create function private.claim_entra_provisioning(p_tenant uuid,p_domain text,p_profile uuid,p_lease uuid)
returns table(mode text,email text,display_name text,object_id uuid)
language plpgsql security definer set search_path='' as $$
declare target public.profiles; entry private.entra_provisioning; observed timestamptz; mapped text; mapped_id uuid;
begin
  target:=private.lock_entra_provisioning_client(p_profile);
  if p_tenant is null or p_lease is null or p_domain is null or p_domain !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.onmicrosoft\.com$' then raise exception 'invalid provisioning scope' using errcode='22023'; end if;
  select i.subject into mapped from public.provider_identities i where i.profile_id=p_profile and i.provider='entra';
  if mapped is not null then
    if mapped !~ ('^'||p_tenant::text||':[a-fA-F0-9-]{36}$') then raise exception 'identity conflict' using errcode='23505'; end if;
    mapped_id:=substring(mapped from 38)::uuid;
  end if;
  select e.* into entry from private.entra_provisioning e where e.tenant_id=p_tenant and e.profile_id=p_profile for update;
  observed:=clock_timestamp();
  if found then
    if entry.tenant_domain<>p_domain or entry.email_hash<>sha256(convert_to(lower(target.email),'UTF8')) or (mapped_id is not null and (entry.object_id is null or mapped_id<>entry.object_id)) then raise exception 'provisioning identity conflict' using errcode='23505'; end if;
    if entry.lease_until>observed then return query select 'busy'::text,lower(target.email),target.display_name,entry.object_id; return; end if;
    update private.entra_provisioning e set status=case when entry.status='creating' then 'unknown' when entry.status='rejected' then 'checking' else entry.status end,
      actor_id=private.current_profile_id(),lease_id=p_lease,lease_until=observed+interval '2 minutes',updated_at=observed where e.id=entry.id returning e.* into entry;
  else
    insert into private.entra_provisioning(tenant_id,tenant_domain,profile_id,email_hash,status,object_id,actor_id,lease_id,lease_until)
      values(p_tenant,p_domain,p_profile,sha256(convert_to(lower(target.email),'UTF8')),case when mapped_id is null then 'checking' else 'ready' end,mapped_id,private.current_profile_id(),p_lease,observed+interval '2 minutes') returning * into entry;
  end if;
  return query select case when entry.status='ready' then 'ready' when entry.status='unknown' then 'reconcile' else 'check' end,lower(target.email),target.display_name,entry.object_id;
end $$;

create function private.start_entra_provisioning(p_tenant uuid,p_profile uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare target public.profiles; entry private.entra_provisioning;
begin
  target:=private.lock_entra_provisioning_client(p_profile);
  select e.* into entry from private.entra_provisioning e where e.tenant_id=p_tenant and e.profile_id=p_profile for update;
  if not found or entry.lease_id<>p_lease or entry.actor_id<>private.current_profile_id() or entry.lease_until<=clock_timestamp() or entry.status<>'checking' or entry.email_hash<>sha256(convert_to(lower(target.email),'UTF8')) then return false; end if;
  if exists(select 1 from public.provider_identities i where i.profile_id=p_profile and i.provider='entra') then return false; end if;
  update private.entra_provisioning set status='creating',updated_at=clock_timestamp() where id=entry.id;
  return true;
end $$;

create function private.complete_entra_provisioning(p_tenant uuid,p_profile uuid,p_lease uuid,p_object uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare target public.profiles; entry private.entra_provisioning; expected text; mapped text;
begin
  target:=private.lock_entra_provisioning_client(p_profile);
  select e.* into entry from private.entra_provisioning e where e.tenant_id=p_tenant and e.profile_id=p_profile for update;
  if not found or p_object is null or entry.lease_id<>p_lease or entry.actor_id<>private.current_profile_id() or entry.lease_until<=clock_timestamp() or entry.email_hash<>sha256(convert_to(lower(target.email),'UTF8')) or (entry.object_id is not null and entry.object_id<>p_object) then return false; end if;
  expected:=p_tenant::text||':'||p_object::text;
  insert into public.provider_identities(profile_id,provider,subject) values(p_profile,'entra',expected) on conflict(profile_id,provider) do nothing;
  select i.subject into mapped from public.provider_identities i where i.profile_id=p_profile and i.provider='entra';
  if mapped<>expected then raise exception 'identity conflict' using errcode='23505'; end if;
  update private.entra_provisioning set status='ready',object_id=p_object,lease_until=clock_timestamp(),updated_at=clock_timestamp() where id=entry.id;
  return true;
end $$;

create function private.release_entra_provisioning(p_tenant uuid,p_profile uuid,p_lease uuid,p_rejected boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_entra_provisioning_client(p_profile);
  update private.entra_provisioning e set status=case when e.status='creating' then case when p_rejected then 'rejected' else 'unknown' end else e.status end,
    lease_until=clock_timestamp(),updated_at=clock_timestamp()
    where e.tenant_id=p_tenant and e.profile_id=p_profile and e.lease_id=p_lease and e.actor_id=private.current_profile_id();
end $$;

create function private.audit_entra_provisioning() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' or old.status is distinct from new.status or old.object_id is distinct from new.object_id then
    insert into public.audit_logs(actor_id,action,entity,entity_id,after_data)
      values(private.current_profile_id(),case when tg_op='INSERT' then 'CREATE' else 'UPDATE' end,'account_provisioning',new.id,jsonb_build_object('provider','entra','state',new.status,'tenantId',new.tenant_id,'profileId',new.profile_id));
  end if;
  return new;
end $$;
create trigger audit_entra_provisioning after insert or update on private.entra_provisioning for each row execute function private.audit_entra_provisioning();
revoke all on function private.lock_entra_provisioning_client(uuid),private.claim_entra_provisioning(uuid,text,uuid,uuid),private.start_entra_provisioning(uuid,uuid,uuid),private.complete_entra_provisioning(uuid,uuid,uuid,uuid),private.release_entra_provisioning(uuid,uuid,uuid,boolean),private.audit_entra_provisioning() from public;
grant execute on function private.claim_entra_provisioning(uuid,text,uuid,uuid),private.start_entra_provisioning(uuid,uuid,uuid),private.complete_entra_provisioning(uuid,uuid,uuid,uuid),private.release_entra_provisioning(uuid,uuid,uuid,boolean) to nova_app;
commit;
