-- Portable PostgreSQL core. Execute as migration owner, never as the runtime role.
-- Runtime connections use nova_app (NOINHERIT, NOBYPASSRLS), not postgres/service_role.
begin;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'nova_app') then
    create role nova_app nologin noinherit nobypassrls;
  end if;
end $$;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema public, private to nova_app;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  client_id text unique check (client_id ~ '^INV-[0-9]{4,12}$'),
  display_name text not null check (length(display_name) between 1 and 150),
  email text not null unique check (length(email) between 3 and 254),
  role text not null default 'client' check (role in ('client','admin')),
  status text not null default 'active' check (status in ('active','suspended','deactivated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (role <> 'client' or client_id is not null)
);
create table public.provider_identities (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id),
  provider text not null check (provider in ('supabase','entra')),
  subject text not null check (length(subject) between 1 and 255),
  unique(provider, subject), unique(profile_id, provider)
);
create index on public.provider_identities(profile_id);

create function private.current_profile_id() returns uuid language sql stable security definer set search_path = '' as $$
 select p.id from public.profiles p join public.provider_identities i on i.profile_id=p.id
 where i.provider=nullif(current_setting('app.provider', true),'')
 and i.subject=nullif(current_setting('app.subject', true),'') and p.status='active'
$$;
create function private.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
 select coalesce((select p.role='admin' and current_setting('app.assurance',true)='aal2' from public.profiles p where p.id=private.current_profile_id()),false)
$$;
revoke all on function private.current_profile_id(), private.is_admin() from public;
grant execute on function private.current_profile_id(), private.is_admin() to nova_app;

