-- Sonda de Páginas: a page belongs to one front of its project, the front whose ads send people to
-- it. Null is "sem frente · orgânico" (the bio link, say). One row is one page and (client_id, url)
-- is unique, so a page is never in two fronts. Additive; no existing row changes.

alter table pages add column front_id uuid references project_fronts(id) on delete set null;
create index pages_front_idx on pages (front_id);

-- The front must be one of the page's own project, and own campaigns: a mirror front only reads
-- another project, so no ad of its own sends anyone to a page.
create function private.check_page_front() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- Unlinking the project (or deleting it) unlinks the front too.
  if tg_op = 'UPDATE' and new.sales_funnel_id is null and old.sales_funnel_id is not null then
    new.front_id := null;
  end if;
  if new.front_id is not null and not exists (
    select 1 from public.project_fronts f
    where f.id = new.front_id and f.sales_funnel_id = new.sales_funnel_id and f.source_sales_funnel_id is null
  ) then
    raise exception 'front % cannot own page of project %', new.front_id, new.sales_funnel_id using errcode = '23514';
  end if;
  return new;
end
$$;
create trigger pages_front_check before insert or update of front_id, sales_funnel_id on pages
  for each row execute function private.check_page_front();
