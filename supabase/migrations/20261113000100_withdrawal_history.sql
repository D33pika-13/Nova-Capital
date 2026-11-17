-- Append-only broker withdrawal reporting; no custody or payment execution.
begin;
create table public.withdrawals (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.profiles(id),
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 amount numeric(20,4) not null check(amount > 0 and amount <> 'NaN'::numeric),
 withdrawn_at timestamptz not null check(withdrawn_at > '-infinity'::timestamptz and withdrawn_at <= now()),
 reference text not null check(length(trim(reference)) between 1 and 300),
 correction_of uuid unique,
 correction_reason text check(length(trim(correction_reason)) between 1 and 1000),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 unique(id,client_id,currency),
 foreign key(correction_of,client_id,currency) references public.withdrawals(id,client_id,currency),
 check((correction_of is null) = (correction_reason is null)),
 check(correction_of is null or correction_of <> id)
);
create index on public.withdrawals(client_id,withdrawn_at desc);
alter table public.withdrawals enable row level security;
revoke all on public.withdrawals from public;
grant select,insert on public.withdrawals to nova_app;
create policy withdrawal_read on public.withdrawals for select to nova_app using(private.is_admin() or client_id=private.current_profile_id());
create policy withdrawal_insert on public.withdrawals for insert to nova_app with check(private.is_admin() and created_by=private.current_profile_id() and exists(select 1 from public.profiles p where p.id=withdrawals.client_id and p.role='client'));
create trigger withdrawal_audit after insert on public.withdrawals for each row execute function private.audit_change();
do $$ declare r text;begin
 foreach r in array array['anon','authenticated','service_role'] loop
  if exists(select 1 from pg_roles where rolname=r) then execute format('revoke all on public.withdrawals from %I',r);end if;
 end loop;
end $$;
commit;
