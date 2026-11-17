begin;
-- No contact body, email or network address is retained in the request ledger.
create table private.contact_requests(
 request_id uuid primary key,payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 status text not null check(status in ('processing','accepted','unknown')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
revoke all on private.contact_requests from public,nova_app;
create function private.contact_status(p_id uuid,p_hash text) returns text language plpgsql security definer set search_path='' as $$
declare item private.contact_requests;
begin
 select * into item from private.contact_requests where request_id=p_id for update;
 if not found then return null; end if;
 if item.payload_hash is distinct from p_hash then raise exception 'Submission key conflict' using errcode='23505'; end if;
 if item.status='processing' and item.created_at<now()-interval '10 minutes' then
  update private.contact_requests set status='unknown',updated_at=clock_timestamp() where request_id=p_id;
  insert into public.audit_logs(actor_id,action,entity,entity_id,before_data,after_data) values(null,'UPDATE','contact_requests',p_id,jsonb_build_object('status','processing'),jsonb_build_object('status','unknown'));
  return 'unknown';
 end if;
 return item.status;
end $$;
create function private.claim_contact(p_id uuid,p_hash text) returns table(claimed boolean,status text) language plpgsql security definer set search_path='' as $$
declare inserted uuid; current_status text;
begin
 if p_hash !~ '^[a-f0-9]{64}$' or p_hash is null or p_id is null then raise exception 'Invalid contact claim' using errcode='23514'; end if;
 insert into private.contact_requests(request_id,payload_hash,status) values(p_id,p_hash,'processing') on conflict(request_id) do nothing returning request_id into inserted;
 if inserted is not null then
  insert into public.audit_logs(actor_id,action,entity,entity_id,after_data) values(null,'INSERT','contact_requests',p_id,jsonb_build_object('status','processing'));
  return query select true,'processing'::text;
 else
  current_status=private.contact_status(p_id,p_hash);
  return query select false,current_status;
 end if;
end $$;
create function private.finish_contact(p_id uuid,p_hash text,p_status text) returns text language plpgsql security definer set search_path='' as $$
declare item private.contact_requests;
begin
 if p_status not in ('accepted','unknown') or p_status is null then raise exception 'Invalid contact outcome' using errcode='23514'; end if;
 select * into item from private.contact_requests where request_id=p_id for update;
 if not found or item.payload_hash is distinct from p_hash then raise exception 'Contact claim unavailable' using errcode='23503'; end if;
 -- A lost acknowledgement cannot downgrade an already committed acceptance.
 if item.status='processing' then
  update private.contact_requests set status=p_status,updated_at=clock_timestamp() where request_id=p_id;
  insert into public.audit_logs(actor_id,action,entity,entity_id,before_data,after_data) values(null,'UPDATE','contact_requests',p_id,jsonb_build_object('status',item.status),jsonb_build_object('status',p_status));
  return p_status;
 end if;
 return item.status;
end $$;
revoke all on function private.contact_status(uuid,text),private.claim_contact(uuid,text),private.finish_contact(uuid,text,text) from public;
grant execute on function private.contact_status(uuid,text),private.claim_contact(uuid,text),private.finish_contact(uuid,text,text) to nova_app;
commit;
