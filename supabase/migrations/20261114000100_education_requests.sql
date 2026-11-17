-- Consented public enquiries; private to MFA administrators. No outbound messages.
begin;
create table private.education_requests (
 id uuid primary key,
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 name text not null check(length(trim(name)) between 1 and 150 and name !~ '[[:cntrl:]]'),
 email text not null check(length(email) between 3 and 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 phone text not null check(length(phone) between 7 and 30 and phone ~ '^\+?[0-9() .-]+$' and length(regexp_replace(phone,'[^0-9]','','g')) between 7 and 15),
 service text not null check(service in ('webinars','mentorship')),
 message text not null default '' check(length(message)<=3000 and translate(message,E'\n\r\t','') !~ '[[:cntrl:]]'),
 consented_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);
create index on private.education_requests(created_at desc,id);
alter table private.education_requests enable row level security;
revoke all on private.education_requests from public,nova_app;
grant select on private.education_requests to nova_app;
create policy education_admin_read on private.education_requests for select to nova_app using(private.is_admin());
create function private.submit_education(p_id uuid,p_hash text,p_name text,p_email text,p_phone text,p_service text,p_message text) returns void language plpgsql security definer set search_path='' as $$
declare saved uuid; existing_hash text;
begin
 insert into private.education_requests(id,payload_hash,name,email,phone,service,message)
 values(p_id,p_hash,p_name,p_email,p_phone,p_service,p_message) on conflict(id) do nothing returning id into saved;
 if saved is null then
  select payload_hash into existing_hash from private.education_requests where id=p_id;
  if existing_hash is distinct from p_hash then raise exception 'Submission reference conflict' using errcode='23505'; end if;
 else
  insert into public.audit_logs(actor_id,action,entity,entity_id,after_data) values(null,'INSERT','education_requests',p_id,jsonb_build_object('status','received','service',p_service));
 end if;
end $$;
revoke all on function private.submit_education(uuid,text,text,text,text,text,text) from public;
grant execute on function private.submit_education(uuid,text,text,text,text,text,text) to nova_app;
do $$ declare r text; begin
 foreach r in array array['anon','authenticated','service_role'] loop
  if exists(select 1 from pg_roles where rolname=r) then
   execute format('revoke all on private.education_requests from %I',r);
   execute format('revoke all on function private.submit_education(uuid,text,text,text,text,text,text) from %I',r);
  end if;
 end loop;
end $$;
commit;
