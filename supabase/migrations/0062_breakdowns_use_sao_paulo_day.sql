-- Central de Tráfego: the creative, product and hour read-outs use the same day as everything else.
--
-- These three cut the sales at UTC midnight and added a day to the end of the period, while the
-- page passes an exclusive São Paulo end (the overview, payment and origin read-outs all honor it).
-- "Ontem" therefore showed yesterday plus today in "Por produto" (138 sales against 87 in the
-- overview). Bodies are unchanged from 0051 apart from the two bounds on the sales.

CREATE OR REPLACE FUNCTION public.get_funnel_report_by_creative(p_sales_funnel_id uuid, p_since date DEFAULT NULL::date, p_until date DEFAULT NULL::date)
 RETURNS TABLE(ad_name text, ad_id text, adset_name text, ad_count integer, spend numeric, impressions bigint, link_clicks bigint, sales_count bigint, revenue numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client_id uuid;
begin
  select sf.client_id into v_client_id
  from sales_funnels sf join clients c on c.id = sf.client_id
  where sf.id = p_sales_funnel_id and private.has_client_role(c.id, 'cliente');

  if v_client_id is null then
    raise exception 'not found or access denied';
  end if;

  return query
  -- NFC on both sides of every name comparison: "Marçal" arrives pre-composed from one source and
  -- decomposed from the other, and plain equality misses every accented name.
  with spend_ads as (
    select
      nullif(acsd.ad_id, '') as ad_id,
      lower(btrim(normalize(coalesce(acsd.ad_name, ''), NFC))) as norm_name,
      lower(btrim(normalize(coalesce(acsd.adset_name, ''), NFC))) as norm_adset,
      lower(btrim(normalize(coalesce(acsd.campaign_name, ''), NFC))) as norm_campaign,
      max(acsd.ad_name) as ad_label,
      max(acsd.adset_name) as adset_label,
      sum(acsd.spend) filter (
        where (p_since is null or acsd.data >= p_since) and (p_until is null or acsd.data < p_until)
      ) as spend,
      sum(acsd.impressions) filter (
        where (p_since is null or acsd.data >= p_since) and (p_until is null or acsd.data < p_until)
      ) as impressions,
      sum(acsd.link_clicks) filter (
        where (p_since is null or acsd.data >= p_since) and (p_until is null or acsd.data < p_until)
      ) as link_clicks
    from ad_creative_spend_daily acsd
    where acsd.sales_funnel_id = p_sales_funnel_id
    group by 1, 2, 3, 4
  ),
  -- One row per ad, so joining a sale to it cannot multiply that sale: an ad renamed mid-flight
  -- has several rows in spend_ads and would otherwise duplicate the revenue joined to it.
  spend_ad_ids as (
    select distinct sa.ad_id from spend_ads sa where sa.ad_id is not null
  ),
  -- Name -> id at three levels of specificity. Every level refuses to resolve a key that serves
  -- more than one ad: unresolved beats resolved wrongly.
  -- `alias_ad_id`, not `ad_id`: plpgsql keeps the RETURNS TABLE column names in scope inside the
  -- body, so an unqualified `ad_id` here would be ambiguous (42702).
  alias_name_adset_campaign as (
    select sa.norm_name, sa.norm_adset, sa.norm_campaign, min(sa.ad_id) as alias_ad_id
    from spend_ads sa
    where sa.ad_id is not null and sa.norm_name <> '' and sa.norm_campaign <> ''
    group by 1, 2, 3
    having count(distinct sa.ad_id) = 1
  ),
  alias_name_adset as (
    select sa.norm_name, sa.norm_adset, min(sa.ad_id) as alias_ad_id
    from spend_ads sa
    where sa.ad_id is not null and sa.norm_name <> ''
    group by 1, 2
    having count(distinct sa.ad_id) = 1
  ),
  alias_name as (
    select sa.norm_name, min(sa.ad_id) as alias_ad_id
    from spend_ads sa
    where sa.ad_id is not null and sa.norm_name <> ''
    group by 1
    having count(distinct sa.ad_id) = 1
  ),
  -- Every click this client ever received, keyed by the tracking id a sale can carry. Not
  -- date-filtered, for the reason 0044 records: which ad a sale came from is a fact about the
  -- sale, not about the window being looked at.
  tracked_clicks as (
    select
      ce.tracking_id::text as tracking_id,
      nullif(ce.source_utms->>'fb_ad_id', '') as click_ad_id,
      nullif(lower(btrim(normalize(coalesce(ce.source_utms->>'utm_term', ''), NFC))), '') as click_norm_name
    from click_events ce
    join variants v on v.id = ce.variant_id
    join tests t on t.id = v.test_id
    where t.client_id = v_client_id
  ),
  sale_rows as (
    select
      s.id as sale_id,
      coalesce(s.valor_liquido, 0) as revenue,
      nullif(lower(btrim(normalize(coalesce(s.utm_term, ''), NFC))), '') as norm_name,
      lower(btrim(normalize(coalesce(s.utm_content, ''), NFC))) as norm_adset,
      -- utm_medium, not utm_campaign: the former is the Meta campaign name, the latter is now the
      -- ad id (and, before the template change, a hand-typed label).
      lower(btrim(normalize(coalesce(s.utm_medium, ''), NFC))) as norm_campaign,
      -- Trailing run of >= 6 digits: the bare {{ad.id}}, or one behind a leftover label.
      substring(coalesce(s.utm_campaign, '') from '([0-9]{6,})[[:space:]]*$') as utm_ad_id,
      s.utm_term as name_label,
      s.utm_content as adset_label,
      tc.click_ad_id,
      tc.click_norm_name
    from sales s
    left join tracked_clicks tc on tc.tracking_id = s.utm_content
    where s.sales_funnel_id = p_sales_funnel_id
      and (p_since is null or s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo'))
      and (p_until is null or s.data_venda < (p_until::timestamp at time zone 'America/Sao_Paulo'))
  ),
  resolved_sales as (
    select
      sr.*,
      coalesce(
        sai.ad_id,
        sr.click_ad_id,
        an_click.alias_ad_id,
        anac.alias_ad_id,
        ana.alias_ad_id,
        an.alias_ad_id
      ) as resolved_ad_id,
      -- A sale resolved by id, or through its click, has no adset of its own to report: the adset
      -- is already known from the ad, and utm_content held a tracking id. Blanking it keeps that
      -- tracking id from being read as an adset named like a uuid.
      case
        when sai.ad_id is not null or sr.click_ad_id is not null or an_click.alias_ad_id is not null
          then null
        else sr.adset_label
      end as own_adset_label
    from sale_rows sr
    left join spend_ad_ids sai on sai.ad_id = sr.utm_ad_id
    left join alias_name an_click on an_click.norm_name = sr.click_norm_name
    left join alias_name_adset_campaign anac
      on anac.norm_name = sr.norm_name
     and anac.norm_adset = sr.norm_adset
     and anac.norm_campaign = sr.norm_campaign
    left join alias_name_adset ana on ana.norm_name = sr.norm_name and ana.norm_adset = sr.norm_adset
    left join alias_name an on an.norm_name = sr.norm_name
  ),
  sales_by_key as (
    select
      case
        when rs.resolved_ad_id is not null then 'id:' || rs.resolved_ad_id
        else 'name:' || coalesce(rs.norm_name, '') || '|' || rs.norm_adset
      end as ad_key,
      max(rs.name_label) as name_label,
      max(rs.own_adset_label) as adset_label,
      count(*) as sales_count,
      sum(rs.revenue) as revenue
    from resolved_sales rs
    where rs.norm_name is not null or rs.resolved_ad_id is not null
    group by 1
  ),
  spend_by_key as (
    select
      case
        when sa.ad_id is not null then 'id:' || sa.ad_id
        else 'name:' || sa.norm_name || '|' || sa.norm_adset
      end as ad_key,
      max(sa.ad_label) as ad_label,
      max(sa.adset_label) as adset_label,
      count(distinct sa.ad_id)::integer as n_ads,
      case when count(distinct sa.ad_id) = 1 then max(sa.ad_id) end as resolved_ad_id,
      coalesce(sum(sa.spend), 0) as spend,
      coalesce(sum(sa.impressions), 0) as impressions,
      coalesce(sum(sa.link_clicks), 0) as link_clicks
    from spend_ads sa
    group by 1
  )
  -- Full join: an ad that spent without selling still shows (that is the one worth pausing), and a
  -- sale whose ad has no spend synced still shows its revenue.
  select
    coalesce(sp.ad_label, sl.name_label, '(sem anúncio)'),
    sp.resolved_ad_id,
    nullif(coalesce(sp.adset_label, sl.adset_label, ''), ''),
    coalesce(sp.n_ads, 0),
    coalesce(sp.spend, 0),
    coalesce(sp.impressions, 0)::bigint,
    coalesce(sp.link_clicks, 0)::bigint,
    coalesce(sl.sales_count, 0)::bigint,
    coalesce(sl.revenue, 0)
  from spend_by_key sp
  full outer join sales_by_key sl on sl.ad_key = sp.ad_key
  order by coalesce(sl.revenue, 0) desc, coalesce(sp.spend, 0) desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_funnel_sales_by_hour(p_sales_funnel_id uuid, p_since date DEFAULT NULL::date, p_until date DEFAULT NULL::date)
 RETURNS TABLE(hour integer, sales_count bigint, revenue numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1 from sales_funnels sf join clients c on c.id = sf.client_id
    where sf.id = p_sales_funnel_id and private.has_client_role(c.id, 'cliente')
  ) then
    raise exception 'not found or access denied';
  end if;

  -- Every hour of the day is returned, empty ones included, so the chart keeps a stable
  -- 24-column shape instead of collapsing the quiet hours out of the axis.
  return query
  select
    h.hour::int,
    count(s.id)::bigint,
    coalesce(sum(s.valor_liquido), 0)
  from generate_series(0, 23) as h(hour)
  left join sales s
    on extract(hour from (s.data_venda at time zone 'America/Sao_Paulo')) = h.hour
   and s.sales_funnel_id = p_sales_funnel_id
   and (p_since is null or s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo'))
   and (p_until is null or s.data_venda < (p_until::timestamp at time zone 'America/Sao_Paulo'))
  group by h.hour
  order by h.hour;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_funnel_sales_by_product(p_sales_funnel_id uuid, p_since date DEFAULT NULL::date, p_until date DEFAULT NULL::date)
 RETURNS TABLE(produto text, sales_count bigint, revenue numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1 from sales_funnels sf join clients c on c.id = sf.client_id
    where sf.id = p_sales_funnel_id and private.has_client_role(c.id, 'cliente')
  ) then
    raise exception 'not found or access denied';
  end if;

  return query
  select
    coalesce(nullif(btrim(s.produto), ''), '(sem produto)') as produto,
    count(*)::bigint as sales_count,
    sum(coalesce(s.valor_liquido, 0)) as revenue
  from sales s
  where s.sales_funnel_id = p_sales_funnel_id
    and (p_since is null or s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo'))
    and (p_until is null or s.data_venda < (p_until::timestamp at time zone 'America/Sao_Paulo'))
  group by 1
  order by 3 desc;
end;
$function$;
