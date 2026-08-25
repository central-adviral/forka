create extension if not exists "pgcrypto";

create table clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table tests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active','paused')),
  fallback_url text,
  conversion_method text not null check (conversion_method in ('hubla_webhook','thank_you_page')),
  created_at timestamptz not null default now()
);

create table variants (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references tests(id) on delete cascade,
  name text not null,
  weight_pct numeric not null check (weight_pct > 0 and weight_pct <= 100),
  destination_url text not null,
  thank_you_url text,
  created_at timestamptz not null default now()
);

create table click_events (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references tests(id) on delete cascade,
  variant_id uuid not null references variants(id) on delete cascade,
  visitor_id text not null,
  tracking_id text not null unique,
  source_utms jsonb,
  created_at timestamptz not null default now()
);

create table conversions (
  id uuid primary key default gen_random_uuid(),
  click_event_id uuid not null references click_events(id) on delete cascade,
  source text not null check (source in ('hubla_webhook','thank_you_page')),
  external_event_id text,
  value_cents integer,
  created_at timestamptz not null default now(),
  unique (click_event_id, source)
);

create unique index conversions_external_event_id_idx
  on conversions(external_event_id) where external_event_id is not null;

alter table clients enable row level security;
alter table tests enable row level security;
alter table variants enable row level security;
alter table click_events enable row level security;
alter table conversions enable row level security;

create policy "clients_owner_all" on clients
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "tests_via_client_owner" on tests
  for all using (exists (select 1 from clients c where c.id = tests.client_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from clients c where c.id = tests.client_id and c.owner_id = auth.uid()));

create policy "variants_via_client_owner" on variants
  for all using (exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = variants.test_id and c.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = variants.test_id and c.owner_id = auth.uid()
  ));

create policy "click_events_select_via_client_owner" on click_events
  for select using (exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = click_events.test_id and c.owner_id = auth.uid()
  ));

create policy "conversions_select_via_client_owner" on conversions
  for select using (exists (
    select 1 from click_events ce
    join tests t on t.id = ce.test_id
    join clients c on c.id = t.client_id
    where ce.id = conversions.click_event_id and c.owner_id = auth.uid()
  ));

-- New tables in `public` are not reachable via the Data API by default on this
-- Postgres image: anon/authenticated/service_role only inherit truncate/
-- references/trigger/maintain, not select/insert/update/delete. Grants below
-- match the RLS policies above; RLS still governs which rows are visible.
grant select, insert, update, delete on clients, tests, variants to authenticated;
grant select on click_events, conversions to authenticated;
grant select, insert, update, delete on clients, tests, variants, click_events, conversions to service_role;

create or replace function create_test_with_variants(
  p_client_id uuid,
  p_name text,
  p_slug text,
  p_fallback_url text,
  p_conversion_method text,
  p_variants jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_test_id uuid;
  v_total numeric;
begin
  if not exists (select 1 from clients where id = p_client_id and owner_id = auth.uid()) then
    raise exception 'access denied';
  end if;

  select sum((v->>'weight_pct')::numeric) into v_total from jsonb_array_elements(p_variants) v;
  if v_total is null or abs(v_total - 100) > 0.01 then
    raise exception 'variant weights must sum to 100, got %', v_total;
  end if;

  insert into tests (client_id, name, slug, fallback_url, conversion_method)
  values (p_client_id, p_name, p_slug, p_fallback_url, p_conversion_method)
  returning id into v_test_id;

  insert into variants (test_id, name, weight_pct, destination_url, thank_you_url)
  select v_test_id, v->>'name', (v->>'weight_pct')::numeric, v->>'destination_url', v->>'thank_you_url'
  from jsonb_array_elements(p_variants) v;

  return v_test_id;
end;
$$;

revoke all on function create_test_with_variants(uuid, text, text, text, text, jsonb) from public;
grant execute on function create_test_with_variants(uuid, text, text, text, text, jsonb) to authenticated;

create or replace function get_test_report(p_test_id uuid)
returns table (
  variant_id uuid,
  variant_name text,
  weight_pct numeric,
  visits bigint,
  conversions bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and c.owner_id = auth.uid()
  ) then
    raise exception 'not found or access denied';
  end if;

  return query
  select v.id, v.name, v.weight_pct,
         count(distinct ce.id)::bigint,
         count(distinct cv.id)::bigint
  from variants v
  left join click_events ce on ce.variant_id = v.id
  left join conversions cv on cv.click_event_id = ce.id
  where v.test_id = p_test_id
  group by v.id, v.name, v.weight_pct
  order by v.name;
end;
$$;

revoke all on function get_test_report(uuid) from public;
grant execute on function get_test_report(uuid) to authenticated;
