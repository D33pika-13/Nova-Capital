-- Short-lived protocol state. No client/account data and no direct runtime table access.
begin;
create table private.entra_login_transactions (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  binding_hash text not null check (binding_hash ~ '^[a-f0-9]{64}$'),
  configuration_hash text not null check (configuration_hash ~ '^[a-f0-9]{64}$'),
  nonce text not null check (nonce ~ '^[A-Za-z0-9_-]{43}$'),
  code_verifier text not null check (code_verifier ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  check (isfinite(created_at) and isfinite(expires_at) and expires_at > created_at and expires_at <= created_at + interval '10 minutes')
);
create index on private.entra_login_transactions(binding_hash, expires_at);
create index on private.entra_login_transactions(expires_at);
alter table private.entra_login_transactions enable row level security;
revoke all on private.entra_login_transactions from public, nova_app;

create function private.cleanup_entra_transactions() returns integer
language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  with expired as (
    select state_hash from private.entra_login_transactions where expires_at <= clock_timestamp()
    order by expires_at limit 500 for update skip locked
  ) delete from private.entra_login_transactions t using expired e where t.state_hash=e.state_hash;
  get diagnostics removed = row_count;
  return removed;
end $$;

create function private.store_entra_transaction(p_state text, p_binding text, p_configuration text, p_nonce text, p_verifier text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare created timestamptz;
begin
  if p_state is null or p_state !~ '^[a-f0-9]{64}$' or p_binding is null or p_binding !~ '^[a-f0-9]{64}$'
     or p_configuration is null or p_configuration !~ '^[a-f0-9]{64}$'
     or p_nonce is null or p_nonce !~ '^[A-Za-z0-9_-]{43}$' or p_verifier is null or p_verifier !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'invalid protocol state' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('entra-login:' || p_binding, 0));
  perform private.cleanup_entra_transactions();
  created := clock_timestamp();
  if (select count(*) from private.entra_login_transactions where binding_hash=p_binding and expires_at>created) >= 5 then
    return false;
  end if;
  insert into private.entra_login_transactions(state_hash,binding_hash,configuration_hash,nonce,code_verifier,created_at,expires_at)
  values(p_state,p_binding,p_configuration,p_nonce,p_verifier,created,created + interval '10 minutes');
  return true;
end $$;

create function private.take_entra_transaction(p_state text, p_binding text, p_configuration text)
returns table(nonce text, code_verifier text) language sql security definer set search_path = '' as $$
  delete from private.entra_login_transactions t
  where t.state_hash=p_state and t.binding_hash=p_binding and t.configuration_hash=p_configuration and t.expires_at>clock_timestamp()
  returning t.nonce,t.code_verifier
$$;
revoke all on function private.cleanup_entra_transactions(), private.store_entra_transaction(text,text,text,text,text), private.take_entra_transaction(text,text,text) from public;
grant execute on function private.cleanup_entra_transactions(), private.store_entra_transaction(text,text,text,text,text), private.take_entra_transaction(text,text,text) to nova_app;
commit;
