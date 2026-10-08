-- Reembolso como data na venda (Arquitetura dos Números, onda 4, 2026-10-08).
--
-- Decision (Vitor): a refund leaves the revenue on the day of the refund; the day of the sale does
-- not change. Until now the sync deleted a sale that left 'aprovada', so a refund rewrote the past.
-- Now the row stays, with status as LaunchOps sends it and reembolsado_em = the refund moment
-- (LaunchOps updated_at of the row, set once; a resync does not move it). Back to 'aprovada' clears
-- it. Sales the sync deleted before this migration stay gone.
--
-- * get_funnel_daily (project KPIs and Dia a dia) and get_client_daily (Hoje): the sale stays on
--   its day, entry sales included. On the refund's São Paulo day, reembolsos and
--   receita_reembolsada_liquida show it, and receita_liquida (receita_bruta too) drops by it. A
--   refunded ascensão comes off the ascensão revenue the same way.
-- * get_portfolio_summary (Carteira): same rule as Hoje, so both show the same revenue.
-- * Every other reader that counted the sale as approved leaves it out, as when the row was
--   deleted, unless it was refunded after the period: then it was a sale in that period
--   (private.sale_counts). That is the breakdowns (origem, pagamento, produto, horário,
--   criativos), the front's watchers, front and cross sales, and data quality.
-- * A/B readers (ab_conversion_value, get_test_data_health, recover_conversions_from_sales) leave
--   every refunded row out, exactly as before; the tests keep their own refund handling (0083/0088).

alter table public.sales add column reembolsado_em timestamptz;

create index sales_funnel_refund_idx on public.sales (sales_funnel_id, reembolsado_em) where reembolsado_em is not null;
create index sales_client_refund_idx on public.sales (client_id, reembolsado_em) where reembolsado_em is not null;

-- A sale counts in a period ending at p_until (a São Paulo day; null = now) unless it was refunded
-- before that end.
create function private.sale_counts(p_reembolsado_em timestamptz, p_until date) returns boolean
language sql stable set search_path = ''
as $$
  select p_reembolsado_em is null
    or (p_until is not null and p_reembolsado_em >= (p_until::timestamp at time zone 'America/Sao_Paulo'))
$$;
revoke all on function private.sale_counts(timestamptz, date) from public, anon;
grant execute on function private.sale_counts(timestamptz, date) to authenticated, service_role;

