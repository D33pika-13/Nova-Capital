begin;
alter table private.entra_login_transactions add column purpose text not null default 'login' check(purpose in ('login','recovery'));
create function private.store_entra_transaction_flow(p_state text,p_binding text,p_configuration text,p_nonce text,p_verifier text,p_purpose text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_purpose is null or p_purpose not in ('login','recovery') then raise exception 'invalid protocol purpose' using errcode='22023'; end if;
  if not private.store_entra_transaction(p_state,p_binding,p_configuration,p_nonce,p_verifier) then return false; end if;
  update private.entra_login_transactions set purpose=p_purpose where state_hash=p_state;
  return true;
end $$;
create function private.take_entra_transaction_flow(p_state text,p_binding text,p_configuration text)
returns table(nonce text,code_verifier text,purpose text) language plpgsql security definer set search_path='' as $$
declare target private.entra_login_transactions;
begin
  select t.* into target from private.entra_login_transactions t where t.state_hash=p_state and t.binding_hash=p_binding and t.configuration_hash=p_configuration for update;
  if not found or target.expires_at<=clock_timestamp() then return; end if;
  return query delete from private.entra_login_transactions t where t.state_hash=target.state_hash returning t.nonce,t.code_verifier,t.purpose;
end $$;
-- Old consumers cannot silently consume a recovery transaction and discard its policy.
create or replace function private.take_entra_transaction(p_state text,p_binding text,p_configuration text)
returns table(nonce text,code_verifier text) language plpgsql security definer set search_path='' as $$
declare target private.entra_login_transactions;
begin
  select t.* into target from private.entra_login_transactions t where t.state_hash=p_state and t.binding_hash=p_binding and t.configuration_hash=p_configuration and t.purpose='login' for update;
  if not found or target.expires_at<=clock_timestamp() then return; end if;
  return query delete from private.entra_login_transactions t where t.state_hash=target.state_hash returning t.nonce,t.code_verifier;
end $$;
create function private.revoke_entra_verified_sessions(p_realm text) returns boolean
language plpgsql security definer set search_path='' as $$
declare principal uuid; observed timestamptz;
begin
  if p_realm is null or p_realm !~ '^[a-f0-9]{64}$' or current_setting('app.provider',true) is distinct from 'entra' or current_setting('app.assurance',true) is distinct from 'aal1' then return false; end if;
  select p.id into principal from public.profiles p join public.provider_identities i on i.profile_id=p.id
    where p.status='active' and i.provider='entra' and i.subject=current_setting('app.subject',true) for update of p;
  if not found then return false; end if;
  observed:=clock_timestamp();
  with changed as (
    update private.entra_sessions s set revoked_at=observed where s.profile_id=principal and s.realm_hash=p_realm and s.revoked_at is null returning s.id
  ) insert into public.audit_logs(actor_id,action,entity,entity_id,after_data)
    select principal,'REVOKE','application_sessions',id,jsonb_build_object('provider','entra','reason','hosted_recovery_sign_in') from changed;
  return true;
end $$;
revoke all on function private.store_entra_transaction_flow(text,text,text,text,text,text),private.take_entra_transaction_flow(text,text,text),private.revoke_entra_verified_sessions(text) from public;
grant execute on function private.store_entra_transaction_flow(text,text,text,text,text,text),private.take_entra_transaction_flow(text,text,text),private.revoke_entra_verified_sessions(text) to nova_app;
commit;
