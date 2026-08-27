-- 0012 recreated create_test_with_variants to add test_type/sales_page_url but
-- dropped the is_control assignment that 0006 added (lost the "with ordinality"
-- insert). Every test created since 0012 has zero control variants. Restore it,
-- and backfill any test created in that window.

create or replace function create_test_with_variants(
  p_client_id uuid,
  p_name text,
  p_slug text,
  p_fallback_url text,
  p_conversion_method text,
  p_test_type text,
  p_sales_page_url text,
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

  insert into tests (client_id, name, slug, fallback_url, conversion_method, test_type, sales_page_url)
  values (p_client_id, p_name, p_slug, p_fallback_url, p_conversion_method, p_test_type,
          nullif(p_sales_page_url, ''))
  returning id into v_test_id;

  insert into variants (test_id, name, weight_pct, destination_url, thank_you_url, is_control)
  select v_test_id, v->>'name', (v->>'weight_pct')::numeric, v->>'destination_url', v->>'thank_you_url', (ord = 1)
  from jsonb_array_elements(p_variants) with ordinality as t(v, ord);

  return v_test_id;
end;
$$;

-- Backfill: any test created before this fix (via the broken 0012 function) that
-- currently has zero control variants gets one, using the same "first row by
-- physical insertion order" heuristic 0006 used originally.
with broken_tests as (
  select test_id
  from variants
  group by test_id
  having count(*) filter (where is_control) = 0 and count(*) > 0
),
first_variant as (
  select distinct on (v.test_id) v.id, v.test_id
  from variants v
  join broken_tests bt on bt.test_id = v.test_id
  order by v.test_id, v.ctid
)
update variants v
set is_control = true
from first_variant fv
where v.id = fv.id;
