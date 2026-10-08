-- Routing rules (Testes 2.0, section 7: creative matched to page). Additive; no existing row changes.
--
-- A variant can send each person to a different page by the ad they clicked, where they came from
-- or their device: "página casada" sends [dor] ads to the pain page and [ganho] ads to the gain
-- page. The draw is untouched: /r still picks the variant by weight, and only then the variant's
-- first matching rule picks the page. So "casada × genérica" stays a real random test.
-- Each click keeps the rule that routed it, to read later which matched page earned most.

alter table variants add constraint variants_id_test_key unique (id, test_id);

create table variant_routes (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null,
  variant_id uuid not null,
  position integer not null default 0,
  -- ad_name: the ad's name contains the value (utm_term); utm_source: the source is the value;
  -- device: 'celular' or 'computador'.
  match_field text not null check (match_field in ('ad_name', 'utm_source', 'device')),
  match_value text not null check (btrim(match_value) <> ''),
  destination_url text not null check (destination_url ~ '^https?://'),
  created_at timestamptz not null default now(),
  -- The rule belongs to a variant of the same test.
  foreign key (variant_id, test_id) references variants (id, test_id) on delete cascade,
  check (match_field <> 'device' or match_value in ('celular', 'computador'))
);
create index variant_routes_variant_idx on variant_routes (variant_id, position);

alter table variant_routes enable row level security;
-- Read through `tests` (its RLS decides, publication included); written by gestor or owner.
create policy variant_routes_read on variant_routes for select to authenticated
  using (test_id in (select t.id from tests t));
create policy variant_routes_write on variant_routes for all to authenticated
  using (test_id in (select t.id from tests t where t.client_id in (select private.accessible_client_ids('gestor'))))
  with check (test_id in (select t.id from tests t where t.client_id in (select private.accessible_client_ids('gestor'))));

alter table click_events add column route_id uuid references variant_routes(id) on delete set null;
