begin;
-- Azure locations require separate owner approval; a provider selector does not move files.
create table private.azure_storage_locations(
 account_name text not null check(account_name ~ '^[a-z0-9]{3,24}$'),
 container_name text not null check(container_name ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$' and container_name not like '%--%'),
 purpose text not null check(purpose in ('reports','offer_images')),
 maximum_bytes integer not null check(maximum_bytes between 1024 and 10485760),
 primary key(account_name,container_name),check(purpose<>'offer_images' or maximum_bytes<=5242880)
);
revoke all on private.azure_storage_locations from public,nova_app;
create function private.register_azure_storage(p_account text,p_container text,p_purpose text,p_maximum integer) returns void language sql set search_path='' as $$
 insert into private.azure_storage_locations(account_name,container_name,purpose,maximum_bytes) values(p_account,p_container,p_purpose,p_maximum)
 on conflict(account_name,container_name) do update set purpose=excluded.purpose,maximum_bytes=excluded.maximum_bytes
$$;
revoke all on function private.register_azure_storage(text,text,text,integer) from public;
create function private.azure_storage_ready(p_account text,p_container text,p_purpose text,p_required integer) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.azure_storage_locations where account_name=p_account and container_name=p_container and purpose=p_purpose and maximum_bytes>=p_required and p_required between 1024 and 10485760)
$$;
revoke all on function private.azure_storage_ready(text,text,text,integer) from public;
grant execute on function private.azure_storage_ready(text,text,text,integer) to nova_app;
alter table public.client_reports add column storage_namespace text;
alter table public.offer_images add column storage_namespace text;
alter table public.client_reports add constraint report_storage_namespace check((storage_provider='azure' and storage_namespace is not null and storage_namespace ~ '^[a-z0-9]{3,24}$') or (storage_provider='supabase' and storage_namespace is null));
alter table public.offer_images add constraint image_storage_namespace check((storage_provider='azure' and storage_namespace is not null and storage_namespace ~ '^[a-z0-9]{3,24}$') or (storage_provider='supabase' and storage_namespace is null));
create function private.guard_storage_namespace() returns trigger language plpgsql set search_path='' as $$
begin
 if new.storage_namespace is distinct from old.storage_namespace then raise exception 'Storage namespace is immutable; perform an audited migration' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function private.guard_storage_namespace() from public;
create trigger immutable_storage_namespace before update on public.client_reports for each row execute function private.guard_storage_namespace();
create trigger immutable_storage_namespace before update on public.offer_images for each row execute function private.guard_storage_namespace();
commit;
