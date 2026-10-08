-- Layers per project (Testes 2.0, review of 2026-10-07). Additive; no existing row changes.
--
-- A sale counted in every test the person went through: two page tests in one project both took
-- it, and a project's sale could even reach a test of another project of the same client. A test
-- now belongs to a project, and its type is its layer: the page decides who reaches the sales page,
-- the checkout decides which checkout the buy button opens. Per project:
--   * one active test per layer (two page tests would split the same sale), and
--   * the sale is credited only inside the project, once per layer.
-- A page test and a checkout test run together: /c enters the visitor of the page test into the
-- checkout test, keeping the page click as the parent, so both see the same sale.
-- Tests without a project keep the old client-wide behaviour until someone links them.

alter table sales_funnels add constraint sales_funnels_id_client_key unique (id, client_id);

alter table tests add column sales_funnel_id uuid;
-- The project must be of the same client; deleting the project unlinks the test, never deletes it.
alter table tests add constraint tests_sales_funnel_fkey
  foreign key (sales_funnel_id, client_id) references sales_funnels (id, client_id)
  on delete set null (sales_funnel_id);
create unique index tests_one_active_per_layer on tests (sales_funnel_id, test_type)
  where status = 'active' and sales_funnel_id is not null;

-- The page click a checkout entry came from, so the journey from the ad to the checkout stays linked.
alter table click_events add column parent_tracking_id text;

-- Creating a test takes its project. The old signature goes: the new parameter has a default, so a
-- call without it (code deployed before this migration) still resolves.
drop function if exists create_test_with_variants(uuid, text, text, text, text, text, text, jsonb);

create function public.create_test_with_variants(
  p_client_id uuid,
  p_name text,
  p_slug text,
  p_fallback_url text,
  p_conversion_method text,
  p_test_type text,
  p_sales_page_url text,
  p_variants jsonb,
  p_sales_funnel_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_test_id uuid;
  v_total numeric;
begin
  if not private.has_client_role(p_client_id, 'gestor') then
    raise exception 'access denied';
  end if;

  if p_test_type not in ('page', 'checkout') then
    raise exception 'invalid test_type: %', p_test_type;
  end if;

  if p_test_type = 'checkout' and (p_sales_page_url is null or p_sales_page_url = '') then
    raise exception 'checkout tests require a sales page url';
  end if;

  select sum((v->>'weight_pct')::numeric) into v_total from jsonb_array_elements(p_variants) v;
  if v_total is null or abs(v_total - 100) > 0.01 then
    raise exception 'variant weights must sum to 100, got %', v_total;
  end if;

  insert into tests (client_id, name, slug, fallback_url, conversion_method, test_type, sales_page_url, sales_funnel_id)
  values (p_client_id, p_name, p_slug, p_fallback_url, p_conversion_method, p_test_type,
          nullif(p_sales_page_url, ''), p_sales_funnel_id)
  returning id into v_test_id;

  insert into variants (test_id, name, weight_pct, destination_url, thank_you_url, is_control)
  select v_test_id, v->>'name', (v->>'weight_pct')::numeric, v->>'destination_url', v->>'thank_you_url', (ord = 1)
  from jsonb_array_elements(p_variants) with ordinality as t(v, ord);

  return v_test_id;
end;
$function$;

revoke all on function create_test_with_variants(uuid, text, text, text, text, text, text, jsonb, uuid) from public;
grant execute on function create_test_with_variants(uuid, text, text, text, text, text, text, jsonb, uuid) to authenticated;

-- Same result as 0077; the only change is where a sale may come from: for a test with a project,
-- only clicks of tests of that project. Same signature, so create or replace.
create or replace function public.get_test_report(p_test_id uuid, p_since timestamptz default null, p_until timestamptz default null)
returns table(
  variant_id uuid,
  variant_name text,
  weight_pct numeric,
  visits bigint,
  conversions bigint,
  clicks bigint,
  sales bigint,
  revenue_cents bigint
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_client_id uuid;
  v_funnel_id uuid;
  v_source text;
begin
  select t.client_id, t.sales_funnel_id, t.conversion_method into v_client_id, v_funnel_id, v_source
  from tests t join clients c on c.id = t.client_id
  where t.id = p_test_id and private.has_client_role(c.id, 'cliente');
  if v_client_id is null then
    raise exception 'not found or access denied';
  end if;

  return query
  with entries as (
    select distinct on (ce.visitor_id) ce.visitor_id, ce.variant_id, ce.created_at as entered_at
    from click_events ce
    where ce.test_id = p_test_id and ce.is_bot = false
      and (p_since is null or ce.created_at >= p_since)
      and (p_until is null or ce.created_at < p_until)
    order by ce.visitor_id, ce.created_at
  ),
  person_sales as (
    select distinct e.visitor_id, e.variant_id, cv.id as conversion_id, cv.value_cents
    from entries e
    join click_events c2 on c2.visitor_id = e.visitor_id
    join tests t2 on t2.id = c2.test_id and t2.client_id = v_client_id
      and (v_funnel_id is null or t2.sales_funnel_id = v_funnel_id)
    join conversions cv on cv.click_event_id = c2.id and cv.source = v_source and cv.created_at >= e.entered_at
  ),
  variant_clicks as (
    select ce.variant_id, count(*) as clicks
    from click_events ce
    where ce.test_id = p_test_id and ce.is_bot = false
      and (p_since is null or ce.created_at >= p_since)
      and (p_until is null or ce.created_at < p_until)
    group by ce.variant_id
  )
  select v.id, v.name, v.weight_pct,
         (select count(*) from entries e where e.variant_id = v.id)::bigint,
         (select count(distinct s.visitor_id) from person_sales s where s.variant_id = v.id)::bigint,
         coalesce((select vc.clicks from variant_clicks vc where vc.variant_id = v.id), 0)::bigint,
         (select count(*) from person_sales s where s.variant_id = v.id)::bigint,
         coalesce((select sum(s.value_cents) from person_sales s where s.variant_id = v.id), 0)::bigint
  from variants v
  where v.test_id = p_test_id
  order by v.name;
end;
$function$;
