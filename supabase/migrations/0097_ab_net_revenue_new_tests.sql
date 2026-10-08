-- New A/B tests read money like the rest of the Central: net revenue, entry sales only, ad spend
-- with the client's tax. Tests that already exist keep the old rule (gross invoice amount, every
-- invoice that carries the click id, spend without tax) and return exactly what they returned.
--
-- The rule is a per-test flag. Existing rows get false; the default then flips to true, so every
-- test created from now on uses the new rule. It only applies to hubla_webhook tests: a
-- thank_you_page conversion has no invoice to look up.

alter table public.tests add column receita_liquida boolean not null default false;
alter table public.tests alter column receita_liquida set default true;

-- The lookup below joins every counted conversion to its LaunchOps sale by invoice id.
create index sales_transaction_id_idx on public.sales (transaction_id_plataforma)
  where transaction_id_plataforma is not null;

-- One row for any conversion: does it count, and for how much. With p_net false it is always
-- (true, gross), so a flag-false test reads what it read before. With p_net true, a conversion
-- whose synced sale is not an entry (an upsell, a bump) does not count, and an entry counts its net
-- amount. A conversion LaunchOps has not synced yet counts as an entry, at the gross amount.
create function private.ab_conversion_value(p_net boolean, p_invoice text, p_gross_cents integer)
returns table (counts boolean, cents integer)
language sql stable set search_path = ''
as $$
  select
    coalesce(bool_or(s.papel = 'entrada'), true),
    coalesce(round(sum(s.valor_liquido) filter (where s.papel = 'entrada') * 100)::integer, p_gross_cents)
  from public.sales s
  where p_net and s.transaction_id_plataforma = p_invoice
$$;

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
  v_net boolean;
begin
  select t.client_id, t.sales_funnel_id, t.conversion_method, t.receita_liquida and t.conversion_method = 'hubla_webhook'
    into v_client_id, v_funnel_id, v_source, v_net
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
    select distinct e.visitor_id, e.variant_id, cv.id as conversion_id, nv.cents as value_cents
    from entries e
    join click_events c2 on c2.visitor_id = e.visitor_id
    join tests t2 on t2.id = c2.test_id and t2.client_id = v_client_id
      and (v_funnel_id is null or t2.sales_funnel_id = v_funnel_id)
    join conversions cv on cv.click_event_id = c2.id and cv.source = v_source and cv.created_at >= e.entered_at
    cross join lateral private.ab_conversion_value(v_net, cv.external_event_id, cv.value_cents) nv
    where nv.counts
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

