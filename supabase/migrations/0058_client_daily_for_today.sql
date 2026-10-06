-- Central de Tráfego, Fase 2: the numbers behind the "Hoje" screen, for a whole client.
--
-- Summing the projects of a client would count a campaign twice when one project reads another
-- (the T15 Captação Paga reads the 1K-LATAM). So the client view takes its spend straight from
-- the client's campaigns, every campaign once, and its sales from every project of the client.
-- Today is cut at the last Meta pull, as on the project screen (0057).

create function public.get_client_daily(p_client_id uuid, p_since date, p_until date)
returns table (
  data date,
  spend numeric,
  spend_com_imposto numeric,
  leads bigint,
  vendas bigint,
  vendas_anuncio bigint,
  receita_liquida numeric,
  dados_ate timestamptz,
  vendas_apos_dados bigint
)
language sql stable set search_path = ''
as $$
  with today as (
    select
      (now() at time zone 'America/Sao_Paulo')::date as data,
      (select max(cd.source_updated_at) from public.campaign_daily cd
       where cd.client_id = p_client_id and cd.data = (now() at time zone 'America/Sao_Paulo')::date) as dados_ate
  ),
  spend as (
    select cd.data, sum(cd.spend) as spend, sum(cd.leads) as leads
    from public.campaign_daily cd
    where cd.client_id = p_client_id and cd.data >= p_since and cd.data < p_until
    group by cd.data
  ),
  sales as (
    select
      (s.data_venda at time zone 'America/Sao_Paulo')::date as data,
      (t.dados_ate is not null and (s.data_venda at time zone 'America/Sao_Paulo')::date = t.data and s.data_venda > t.dados_ate) as apos_dados,
      s.is_upsell, s.origem, s.valor_liquido
    from public.sales s
    join public.sales_funnels sf on sf.id = s.sales_funnel_id and sf.client_id = p_client_id
    cross join today t
    where s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
      and s.data_venda < (p_until::timestamp at time zone 'America/Sao_Paulo')
  ),
  sales_by_day as (
    select
      data,
      count(*) filter (where not is_upsell and not apos_dados) as vendas,
      count(*) filter (where not is_upsell and not apos_dados and origem in ('anuncio', 'anuncio_legado')) as vendas_anuncio,
      coalesce(sum(valor_liquido) filter (where not apos_dados), 0) as receita_liquida,
      count(*) filter (where apos_dados) as vendas_apos_dados
    from sales
    group by data
  )
  select
    coalesce(sp.data, sa.data) as data,
    coalesce(sp.spend, 0),
    coalesce(sp.spend, 0) * coalesce(
      (select t.factor from public.client_tax_rates t
       where t.client_id = p_client_id and t.valid_from <= coalesce(sp.data, sa.data)
       order by t.valid_from desc limit 1),
      1),
    coalesce(sp.leads, 0)::bigint,
    coalesce(sa.vendas, 0)::bigint,
    coalesce(sa.vendas_anuncio, 0)::bigint,
    coalesce(sa.receita_liquida, 0),
    case when coalesce(sp.data, sa.data) = (select data from today) then (select dados_ate from today) end,
    coalesce(sa.vendas_apos_dados, 0)::bigint
  from spend sp
  full join sales_by_day sa on sa.data = sp.data
  order by 1
$$;
revoke all on function public.get_client_daily(uuid, date, date) from public, anon;
grant execute on function public.get_client_daily(uuid, date, date) to authenticated, service_role;
