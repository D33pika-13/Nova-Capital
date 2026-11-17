-- Test-only Supabase metadata shape. This is not a real Storage HTTP service.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema storage;
create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null);
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated;
grant select,insert,update,delete on storage.objects to anon,authenticated;
-- Deliberately permissive pre-existing policy: the report restriction must still win.
create policy test_broad_access on storage.objects for all to anon,authenticated using(true) with check(true);
