-- Content edits are versioned and audited. Public visibility remains time bounded by RLS.
alter table public.offers add column version integer not null default 1 check(version>0);
alter table public.offers add constraint offer_finite_dates check(isfinite(starts_at) and isfinite(ends_at));
alter table public.offers add constraint offer_content_bounds check(length(eligibility) between 1 and 5000 and length(terms) between 1 and 10000);
create function private.guard_offer() returns trigger language plpgsql set search_path='' as $$
begin
 if new.id<>old.id or new.created_by<>old.created_by or new.created_at<>old.created_at then
  raise exception 'Offer ownership is immutable' using errcode='23514';
 end if;
 new.version=old.version+1;
 return new;
end $$;
revoke all on function private.guard_offer() from public;
create trigger guard_offer before update on public.offers for each row execute function private.guard_offer();
revoke update on public.offers from nova_app;
grant update(title,description,category,eligibility,terms,status,starts_at,ends_at) on public.offers to nova_app;
