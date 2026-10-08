-- Sonda de Páginas: from "is it up" to "is it working, and what does it cost". Additive; no
-- existing row changes.
--
-- A page now belongs to a project, so the screen shows the spend reaching it and what a fall
-- costs. Each check follows up to 3 redirects and records where it landed, reads the start of the
-- final HTML to confirm the Meta pixel, the Hubla checkout link and an optional text, and reads
-- the certificate expiry. What to watch is chosen per page. A page can be silenced for planned
-- maintenance: it keeps being checked but raises no critical until then.

alter table pages
  add column sales_funnel_id uuid,
  add column watch_pixel boolean not null default false,
  add column watch_checkout boolean not null default false,
  add column required_text text check (required_text is null or (btrim(required_text) <> '' and length(required_text) <= 120)),
  add column silenced_until timestamptz;
-- The project must be of the same client; deleting the project unlinks the page, never deletes it.
alter table pages add constraint pages_sales_funnel_fkey
  foreign key (sales_funnel_id, client_id) references sales_funnels (id, client_id)
  on delete set null (sales_funnel_id);

-- Null where the page does not watch that item (or the check never reached the HTML).
alter table page_checks
  add column final_url text,
  add column redirects smallint not null default 0,
  add column pixel_found boolean,
  add column checkout_url text,
  add column checkout_ok boolean,
  add column text_found boolean,
  add column cert_expires_at timestamptz;

-- The latest two checks of every active page the caller can read: the Carteira counts the pages
-- that are down, and the 5-minute recheck picks the pages whose last check failed.
create function public.get_pages_now()
returns table (page_id uuid, client_id uuid, url text, silenced boolean, last_ok boolean, last_redirects smallint, prev_ok boolean)
language sql stable security invoker set search_path = ''
as $$
  select p.id, p.client_id, p.url, coalesce(p.silenced_until > now(), false), l.ok, l.redirects, pr.ok
  from public.pages p
  left join lateral (
    select c.ok, c.redirects, c.checked_at from public.page_checks c where c.page_id = p.id order by c.checked_at desc limit 1
  ) l on true
  left join lateral (
    select c.ok from public.page_checks c where c.page_id = p.id and c.checked_at < l.checked_at order by c.checked_at desc limit 1
  ) pr on true
  where p.is_active
$$;
revoke all on function public.get_pages_now() from public, anon;
grant execute on function public.get_pages_now() to authenticated, service_role;
