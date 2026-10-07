-- Central de Tráfego: a probe on the pages the ads send people to.
--
-- A gestor registers the client's pages (sales page, checkout, capture). Every sync, and on
-- "Checar agora", the server requests each one and keeps the answer: status, time to the response
-- headers, error. A page that stops answering or gets slow shows up in the Painel and in Hoje,
-- before the money spent on clicks into it goes to waste.

create table pages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  label text not null check (btrim(label) <> ''),
  url text not null check (url like 'https://%'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (client_id, url)
);
create index pages_client_idx on pages (client_id);

create table page_checks (
  id bigint generated always as identity primary key,
  page_id uuid not null references pages(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  checked_at timestamptz not null default now(),
  status_code integer,
  ttfb_ms integer,
  ok boolean not null,
  error text
);
create index page_checks_page_checked_idx on page_checks (page_id, checked_at desc);

alter table pages enable row level security;
alter table page_checks enable row level security;
create policy pages_read on pages for select to authenticated
  using (client_id in (select private.accessible_client_ids('cliente')));
create policy pages_write on pages for all to authenticated
  using (client_id in (select private.accessible_client_ids('gestor')))
  with check (client_id in (select private.accessible_client_ids('gestor')));
create policy page_checks_read on page_checks for select to authenticated
  using (client_id in (select private.accessible_client_ids('cliente')));
grant select, insert, update, delete on pages to authenticated, service_role;
grant select on page_checks to authenticated;
grant select, insert, delete on page_checks to service_role;
revoke all on pages, page_checks from anon;
