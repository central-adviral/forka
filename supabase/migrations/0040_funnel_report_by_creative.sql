-- Revenue per creative for a sales funnel. Until now that screen could only show money in
-- aggregate: spend came from ad_creative_spend_daily per ad, while revenue sat in sales with no
-- ad attached, so the two could never meet. 0039 brought the UTMs across, and utm_term carries
-- the ad name on 98.6% of the sales.
--
-- Ads and sales are matched the way get_test_report_by_ad matches them (0038): on the name
-- normalized to NFC -- "Marçal" is stored pre-composed on one side and decomposed on the other,
-- and a plain equality silently misses every accented ad name.

create or replace function get_funnel_report_by_creative(
  p_sales_funnel_id uuid,
  p_since date default null,
  p_until date default null
)
returns table (
  ad_name text,
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
  with spend_by_ad as (
    select
      nullif(lower(btrim(normalize(coalesce(acsd.ad_name, ''), NFC))), '') as norm_name,
      max(acsd.ad_name) as ad_label,
      sum(acsd.spend) as spend,
      sum(acsd.impressions) as impressions,
      sum(acsd.link_clicks) as link_clicks
    from ad_creative_spend_daily acsd
    where acsd.sales_funnel_id = p_sales_funnel_id
      and (p_since is null or acsd.data >= p_since)
      and (p_until is null or acsd.data < p_until)
    group by 1
  ),
  sales_by_ad as (
    select
      nullif(lower(btrim(normalize(coalesce(s.utm_term, ''), NFC))), '') as norm_name,
      max(s.utm_term) as ad_label,
      count(*) as sales_count,
      sum(coalesce(s.valor_liquido, 0)) as revenue
    from sales s
    where s.sales_funnel_id = p_sales_funnel_id
      and (p_since is null or s.data_venda >= p_since)
      and (p_until is null or s.data_venda < p_until + 1)
    group by 1
  )
  -- Full join: an ad that spent without selling still shows (that is the one worth pausing),
  -- and a sale whose ad has no spend synced still shows its revenue.
  select
    coalesce(sp.ad_label, sa.ad_label, '(sem anúncio)') as ad_name,
    coalesce(sp.spend, 0) as spend,
    coalesce(sp.impressions, 0)::bigint as impressions,
    coalesce(sp.link_clicks, 0)::bigint as link_clicks,
    coalesce(sa.sales_count, 0)::bigint as sales_count,
    coalesce(sa.revenue, 0) as revenue
  from spend_by_ad sp
  full outer join sales_by_ad sa on sa.norm_name = sp.norm_name
  where sp.norm_name is not null or sa.norm_name is not null
  order by coalesce(sa.revenue, 0) desc, coalesce(sp.spend, 0) desc;
end;
$$;

revoke all on function get_funnel_report_by_creative(uuid, date, date) from public;
grant execute on function get_funnel_report_by_creative(uuid, date, date) to authenticated;
