begin;
-- Original bytes are immutable; legacy rows must be revalidated before publication.
alter table public.client_reports add column file_name text not null default 'report.pdf';
alter table public.client_reports add column file_sha256 text check(file_sha256 ~ '^[a-f0-9]{64}$');
alter table public.client_reports add column storage_provider text not null default 'supabase' check(storage_provider in ('supabase','azure'));
alter table public.client_reports add column storage_bucket text not null default 'client-reports' check(storage_bucket ~ '^[a-z0-9-]{1,63}$');
alter table public.client_reports add column published_at timestamptz;
alter table public.client_reports add column scanned_at timestamptz;
alter table public.client_reports add column page_count integer check(page_count between 1 and 2000);
update public.client_reports set status='quarantined' where status='available';
alter table public.client_reports add constraint report_available_verified check(status<>'available' or (file_sha256 is not null and scanned_at is not null and page_count is not null and published_at is not null));
alter table public.client_reports add constraint report_period_valid check(period_start>'-infinity'::date and period_end<=report_date and report_date<'infinity'::date);
alter table public.client_reports add constraint report_filename_valid check(length(file_name) between 5 and 200 and file_name !~ '[[:cntrl:]/\\]' and lower(file_name) like '%.pdf');
create function private.guard_report_update() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.status<>'quarantined' or new.published_at is not null then raise exception 'Reports must begin in quarantine'; end if;
  if new.storage_path<>new.client_id::text||'/'||new.id::text||'.pdf' then raise exception 'Invalid report object association'; end if;
 else
  if row(new.id,new.client_id,new.storage_path,new.file_sha256,new.storage_provider,new.storage_bucket,new.file_name,new.title,new.period_start,new.period_end,new.report_date,new.size_bytes,new.uploaded_by,new.created_at,new.scanned_at,new.page_count) is distinct from row(old.id,old.client_id,old.storage_path,old.file_sha256,old.storage_provider,old.storage_bucket,old.file_name,old.title,old.period_start,old.period_end,old.report_date,old.size_bytes,old.uploaded_by,old.created_at,old.scanned_at,old.page_count) then raise exception 'Report metadata and original file are immutable'; end if;
  if old.status='archived' or new.status='quarantined' then raise exception 'Invalid report status transition'; end if;
  if new.status='available' and old.status='quarantined' then new.published_at=clock_timestamp();
  elsif new.published_at is distinct from old.published_at then raise exception 'Publication history is immutable'; end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_report_update() from public;
create trigger report_guard before insert or update on public.client_reports for each row execute function private.guard_report_update();
revoke update on public.client_reports from nova_app;
grant update(status) on public.client_reports to nova_app;

create table private.report_buckets(name text primary key check(name ~ '^[a-z0-9-]{1,63}$'),maximum_bytes integer not null check(maximum_bytes between 1024 and 10485760));
revoke all on private.report_buckets from public;
-- Owner-only installation. No browser/app role can change bucket policy or registry.
create function private.configure_report_bucket(p_bucket text,p_max_bytes integer default 10485760) returns void language plpgsql set search_path='' as $$
declare role_names text; policy_name text;
begin
 if p_bucket !~ '^[a-z0-9-]{1,63}$' or p_max_bytes not between 1024 and 10485760 then raise exception 'Invalid bucket configuration'; end if;
 if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then raise exception 'Supabase Storage schema is unavailable'; end if;
 select string_agg(quote_ident(rolname),', ' order by rolname) into role_names from pg_roles where rolname in ('anon','authenticated');
 if role_names is null or (select count(*) from pg_roles where rolname in ('anon','authenticated'))<>2 then raise exception 'Storage roles unavailable'; end if;
 execute 'insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values($1,$1,false,$2,array[''application/pdf'']::text[]) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types' using p_bucket,p_max_bytes;
 policy_name='nova_reports_'||md5(p_bucket);
 execute format('drop policy if exists %I on storage.objects',policy_name);
 execute format('create policy %I on storage.objects as restrictive for all to %s using(bucket_id<>%L) with check(bucket_id<>%L)',policy_name,role_names,p_bucket,p_bucket);
 insert into private.report_buckets(name,maximum_bytes) values(p_bucket,p_max_bytes) on conflict(name) do update set maximum_bytes=excluded.maximum_bytes;
end $$;
revoke all on function private.configure_report_bucket(text,integer) from public;
create function private.report_bucket_ready(p_bucket text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare bucket_private boolean; policy_ok boolean; expected_expression text;
begin
 if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then return false; end if;
 if not exists(select 1 from private.report_buckets where name=p_bucket) then return false; end if;
 execute 'select not public from storage.buckets where id=$1' into bucket_private using p_bucket;
 expected_expression=format('(bucket_id <> %L::text)',p_bucket);
 select exists(select 1 from pg_policy pol join pg_class c on c.oid=pol.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='storage' and c.relname='objects' and c.relrowsecurity and pol.polname='nova_reports_'||md5(p_bucket) and not pol.polpermissive and pol.polcmd='*' and pg_get_expr(pol.polqual,pol.polrelid)=expected_expression and pg_get_expr(pol.polwithcheck,pol.polrelid)=expected_expression and pol.polroles @> array[(select oid from pg_roles where rolname='anon'),(select oid from pg_roles where rolname='authenticated')]::oid[]) into policy_ok;
 return coalesce(bucket_private,false) and policy_ok;
end $$;
revoke all on function private.report_bucket_ready(text) from public;
grant execute on function private.report_bucket_ready(text) to nova_app;
do $$ begin
 if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then perform private.configure_report_bucket('client-reports',10485760); end if;
end $$;
create function private.lock_active_profile() returns void language plpgsql security definer set search_path='' as $$
declare active_id uuid;
begin
 select p.id into active_id from public.profiles p where p.id=private.current_profile_id() and p.status='active' for share;
 if active_id is null then raise exception using errcode='42501',message='Active profile required'; end if;
end $$;
revoke all on function private.lock_active_profile() from public;
grant execute on function private.lock_active_profile() to nova_app;
commit;
