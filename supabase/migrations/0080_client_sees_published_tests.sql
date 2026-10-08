-- The client reads only the A/B tests of published experiments (Testes 2.0, review of 2026-10-07).
--
-- A client member read every A/B test of the client, finished or half-built, with its numbers. Now a
-- client member reads a test only when a published card (running or decided) is measured by it,
-- the same rule the board already follows (0068). Analista and above keep reading every test.
-- Variants, clicks, conversions, assignments and the change log read through `tests`, so they follow
-- the new rule with no change of their own; the per-test report functions run as definer and check
-- the same rule through can_read_test. No data changes.

create function private.can_read_test(p_test_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.tests t
    where t.id = p_test_id
      and (
        private.has_client_role(t.client_id, 'analista')
        or (
          private.has_client_role(t.client_id, 'cliente')
          and exists (
            select 1 from public.backlog_items b
            where b.ab_test_id = t.id and b.published and b.status in ('running', 'decided')
          )
        )
      )
  )
$$;
revoke all on function private.can_read_test(uuid) from public;
grant execute on function private.can_read_test(uuid) to authenticated;

drop policy tests_read on tests;
create policy tests_read on tests for select to authenticated
  using (
    client_id in (select private.accessible_client_ids('analista'))
    or (
      client_id in (select private.accessible_client_ids('cliente'))
      and exists (
        select 1 from public.backlog_items b
        where b.ab_test_id = tests.id and b.published and b.status in ('running', 'decided')
      )
    )
  );

-- The per-test reports: same bodies, the client guard swapped for the published rule.

