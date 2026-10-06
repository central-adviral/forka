-- Central de Tráfego, Fase 1: where each sale came from, entry vs upsell, and the Meta tax per client.
--
-- The project overview (the perpetual one above all) reads its CPA as ad spend over EVERY entry sale,
-- whatever brought the buyer in, and its revenue and ROAS over entry + upsell. Creatives, campaigns,
-- watchers and A/B tests keep counting only the sale the UTM ties to an ad. Both need to know, per
-- sale, whether it is an upsell and which origin its UTM points to.

alter table sales add column is_upsell boolean not null default false;

-- bsheep: an ad sale is recognised by a numeric Meta ad id in utm_content, not by looking the id up
-- among the client's ads -- the Central does not hold every ad yet. Revisit once it does.
alter table sales add column origem text generated always as (
  case
    when coalesce(utm_content, '') ~ '^[0-9]{6,}$' then 'anuncio'
    when lower(coalesce(utm_source, '')) = 'facebookads' then 'anuncio_legado'
    when lower(coalesce(utm_source, '')) in ('ig', 'instagram')
      and lower(coalesce(utm_medium, '') || ' ' || coalesce(utm_campaign, '') || ' ' || coalesce(utm_content, '')) like '%bio%'
      then 'organico_bio'
    when coalesce(utm_source, '') = '' and coalesce(utm_medium, '') = '' and coalesce(utm_campaign, '') = '' and coalesce(utm_content, '') = ''
      then 'sem_utm'
    else 'outro'
  end
) stored;

-- The Meta charges a tax on top of the spend it reports (13,8% today). Spend is stored as reported
-- and the factor is applied on read, per day, so a rate change never rewrites history.
create table client_tax_rates (
  client_id uuid not null references clients(id) on delete cascade,
  valid_from date not null,
  factor numeric not null check (factor >= 1 and factor < 2),
  created_at timestamptz not null default now(),
  primary key (client_id, valid_from)
);
alter table client_tax_rates enable row level security;
create policy client_tax_rates_read on client_tax_rates for select to authenticated
  using (client_id in (select private.accessible_client_ids('cliente')));
create policy client_tax_rates_write on client_tax_rates for all to authenticated
  using (client_id in (select private.accessible_client_ids('gestor')))
  with check (client_id in (select private.accessible_client_ids('gestor')));
grant select, insert, update, delete on client_tax_rates to authenticated, service_role;
revoke all on client_tax_rates from anon;

-- One row per São Paulo day. vendas = entry sales of any origin (the CPA base of the overview);
-- vendas_anuncio = the entry sales the UTM ties to an ad; receita = entry + upsell.
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
  spend_source text
)
language sql stable set search_path = ''
as $$
  with project as (
    select sf.client_id from public.sales_funnels sf where sf.id = p_sales_funnel_id
  ),
  by_fronts as (
    select exists (select 1 from public.project_fronts f where f.sales_funnel_id = p_sales_funnel_id) as yes
  ),
  sales as (
    select
      (s.data_venda at time zone 'America/Sao_Paulo')::date as data,
      count(*) filter (where not s.is_upsell) as vendas,
      count(*) filter (where not s.is_upsell and s.origem in ('anuncio', 'anuncio_legado')) as vendas_anuncio,
      count(*) filter (where s.is_upsell) as vendas_upsell,
      coalesce(sum(s.valor_bruto), 0) as receita_bruta,
      coalesce(sum(s.valor_liquido), 0) as receita_liquida
    from public.sales s
    where s.sales_funnel_id = p_sales_funnel_id
      and s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
      and s.data_venda < (p_until::timestamp at time zone 'America/Sao_Paulo')
    group by 1
  ),
  spend as (
    select fd.data, sum(fd.spend) as spend, sum(fd.impressions) as impressions, sum(fd.clicks) as clicks,
      sum(fd.reach) as reach, sum(fd.link_clicks) as link_clicks, sum(fd.landing_page_views) as landing_page_views,
      sum(fd.initiate_checkout) as initiate_checkout
    from public.get_project_front_daily(p_sales_funnel_id, p_since, p_until) fd, by_fronts
    where by_fronts.yes
    group by fd.data
    union all
    select a.data, sum(a.spend), sum(a.impressions), sum(a.clicks), sum(a.reach), sum(a.link_clicks),
      sum(a.landing_page_views), sum(a.initiate_checkout)
    from public.ad_spend_daily a, by_fronts
    where not by_fronts.yes and a.sales_funnel_id = p_sales_funnel_id and a.data >= p_since and a.data < p_until
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
      coalesce(sp.initiate_checkout, 0)::bigint as initiate_checkout
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
    case when (select yes from by_fronts) then 'frentes' else 'operacao' end
  from days d
  order by 1
$$;
revoke all on function public.get_funnel_daily(uuid, date, date) from public, anon;
grant execute on function public.get_funnel_daily(uuid, date, date) to authenticated, service_role;

-- Entry and upsell sales per origin, for the "Origem das vendas" read-out of the overview.
create function public.get_funnel_sales_by_origin(p_sales_funnel_id uuid, p_since date, p_until date)
returns table (origem text, vendas bigint, vendas_upsell bigint, receita_bruta numeric)
language sql stable set search_path = ''
as $$
  select
    s.origem,
    count(*) filter (where not s.is_upsell),
    count(*) filter (where s.is_upsell),
    coalesce(sum(s.valor_bruto), 0)
  from public.sales s
  where s.sales_funnel_id = p_sales_funnel_id
    and s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
    and s.data_venda < (p_until::timestamp at time zone 'America/Sao_Paulo')
  group by s.origem
  order by 2 desc
$$;
revoke all on function public.get_funnel_sales_by_origin(uuid, date, date) from public, anon;
grant execute on function public.get_funnel_sales_by_origin(uuid, date, date) to authenticated, service_role;
