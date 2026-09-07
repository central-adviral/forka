-- 0040 keyed this report on the ad name alone. Names repeat: 43 name-keys cover 64 ads and
-- R$ 72.546 of spend lands on a key that serves more than one ad, so distinct ads were summed
-- into one line and the operator could not tell which of them earned the revenue.
--
-- Sales carry the adset too -- utm_content holds the adset name -- so the key becomes
-- (name, adset). That leaves 55 of 77 keys pointing at exactly one ad, and cuts the spend
-- sitting on an ambiguous key to R$ 39.883.
--
-- What it does NOT do: split revenue between two ads that share a name AND an adset (an
-- ABO-vs-CBO pair, for instance). The sale's utm_campaign is a fixed label, not the Meta
-- campaign, so nothing on the sale separates them. Those rows report ad_count > 1 and ad_id
-- null, and the screen says so rather than crediting one of the two at random.

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
begin
  if not exists (
    select 1 from sales_funnels sf join clients c on c.id = sf.client_id
    where sf.id = p_sales_funnel_id and c.owner_id = auth.uid()
  ) then
    raise exception 'not found or access denied';
  end if;

  return query
  -- NFC on both sides: "Marçal" arrives pre-composed from one source and decomposed from the
  -- other, and plain equality misses every accented name.
  with spend_by_ad as (
    select
      nullif(lower(btrim(normalize(coalesce(acsd.ad_name, ''), NFC))), '') as norm_name,
      lower(btrim(normalize(coalesce(acsd.adset_name, ''), NFC))) as norm_adset,
      max(acsd.ad_name) as ad_label,
      max(acsd.adset_name) as adset_label,
      count(distinct acsd.ad_id)::integer as n_ads,
      case when count(distinct acsd.ad_id) = 1 then max(acsd.ad_id) end as resolved_ad_id,
      sum(acsd.spend) as spend,
      sum(acsd.impressions) as impressions,
      sum(acsd.link_clicks) as link_clicks
    from ad_creative_spend_daily acsd
    where acsd.sales_funnel_id = p_sales_funnel_id
      and (p_since is null or acsd.data >= p_since)
      and (p_until is null or acsd.data < p_until)
    group by 1, 2
  ),
  sales_by_ad as (
    select
      nullif(lower(btrim(normalize(coalesce(s.utm_term, ''), NFC))), '') as norm_name,
      lower(btrim(normalize(coalesce(s.utm_content, ''), NFC))) as norm_adset,
      max(s.utm_term) as ad_label,
      max(s.utm_content) as adset_label,
      count(*) as n_sales,
      sum(coalesce(s.valor_liquido, 0)) as revenue
    from sales s
    where s.sales_funnel_id = p_sales_funnel_id
      and (p_since is null or s.data_venda >= p_since)
      and (p_until is null or s.data_venda < p_until + 1)
    group by 1, 2
  )
  -- Full join: an ad that spent without selling still shows (that is the one worth pausing),
  -- and a sale whose ad has no spend synced still shows its revenue.
  select
    coalesce(sp.ad_label, sa.ad_label, '(sem anúncio)'),
    sp.resolved_ad_id,
    nullif(coalesce(sp.adset_label, sa.adset_label, ''), ''),
    coalesce(sp.n_ads, 0),
    coalesce(sp.spend, 0),
    coalesce(sp.impressions, 0)::bigint,
    coalesce(sp.link_clicks, 0)::bigint,
    coalesce(sa.n_sales, 0)::bigint,
    coalesce(sa.revenue, 0)
  from spend_by_ad sp
  full outer join sales_by_ad sa
    on sa.norm_name = sp.norm_name and sa.norm_adset = sp.norm_adset
  where sp.norm_name is not null or sa.norm_name is not null
  order by coalesce(sa.revenue, 0) desc, coalesce(sp.spend, 0) desc;
end;
$$;

revoke all on function get_funnel_report_by_creative(uuid, date, date) from public;
grant execute on function get_funnel_report_by_creative(uuid, date, date) to authenticated;
