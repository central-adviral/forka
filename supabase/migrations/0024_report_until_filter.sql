-- Adds an optional p_until upper bound to every report RPC, needed for the new
-- "Ontem" period (which is not open-ended like the others -- it needs both a
-- start AND an end). p_until is null by default, matching today's behavior.

drop function if exists get_test_report(uuid, timestamptz);

create or replace function get_test_report(p_test_id uuid, p_since timestamptz default null, p_until timestamptz default null)
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
  join tests t on t.id = v.test_id
  left join click_events ce on ce.variant_id = v.id and ce.is_bot = false
    and (p_since is null or ce.created_at >= p_since)
    and (p_until is null or ce.created_at < p_until)
  left join conversions cv on cv.click_event_id = ce.id and cv.source = t.conversion_method
  where v.test_id = p_test_id
  group by v.id, v.name, v.weight_pct
  order by v.name;
end;
$$;

drop function if exists get_test_report_by_source(uuid, timestamptz);

create or replace function get_test_report_by_source(p_test_id uuid, p_since timestamptz default null, p_until timestamptz default null)
returns table (
  variant_id uuid,
  variant_name text,
  utm_source text,
  clicks bigint,
  visitors bigint,
  conversions bigint,
  revenue_cents bigint,
  bot_clicks bigint
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
  select
    v.id,
    v.name,
    coalesce(nullif(ce.source_utms->>'utm_source', ''), '(direto)') as utm_source,
    count(distinct ce.id) filter (where ce.is_bot = false)::bigint,
    count(distinct ce.visitor_id) filter (where ce.is_bot = false)::bigint,
    count(distinct cv.id)::bigint,
    coalesce(sum(cv.value_cents), 0)::bigint,
    count(distinct ce.id) filter (where ce.is_bot = true)::bigint
  from variants v
  join tests t on t.id = v.test_id
  left join click_events ce on ce.variant_id = v.id
    and (p_since is null or ce.created_at >= p_since)
    and (p_until is null or ce.created_at < p_until)
  left join conversions cv on cv.click_event_id = ce.id and cv.source = t.conversion_method
  where v.test_id = p_test_id
  group by v.id, v.name, coalesce(nullif(ce.source_utms->>'utm_source', ''), '(direto)')
  order by v.name, utm_source;
end;
$$;

drop function if exists get_test_report_by_ad(uuid, timestamptz);

create or replace function get_test_report_by_ad(p_test_id uuid, p_since timestamptz default null, p_until timestamptz default null)
returns table (
  variant_id uuid,
  variant_name text,
  ad_name text,
  clicks bigint,
  visitors bigint,
  conversions bigint,
  revenue_cents bigint,
  bot_clicks bigint
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
  select
    v.id,
    v.name,
    coalesce(nullif(ce.source_utms->>'utm_term', ''), '(sem anúncio)') as ad_name,
    count(distinct ce.id) filter (where ce.is_bot = false)::bigint,
    count(distinct ce.visitor_id) filter (where ce.is_bot = false)::bigint,
    count(distinct cv.id)::bigint,
    coalesce(sum(cv.value_cents), 0)::bigint,
    count(distinct ce.id) filter (where ce.is_bot = true)::bigint
  from variants v
  join tests t on t.id = v.test_id
  left join click_events ce on ce.variant_id = v.id
    and (p_since is null or ce.created_at >= p_since)
    and (p_until is null or ce.created_at < p_until)
  left join conversions cv on cv.click_event_id = ce.id and cv.source = t.conversion_method
  where v.test_id = p_test_id
  group by v.id, v.name, coalesce(nullif(ce.source_utms->>'utm_term', ''), '(sem anúncio)')
  order by v.name, ad_name;
end;
$$;

drop function if exists get_test_report_totals(uuid, timestamptz);

create or replace function get_test_report_totals(p_test_id uuid, p_since timestamptz default null, p_until timestamptz default null)
returns table (
  variant_id uuid,
  variant_name text,
  clicks bigint,
  visitors bigint,
  conversions bigint,
  revenue_cents bigint
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
  select
    v.id,
    v.name,
    count(distinct ce.id) filter (where ce.is_bot = false)::bigint,
    count(distinct ce.visitor_id) filter (where ce.is_bot = false)::bigint,
    count(distinct cv.id)::bigint,
    coalesce(sum(cv.value_cents), 0)::bigint
  from variants v
  join tests t on t.id = v.test_id
  left join click_events ce on ce.variant_id = v.id
    and (p_since is null or ce.created_at >= p_since)
    and (p_until is null or ce.created_at < p_until)
  left join conversions cv on cv.click_event_id = ce.id and cv.source = t.conversion_method
  where v.test_id = p_test_id
  group by v.id, v.name
  order by v.name;
end;
$$;

revoke all on function get_test_report(uuid, timestamptz, timestamptz) from public;
grant execute on function get_test_report(uuid, timestamptz, timestamptz) to authenticated;
revoke all on function get_test_report_by_source(uuid, timestamptz, timestamptz) from public;
grant execute on function get_test_report_by_source(uuid, timestamptz, timestamptz) to authenticated;
revoke all on function get_test_report_by_ad(uuid, timestamptz, timestamptz) from public;
grant execute on function get_test_report_by_ad(uuid, timestamptz, timestamptz) to authenticated;
revoke all on function get_test_report_totals(uuid, timestamptz, timestamptz) from public;
grant execute on function get_test_report_totals(uuid, timestamptz, timestamptz) to authenticated;
