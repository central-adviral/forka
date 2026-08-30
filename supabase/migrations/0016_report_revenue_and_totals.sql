-- Add revenue to the by-source report, matching what get_test_report_by_ad already does.
drop function if exists get_test_report_by_source(uuid);

create or replace function get_test_report_by_source(p_test_id uuid)
returns table (
  variant_id uuid,
  variant_name text,
  utm_source text,
  visits bigint,
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
    coalesce(nullif(ce.source_utms->>'utm_source', ''), '(direto)') as utm_source,
    count(distinct ce.id)::bigint,
    count(distinct cv.id)::bigint,
    coalesce(sum(cv.value_cents), 0)::bigint
  from variants v
  join tests t on t.id = v.test_id
  left join click_events ce on ce.variant_id = v.id
  left join conversions cv on cv.click_event_id = ce.id and cv.source = t.conversion_method
  where v.test_id = p_test_id
  group by v.id, v.name, coalesce(nullif(ce.source_utms->>'utm_source', ''), '(direto)')
  order by v.name, utm_source;
end;
$$;

-- New: one row per variant, totals only (cliques = raw click_events, visitas = distinct
-- visitor_id — a proxy for real people, since repeat/bot hits from the same visitor_id
-- only count once here).
create or replace function get_test_report_totals(p_test_id uuid)
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
    count(distinct ce.id)::bigint,
    count(distinct ce.visitor_id)::bigint,
    count(distinct cv.id)::bigint,
    coalesce(sum(cv.value_cents), 0)::bigint
  from variants v
  join tests t on t.id = v.test_id
  left join click_events ce on ce.variant_id = v.id
  left join conversions cv on cv.click_event_id = ce.id and cv.source = t.conversion_method
  where v.test_id = p_test_id
  group by v.id, v.name
  order by v.name;
end;
$$;
