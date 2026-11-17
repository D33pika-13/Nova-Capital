begin;
alter table public.chat_sessions add column title text not null default 'New chat' check(length(title) between 1 and 80);
alter table public.chat_sessions add column updated_at timestamptz not null default now();
alter table public.chat_sessions add column cleared_at timestamptz;
alter table public.chat_messages add column request_id uuid;
alter table public.chat_messages add column reply jsonb;
alter table public.chat_messages add column ordinal bigint generated always as identity;
create unique index on public.chat_messages(client_id,request_id,role) where request_id is not null;
create index on public.chat_messages(session_id,ordinal);
grant usage,select on sequence public.chat_messages_ordinal_seq to nova_app;
create table private.chat_requests(
 client_id uuid not null references public.profiles(id),request_id uuid not null,session_id uuid not null references public.chat_sessions(id),
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),status text not null check(status in ('processing','completed','cancelled','failed')),
 result jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),primary key(client_id,request_id)
);
revoke all on private.chat_requests from public,nova_app;
-- Lock the actor before sessions/requests in all operations; never hold this over AI I/O.
create function private.chat_actor() returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
 select p.id into actor from public.profiles p where p.id=private.current_profile_id() and p.role='client' and p.status='active' for update;
 if actor is null then raise exception 'Active client required' using errcode='42501'; end if;
 return actor;
end $$;
create function private.claim_chat(p_request uuid,p_hash text,p_session uuid,p_question text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; item private.chat_requests; target uuid;
begin
 actor=private.chat_actor();
 if p_request is null or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or length(p_question) not between 1 and 2000 or p_question is null then raise exception 'Invalid chat request' using errcode='23514'; end if;
 select * into item from private.chat_requests where client_id=actor and request_id=p_request for update;
 if found then
  if item.payload_hash is distinct from p_hash then raise exception 'Changed request' using errcode='23505'; end if;
  if item.status='processing' and item.updated_at<now()-interval '2 minutes' then update private.chat_requests set status='failed',updated_at=clock_timestamp() where client_id=actor and request_id=p_request; item.status='failed'; end if;
  return jsonb_build_object('claimed',false,'status',item.status,'sessionId',item.session_id,'result',item.result);
 end if;
 if p_session is null then
  insert into public.chat_sessions(client_id,title) values(actor,left(p_question,80)) returning id into target;
 else
  select id into target from public.chat_sessions where id=p_session and client_id=actor and cleared_at is null for update;
  if target is null then raise exception 'Chat unavailable' using errcode='P0002'; end if;
 end if;
 if exists(select 1 from private.chat_requests where session_id=target and status='processing' and updated_at>=now()-interval '2 minutes') then raise exception 'Chat request pending' using errcode='55P03'; end if;
 update private.chat_requests set status='failed',updated_at=clock_timestamp() where session_id=target and status='processing';
 if (select count(*) from public.chat_messages where session_id=target)>=100 then raise exception 'Start a new chat' using errcode='54000'; end if;
 insert into private.chat_requests(client_id,request_id,session_id,payload_hash,status) values(actor,p_request,target,p_hash,'processing');
 insert into public.chat_messages(session_id,client_id,role,content,request_id) values(target,actor,'user',p_question,p_request);
 update public.chat_sessions set updated_at=clock_timestamp() where id=target;
 return jsonb_build_object('claimed',true,'status','processing','sessionId',target,'result',null);
end $$;
create function private.finish_chat(p_request uuid,p_reply jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; item private.chat_requests; stamp timestamptz; result_value jsonb;
begin
 actor=private.chat_actor();
 select * into item from private.chat_requests where client_id=actor and request_id=p_request for update;
 if not found or item.status in ('cancelled','failed') or exists(select 1 from public.chat_sessions where id=item.session_id and cleared_at is not null) then raise exception 'Chat unavailable' using errcode='P0002'; end if;
 if item.status='completed' then return item.result; end if;
 if jsonb_typeof(p_reply)<>'object' or length(p_reply->>'text') not between 1 and 7500 or p_reply->>'text' is null or p_reply->>'mode' is null or p_reply->>'mode' not in ('ai','faq','fallback') or octet_length(p_reply::text)>32000 then raise exception 'Invalid reply' using errcode='23514'; end if;
 stamp=clock_timestamp();
 insert into public.chat_messages(session_id,client_id,role,content,request_id,reply,created_at) values(item.session_id,actor,'assistant',p_reply->>'text',p_request,p_reply,stamp);
 result_value=jsonb_build_object('sessionId',item.session_id,'requestId',p_request,'reply',p_reply,'createdAt',to_char(stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 update private.chat_requests set status='completed',result=result_value,updated_at=stamp where client_id=actor and request_id=p_request;
 update public.chat_sessions set updated_at=stamp where id=item.session_id;
 return result_value;
end $$;
create function private.clear_chat(p_session uuid) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid; target uuid;
begin
 actor=private.chat_actor();select id into target from public.chat_sessions where id=p_session and client_id=actor for update;
 if target is null then raise exception 'Chat unavailable' using errcode='P0002'; end if;
 if exists(select 1 from public.chat_sessions where id=target and cleared_at is null) then insert into public.audit_logs(actor_id,action,entity,entity_id,after_data) values(actor,'CLEAR','chat_sessions',target,jsonb_build_object('cleared',true)); end if;
 update public.chat_sessions set cleared_at=coalesce(cleared_at,clock_timestamp()),title='Cleared chat',updated_at=clock_timestamp() where id=target;
 delete from public.chat_messages where session_id=target;
 update private.chat_requests set status='cancelled',result=null,updated_at=clock_timestamp() where session_id=target;
end $$;
revoke all on function private.chat_actor(),private.claim_chat(uuid,text,uuid,text),private.finish_chat(uuid,jsonb),private.clear_chat(uuid) from public;
grant execute on function private.claim_chat(uuid,text,uuid,text),private.finish_chat(uuid,jsonb),private.clear_chat(uuid) to nova_app;
-- Cleared sessions are tombstones, preventing late retries from restoring content.
drop policy chat_session_own on public.chat_sessions;
create policy chat_session_read on public.chat_sessions for select to nova_app using(client_id=private.current_profile_id() and cleared_at is null);
create policy chat_session_insert on public.chat_sessions for insert to nova_app with check(client_id=private.current_profile_id() and cleared_at is null);
create policy chat_session_delete on public.chat_sessions for delete to nova_app using(false);
commit;
