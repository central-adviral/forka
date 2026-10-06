-- Central de Tráfego: the fronts take over day by day, not for the whole history at once.
--
-- The per-ad table the campaign sync reads (anuncio_dia) only starts on 2026-08-23, while the
-- operation-mapped spend (ad_spend_daily) goes back to the project's first day. Creating a front
-- used to switch every day to the fronts, so the months before the campaign history read zero.
-- Now a day reads the fronts only from the first day the client has campaigns synced; the days
-- before that keep the operation spend.

drop function public.get_funnel_daily(uuid, date, date);
create function public.get_funnel_daily(p_sales_funnel_id uuid, p_since date, p_until date)
returns table (
  data date,
  vendas bigint,
  vendas_anuncio bigint,
  vendas_upsell bigint,
  receita_bruta numeric,
  receita_liquida numeric,
  spend numeric,
  spend_com_imposto numeric,
  impressions bigint,
  clicks bigint,
  reach bigint,
  link_clicks bigint,
  landing_page_views bigint,
  initiate_checkout bigint,
  spend_source text,
  dados_ate timestamptz,
  vendas_apos_dados bigint
)
language sql stable set search_path = ''
as $$
  with project as (
    select sf.client_id from public.sales_funnels sf where sf.id = p_sales_funnel_id
  ),
  -- Today's spend is the Meta's number as of the last pull; sales keep arriving after it. Today's
  -- sales are cut at that moment so its CPA compares like with like; the rest is reported apart.
  today as (
    select
      (now() at time zone 'America/Sao_Paulo')::date as data,
      (select max(cd.source_updated_at) from public.campaign_daily cd, project p
       where cd.client_id = p.client_id and cd.data = (now() at time zone 'America/Sao_Paulo')::date) as dados_ate
  ),
  by_fronts as (
    select exists (select 1 from public.project_fronts f where f.sales_funnel_id = p_sales_funnel_id) as yes,
      (select min(cd.data) from public.campaign_daily cd, project p where cd.client_id = p.client_id) as since
  ),
  dated_sales as (
    select s.*, (s.data_venda at time zone 'America/Sao_Paulo')::date as data_sp,
      (t.dados_ate is not null and (s.data_venda at time zone 'America/Sao_Paulo')::date = t.data and s.data_venda > t.dados_ate) as apos_dados
    from public.sales s, today t
    where s.sales_funnel_id = p_sales_funnel_id
      and s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
      and s.data_venda < (p_until::timestamp at time zone 'America/Sao_Paulo')
  ),
  sales as (
    select
      s.data_sp as data,
      count(*) filter (where not s.is_upsell and not s.apos_dados) as vendas,
      count(*) filter (where not s.is_upsell and not s.apos_dados and s.origem in ('anuncio', 'anuncio_legado')) as vendas_anuncio,
      count(*) filter (where s.is_upsell and not s.apos_dados) as vendas_upsell,
      coalesce(sum(s.valor_bruto) filter (where not s.apos_dados), 0) as receita_bruta,
      coalesce(sum(s.valor_liquido) filter (where not s.apos_dados), 0) as receita_liquida,
      count(*) filter (where s.apos_dados) as vendas_apos_dados
    from dated_sales s
    group by 1
  ),
  spend as (
    select fd.data, sum(fd.spend) as spend, sum(fd.impressions) as impressions, sum(fd.clicks) as clicks,
      sum(fd.reach) as reach, sum(fd.link_clicks) as link_clicks, sum(fd.landing_page_views) as landing_page_views,
      sum(fd.initiate_checkout) as initiate_checkout
    from public.get_project_front_daily(p_sales_funnel_id, p_since, p_until) fd, by_fronts
    where by_fronts.yes and fd.data >= by_fronts.since
    group by fd.data
    union all
    select a.data, sum(a.spend), sum(a.impressions), sum(a.clicks), sum(a.reach), sum(a.link_clicks),
      sum(a.landing_page_views), sum(a.initiate_checkout)
    from public.ad_spend_daily a, by_fronts
    where not (by_fronts.yes and a.data >= coalesce(by_fronts.since, 'infinity'::date)) and a.sales_funnel_id = p_sales_funnel_id and a.data >= p_since and a.data < p_until
    group by a.data
  ),
  days as (
    select
      coalesce(s.data, sp.data) as data,
      coalesce(s.vendas, 0)::bigint as vendas,
      coalesce(s.vendas_anuncio, 0)::bigint as vendas_anuncio,
      coalesce(s.vendas_upsell, 0)::bigint as vendas_upsell,
      coalesce(s.receita_bruta, 0) as receita_bruta,
      coalesce(s.receita_liquida, 0) as receita_liquida,
      coalesce(sp.spend, 0) as spend,
      coalesce(sp.impressions, 0)::bigint as impressions,
      coalesce(sp.clicks, 0)::bigint as clicks,
      coalesce(sp.reach, 0)::bigint as reach,
      coalesce(sp.link_clicks, 0)::bigint as link_clicks,
      coalesce(sp.landing_page_views, 0)::bigint as landing_page_views,
      coalesce(sp.initiate_checkout, 0)::bigint as initiate_checkout,
      coalesce(s.vendas_apos_dados, 0)::bigint as vendas_apos_dados
    from sales s
    full join spend sp on sp.data = s.data
  )
  select
    d.data, d.vendas, d.vendas_anuncio, d.vendas_upsell, d.receita_bruta, d.receita_liquida, d.spend,
    d.spend * coalesce(
      (select t.factor from public.client_tax_rates t, project p
       where t.client_id = p.client_id and t.valid_from <= d.data
       order by t.valid_from desc limit 1),
      1),
    d.impressions, d.clicks, d.reach, d.link_clicks, d.landing_page_views, d.initiate_checkout,
    case when (select b.yes and d.data >= b.since from by_fronts b) then 'frentes' else 'operacao' end,
    case when d.data = (select t.data from today t) then (select t.dados_ate from today t) end,
    d.vendas_apos_dados
  from days d
  order by 1
$$;
revoke all on function public.get_funnel_daily(uuid, date, date) from public, anon;
grant execute on function public.get_funnel_daily(uuid, date, date) to authenticated, service_role;