-- The sync's refund write: only rows the Central already holds (a sale never seen approved is not
-- a sale), and the first refund moment wins.
create function public.mark_sales_refunded(p_client_id uuid, p_rows jsonb) returns integer
language plpgsql set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.sales s
     set status = r.status,
         updated_at = coalesce(r.updated_at, now()),
         reembolsado_em = coalesce(s.reembolsado_em, r.updated_at, now())
    from jsonb_to_recordset(p_rows) as r(external_id text, status text, updated_at timestamptz)
   where s.client_id = p_client_id and s.source = 'launchops_sync' and s.external_id = r.external_id;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke all on function public.mark_sales_refunded(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.mark_sales_refunded(uuid, jsonb) to service_role;

drop function public.get_funnel_daily(uuid, date, date);
create function public.get_funnel_daily(p_sales_funnel_id uuid, p_since date, p_until date)
 RETURNS TABLE(data date, vendas bigint, vendas_anuncio bigint, vendas_upsell bigint, receita_bruta numeric, receita_liquida numeric, spend numeric, spend_com_imposto numeric, impressions bigint, clicks bigint, reach bigint, link_clicks bigint, landing_page_views bigint, initiate_checkout bigint, spend_source text, dados_ate timestamp with time zone, vendas_apos_dados bigint, vendas_ascensao bigint, receita_ascensao_bruta numeric, receita_ascensao_liquida numeric, reembolsos bigint, receita_reembolsada_liquida numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
      count(*) filter (where s.papel = 'entrada' and not s.apos_dados) as vendas,
      count(*) filter (where s.papel = 'entrada' and not s.apos_dados and s.origem in ('anuncio', 'anuncio_legado')) as vendas_anuncio,
      count(*) filter (where s.papel in ('order_bump', 'upsell') and not s.apos_dados) as vendas_upsell,
      coalesce(sum(s.valor_bruto) filter (where s.papel <> 'ascensao' and not s.apos_dados), 0) as receita_bruta,
      coalesce(sum(s.valor_liquido) filter (where s.papel <> 'ascensao' and not s.apos_dados), 0) as receita_liquida,
      count(*) filter (where s.apos_dados) as vendas_apos_dados,
      count(*) filter (where s.papel = 'ascensao' and not s.apos_dados) as vendas_ascensao,
      coalesce(sum(s.valor_bruto) filter (where s.papel = 'ascensao' and not s.apos_dados), 0) as receita_ascensao_bruta,
      coalesce(sum(s.valor_liquido) filter (where s.papel = 'ascensao' and not s.apos_dados), 0) as receita_ascensao_liquida
    from dated_sales s
    group by 1
  ),
  -- The refunds, on the São Paulo day they happened, whatever day the sale was.
  refunds as (
    select
      (s.reembolsado_em at time zone 'America/Sao_Paulo')::date as data,
      count(*) filter (where s.papel <> 'ascensao') as reembolsos,
      coalesce(sum(s.valor_bruto) filter (where s.papel <> 'ascensao'), 0) as bruta,
      coalesce(sum(s.valor_liquido) filter (where s.papel <> 'ascensao'), 0) as liquida,
      coalesce(sum(s.valor_bruto) filter (where s.papel = 'ascensao'), 0) as ascensao_bruta,
      coalesce(sum(s.valor_liquido) filter (where s.papel = 'ascensao'), 0) as ascensao_liquida
    from public.sales s
    where s.sales_funnel_id = p_sales_funnel_id
      and s.reembolsado_em >= (p_since::timestamp at time zone 'America/Sao_Paulo')
      and s.reembolsado_em < (p_until::timestamp at time zone 'America/Sao_Paulo')
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
      coalesce(s.data, sp.data, r.data) as data,
      coalesce(s.vendas, 0)::bigint as vendas,
      coalesce(s.vendas_anuncio, 0)::bigint as vendas_anuncio,
      coalesce(s.vendas_upsell, 0)::bigint as vendas_upsell,
      coalesce(s.receita_bruta, 0) - coalesce(r.bruta, 0) as receita_bruta,
      coalesce(s.receita_liquida, 0) - coalesce(r.liquida, 0) as receita_liquida,
      coalesce(sp.spend, 0) as spend,
      coalesce(sp.impressions, 0)::bigint as impressions,
      coalesce(sp.clicks, 0)::bigint as clicks,
      coalesce(sp.reach, 0)::bigint as reach,
      coalesce(sp.link_clicks, 0)::bigint as link_clicks,
      coalesce(sp.landing_page_views, 0)::bigint as landing_page_views,
      coalesce(sp.initiate_checkout, 0)::bigint as initiate_checkout,
      coalesce(s.vendas_apos_dados, 0)::bigint as vendas_apos_dados,
      coalesce(s.vendas_ascensao, 0)::bigint as vendas_ascensao,
      coalesce(s.receita_ascensao_bruta, 0) - coalesce(r.ascensao_bruta, 0) as receita_ascensao_bruta,
      coalesce(s.receita_ascensao_liquida, 0) - coalesce(r.ascensao_liquida, 0) as receita_ascensao_liquida,
      coalesce(r.reembolsos, 0)::bigint as reembolsos,
      coalesce(r.liquida, 0) as receita_reembolsada_liquida
    from sales s
    full join spend sp on sp.data = s.data
    full join refunds r on r.data = coalesce(s.data, sp.data)
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
    d.vendas_apos_dados, d.vendas_ascensao, d.receita_ascensao_bruta, d.receita_ascensao_liquida,
    d.reembolsos, d.receita_reembolsada_liquida
  from days d
  order by 1
$function$;
revoke all on function public.get_funnel_daily(uuid, date, date) from public, anon;
grant execute on function public.get_funnel_daily(uuid, date, date) to authenticated, service_role;

drop function public.get_client_daily(uuid, date, date);
create function public.get_client_daily(p_client_id uuid, p_since date, p_until date)
 RETURNS TABLE(data date, spend numeric, spend_com_imposto numeric, leads bigint, vendas bigint, vendas_anuncio bigint, receita_liquida numeric, dados_ate timestamp with time zone, vendas_apos_dados bigint, receita_ascensao_liquida numeric, spend_compra_com_imposto numeric, spend_lead_com_imposto numeric, spend_sem_frente_com_imposto numeric, vendas_sem_projeto bigint, reembolsos bigint, receita_reembolsada_liquida numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with today as (
    select
      (now() at time zone 'America/Sao_Paulo')::date as data,
      (select max(cd.source_updated_at) from public.campaign_daily cd
       where cd.client_id = p_client_id and cd.data = (now() at time zone 'America/Sao_Paulo')::date) as dados_ate
  ),
  -- The project that owns each campaign (mirrors never own), and what that project produces.
  owners as (
    select c.campaign_id, sf.resultado
    from public.get_client_campaigns(p_client_id, p_since, p_until) c
    join public.project_fronts f on f.id = c.front_ids[1]
    join public.sales_funnels sf on sf.id = f.sales_funnel_id
    where cardinality(c.front_ids) > 0
  ),
  spend as (
    select cd.data, sum(cd.spend) as spend, sum(cd.leads) as leads,
      coalesce(sum(cd.spend) filter (where o.resultado in ('compra', 'roas')), 0) as spend_compra,
      coalesce(sum(cd.spend) filter (where o.resultado = 'lead'), 0) as spend_lead,
      coalesce(sum(cd.spend) filter (where o.campaign_id is null), 0) as spend_sem_frente
    from public.campaign_daily cd
    left join owners o on o.campaign_id = cd.campaign_id
    where cd.client_id = p_client_id and cd.data >= p_since and cd.data < p_until
    group by cd.data
  ),
  sales as (
    select
      (s.data_venda at time zone 'America/Sao_Paulo')::date as data,
      (t.dados_ate is not null and (s.data_venda at time zone 'America/Sao_Paulo')::date = t.data and s.data_venda > t.dados_ate) as apos_dados,
      -- A sale with no project has no role from a project: it counts as an entry.
      coalesce(s.papel, 'entrada') as papel, s.origem, s.valor_liquido, s.sales_funnel_id
    from public.sales s
    cross join today t
    where s.client_id = p_client_id
      and s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
      and s.data_venda < (p_until::timestamp at time zone 'America/Sao_Paulo')
  ),
  sales_by_day as (
    select
      data,
      count(*) filter (where papel = 'entrada' and not apos_dados) as vendas,
      count(*) filter (where papel = 'entrada' and not apos_dados and origem in ('anuncio', 'anuncio_legado')) as vendas_anuncio,
      coalesce(sum(valor_liquido) filter (where papel <> 'ascensao' and not apos_dados), 0) as receita_liquida,
      count(*) filter (where apos_dados) as vendas_apos_dados,
      coalesce(sum(valor_liquido) filter (where papel = 'ascensao' and not apos_dados), 0) as receita_ascensao_liquida,
      count(*) filter (where sales_funnel_id is null and not apos_dados) as vendas_sem_projeto
    from sales
    group by data
  ),
  -- The refunds, on the São Paulo day they happened, whatever day the sale was.
  refunds as (
    select
      (s.reembolsado_em at time zone 'America/Sao_Paulo')::date as data,
      count(*) filter (where coalesce(s.papel, 'entrada') <> 'ascensao') as reembolsos,
      coalesce(sum(s.valor_liquido) filter (where coalesce(s.papel, 'entrada') <> 'ascensao'), 0) as liquida,
      coalesce(sum(s.valor_liquido) filter (where s.papel = 'ascensao'), 0) as ascensao_liquida
    from public.sales s
    where s.client_id = p_client_id
      and s.reembolsado_em >= (p_since::timestamp at time zone 'America/Sao_Paulo')
      and s.reembolsado_em < (p_until::timestamp at time zone 'America/Sao_Paulo')
    group by 1
  ),
  days as (
    select coalesce(sp.data, sa.data, r.data) as day, sp.spend, sp.leads, sp.spend_compra, sp.spend_lead, sp.spend_sem_frente,
      sa.vendas, sa.vendas_anuncio, sa.receita_liquida, sa.vendas_apos_dados, sa.receita_ascensao_liquida, sa.vendas_sem_projeto,
      r.reembolsos, r.liquida as receita_reembolsada_liquida, r.ascensao_liquida as receita_ascensao_reembolsada
    from spend sp
    full join sales_by_day sa on sa.data = sp.data
    full join refunds r on r.data = coalesce(sp.data, sa.data)
  ),
  taxed as (
    select d.*,
      coalesce((select t.factor from public.client_tax_rates t
                where t.client_id = p_client_id and t.valid_from <= d.day
                order by t.valid_from desc limit 1), 1) as tax
    from days d
  )
  select
    d.day,
    coalesce(d.spend, 0),
    coalesce(d.spend, 0) * d.tax,
    coalesce(d.leads, 0)::bigint,
    coalesce(d.vendas, 0)::bigint,
    coalesce(d.vendas_anuncio, 0)::bigint,
    coalesce(d.receita_liquida, 0) - coalesce(d.receita_reembolsada_liquida, 0),
    case when d.day = (select data from today) then (select dados_ate from today) end,
    coalesce(d.vendas_apos_dados, 0)::bigint,
    coalesce(d.receita_ascensao_liquida, 0) - coalesce(d.receita_ascensao_reembolsada, 0),
    coalesce(d.spend_compra, 0) * d.tax,
    coalesce(d.spend_lead, 0) * d.tax,
    coalesce(d.spend_sem_frente, 0) * d.tax,
    coalesce(d.vendas_sem_projeto, 0)::bigint,
    coalesce(d.reembolsos, 0)::bigint,
    coalesce(d.receita_reembolsada_liquida, 0)
  from taxed d
  order by 1
$function$;
revoke all on function public.get_client_daily(uuid, date, date) from public, anon;
grant execute on function public.get_client_daily(uuid, date, date) to authenticated, service_role;

-- Breakdowns, fronts, cross-sales and data quality: a refunded sale is left out, unless it was
-- refunded after the period.

CREATE OR REPLACE FUNCTION public.get_funnel_payment_breakdown(p_sales_funnel_id uuid, p_since date, p_until date)
 RETURNS TABLE(metodo text, receita numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(s.metodo_pagamento, 'desconhecido'), coalesce(sum(s.valor_liquido), 0)
  from public.sales s
  where s.sales_funnel_id = p_sales_funnel_id
    and s.papel <> 'ascensao'
    and s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
    and s.data_venda < (p_until::timestamp at time zone 'America/Sao_Paulo')
    and not private.sale_after_meta_pull(s.client_id, s.data_venda)
    and private.sale_counts(s.reembolsado_em, p_until)
  group by 1
  order by 2 desc
$function$;

CREATE OR REPLACE FUNCTION public.get_funnel_sales_by_origin(p_sales_funnel_id uuid, p_since date, p_until date)
 RETURNS TABLE(origem text, vendas bigint, vendas_upsell bigint, receita_liquida numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    s.origem,
    count(*) filter (where s.papel = 'entrada'),
    count(*) filter (where s.papel in ('order_bump', 'upsell')),
    coalesce(sum(s.valor_liquido) filter (where s.papel <> 'ascensao'), 0)
  from public.sales s
  where s.sales_funnel_id = p_sales_funnel_id
    and s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
    and s.data_venda < (p_until::timestamp at time zone 'America/Sao_Paulo')
    and not private.sale_after_meta_pull(s.client_id, s.data_venda)
    and private.sale_counts(s.reembolsado_em, p_until)
  group by s.origem
  order by 2 desc
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
    and not private.sale_after_meta_pull(s.client_id, s.data_venda)
    and private.sale_counts(s.reembolsado_em, p_until)
  group by 1
  order by 3 desc;
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
    count(s.id) filter (where s.papel = 'entrada')::bigint,
    coalesce(sum(s.valor_liquido), 0)
  from generate_series(0, 23) as h(hour)
  left join sales s
    on extract(hour from (s.data_venda at time zone 'America/Sao_Paulo')) = h.hour
   and s.sales_funnel_id = p_sales_funnel_id
   and s.papel <> 'ascensao'
   and (p_since is null or s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo'))
   and (p_until is null or s.data_venda < (p_until::timestamp at time zone 'America/Sao_Paulo'))
   and not private.sale_after_meta_pull(s.client_id, s.data_venda)
   and private.sale_counts(s.reembolsado_em, p_until)
  group by h.hour
  order by h.hour;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_funnel_report_by_creative(p_sales_funnel_id uuid, p_since date DEFAULT NULL::date, p_until date DEFAULT NULL::date)
 RETURNS TABLE(ad_name text, ad_id text, adset_name text, ad_count integer, spend numeric, impressions bigint, link_clicks bigint, sales_count bigint, revenue numeric, leads bigint)
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
      sum(acsd.spend * acsd.tax) filter (
        where (p_since is null or acsd.data >= p_since) and (p_until is null or acsd.data < p_until)
      ) as spend,
      sum(acsd.impressions) filter (
        where (p_since is null or acsd.data >= p_since) and (p_until is null or acsd.data < p_until)
      ) as impressions,
      sum(acsd.link_clicks) filter (
        where (p_since is null or acsd.data >= p_since) and (p_until is null or acsd.data < p_until)
      ) as link_clicks,
      sum(acsd.leads) filter (
        where (p_since is null or acsd.data >= p_since) and (p_until is null or acsd.data < p_until)
      ) as leads
    from (
      -- One row per ad and day: a rename rewrites history under the new name, and the row kept
      -- under the old name would count that day twice. The newest write wins.
      select distinct on (coalesce(nullif(x.ad_id, ''), x.id::text), x.data)
        x.*,
        coalesce(
          (select t.factor from client_tax_rates t
           where t.client_id = v_client_id and t.valid_from <= x.data
           order by t.valid_from desc limit 1),
          1) as tax
      from ad_creative_spend_daily x
      where x.sales_funnel_id = p_sales_funnel_id
      order by coalesce(nullif(x.ad_id, ''), x.id::text), x.data, x.updated_at desc
    ) acsd
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
      s.papel,
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
      and s.papel <> 'ascensao'
      and (p_since is null or s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo'))
      and (p_until is null or s.data_venda < (p_until::timestamp at time zone 'America/Sao_Paulo'))
      and not private.sale_after_meta_pull(s.client_id, s.data_venda)
      and private.sale_counts(s.reembolsado_em, p_until)
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
      count(*) filter (where rs.papel = 'entrada') as sales_count,
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
      coalesce(sum(sa.link_clicks), 0) as link_clicks,
      coalesce(sum(sa.leads), 0) as leads
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
    coalesce(sl.revenue, 0),
    coalesce(sp.leads, 0)::bigint
  from spend_by_key sp
  full outer join sales_by_key sl on sl.ad_key = sp.ad_key
  order by coalesce(sl.revenue, 0) desc, coalesce(sp.spend, 0) desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_project_front_sales(p_sales_funnel_id uuid, p_since date, p_until date)
 RETURNS TABLE(front_id uuid, vendas bigint, receita_liquida numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_client_id uuid;
begin
  select sf.client_id into v_client_id from public.sales_funnels sf
  where sf.id = p_sales_funnel_id and private.has_client_role(sf.client_id, 'cliente');
  if v_client_id is null then
    raise exception 'not found or access denied';
  end if;

  return query
  with own_fronts as (
    select f.id from public.project_fronts f where f.sales_funnel_id = p_sales_funnel_id and f.source_sales_funnel_id is null
  ),
  front_campaigns as (
    select c.front_ids[1] as front_id, c.campaign_id
    from public.get_client_campaigns(v_client_id, p_since - 60, p_until) c
    where c.front_ids[1] in (select id from own_fronts)
  )
  select fc.front_id,
    count(*) filter (where s.papel = 'entrada'),
    coalesce(sum(s.valor_liquido) filter (where s.papel <> 'ascensao'), 0)
  from public.sales s
  join front_campaigns fc on fc.campaign_id = private.sale_campaign_id(s.client_id, s.utm_campaign, s.utm_content)
  where s.sales_funnel_id = p_sales_funnel_id
    and s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
    and s.data_venda < (p_until::timestamp at time zone 'America/Sao_Paulo')
    and not private.sale_after_meta_pull(s.client_id, s.data_venda)
    and private.sale_counts(s.reembolsado_em, p_until)
  group by fc.front_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_project_cross_sales(p_sales_funnel_id uuid, p_since date, p_until date)
 RETURNS TABLE(geradas_para_outro bigint, vindas_de_outro bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_client_id uuid;
begin
  select sf.client_id into v_client_id from public.sales_funnels sf
  where sf.id = p_sales_funnel_id and private.has_client_role(sf.client_id, 'cliente');
  if v_client_id is null then
    raise exception 'not found or access denied';
  end if;

  return query
  select
    count(*) filter (where s.anuncio_funnel_id = p_sales_funnel_id and s.sales_funnel_id is distinct from p_sales_funnel_id),
    count(*) filter (where s.sales_funnel_id = p_sales_funnel_id and s.anuncio_funnel_id is not null and s.anuncio_funnel_id <> p_sales_funnel_id)
  from public.sales s
  where s.client_id = v_client_id and s.papel = 'entrada'
    and s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
    and s.data_venda < (p_until::timestamp at time zone 'America/Sao_Paulo')
    and not private.sale_after_meta_pull(s.client_id, s.data_venda)
    and private.sale_counts(s.reembolsado_em, p_until);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_project_data_quality(p_sales_funnel_id uuid, p_since date, p_until date)
 RETURNS TABLE(vendas_entrada bigint, vendas_anuncio bigint, vendas_com_id_anuncio bigint, vendas_sem_utm bigint, vendas_bio bigint, vendas_outra_origem bigint, cliente_vendas_sem_projeto bigint, cliente_gasto_sem_frente numeric, cliente_campanhas_sem_frente bigint, cliente_campanhas_em_disputa bigint, espelhos_sem_janela bigint, vigias_sem_avaliar bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_client_id uuid;
  v_starts date;
  v_ends date;
begin
  select sf.client_id, sf.starts_on, sf.ends_on into v_client_id, v_starts, v_ends
  from public.sales_funnels sf
  where sf.id = p_sales_funnel_id and private.has_client_role(sf.client_id, 'cliente');
  if v_client_id is null then
    raise exception 'not found or access denied';
  end if;

  return query
  with sales as (
    select s.* from public.sales s
    where s.client_id = v_client_id
      and s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
      and s.data_venda < (p_until::timestamp at time zone 'America/Sao_Paulo')
      and not private.sale_after_meta_pull(s.client_id, s.data_venda)
      and private.sale_counts(s.reembolsado_em, p_until)
  ),
  entries as (
    select s.* from sales s where s.sales_funnel_id = p_sales_funnel_id and s.papel = 'entrada'
  ),
  campaigns as (
    select c.* from public.get_client_campaigns(v_client_id, p_since, p_until) c
  )
  select
    (select count(*) from entries),
    (select count(*) from entries e where e.origem in ('anuncio', 'anuncio_legado')),
    (select count(*) from entries e where private.sale_ad_id(e.utm_campaign, e.utm_content) is not null),
    (select count(*) from entries e where e.origem = 'sem_utm'),
    (select count(*) from entries e where e.origem = 'organico_bio'),
    (select count(*) from entries e where e.origem = 'outro'),
    (select count(*) from sales s where s.sales_funnel_id is null),
    coalesce((
      select sum(cd.spend * coalesce((select t.factor from public.client_tax_rates t
                                      where t.client_id = v_client_id and t.valid_from <= cd.data
                                      order by t.valid_from desc limit 1), 1))
      from public.campaign_daily cd
      join campaigns c on c.campaign_id = cd.campaign_id and cardinality(c.front_ids) = 0
      where cd.client_id = v_client_id and cd.data >= p_since and cd.data < p_until
    ), 0),
    (select count(*) from campaigns c where cardinality(c.front_ids) = 0),
    (select count(*) from campaigns c where cardinality(c.front_ids) = 0 and cardinality(c.suggested_front_ids) > 1),
    (select count(*) from public.project_fronts f
      where f.sales_funnel_id = p_sales_funnel_id and f.source_sales_funnel_id is not null and v_starts is null and v_ends is null),
    (select count(*) from public.watchers w
      where w.sales_funnel_id = p_sales_funnel_id and w.is_active and w.created_at < now() - interval '2 days'
        and (w.last_day is null or w.last_day < (now() at time zone 'America/Sao_Paulo')::date - 2 or w.last_status = 'sem_dado'));
end;
$function$;

CREATE OR REPLACE FUNCTION public.watcher_day(p_watcher_id uuid, p_day date)
 RETURNS TABLE(spend numeric, value numeric, status text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  w public.watchers;
  v_tax numeric;
  v_spend numeric;
  v_impr numeric;
  v_clicks numeric;
  v_lpv numeric;
  v_leads numeric;
  v_reach numeric;
  v_vendas numeric;
  v_vendas_anuncio numeric;
  v_receita numeric;
  v_ic numeric;
  v_value numeric;
  v_off numeric;
begin
  select * into w from public.watchers where id = p_watcher_id;
  if not found then
    return;
  end if;

  select coalesce((select t.factor from public.client_tax_rates t
                   where t.client_id = w.client_id and t.valid_from <= p_day
                   order by t.valid_from desc limit 1), 1)
    into v_tax;

  select coalesce(sum(fd.spend), 0) * v_tax, coalesce(sum(fd.impressions), 0), coalesce(sum(fd.link_clicks), 0),
         coalesce(sum(fd.landing_page_views), 0), coalesce(sum(fd.leads), 0), coalesce(sum(fd.reach), 0),
         coalesce(sum(fd.initiate_checkout), 0)
    into v_spend, v_impr, v_clicks, v_lpv, v_leads, v_reach, v_ic
    from public.get_project_front_daily(w.sales_funnel_id, p_day, p_day + 1) fd
   where w.front_id is null or fd.front_id = w.front_id;

  if w.metric in ('cpa_geral', 'cpa_anuncio', 'roas') and w.front_id is null then
    select fdy.vendas, fdy.vendas_anuncio, fdy.receita_liquida into v_vendas, v_vendas_anuncio, v_receita
      from public.get_funnel_daily(w.sales_funnel_id, p_day, p_day + 1) fdy;
  elsif w.metric in ('cpa_anuncio', 'roas') then
    -- The front's sales: the project's sales of the day whose UTM names a campaign the front
    -- counts (or an ad of one). The 60 days only bound which campaigns are read.
    with front_campaigns as (
      select c.campaign_id
      from public.get_client_campaigns(w.client_id, p_day - 60, p_day + 1) c
      where w.front_id = any (c.front_ids)
    )
    select count(*) filter (where s.papel = 'entrada'),
           coalesce(sum(s.valor_liquido) filter (where s.papel <> 'ascensao'), 0)
      into v_vendas_anuncio, v_receita
      from public.sales s
      join front_campaigns fc on fc.campaign_id = private.sale_campaign_id(s.client_id, s.utm_campaign, s.utm_content)
     where s.sales_funnel_id = w.sales_funnel_id
       and s.data_venda >= (p_day::timestamp at time zone 'America/Sao_Paulo')
       and s.data_venda < ((p_day + 1)::timestamp at time zone 'America/Sao_Paulo')
       and private.sale_counts(s.reembolsado_em, p_day + 1);
  end if;

  v_value := case w.metric
    when 'investimento' then v_spend
    when 'cpl' then v_spend / nullif(v_leads, 0)
    when 'cpm' then v_spend / nullif(v_impr, 0) * 1000
    when 'ctr' then v_clicks / nullif(v_impr, 0) * 100
    when 'connect_rate' then v_lpv / nullif(v_clicks, 0) * 100
    when 'frequencia' then v_impr / nullif(v_reach, 0)
    when 'cpa_geral' then v_spend / nullif(v_vendas, 0)
    when 'cpa_anuncio' then v_spend / nullif(v_vendas_anuncio, 0)
    when 'roas' then v_receita / nullif(v_spend, 0)
    when 'custo_checkout' then v_spend / nullif(v_ic, 0)
    when 'custo_visita' then v_spend / nullif(v_lpv, 0)
  end;

  if v_spend < w.min_spend then
    status := 'sem_volume';
  elsif v_value is null then
    status := 'sem_dado';
  else
    -- How far off the target, in %, in the direction that is bad for this metric.
    v_off := case public.watcher_metric_direction(w.metric)
      when 'sobe' then (v_value / w.target - 1) * 100
      else (1 - v_value / w.target) * 100
    end;
    status := case when v_off > w.crit_pct then 'crit' when v_off > w.warn_pct then 'warn' else 'ok' end;
  end if;
  spend := v_spend;
  value := v_value;
  return next;
end
$function$;

CREATE OR REPLACE FUNCTION public.get_portfolio_summary(p_since date)
 RETURNS TABLE(client_id uuid, spend numeric, spend_today numeric, entry_sales bigint, net_revenue numeric, active_tests bigint, last_sync_at timestamp with time zone, alerts_crit bigint, alerts_warn bigint, responsaveis text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with today as (select (now() at time zone 'America/Sao_Paulo')::date as data),
  mine as (select private.accessible_client_ids('cliente') as id),
  spend as (
    select cd.client_id, cd.data,
      sum(cd.spend) * coalesce(
        (select t.factor from public.client_tax_rates t
         where t.client_id = cd.client_id and t.valid_from <= cd.data
         order by t.valid_from desc limit 1),
        1) as spend
    from public.campaign_daily cd
    where cd.client_id in (select id from mine) and cd.data >= least(p_since, (select data from today))
    group by cd.client_id, cd.data
  )
  select
    c.id,
    coalesce((select sum(s.spend) from spend s where s.client_id = c.id and s.data >= p_since), 0),
    coalesce((select sum(s.spend) from spend s, today where s.client_id = c.id and s.data = today.data), 0),
    -- Client-wide: a sale with no project is still the client's sale.
    (
      select count(*) from public.sales s
      where s.client_id = c.id and coalesce(s.papel, 'entrada') = 'entrada'
        and s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
    ),
    -- As Hoje (0099): the sale stays on its day, a refund comes off on the refund's day.
    coalesce((
      select sum(s.valor_liquido) from public.sales s
      where s.client_id = c.id and coalesce(s.papel, 'entrada') <> 'ascensao'
        and s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
    ), 0) - coalesce((
      select sum(s.valor_liquido) from public.sales s
      where s.client_id = c.id and coalesce(s.papel, 'entrada') <> 'ascensao'
        and s.reembolsado_em >= (p_since::timestamp at time zone 'America/Sao_Paulo')
    ), 0),
    (select count(*) from public.tests t where t.client_id = c.id and t.status = 'active'),
    greatest(
      (select max(r.finished_at) from public.sync_runs r where r.client_id = c.id and r.error is null),
      (select max(fss.last_run_at) from public.funnel_sync_state fss
       join public.sales_funnels sf on sf.id = fss.sales_funnel_id
       where sf.client_id = c.id and fss.last_result = 'ok')
    ),
    (select count(*) from public.alerts a where a.client_id = c.id and a.closed_at is null and a.severity = 'crit'),
    (select count(*) from public.alerts a where a.client_id = c.id and a.closed_at is null and a.severity = 'warn'),
    case when private.has_client_role(c.id, 'analista') then (
      select string_agg(split_part(u.email::text, '@', 1), ', ' order by private.role_rank(m.role) desc, u.email)
      from public.memberships m
      join auth.users u on u.id = m.user_id
      where m.client_id = c.id and m.role in ('owner', 'gestor')
    ) end
  from public.clients c
  where c.id in (select id from mine)
$function$;

-- A/B: these read sales only to confirm a sale or price it. A refunded row was absent before 0099
-- and stays out, so no test result moves.

CREATE OR REPLACE FUNCTION private.ab_conversion_value(p_net boolean, p_invoice text, p_gross_cents integer)
 RETURNS TABLE(counts boolean, cents integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    coalesce(bool_or(s.papel = 'entrada'), true),
    coalesce(round(sum(s.valor_liquido) filter (where s.papel = 'entrada') * 100)::integer, p_gross_cents)
  from public.sales s
  where p_net and s.transaction_id_plataforma = p_invoice and s.reembolsado_em is null
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
      and s.reembolsado_em is null
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

CREATE OR REPLACE FUNCTION public.recover_conversions_from_sales(p_client_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  with candidates as (
    select distinct on (s.transaction_id_plataforma)
      s.transaction_id_plataforma as invoice, ce.id as click_id, round(s.valor_bruto * 100)::integer as cents, s.data_venda
    from public.sales s
    join public.click_events ce on ce.tracking_id = s.utm_content and not ce.is_bot
    join public.tests t on t.id = ce.test_id and t.client_id = p_client_id and t.conversion_method = 'hubla_webhook'
    where s.client_id = p_client_id
      and s.transaction_id_plataforma is not null
      and s.reembolsado_em is null
      and s.data_venda >= now() - interval '90 days'
      -- Bought after the click (a few minutes of clock skew), within the cookie's 30 days.
      and s.data_venda >= ce.created_at - interval '5 minutes'
      and s.data_venda < ce.created_at + interval '30 days'
      and not exists (select 1 from public.conversions cv where cv.external_event_id = s.transaction_id_plataforma)
      and not exists (select 1 from public.conversion_refunds r where r.external_event_id = s.transaction_id_plataforma)
      and not exists (select 1 from public.hubla_events h where h.invoice_id = s.transaction_id_plataforma and h.kind = 'refund')
    order by s.transaction_id_plataforma, ce.created_at
  ),
  inserted as (
    insert into public.conversions (click_event_id, source, external_event_id, value_cents, created_at, recovered_via)
    select c.click_id, 'hubla_webhook', c.invoice, c.cents, c.data_venda, 'launchops_sync' from candidates c
    on conflict (external_event_id) where external_event_id is not null do nothing
    returning id, external_event_id
  )
  update public.sales s set conversion_id = i.id
  from inserted i
  where s.client_id = p_client_id and s.transaction_id_plataforma = i.external_event_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
