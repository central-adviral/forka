-- Motor de Experimentos, step 1: measure what already runs by person, not by click.
--
-- get_test_report counted every click as a visit and every conversion row as a conversion. One
-- person clicking three times was three visits, and since 0050 one click can carry several
-- conversions (one-click upsell, renewal), so a variant could show more conversions than visits.
-- Now, per variant:
--   visits      = distinct human visitors who entered the variant in the window;
--   conversions = how many of them bought afterwards. The sale counts for every test the person
--                 was in, whichever test's click it landed on, as long as it came after they
--                 entered this one.
-- Same columns as before, so every caller (chance to beat, SRM, insight, the test list) moves to
-- people at once.
--
-- Weight 0 is allowed, so a variant can stay in a test (its history and people kept) without
-- receiving new traffic.

alter table variants drop constraint variants_weight_pct_check;
alter table variants add constraint variants_weight_pct_check check (weight_pct >= 0 and weight_pct <= 100);

create index if not exists click_events_visitor_idx on click_events (visitor_id);

create or replace function public.get_test_report(p_test_id uuid, p_since timestamp with time zone default null, p_until timestamp with time zone default null)
returns table(variant_id uuid, variant_name text, weight_pct numeric, visits bigint, conversions bigint)
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
    select ce.visitor_id, ce.variant_id, min(ce.created_at) as entered_at
    from click_events ce
    where ce.test_id = p_test_id and ce.is_bot = false
      and (p_since is null or ce.created_at >= p_since)
      and (p_until is null or ce.created_at < p_until)
    group by ce.visitor_id, ce.variant_id
  ),
  converted as (
    select e.visitor_id, e.variant_id
    from entries e
    where exists (
      select 1
      from click_events c2
      join tests t2 on t2.id = c2.test_id and t2.client_id = v_client_id
      join conversions cv on cv.click_event_id = c2.id and cv.source = v_source
      where c2.visitor_id = e.visitor_id and cv.created_at >= e.entered_at
    )
  )
  select v.id, v.name, v.weight_pct,
         (select count(*) from entries e where e.variant_id = v.id)::bigint,
         (select count(*) from converted x where x.variant_id = v.id)::bigint
  from variants v
  where v.test_id = p_test_id
  order by v.name;
end;
$function$;
