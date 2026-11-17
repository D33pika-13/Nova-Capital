-- Narrow maintenance capability. It never publishes, extends or changes content.
create function private.expire_offers() returns integer language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
 if nullif(current_setting('app.subject',true),'') is not null and not private.is_admin() then raise exception 'Maintenance denied' using errcode='42501'; end if;
 with due as (
  select id from public.offers where status='published' and ends_at<=now()
  order by ends_at,id limit 500 for update skip locked
 )
 update public.offers o set status='expired' from due where o.id=due.id;
 get diagnostics affected=row_count;
 return affected;
end $$;
revoke all on function private.expire_offers() from public;
grant execute on function private.expire_offers() to nova_app;
