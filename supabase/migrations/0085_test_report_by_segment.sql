-- The test by audience segment, to read the routing rules (0084). Changes no data.
--
-- A rule "[dor] -> pain page" on B is read against the same audience in A: [dor] ads drawn into A,
-- on the generic page. Comparing it with all of A would mix the page with the ad. This returns, per
-- variant, the rule that routed the person and their first click's ad, source and device, with the
-- entries and the credit rule of get_test_report (0077, 0078); the app matches each rule's
-- condition over these rows, with the same code /r uses.

create function public.get_test_report_by_segment(p_test_id uuid, p_since timestamptz default null, p_until timestamptz default null)
returns table(variant_id uuid, route_id uuid, ad_name text, utm_source text, device text, people bigint, buyers bigint, revenue_cents bigint)
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
  from tests t
  where t.id = p_test_id and private.can_read_test(t.id);
  if v_client_id is null then
    raise exception 'not found or access denied';
  end if;

  return query
  with entries as (
    select distinct on (ce.visitor_id) ce.visitor_id, ce.variant_id, ce.route_id, ce.created_at as entered_at,
      coalesce(ce.source_utms->>'utm_term', '') as ad_name,
      coalesce(ce.source_utms->>'utm_source', '') as utm_source,
      -- Same test as deviceOf in src/lib/domain/routing.ts.
      case when ce.user_agent ~* '(Mobi|Android|iPhone|iPad|iPod|Opera Mini|IEMobile)' then 'celular' else 'computador' end as device
    from click_events ce
    where ce.test_id = p_test_id and ce.is_bot = false
      and (p_since is null or ce.created_at >= p_since)
      and (p_until is null or ce.created_at < p_until)
    order by ce.visitor_id, ce.created_at
  ),
  person_sales as (
    select distinct e.visitor_id, cv.id as conversion_id, cv.value_cents
    from entries e
    join click_events c2 on c2.visitor_id = e.visitor_id
    join tests t2 on t2.id = c2.test_id and t2.client_id = v_client_id
      and (v_funnel_id is null or t2.sales_funnel_id = v_funnel_id)
    join conversions cv on cv.click_event_id = c2.id and cv.source = v_source and cv.created_at >= e.entered_at
  ),
  per_person as (
    select e.variant_id, e.route_id, e.ad_name, e.utm_source, e.device, s.visitor_id is not null as buyer, coalesce(s.revenue, 0) as revenue
    from entries e
    left join (select ps.visitor_id, sum(ps.value_cents) as revenue from person_sales ps group by ps.visitor_id) s
      on s.visitor_id = e.visitor_id
  )
  select p.variant_id, p.route_id, p.ad_name, p.utm_source, p.device,
         count(*)::bigint, count(*) filter (where p.buyer)::bigint, sum(p.revenue)::bigint
  from per_person p
  group by p.variant_id, p.route_id, p.ad_name, p.utm_source, p.device;
end;
$function$;

revoke all on function public.get_test_report_by_segment(uuid, timestamptz, timestamptz) from public;
grant execute on function public.get_test_report_by_segment(uuid, timestamptz, timestamptz) to authenticated;
