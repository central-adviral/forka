alter table variants add column is_control boolean not null default false;

with first_variant as (
  select distinct on (test_id) id
  from variants
  order by test_id, ctid
)
update variants v
set is_control = true
from first_variant fv
where v.id = fv.id;

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

  insert into variants (test_id, name, weight_pct, destination_url, thank_you_url, is_control)
  select v_test_id, v->>'name', (v->>'weight_pct')::numeric, v->>'destination_url', v->>'thank_you_url', (ord = 1)
  from jsonb_array_elements(p_variants) with ordinality as t(v, ord);

  return v_test_id;
end;
$$;
