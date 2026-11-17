begin;
create sequence private.client_number start 1001;
-- Skip identifiers supplied before this migration, including demo fixtures.
select setval('private.client_number',greatest(1000,coalesce((select max(substring(client_id from 5)::bigint) from public.profiles where client_id is not null),1000)),true);
create function private.next_client_id() returns text language plpgsql security definer set search_path='' as $$
declare candidate text;
begin
 loop
  candidate='INV-'||nextval('private.client_number');
  if not exists(select 1 from public.profiles where client_id=candidate) then return candidate; end if;
 end loop;
end $$;
revoke all on function private.next_client_id() from public;
grant execute on function private.next_client_id() to nova_app;
alter table public.profiles alter column client_id set default private.next_client_id();
create unique index profile_normalized_email on public.profiles(lower(email));
create index on public.profiles(role,status,created_at desc);
-- Concurrency tokens must change even for rapid updates in the same transaction.
create or replace function private.touch_updated_at() returns trigger language plpgsql set search_path='' as $$
begin
 new.updated_at=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
 return new;
end $$;

create table public.write_requests (
 actor_id uuid not null references public.profiles(id), request_id uuid not null,
 action text not null, payload_hash text not null check(length(payload_hash)=64), result jsonb,
 created_at timestamptz not null default now(),primary key(actor_id,request_id)
);
alter table public.write_requests enable row level security;
revoke all on public.write_requests from public;
create policy writes_admin on public.write_requests for all to nova_app using(private.is_admin() and actor_id=private.current_profile_id()) with check(private.is_admin() and actor_id=private.current_profile_id());
grant select,insert on public.write_requests to nova_app;
grant update(result) on public.write_requests to nova_app;

create table public.client_invitations (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.profiles(id),
 actor_id uuid not null references public.profiles(id), request_id uuid not null,
 purpose text not null check(purpose in ('setup','reset')),
 status text not null default 'pending' check(status in ('pending','processing','accepted','failed','unknown')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(actor_id,request_id)
);
create index on public.client_invitations(client_id,created_at desc);
alter table public.client_invitations enable row level security;
revoke all on public.client_invitations from public;
create policy invitations_admin on public.client_invitations for all to nova_app using(private.is_admin()) with check(private.is_admin() and actor_id=private.current_profile_id());
grant select,insert on public.client_invitations to nova_app;
grant update(status,updated_at) on public.client_invitations to nova_app;
create trigger audit_invitation after insert or update on public.client_invitations for each row execute function private.audit_change();

-- NUMERIC NaN compares above ordinary numbers in PostgreSQL; >= 0 alone is insufficient.
alter table public.investments add constraint investment_finite_money check(invested_amount<>'NaN'::numeric and reported_value<>'NaN'::numeric);
alter table public.portfolio_snapshots add constraint snapshot_finite_money check(reported_value<>'NaN'::numeric and (adjusted_basis is null or adjusted_basis<>'NaN'::numeric));
alter table public.investments add constraint investment_finite_date check(reported_at>'-infinity'::timestamptz);
alter table public.portfolio_snapshots add constraint snapshot_finite_date check(reported_at>'-infinity'::timestamptz);
alter table public.investments add column version integer not null default 1 check(version>0);
alter table public.investments add column correction_reason text check(length(correction_reason) between 1 and 1000);
create table public.investment_revisions (
 id uuid primary key default gen_random_uuid(), investment_id uuid not null,client_id uuid not null references public.profiles(id),
 version integer not null,asset_class text not null,description text not null,currency text not null,
 invested_amount numeric(20,4) not null,reported_value numeric(20,4) not null,reported_at timestamptz not null,archived_at timestamptz,
 correction_reason text,recorded_by uuid not null references public.profiles(id),recorded_at timestamptz not null default now(),
 foreign key(investment_id,client_id) references public.investments(id,client_id),unique(investment_id,version)
);
create index on public.investment_revisions(client_id,recorded_at desc);
alter table public.investment_revisions enable row level security;
revoke all on public.investment_revisions from public;
create policy revision_read on public.investment_revisions for select to nova_app using(private.is_admin() or client_id=private.current_profile_id());
grant select on public.investment_revisions to nova_app;
insert into public.investment_revisions(investment_id,client_id,version,asset_class,description,currency,invested_amount,reported_value,reported_at,archived_at,correction_reason,recorded_by,recorded_at)
select id,client_id,version,asset_class,description,currency,invested_amount,reported_value,reported_at,archived_at,correction_reason,created_by,updated_at from public.investments;

create function private.guard_investment_update() returns trigger language plpgsql set search_path='' as $$
begin
 if new.client_id<>old.client_id or new.currency<>old.currency or new.created_by<>old.created_by or new.created_at<>old.created_at then raise exception 'Investment ownership and currency are immutable'; end if;
 if old.archived_at is not null then raise exception 'Archived investment is immutable'; end if;
 if new.correction_reason is null or length(trim(new.correction_reason))=0 then raise exception 'Correction reason required'; end if;
 new.version=old.version+1;
 return new;
end $$;
revoke all on function private.guard_investment_update() from public;
create trigger investment_guard before update on public.investments for each row execute function private.guard_investment_update();
create function private.record_investment_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.investment_revisions(investment_id,client_id,version,asset_class,description,currency,invested_amount,reported_value,reported_at,archived_at,correction_reason,recorded_by)
 values(new.id,new.client_id,new.version,new.asset_class,new.description,new.currency,new.invested_amount,new.reported_value,new.reported_at,new.archived_at,new.correction_reason,coalesce(private.current_profile_id(),new.created_by));
 return new;
end $$;
revoke all on function private.record_investment_revision() from public;
create trigger investment_history after insert or update on public.investments for each row execute function private.record_investment_revision();

create unique index snapshot_unique_original_date on public.portfolio_snapshots(client_id,currency,reported_at) where correction_of is null;
create function private.guard_snapshot_correction() returns trigger language plpgsql set search_path='' as $$
declare original public.portfolio_snapshots;
begin
 if new.correction_of is not null then
  select * into original from public.portfolio_snapshots where id=new.correction_of;
  if not found or original.client_id<>new.client_id or original.currency<>new.currency or original.reported_at<>new.reported_at then raise exception 'Correction must retain client, currency and reporting date'; end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_snapshot_correction() from public;
create trigger snapshot_correction_guard before insert on public.portfolio_snapshots for each row execute function private.guard_snapshot_correction();
-- Immutable association/creator columns are not application-editable.
revoke update on public.profiles,public.investments from nova_app;
grant update(display_name,status,updated_at) on public.profiles to nova_app;
grant update(asset_class,description,invested_amount,reported_value,reported_at,archived_at,correction_reason) on public.investments to nova_app;

do $$ declare r text;t text;begin
 foreach r in array array['anon','authenticated','service_role'] loop
  if exists(select 1 from pg_roles where rolname=r) then
   foreach t in array array['write_requests','client_invitations','investment_revisions'] loop execute format('revoke all on public.%I from %I',t,r);end loop;
  end if;
 end loop;
end $$;
commit;