CREATE OR REPLACE FUNCTION public.get_test_daily(p_test_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(day date, variant_id uuid, people bigint, buyers bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client_id uuid;
  v_funnel_id uuid;
  v_source text;
  v_net boolean;
begin
  select t.client_id, t.sales_funnel_id, t.conversion_method, t.receita_liquida and t.conversion_method = 'hubla_webhook'
    into v_client_id, v_funnel_id, v_source, v_net
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
    order by ce.visitor_id, ce.created_at
  ),
  first_purchase as (
    select e.visitor_id, e.variant_id, min(cv.created_at) as bought_at
    from entries e
    join click_events c2 on c2.visitor_id = e.visitor_id
    join tests t2 on t2.id = c2.test_id and t2.client_id = v_client_id
      and (v_funnel_id is null or t2.sales_funnel_id = v_funnel_id)
    join conversions cv on cv.click_event_id = c2.id and cv.source = v_source and cv.created_at >= e.entered_at
    cross join lateral private.ab_conversion_value(v_net, cv.external_event_id, cv.value_cents) nv
    where nv.counts
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

CREATE OR REPLACE FUNCTION public.get_test_report_by_segment(p_test_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(variant_id uuid, route_id uuid, ad_name text, utm_source text, device text, people bigint, buyers bigint, revenue_cents bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client_id uuid;
  v_funnel_id uuid;
  v_source text;
  v_net boolean;
begin
  select t.client_id, t.sales_funnel_id, t.conversion_method, t.receita_liquida and t.conversion_method = 'hubla_webhook'
    into v_client_id, v_funnel_id, v_source, v_net
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
    select distinct e.visitor_id, cv.id as conversion_id, nv.cents as value_cents
    from entries e
    join click_events c2 on c2.visitor_id = e.visitor_id
    join tests t2 on t2.id = c2.test_id and t2.client_id = v_client_id
      and (v_funnel_id is null or t2.sales_funnel_id = v_funnel_id)
    join conversions cv on cv.click_event_id = c2.id and cv.source = v_source and cv.created_at >= e.entered_at
    cross join lateral private.ab_conversion_value(v_net, cv.external_event_id, cv.value_cents) nv
    where nv.counts
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

CREATE OR REPLACE FUNCTION public.get_test_report_by_source(p_test_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(variant_id uuid, variant_name text, utm_source text, clicks bigint, visitors bigint, conversions bigint, revenue_cents bigint, bot_clicks bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client_id uuid;
  v_source text;
  v_net boolean;
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and private.can_read_test(t.id)
  ) then
    raise exception 'not found or access denied';
  end if;

  select t.client_id, t.conversion_method, t.receita_liquida and t.conversion_method = 'hubla_webhook'
    into v_client_id, v_source, v_net
  from tests t where t.id = p_test_id;

  return query
  select
    v.id,
    v.name,
    coalesce(nullif(ce.source_utms->>'utm_source', ''), '(direto)') as utm_source,
    count(distinct ce.id) filter (where ce.is_bot = false)::bigint,
    count(distinct ce.visitor_id) filter (where ce.is_bot = false)::bigint,
    count(distinct cv.id) filter (where ce.is_bot = false)::bigint,
    coalesce(sum(nv.cents) filter (where ce.is_bot = false), 0)::bigint,
    count(distinct ce.id) filter (where ce.is_bot = true)::bigint
  from variants v
  left join click_events ce on ce.variant_id = v.id
    and (p_since is null or ce.created_at >= p_since)
    and (p_until is null or ce.created_at < p_until)
  left join (conversions cv cross join lateral private.ab_conversion_value(v_net, cv.external_event_id, cv.value_cents) nv)
    on cv.click_event_id = ce.id and cv.source = v_source and nv.counts
  where v.test_id = p_test_id
  group by v.id, v.name, coalesce(nullif(ce.source_utms->>'utm_source', ''), '(direto)')
  order by v.name, utm_source;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_test_report_by_ad(p_test_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(variant_id uuid, variant_name text, ad_name text, clicks bigint, visitors bigint, conversions bigint, revenue_cents bigint, bot_clicks bigint, ad_spend numeric, ad_impressions bigint, ad_link_clicks bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client_id uuid;
  v_conversion_method text;
  v_net boolean;
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and private.can_read_test(t.id)
  ) then
    raise exception 'not found or access denied';
  end if;

  select t.client_id, t.conversion_method, t.receita_liquida and t.conversion_method = 'hubla_webhook'
    into v_client_id, v_conversion_method, v_net
  from tests t where t.id = p_test_id;

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
      nv.cents as value_cents,
      nullif(ce.source_utms->>'fb_ad_id', '') as click_ad_id,
      nullif(ce.source_utms->>'utm_term', '') as click_ad_name,
      nullif(lower(btrim(normalize(coalesce(ce.source_utms->>'utm_term', ''), NFC))), '') as click_norm_name
    from variants v
    left join click_events ce on ce.variant_id = v.id
      and (p_since is null or ce.created_at >= p_since)
      and (p_until is null or ce.created_at < p_until)
    left join (conversions cv cross join lateral private.ab_conversion_value(v_net, cv.external_event_id, cv.value_cents) nv)
      on cv.click_event_id = ce.id and cv.source = v_conversion_method and nv.counts
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
      -- The day's tax, as get_funnel_report_by_creative applies it.
      sum(case when v_net then acsd.spend * coalesce(
        (select tr.factor from client_tax_rates tr
         where tr.client_id = v_client_id and tr.valid_from <= acsd.data
         order by tr.valid_from desc limit 1),
        1) else acsd.spend end) as spend,
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
$function$;

CREATE OR REPLACE FUNCTION public.get_test_report_by_weekday(p_test_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(weekday integer, clicks bigint, conversions bigint, revenue_cents bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_conversion_method text;
  v_net boolean;
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and private.can_read_test(t.id)
  ) then
    raise exception 'not found or access denied';
  end if;

  select t.conversion_method, t.receita_liquida and t.conversion_method = 'hubla_webhook'
    into v_conversion_method, v_net
  from tests t where t.id = p_test_id;

  return query
  select
    d.weekday,
    count(distinct ce.id)::bigint,
    count(distinct cv.id)::bigint,
    coalesce(sum(nv.cents), 0)::bigint
  from generate_series(0, 6) as d(weekday)
  left join click_events ce
    on ce.test_id = p_test_id
    and ce.is_bot = false
    and extract(dow from ce.created_at at time zone 'America/Sao_Paulo')::int = d.weekday
    and (p_since is null or ce.created_at >= p_since)
    and (p_until is null or ce.created_at < p_until)
  left join (conversions cv cross join lateral private.ab_conversion_value(v_net, cv.external_event_id, cv.value_cents) nv)
    on cv.click_event_id = ce.id and cv.source = v_conversion_method and nv.counts
  group by d.weekday
  order by d.weekday;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_test_report_by_hour(p_test_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(hour integer, clicks bigint, conversions bigint, revenue_cents bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_conversion_method text;
  v_net boolean;
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and private.can_read_test(t.id)
  ) then
    raise exception 'not found or access denied';
  end if;

  select t.conversion_method, t.receita_liquida and t.conversion_method = 'hubla_webhook'
    into v_conversion_method, v_net
  from tests t where t.id = p_test_id;

  return query
  select
    d.hour,
    count(distinct ce.id)::bigint,
    count(distinct cv.id)::bigint,
    coalesce(sum(nv.cents), 0)::bigint
  from generate_series(0, 23) as d(hour)
  left join click_events ce
    on ce.test_id = p_test_id
    and ce.is_bot = false
    and extract(hour from ce.created_at at time zone 'America/Sao_Paulo')::int = d.hour
    and (p_since is null or ce.created_at >= p_since)
    and (p_until is null or ce.created_at < p_until)
  left join (conversions cv cross join lateral private.ab_conversion_value(v_net, cv.external_event_id, cv.value_cents) nv)
    on cv.click_event_id = ce.id and cv.source = v_conversion_method and nv.counts
  group by d.hour
  order by d.hour;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_test_data_health(p_test_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(traceable_sales bigint, counted_sales bigint, recovered bigint, refunds bigint, median_delay_seconds numeric, clicks bigint, bot_clicks bigint, rate_limited_clicks bigint, buyers bigint, buyers_in_other_tests bigint, client_untracked_payments bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_client_id uuid;
  v_funnel_id uuid;
  v_net boolean;
begin
  select t.client_id, t.sales_funnel_id, t.receita_liquida and t.conversion_method = 'hubla_webhook'
    into v_client_id, v_funnel_id, v_net
  from public.tests t
  where t.id = p_test_id and private.can_read_test(t.id);
  if v_client_id is null then
    raise exception 'not found or access denied';
  end if;

  return query
  with test_clicks as (
    select ce.id, ce.tracking_id, ce.visitor_id, ce.is_bot, ce.rate_limited
    from public.click_events ce
    where ce.test_id = p_test_id and (p_since is null or ce.created_at >= p_since)
  ),
  -- Sales LaunchOps synced that carry the id of one of this test's clicks: the ones the test must see.
  traceable as (
    select s.transaction_id_plataforma as invoice, s.data_venda
    from public.sales s
    join test_clicks tc on tc.tracking_id = s.utm_content and not tc.is_bot
    where s.client_id = v_client_id and s.transaction_id_plataforma is not null
      and (not v_net or s.papel = 'entrada')
  ),
  test_conversions as (
    select cv.id, cv.created_at, cv.recovered_via, cv.external_event_id, tc.visitor_id
    from public.conversions cv
    join test_clicks tc on tc.id = cv.click_event_id
    cross join lateral private.ab_conversion_value(v_net, cv.external_event_id, cv.value_cents) nv
    where cv.source = 'hubla_webhook' and nv.counts
  ),
  test_buyers as (
    select distinct tcv.visitor_id from test_conversions tcv
  )
  select
    (select count(*) from traceable),
    (select count(*) from traceable tr where exists (select 1 from public.conversions cv where cv.external_event_id = tr.invoice)),
    (select count(*) from test_conversions tcv where tcv.recovered_via is not null),
    (select count(*) from public.conversion_refunds r join test_clicks tc on tc.id = r.click_event_id),
    (select (percentile_cont(0.5) within group (order by extract(epoch from c.created_at - tr.data_venda)))::numeric
       from test_conversions c join traceable tr on tr.invoice = c.external_event_id where c.recovered_via is null),
    (select count(*) from test_clicks),
    (select count(*) from test_clicks tc where tc.is_bot),
    (select count(*) from test_clicks tc where tc.rate_limited and not tc.is_bot),
    (select count(*) from test_buyers),
    (select count(*) from test_buyers b where exists (
       select 1 from public.click_events o join public.tests ot on ot.id = o.test_id
       where o.visitor_id = b.visitor_id and ot.id <> p_test_id and ot.client_id = v_client_id
         and (v_funnel_id is null or ot.sales_funnel_id = v_funnel_id))),
    (select count(*) from public.hubla_events h
      where h.client_id = v_client_id and h.kind = 'payment' and h.outcome = 'no_tracking'
        and (p_since is null or h.received_at >= p_since));
end;
$function$;
