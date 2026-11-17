-- DEMO ONLY. Apply only to an isolated local/test database, never production.
-- These synthetic identities are database fixtures, not usable auth accounts.
begin;
insert into public.profiles(id,client_id,display_name,email,role) values
 ('10000000-0000-4000-8000-000000000001',null,'DEMO Administrator','admin@example.test','admin'),
 ('10000000-0000-4000-8000-000000000002','INV-1001','DEMO Client A','client-a@example.test','client'),
 ('10000000-0000-4000-8000-000000000003','INV-1002','DEMO Client B','client-b@example.test','client');
insert into public.provider_identities(profile_id,provider,subject) values
 ('10000000-0000-4000-8000-000000000001','supabase','synthetic-admin'),
 ('10000000-0000-4000-8000-000000000002','supabase','synthetic-a'),
 ('10000000-0000-4000-8000-000000000003','supabase','synthetic-b');
do $$ begin
 if to_regclass('private.client_number') is not null then
  perform setval('private.client_number',greatest(1000,(select max(substring(client_id from 5)::bigint) from public.profiles where client_id is not null)),true);
 end if;
end $$;
commit;
