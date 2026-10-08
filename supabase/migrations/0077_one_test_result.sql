-- One count for the A/B report (Testes 2.0, review of 2026-10-07). Changes no data.
--
-- The report read two functions that counted differently: get_test_report counted people and
-- buyers, get_test_report_totals counted every conversion of the variant's clicks. The same variant
-- showed 120 sales in the summary and 145 in the table. Now get_test_report returns everything side
-- by side from the same entries:
--   visits         people: each counted once, in the first variant they entered (0067)
--   conversions    buyers: people with at least one conversion after entering (0069)
--   clicks         non-bot clicks of the variant in the period, for R$ per click
--   sales          every conversion of those buyers (an upsell is a second sale)
--   revenue_cents  the value of those sales
-- Buyers decide the test; sales and revenue show the money. Column names of the old result stay,
-- so code deployed before this migration keeps reading the same two numbers.

drop function if exists get_test_report(uuid, timestamptz, timestamptz);

create function public.get_test_report(p_test_id uuid, p_since timestamptz default null, p_until timestamptz default null)
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
  v_source text;
begin
  select t.client_id, t.conversion_method into v_client_id, v_source
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
  -- Same credit rule as the buyers since 0069: a conversion of the person on any test of the
  -- client after entering this one. The layer-per-funnel credit replaces it later.
  person_sales as (
    select distinct e.visitor_id, e.variant_id, cv.id as conversion_id, cv.value_cents
    from entries e
    join click_events c2 on c2.visitor_id = e.visitor_id
    join tests t2 on t2.id = c2.test_id and t2.client_id = v_client_id
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

revoke all on function get_test_report(uuid, timestamptz, timestamptz) from public;
grant execute on function get_test_report(uuid, timestamptz, timestamptz) to authenticated;
