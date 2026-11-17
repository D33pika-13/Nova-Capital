begin;
create table public.offer_images (
 id uuid primary key default gen_random_uuid(),offer_id uuid not null references public.offers(id),
 storage_path text not null unique,storage_bucket text not null check(storage_bucket ~ '^[a-z0-9-]{1,63}$'),
 storage_provider text not null check(storage_provider in ('supabase','azure')),
 source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),file_sha256 text not null check(file_sha256 ~ '^[a-f0-9]{64}$'),
 size_bytes integer not null check(size_bytes between 1 and 5242880),
 width integer not null check(width between 1 and 1600),height integer not null check(height between 1 and 1600),
 alt text not null check(length(alt) between 1 and 200),expected_version integer not null check(expected_version>0),
 status text not null default 'quarantined' check(status in ('quarantined','ready','aborted')),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 scanned_at timestamptz not null default now(),ready_at timestamptz
);
create index on public.offer_images(offer_id,created_at desc);
alter table public.offers add column image_id uuid references public.offer_images(id);
grant update(image_id) on public.offers to nova_app;
create function private.guard_offer_image() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.status<>'quarantined' or new.ready_at is not null or new.storage_path<>new.offer_id::text||'/'||new.id::text||'.webp' then raise exception 'Invalid image reservation' using errcode='23514'; end if;
 else
  if row(new.id,new.offer_id,new.storage_path,new.storage_bucket,new.storage_provider,new.source_sha256,new.file_sha256,new.size_bytes,new.width,new.height,new.alt,new.expected_version,new.created_by,new.created_at,new.scanned_at) is distinct from row(old.id,old.offer_id,old.storage_path,old.storage_bucket,old.storage_provider,old.source_sha256,old.file_sha256,old.size_bytes,old.width,old.height,old.alt,old.expected_version,old.created_by,old.created_at,old.scanned_at) then raise exception 'Immutable image' using errcode='23514'; end if;
  if old.status<>'quarantined' or new.status not in ('ready','aborted') then raise exception 'Invalid image transition' using errcode='23514'; end if;
  if new.status='ready' then new.ready_at=clock_timestamp();
  elsif new.ready_at is distinct from old.ready_at then raise exception 'Immutable image publication' using errcode='23514'; end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_offer_image() from public;
create trigger guard_image before insert or update on public.offer_images for each row execute function private.guard_offer_image();
create function private.guard_offer_image_link() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.image_id is not null and not exists(select 1 from public.offer_images i where i.id=new.image_id and i.offer_id=new.id and i.status='ready') then raise exception 'Image must be verified and belong to this offer' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function private.guard_offer_image_link() from public;
create trigger offer_image_link before insert or update on public.offers for each row execute function private.guard_offer_image_link();
alter table public.offer_images enable row level security;
create policy image_read on public.offer_images for select to nova_app using(private.is_admin() or (status='ready' and exists(select 1 from public.offers o where o.image_id=offer_images.id and o.id=offer_images.offer_id)));
create policy image_insert on public.offer_images for insert to nova_app with check(private.is_admin() and created_by=private.current_profile_id());
create policy image_update on public.offer_images for update to nova_app using(private.is_admin()) with check(private.is_admin());
grant select,insert on public.offer_images to nova_app;
grant update(status) on public.offer_images to nova_app;
create trigger audit_row after insert or update or delete on public.offer_images for each row execute function private.audit_change();
do $$ declare role_name text; begin
 foreach role_name in array array['anon','authenticated','service_role'] loop
  if exists(select 1 from pg_roles where rolname=role_name) then execute format('revoke all on public.offer_images from %I',role_name); end if;
 end loop;
end $$;
create table private.offer_image_buckets(name text primary key check(name ~ '^[a-z0-9-]{1,63}$'),maximum_bytes integer not null check(maximum_bytes between 1024 and 5242880));
revoke all on private.offer_image_buckets from public;
create function private.configure_offer_image_bucket(p_bucket text,p_max_bytes integer default 5242880) returns void language plpgsql set search_path='' as $$
declare role_names text; policy_name text;
begin
 if p_bucket !~ '^[a-z0-9-]{1,63}$' or p_max_bytes not between 1024 and 5242880 then raise exception 'Invalid bucket configuration'; end if;
 if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then raise exception 'Supabase Storage schema is unavailable'; end if;
 if exists(select 1 from private.report_buckets where name=p_bucket) then raise exception 'Image and report buckets must be separate'; end if;
 select string_agg(quote_ident(rolname),', ' order by rolname) into role_names from pg_roles where rolname in ('anon','authenticated');
 if role_names is null or (select count(*) from pg_roles where rolname in ('anon','authenticated'))<>2 then raise exception 'Storage roles unavailable'; end if;
 execute 'insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values($1,$1,false,$2,array[''image/webp'']::text[]) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types' using p_bucket,p_max_bytes;
 policy_name='nova_offer_images_'||md5(p_bucket);
 execute format('drop policy if exists %I on storage.objects',policy_name);
 execute format('create policy %I on storage.objects as restrictive for all to %s using(bucket_id<>%L) with check(bucket_id<>%L)',policy_name,role_names,p_bucket,p_bucket);
 insert into private.offer_image_buckets(name,maximum_bytes) values(p_bucket,p_max_bytes) on conflict(name) do update set maximum_bytes=excluded.maximum_bytes;
end $$;
revoke all on function private.configure_offer_image_bucket(text,integer) from public;
create function private.offer_image_bucket_ready(p_bucket text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare bucket_private boolean; policy_ok boolean; expected_expression text;
begin
 if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then return false; end if;
 if not exists(select 1 from private.offer_image_buckets where name=p_bucket) then return false; end if;
 execute 'select not public from storage.buckets where id=$1' into bucket_private using p_bucket;
 expected_expression=format('(bucket_id <> %L::text)',p_bucket);
 select exists(select 1 from pg_policy pol join pg_class c on c.oid=pol.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='storage' and c.relname='objects' and c.relrowsecurity and pol.polname='nova_offer_images_'||md5(p_bucket) and not pol.polpermissive and pol.polcmd='*' and pg_get_expr(pol.polqual,pol.polrelid)=expected_expression and pg_get_expr(pol.polwithcheck,pol.polrelid)=expected_expression and pol.polroles @> array[(select oid from pg_roles where rolname='anon'),(select oid from pg_roles where rolname='authenticated')]::oid[]) into policy_ok;
 return coalesce(bucket_private,false) and policy_ok;
end $$;
revoke all on function private.offer_image_bucket_ready(text) from public;
grant execute on function private.offer_image_bucket_ready(text) to nova_app;
do $$ begin
 if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then perform private.configure_offer_image_bucket('offer-images',5242880); end if;
end $$;
commit;