CREATE OR REPLACE FUNCTION public.get_test_report(p_test_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(variant_id uuid, variant_name text, weight_pct numeric, visits bigint, conversions bigint, clicks bigint, sales bigint, revenue_cents bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client_id uuid;
  v_funnel_id uuid;
  v_source text;
begin
  select t.client_id, t.sales_funnel_id, t.conversion_method into v_client_id, v_funnel_id, v_source
  from tests t join clients c on c.id = t.client_id
  where t.id = p_test_id and private.can_read_test(t.id);
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
$function$

;

CREATE OR REPLACE FUNCTION public.get_test_report_by_ad(p_test_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(variant_id uuid, variant_name text, ad_name text, clicks bigint, visitors bigint, conversions bigint, revenue_cents bigint, bot_clicks bigint, ad_spend numeric, ad_impressions bigint, ad_link_clicks bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client_id uuid;
  v_conversion_method text;
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and private.can_read_test(t.id)
  ) then
    raise exception 'not found or access denied';
  end if;

  select client_id, conversion_method into v_client_id, v_conversion_method from tests where id = p_test_id;

  return query
  with click_rows as (
    select
      v.id as v_id,
      v.name as v_name,
      ce.id as click_id,
      ce.visitor_id,
      ce.is_bot,
      ce.created_at,
      cv.id as conversion_id,
      cv.value_cents,
      nullif(ce.source_utms->>'fb_ad_id', '') as click_ad_id,
      nullif(ce.source_utms->>'utm_term', '') as click_ad_name,
      nullif(lower(btrim(normalize(coalesce(ce.source_utms->>'utm_term', ''), NFC))), '') as click_norm_name
    from variants v
    left join click_events ce on ce.variant_id = v.id
      and (p_since is null or ce.created_at >= p_since)
      and (p_until is null or ce.created_at < p_until)
    left join conversions cv on cv.click_event_id = ce.id and cv.source = v_conversion_method
    where v.test_id = p_test_id
  ),
  -- Name -> id, learned from every click this test ever received that carried both. Reads the
  -- full history, not the report window: a name a click identified in August still identifies
  -- the same ad in a September report. A name serving two ads is left out -- better unresolved
  -- than resolved wrongly.
  ad_alias as (
    select
      nullif(lower(btrim(normalize(coalesce(ce.source_utms->>'utm_term', ''), NFC))), '') as norm_name,
      min(nullif(ce.source_utms->>'fb_ad_id', '')) as ad_id
    from variants v
    join click_events ce on ce.variant_id = v.id
    where v.test_id = p_test_id
      and nullif(ce.source_utms->>'fb_ad_id', '') is not null
      and nullif(lower(btrim(normalize(coalesce(ce.source_utms->>'utm_term', ''), NFC))), '') is not null
    group by 1
    having count(distinct nullif(ce.source_utms->>'fb_ad_id', '')) = 1
  ),
  -- Second source for the same map, for a name no click ever carried an id for. Same rule.
  spend_alias as (
    select
      lower(btrim(normalize(acsd.ad_name, NFC))) as norm_name,
      min(acsd.ad_id) as ad_id
    from ad_creative_spend_daily acsd
    join sales_funnels sf on sf.id = acsd.sales_funnel_id
    where sf.client_id = v_client_id
      and nullif(acsd.ad_id, '') is not null
      and nullif(btrim(acsd.ad_name), '') is not null
    group by 1
    having count(distinct acsd.ad_id) = 1
  ),
  resolved as (
    select
      c.*,
      coalesce(
        'id:' || coalesce(c.click_ad_id, a.ad_id, sa.ad_id),
        'name:' || c.click_norm_name,
        '(sem anúncio)'
      ) as ad_key
    from click_rows c
    left join ad_alias a on a.norm_name = c.click_norm_name
    left join spend_alias sa on sa.norm_name = c.click_norm_name
  ),
  spend_by_key as (
    select
      case
        when nullif(acsd.ad_id, '') is not null then 'id:' || acsd.ad_id
        else 'name:' || lower(btrim(normalize(coalesce(acsd.ad_name, ''), NFC)))
      end as ad_key,
      max(acsd.ad_name) as spend_label,
      max(acsd.adset_name) as adset_name,
      max(acsd.campaign_name) as campaign_name,
      max(nullif(acsd.ad_id, '')) as ad_id,
      sum(acsd.spend) as spend,
      sum(acsd.impressions) as impressions,
      sum(acsd.link_clicks) as link_clicks
    from ad_creative_spend_daily acsd
    join sales_funnels sf on sf.id = acsd.sales_funnel_id
    where sf.client_id = v_client_id
      and (p_since is null or acsd.data >= p_since::date)
      and (p_until is null or acsd.data < p_until::date)
    group by 1
  ),
  -- Fallback label for an ad the spend sync has not reached yet. The spend table wins when it
  -- has the id, since it holds the name the ad carries in Meta right now -- and it holds one
  -- canonical spelling, where clicks carry whatever bytes the browser sent (NFC or NFD).
  click_label as (
    select ad_key, (array_agg(click_ad_name order by created_at desc nulls last))[1] as label
    from resolved
    where click_ad_name is not null
    group by ad_key
  ),
  base_labels as (
    select
      k.ad_key,
      coalesce(s.spend_label, cl.label, '(sem anúncio)') as base,
      s.adset_name,
      s.campaign_name,
      coalesce(s.ad_id, substring(k.ad_key from '^id:(.+)$')) as ad_id
    from (select distinct ad_key from resolved) k
    left join click_label cl on cl.ad_key = k.ad_key
    left join spend_by_key s on s.ad_key = k.ad_key
  ),
  labels as (
    select
      ad_key,
      case
        when count(*) over (partition by base) = 1 then base
        -- A bucket that never resolved to an id. It is not an ad, it is the leftover traffic of
        -- a name two ads answer to, and saying so beats dressing it up as a third ad.
        when ad_id is null then base || ' · anúncio não identificado'
        when count(*) over (partition by base, coalesce(adset_name, '')) = 1 and adset_name is not null
          then base || ' · ' || adset_name
        when count(*) over (partition by base, coalesce(adset_name, ''), coalesce(campaign_name, '')) = 1
          and campaign_name is not null then base || ' · ' || campaign_name
        else base || ' · id …' || right(ad_id, 6)
      end as label
    from base_labels
  )
  select
    r.v_id,
    r.v_name,
    l.label,
    count(distinct r.click_id) filter (where r.is_bot = false)::bigint,
    count(distinct r.visitor_id) filter (where r.is_bot = false)::bigint,
    count(distinct r.conversion_id) filter (where r.is_bot = false)::bigint,
    coalesce(sum(r.value_cents) filter (where r.is_bot = false), 0)::bigint,
    count(distinct r.click_id) filter (where r.is_bot = true)::bigint,
    max(s.spend),
    max(s.impressions)::bigint,
    max(s.link_clicks)::bigint
  from resolved r
  join labels l on l.ad_key = r.ad_key
  left join spend_by_key s on s.ad_key = r.ad_key
  group by r.v_id, r.v_name, r.ad_key, l.label
  order by r.v_name, l.label;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.get_test_report_by_hour(p_test_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(hour integer, clicks bigint, conversions bigint, revenue_cents bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_conversion_method text;
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and private.can_read_test(t.id)
  ) then
    raise exception 'not found or access denied';
  end if;

  select t.conversion_method into v_conversion_method from tests t where t.id = p_test_id;

  return query
  select
    d.hour,
    count(distinct ce.id)::bigint,
    count(distinct cv.id)::bigint,
    coalesce(sum(cv.value_cents), 0)::bigint
  from generate_series(0, 23) as d(hour)
  left join click_events ce
    on ce.test_id = p_test_id
    and ce.is_bot = false
    and extract(hour from ce.created_at at time zone 'America/Sao_Paulo')::int = d.hour
    and (p_since is null or ce.created_at >= p_since)
    and (p_until is null or ce.created_at < p_until)
  left join conversions cv on cv.click_event_id = ce.id and cv.source = v_conversion_method
  group by d.hour
  order by d.hour;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.get_test_report_by_source(p_test_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(variant_id uuid, variant_name text, utm_source text, clicks bigint, visitors bigint, conversions bigint, revenue_cents bigint, bot_clicks bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client_id uuid;
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and private.can_read_test(t.id)
  ) then
    raise exception 'not found or access denied';
  end if;

  select client_id into v_client_id from tests where id = p_test_id;

  return query
  select
    v.id,
    v.name,
    coalesce(nullif(ce.source_utms->>'utm_source', ''), '(direto)') as utm_source,
    count(distinct ce.id) filter (where ce.is_bot = false)::bigint,
    count(distinct ce.visitor_id) filter (where ce.is_bot = false)::bigint,
    count(distinct cv.id) filter (where ce.is_bot = false)::bigint,
    coalesce(sum(cv.value_cents) filter (where ce.is_bot = false), 0)::bigint,
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
$function$

;

CREATE OR REPLACE FUNCTION public.get_test_report_by_weekday(p_test_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(weekday integer, clicks bigint, conversions bigint, revenue_cents bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_conversion_method text;
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and private.can_read_test(t.id)
  ) then
    raise exception 'not found or access denied';
  end if;

  select t.conversion_method into v_conversion_method from tests t where t.id = p_test_id;

  return query
  select
    d.weekday,
    count(distinct ce.id)::bigint,
    count(distinct cv.id)::bigint,
    coalesce(sum(cv.value_cents), 0)::bigint
  from generate_series(0, 6) as d(weekday)
  left join click_events ce
    on ce.test_id = p_test_id
    and ce.is_bot = false
    and extract(dow from ce.created_at at time zone 'America/Sao_Paulo')::int = d.weekday
    and (p_since is null or ce.created_at >= p_since)
    and (p_until is null or ce.created_at < p_until)
  left join conversions cv on cv.click_event_id = ce.id and cv.source = v_conversion_method
  group by d.weekday
  order by d.weekday;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.get_test_report_totals(p_test_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(variant_id uuid, variant_name text, clicks bigint, visitors bigint, conversions bigint, revenue_cents bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and private.can_read_test(t.id)
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
  left join click_events ce on ce.variant_id = v.id and ce.is_bot = false
    and (p_since is null or ce.created_at >= p_since)
    and (p_until is null or ce.created_at < p_until)
  left join conversions cv on cv.click_event_id = ce.id and cv.source = t.conversion_method
  where v.test_id = p_test_id
  group by v.id, v.name
  order by v.name;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.get_test_bot_click_count(p_test_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result bigint;
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and private.can_read_test(t.id)
  ) then
    raise exception 'not found or access denied';
  end if;

  select count(*) into result
  from click_events ce
  where ce.test_id = p_test_id
    and ce.is_bot = true
    and (p_since is null or ce.created_at >= p_since);

  return result;
end;
$function$

;