create table public.investments (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.profiles(id),
 asset_class text not null check(asset_class in ('stocks','forex','commodities','crypto')),
 description text not null check(length(description) between 1 and 500),
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 invested_amount numeric(20,4) not null check(invested_amount >= 0),
 reported_value numeric(20,4) not null check(reported_value >= 0),
 reported_at timestamptz not null check(reported_at <= now()),
 archived_at timestamptz,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id, client_id)
);
create index on public.investments(client_id, reported_at desc);
create table public.portfolio_snapshots (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.profiles(id),
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 adjusted_basis numeric(20,4) check(adjusted_basis >= 0),
 reported_value numeric(20,4) not null check(reported_value >= 0),
 basis_explanation text not null check(length(basis_explanation) between 1 and 1000),
 reported_at timestamptz not null check(reported_at <= now()),
 correction_of uuid, correction_reason text,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 unique(id,client_id,currency),
 foreign key(correction_of,client_id,currency) references public.portfolio_snapshots(id,client_id,currency),
 check((correction_of is null and correction_reason is null) or (correction_of is not null and length(correction_reason) between 1 and 1000))
);
create unique index snapshot_one_correction on public.portfolio_snapshots(correction_of) where correction_of is not null;
create index on public.portfolio_snapshots(client_id,currency,reported_at desc,created_at desc);
create table public.admin_notes (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.profiles(id),
 note text not null check(length(note) between 1 and 5000), created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create index on public.admin_notes(client_id);
create table public.client_reports (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.profiles(id),
 title text not null check(length(title) between 1 and 200),
 storage_path text not null unique,
 period_start date not null, period_end date not null check(period_end >= period_start), report_date date not null,
 status text not null default 'quarantined' check(status in ('quarantined','available','archived')),
 size_bytes integer not null check(size_bytes between 1 and 10485760),
 uploaded_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 check(storage_path ~ '^[a-f0-9-]+/[a-f0-9-]+\.pdf$')
);
create index on public.client_reports(client_id,report_date desc);
create table public.offers (
 id uuid primary key default gen_random_uuid(), title text not null check(length(title) between 1 and 200),
 description text not null check(length(description) between 1 and 5000),
 category text not null check(category in ('member','promotion','travel')),
 image_path text, eligibility text not null, terms text not null,
 status text not null default 'draft' check(status in ('draft','published','expired')),
 starts_at timestamptz not null, ends_at timestamptz not null check(ends_at > starts_at),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.offers(status,starts_at,ends_at);
create table public.notifications (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.profiles(id),
 title text not null check(length(title) between 1 and 200), body text not null check(length(body) between 1 and 5000),
 read_at timestamptz, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create index on public.notifications(client_id,created_at desc);
create table public.chat_sessions (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), unique(id,client_id)
);
create index on public.chat_sessions(client_id,created_at desc);
create table public.chat_messages (
 id uuid primary key default gen_random_uuid(), session_id uuid not null, client_id uuid not null references public.profiles(id),
 role text not null check(role in ('user','assistant')), content text not null check(length(content) between 1 and 8000),
 created_at timestamptz not null default now(),
 foreign key(session_id,client_id) references public.chat_sessions(id,client_id) on delete cascade
);
create index on public.chat_messages(session_id,created_at);
create table public.audit_logs (
 id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id),
 action text not null, entity text not null, entity_id uuid not null,
 before_data jsonb, after_data jsonb, created_at timestamptz not null default now()
);
create index on public.audit_logs(entity,entity_id,created_at desc);
create index on public.audit_logs(actor_id,created_at desc);
create table private.rate_limits (
 key_hash text primary key, window_start timestamptz not null, count integer not null check(count > 0)
);
create function private.consume_rate_limit(p_key text, p_limit integer, p_window integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare current_count integer;
begin
 if p_limit < 1 or p_limit > 10000 or p_window < 1 or p_window > 86400 or length(p_key) <> 64 then raise exception 'Invalid rate limit parameters'; end if;
 insert into private.rate_limits(key_hash,window_start,count) values(p_key,now(),1)
 on conflict(key_hash) do update set
 count=case when private.rate_limits.window_start <= now()-make_interval(secs=>p_window) then 1 else least(private.rate_limits.count+1,p_limit+1) end,
 window_start=case when private.rate_limits.window_start <= now()-make_interval(secs=>p_window) then now() else private.rate_limits.window_start end
 returning count into current_count;
 return current_count <= p_limit;
end $$;
revoke all on function private.consume_rate_limit(text,integer,integer) from public;
grant execute on function private.consume_rate_limit(text,integer,integer) to nova_app;

create function private.audit_change() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.audit_logs(actor_id,action,entity,entity_id,before_data,after_data)
 values(private.current_profile_id(),tg_op,tg_table_name,coalesce(new.id,old.id),case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end);
 return coalesce(new,old);
end $$;
revoke all on function private.audit_change() from public;
create function private.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$ begin new.updated_at=now(); return new; end $$;
revoke all on function private.touch_updated_at() from public;

do $$ declare t text; begin
 foreach t in array array['profiles','provider_identities','investments','portfolio_snapshots','admin_notes','client_reports','offers','notifications'] loop
 execute format('create trigger audit_row after insert or update or delete on public.%I for each row execute function private.audit_change()',t);
 end loop;
 foreach t in array array['profiles','investments','offers'] loop
 execute format('create trigger touch_row before update on public.%I for each row execute function private.touch_updated_at()',t);
 end loop;
 foreach t in array array['profiles','provider_identities','investments','portfolio_snapshots','admin_notes','client_reports','offers','notifications','chat_sessions','chat_messages','audit_logs'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public',t);
 end loop;
end $$;

create policy profile_read on public.profiles for select to nova_app using(id=private.current_profile_id() or private.is_admin());
create policy profile_insert on public.profiles for insert to nova_app with check(private.is_admin() and role='client');
create policy profile_update on public.profiles for update to nova_app using(private.is_admin() and role='client') with check(private.is_admin() and role='client');
create policy identity_read on public.provider_identities for select to nova_app using(profile_id=private.current_profile_id() or private.is_admin());
create policy identity_insert on public.provider_identities for insert to nova_app with check(private.is_admin() and exists(select 1 from public.profiles p where p.id=profile_id and p.role='client'));

do $$ declare t text; begin
 foreach t in array array['investments','portfolio_snapshots','client_reports'] loop
 execute format('create policy own_read on public.%I for select to nova_app using(private.is_admin() or (client_id=private.current_profile_id()%s))',t,case when t='client_reports' then ' and status=''available''' else '' end);
 execute format('create policy admin_insert on public.%I for insert to nova_app with check(private.is_admin() and %I=private.current_profile_id() and exists(select 1 from public.profiles p where p.id=%I.client_id and p.role=''client''))',t,case when t='client_reports' then 'uploaded_by' else 'created_by' end,t);
 end loop;
end $$;
-- Report uploader uses uploaded_by rather than created_by.
drop policy admin_insert on public.client_reports;
create policy admin_insert on public.client_reports for insert to nova_app with check(private.is_admin() and uploaded_by=private.current_profile_id() and exists(select 1 from public.profiles p where p.id=client_reports.client_id and p.role='client'));
create policy investment_update on public.investments for update to nova_app using(private.is_admin()) with check(private.is_admin());
create policy report_update on public.client_reports for update to nova_app using(private.is_admin()) with check(private.is_admin());
create policy admin_notes_all on public.admin_notes for all to nova_app using(private.is_admin()) with check(private.is_admin() and created_by=private.current_profile_id());
create policy offers_read on public.offers for select to nova_app using(private.is_admin() or (status='published' and starts_at<=now() and ends_at>now()));
create policy offers_insert on public.offers for insert to nova_app with check(private.is_admin() and created_by=private.current_profile_id());
create policy offers_update on public.offers for update to nova_app using(private.is_admin()) with check(private.is_admin());
create policy notification_read on public.notifications for select to nova_app using(client_id=private.current_profile_id() or private.is_admin());
create policy notification_insert on public.notifications for insert to nova_app with check(private.is_admin() and created_by=private.current_profile_id());
create policy notification_update on public.notifications for update to nova_app using(client_id=private.current_profile_id()) with check(client_id=private.current_profile_id());
create policy audit_read on public.audit_logs for select to nova_app using(private.is_admin());
create policy chat_session_own on public.chat_sessions for all to nova_app using(client_id=private.current_profile_id()) with check(client_id=private.current_profile_id());
create policy chat_message_own on public.chat_messages for all to nova_app using(client_id=private.current_profile_id()) with check(client_id=private.current_profile_id());

grant select,insert,update on public.profiles to nova_app;
grant select,insert on public.provider_identities to nova_app;
grant select,insert,update on public.investments, public.client_reports, public.offers to nova_app;
grant select,insert on public.portfolio_snapshots, public.admin_notes to nova_app;
grant select,insert on public.notifications to nova_app;
grant update(read_at) on public.notifications to nova_app;
grant select,insert,delete on public.chat_sessions, public.chat_messages to nova_app;
grant select on public.audit_logs to nova_app;
-- Supabase may have provider-specific default grants; remove direct browser access.
do $$ declare r text; t text; begin
 foreach r in array array['anon','authenticated','service_role'] loop
  if exists(select 1 from pg_roles where rolname=r) then
   foreach t in array array['profiles','provider_identities','investments','portfolio_snapshots','admin_notes','client_reports','offers','notifications','chat_sessions','chat_messages','audit_logs'] loop
    execute format('revoke all on public.%I from %I',t,r);
   end loop;
  end if;
 end loop;
end $$;
commit;
