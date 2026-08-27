alter table tests
  add column test_type text not null default 'page'
    check (test_type in ('page', 'checkout')),
  add column sales_page_url text;

alter table tests
  add constraint tests_checkout_requires_sales_page
    check (test_type <> 'checkout' or sales_page_url is not null);

-- test_type must never change after creation: mixing pre/post-switch click events
-- in one report produces silently wrong conversion numbers. The Data API exposes
-- UPDATE on tests to authenticated users, so omitting the field in the server
-- action is not enough.
create or replace function forbid_test_type_change() returns trigger
language plpgsql
as $$
begin
  if new.test_type is distinct from old.test_type then
    raise exception 'test_type is immutable';
  end if;
  return new;
end;
$$;

create trigger tests_test_type_immutable
  before update on tests
  for each row execute function forbid_test_type_change();

-- /c/[slug] looks up the most recent click event for (test, visitor) on every
-- buy-button click; the existing indexes only cover test_id and variant_id alone.
create index click_events_test_visitor_created_idx
  on click_events (test_id, visitor_id, created_at desc);

-- Parameter list changes, so "create or replace" would create a second overload
-- and leave the PostgREST call ambiguous. Drop the old signature first.
drop function if exists create_test_with_variants(uuid, text, text, text, text, jsonb);

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

  insert into variants (test_id, name, weight_pct, destination_url, thank_you_url)
  select v_test_id, v->>'name', (v->>'weight_pct')::numeric, v->>'destination_url', v->>'thank_you_url'
  from jsonb_array_elements(p_variants) v;

  return v_test_id;
end;
$$;

revoke all on function create_test_with_variants(uuid, text, text, text, text, text, text, jsonb) from public;
grant execute on function create_test_with_variants(uuid, text, text, text, text, text, text, jsonb) to authenticated;
