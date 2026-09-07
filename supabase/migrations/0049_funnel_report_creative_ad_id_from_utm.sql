-- Everything before this migration resolves a sale to an ad by inference: through the click it
-- came from, or by matching names against the spend table. Inference has a ceiling. Measured on
-- the taggable window, R$ 13.146 of R$ 51.645 in revenue still lands on a key that serves more
-- than one ad, because nothing the sale carries separates them.
--
-- The fix is at the source, not in the query: the ad's own id travels with the sale. Meta's URL
-- template gets utm_campaign={{ad.id}}, which is the one utm_* slot carrying no information today
-- -- it held a hand-typed product label ("1K_Latam", one value across 7.209 sales) that the sale
-- already states natively in `produto`, on 100% of rows. The other four slots keep their names,
-- which is what makes the report readable; this one carries the identity, which is what makes it
-- exact. One id is enough: given the ad, the spend table already knows its adset and campaign.
--
-- So utm_campaign becomes level zero of the cascade, ahead of every inference. The pattern reads a
-- trailing run of six or more digits, which accepts the bare id and also a label-prefixed one
-- ("1K_Latam-120249161688950044") during the changeover, while ignoring the labels already in the
-- data: "1K_Latam" ends in a letter, "WM-xx-26" ends in two digits. The id is trusted only when
-- the spend table knows it -- an unknown id falls through to the cascade rather than producing a
-- row nothing can join to.
--
-- This migration does nothing until the Meta template changes. It is inert on today's data and
-- starts paying off on the first sale that carries an id, with no cutover.

drop function if exists get_funnel_report_by_creative(uuid, date, date);

create or replace function get_funnel_report_by_creative(
  p_sales_funnel_id uuid,
  p_since date default null,
  p_until date default null
)
returns table (
  ad_name text,
  ad_id text,
  adset_name text,
  ad_count integer,
  spend numeric,
  impressions bigint,
  link_clicks bigint,
  sales_count bigint,
  revenue numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
begin
  select sf.client_id into v_client_id
  from sales_funnels sf join clients c on c.id = sf.client_id
  where sf.id = p_sales_funnel_id and c.owner_id = auth.uid();

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
      and (p_since is null or s.data_venda >= p_since)
      and (p_until is null or s.data_venda < p_until + 1)
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
$$;

revoke all on function get_funnel_report_by_creative(uuid, date, date) from public;
grant execute on function get_funnel_report_by_creative(uuid, date, date) to authenticated;
