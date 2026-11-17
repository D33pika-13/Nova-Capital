-- Announcements are private client content; recipients are explicit and retained.
create table public.announcements (
 id uuid primary key default gen_random_uuid(),
 title text not null check(length(title) between 1 and 200),
 body text not null check(length(body) between 1 and 5000),
 status text not null default 'draft' check(status in ('draft','published','archived')),
 version integer not null default 1 check(version>0),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.announcement_recipients (
 id uuid primary key default gen_random_uuid(),
 announcement_id uuid not null references public.announcements(id),
 client_id uuid not null references public.profiles(id),
 included boolean not null default true,
 read_version integer not null default 0 check(read_version>=0),
 read_at timestamptz,
 unique(announcement_id,client_id),
 check((read_version=0 and read_at is null) or (read_version>0 and read_at is not null))
);
create index on public.announcements(updated_at desc,id);
create index on public.announcement_recipients(client_id,announcement_id) where included;
alter table public.announcements enable row level security;
alter table public.announcement_recipients enable row level security;
-- Fixed-path, narrow predicate avoids recursive parent/recipient RLS policies.
create function private.can_read_announcement(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.announcements a join public.announcement_recipients r on r.announcement_id=a.id
 where a.id=target and a.status='published' and r.included and r.client_id=private.current_profile_id())
$$;
revoke all on function private.can_read_announcement(uuid) from public;
grant execute on function private.can_read_announcement(uuid) to nova_app;
create policy announcement_read on public.announcements for select to nova_app using(private.is_admin() or private.can_read_announcement(id));
create policy announcement_insert on public.announcements for insert to nova_app with check(private.is_admin() and created_by=private.current_profile_id());
create policy announcement_update on public.announcements for update to nova_app using(private.is_admin()) with check(private.is_admin());
create policy recipient_read on public.announcement_recipients for select to nova_app using(private.is_admin() or (client_id=private.current_profile_id() and included and private.can_read_announcement(announcement_id)));
create policy recipient_insert on public.announcement_recipients for insert to nova_app with check(private.is_admin());
create policy recipient_update on public.announcement_recipients for update to nova_app using(private.is_admin() or (client_id=private.current_profile_id() and included and private.can_read_announcement(announcement_id))) with check(private.is_admin() or (client_id=private.current_profile_id() and included and private.can_read_announcement(announcement_id)));
create function private.guard_announcement() returns trigger language plpgsql set search_path='' as $$
begin
 if new.id<>old.id or new.created_by<>old.created_by or new.created_at<>old.created_at then raise exception 'Immutable announcement ownership' using errcode='23514'; end if;
 new.version=old.version+1;
 return new;
end $$;
revoke all on function private.guard_announcement() from public;
create trigger guard_content before update on public.announcements for each row execute function private.guard_announcement();
create trigger touch_row before update on public.announcements for each row execute function private.touch_updated_at();
-- Only a recipient can acknowledge; server clock supplies the timestamp.
create function private.guard_announcement_recipient() returns trigger language plpgsql security definer set search_path='' as $$
declare current_version integer;
begin
 if tg_op='INSERT' then
  if not private.is_admin() then raise exception 'Recipient management denied' using errcode='42501'; end if;
  if new.read_version<>0 or new.read_at is not null or not exists(select 1 from public.profiles p where p.id=new.client_id and p.role='client') then raise exception 'Invalid recipient' using errcode='23514'; end if;
 else
  if new.id<>old.id or new.announcement_id<>old.announcement_id or new.client_id<>old.client_id then raise exception 'Immutable recipient' using errcode='23514'; end if;
  if private.is_admin() then
   if new.read_version<>old.read_version or new.read_at is distinct from old.read_at then raise exception 'Recipient acknowledgment required' using errcode='42501'; end if;
  else
   select a.version into current_version from public.announcements a where a.id=old.announcement_id and a.status='published';
   if private.current_profile_id() is distinct from old.client_id or not old.included or new.included<>old.included or new.read_version<>current_version or new.read_version<old.read_version or current_version is null then raise exception 'Invalid acknowledgment' using errcode='42501'; end if;
   new.read_at=case when new.read_version=old.read_version then old.read_at else clock_timestamp() end;
  end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_announcement_recipient() from public;
create trigger guard_recipient before insert or update on public.announcement_recipients for each row execute function private.guard_announcement_recipient();
create trigger audit_row after insert or update or delete on public.announcements for each row execute function private.audit_change();
create trigger audit_row after insert or update or delete on public.announcement_recipients for each row execute function private.audit_change();
grant select,insert on public.announcements,public.announcement_recipients to nova_app;
grant update(title,body,status) on public.announcements to nova_app;
grant update(included,read_version) on public.announcement_recipients to nova_app;
-- Browser/service-role credentials never access application tables directly.
do $$ declare role_name text; begin
 foreach role_name in array array['anon','authenticated','service_role'] loop
  if exists(select 1 from pg_roles where rolname=role_name) then
   execute format('revoke all on public.announcements,public.announcement_recipients from %I',role_name);
  end if;
 end loop;
end $$;
