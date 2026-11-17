begin;
alter table private.entra_mfa_challenges add column operation text not null default 'step_up' check(operation in ('step_up','regenerate','remove'));

create or replace function private.finish_entra_mfa(p_token text,p_realm text,p_proof text,p_step bigint,p_recovery text,p_new_token text,p_codes text[])
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
  if challenge.operation<>'step_up' or target.expires_at<=observed or target.last_seen_at<=observed-interval '30 minutes' or challenge.expires_at<=observed or p_new_token is null or p_new_token !~ '^[a-f0-9]{64}$' or p_new_token=p_token then return; end if;
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

create function private.begin_entra_mfa_action(p_token text,p_realm text,p_proof text,p_recovery boolean,p_operation text)
returns table(factor_id uuid,profile_id uuid,encrypted_secret text,last_step bigint,enrolling boolean)
language plpgsql security definer set search_path='' as $$
declare target private.entra_sessions; factor record;
begin
  if p_operation is null or p_operation not in ('regenerate','remove') then return; end if;
  target:=private.lock_entra_mfa_session(p_token,p_realm);
  if target.id is null or target.created_at<=clock_timestamp()-interval '10 minutes' then return; end if;
  select * into factor from private.begin_entra_mfa(p_token,p_realm,p_proof,p_recovery);
  if not found then return; end if;
  if factor.enrolling then
    delete from private.entra_mfa_challenges c where c.proof_hash=p_proof and c.session_id=target.id;
    return;
  end if;
  update private.entra_mfa_challenges c set operation=p_operation where c.proof_hash=p_proof and c.session_id=target.id;
  return query select factor.factor_id,factor.profile_id,factor.encrypted_secret,factor.last_step,factor.enrolling;
end $$;

create function private.finish_entra_mfa_action(p_token text,p_realm text,p_proof text,p_operation text,p_step bigint,p_recovery text,p_new_token text,p_codes text[])
returns table(expires_at timestamptz,removed boolean)
language plpgsql security definer set search_path='' as $$
declare target private.entra_sessions; factor private.entra_mfa_factors; challenge private.entra_mfa_challenges; observed timestamptz; changed integer; new_id uuid;
begin
  if p_operation is null or p_operation not in ('regenerate','remove') then return; end if;
  target:=private.lock_entra_mfa_session(p_token,p_realm);
  if target.id is null then return; end if;
  select f.* into factor from private.entra_mfa_factors f where f.profile_id=target.profile_id and f.realm_hash=p_realm and f.identity_id=target.identity_id for update;
  if not found then return; end if;
  delete from private.entra_mfa_challenges c where c.proof_hash=p_proof and c.session_id=target.id and c.factor_id=factor.id returning c.* into challenge;
  if not found then return; end if;
  observed:=clock_timestamp();
  if challenge.operation<>p_operation or challenge.purpose='enroll' or factor.confirmed_at is null or challenge.expires_at<=observed or target.expires_at<=observed or target.last_seen_at<=observed-interval '30 minutes' or target.created_at<=observed-interval '10 minutes' then return; end if;
  if p_operation='remove' then
    if p_codes is not null or p_new_token is not null then return; end if;
  else
    if p_new_token is null or p_new_token !~ '^[a-f0-9]{64}$' or p_new_token=p_token or p_codes is null or cardinality(p_codes)<>10 then return; end if;
    if (select count(distinct c) from unnest(p_codes) c where c ~ '^[a-f0-9]{64}$')<>10 then return; end if;
    if exists(select 1 from private.entra_mfa_recovery r where r.factor_id=factor.id and r.digest=any(p_codes)) then return; end if;
  end if;
  if challenge.purpose='recovery' then
    if p_step is not null then return; end if;
    update private.entra_mfa_recovery r set consumed_at=observed where r.factor_id=factor.id and r.digest=p_recovery and r.consumed_at is null;
    get diagnostics changed=row_count;
    if changed<>1 then return; end if;
  else
    if challenge.purpose<>'verify' or p_recovery is not null or p_step is null or p_step<floor(extract(epoch from observed)/30)-1 or p_step>floor(extract(epoch from observed)/30)+1 or p_step<=factor.last_step then return; end if;
    update private.entra_mfa_factors set last_step=p_step where id=factor.id;
  end if;
  -- Invalidate all prior application sessions in this realm, not just this browser.
  with revoked as (
    update private.entra_sessions s set revoked_at=observed where s.profile_id=target.profile_id and s.realm_hash=p_realm and s.revoked_at is null returning s.id
  ) insert into public.audit_logs(actor_id,action,entity,entity_id,after_data)
    select target.profile_id,'REVOKE','application_sessions',id,jsonb_build_object('provider','entra','reason',p_operation) from revoked;
  if p_operation='remove' then
    delete from private.entra_mfa_factors where id=factor.id;
    insert into public.audit_logs(actor_id,action,entity,entity_id,after_data)
      values(target.profile_id,'REVOKE','mfa_factors',factor.id,jsonb_build_object('provider','entra','reason','self_service_remove','method',challenge.purpose));
    return query select null::timestamptz,true; return;
  end if;
  delete from private.entra_mfa_recovery where factor_id=factor.id;
  insert into private.entra_mfa_recovery(factor_id,digest) select factor.id,c from unnest(p_codes) c;
  insert into private.entra_sessions(token_hash,realm_hash,profile_id,identity_id,subject,created_at,last_seen_at,expires_at,mfa_factor_id,mfa_verified_at,mfa_expires_at)
    values(p_new_token,p_realm,target.profile_id,target.identity_id,target.subject,target.created_at,observed,target.expires_at,factor.id,observed,least(observed+interval '15 minutes',target.expires_at)) returning id into new_id;
  insert into public.audit_logs(actor_id,action,entity,entity_id,after_data) values
    (target.profile_id,'UPDATE','mfa_factors',factor.id,jsonb_build_object('provider','entra','reason','recovery_regenerated','method',challenge.purpose)),
    (target.profile_id,'CREATE','application_sessions',new_id,jsonb_build_object('provider','entra','assurance','aal2','method','recovery_regeneration'));
  return query select target.expires_at,false;
end $$;
revoke all on function private.begin_entra_mfa_action(text,text,text,boolean,text),private.finish_entra_mfa_action(text,text,text,text,bigint,text,text,text[]) from public;
grant execute on function private.begin_entra_mfa_action(text,text,text,boolean,text),private.finish_entra_mfa_action(text,text,text,text,bigint,text,text,text[]) to nova_app;
commit;
