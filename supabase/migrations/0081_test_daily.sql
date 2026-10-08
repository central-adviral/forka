-- The test day by day (Testes 2.0, review of 2026-10-08). Changes no data.
--
-- The experiment page shows the chance of winning day by day, so a gestor sees whether it is
-- settling or still swinging before deciding. This returns, per São Paulo day and variant, the
-- people who entered that day and the buyers whose first purchase fell on that day, with exactly
-- the entries and the credit rule of get_test_report (0077, 0078): summed up to any day, they give
-- that day's people and buyers.

create function public.get_test_daily(p_test_id uuid, p_since timestamptz default null)
returns table(day date, variant_id uuid, people bigint, buyers bigint)
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
    order by ce.visitor_id, ce.created_at
  ),
  first_purchase as (
    select e.visitor_id, e.variant_id, min(cv.created_at) as bought_at
    from entries e
    join click_events c2 on c2.visitor_id = e.visitor_id
    join tests t2 on t2.id = c2.test_id and t2.client_id = v_client_id
      and (v_funnel_id is null or t2.sales_funnel_id = v_funnel_id)
    join conversions cv on cv.click_event_id = c2.id and cv.source = v_source and cv.created_at >= e.entered_at
    group by e.visitor_id, e.variant_id
  ),
  per_day as (
    select (e.entered_at at time zone 'America/Sao_Paulo')::date as d, e.variant_id as v, count(*)::bigint as p, 0::bigint as b
    from entries e group by 1, 2
    union all
    select (f.bought_at at time zone 'America/Sao_Paulo')::date, f.variant_id, 0, count(*)::bigint
    from first_purchase f group by 1, 2
  )
  select per_day.d, per_day.v, sum(per_day.p)::bigint, sum(per_day.b)::bigint
  from per_day
  group by per_day.d, per_day.v
  order by per_day.d, per_day.v;
end;
$function$;

revoke all on function public.get_test_daily(uuid, timestamptz) from public;
grant execute on function public.get_test_daily(uuid, timestamptz) to authenticated;
