-- Objetivo do projeto (Arquitetura dos Números, configuração, 2026-10-08). Only flags change.
--
-- * A project's objective was compra (CPA) or lead (CPL). It can now also be receita (ROAS),
--   checkout iniciado (custo por checkout), visita na página (custo por visita) or alcance (CPM):
--   the metric the plan targets, the Hoje and the alerts judge. Compra and ROAS count sales; the
--   others are read from the campaigns.
-- * The plan's watcher was found by its metric (CPA or CPL). With ROAS and CPM as objectives, an
--   extra project-wide ROAS or CPM watcher would be taken for the plan's and replaced on save. It is
--   marked now: is_plan, one per project, set on the existing plan watchers by their metric.
-- * Two watcher metrics: custo_checkout (spend ÷ checkouts iniciados) and custo_visita (spend ÷
--   visitas na página).
-- * Hoje's CPA divides the spend of every sales project (compra and ROAS).

alter table sales_funnels drop constraint sales_funnels_resultado_check;
alter table sales_funnels add constraint sales_funnels_resultado_check
  check (resultado in ('compra', 'lead', 'roas', 'checkout', 'visita', 'alcance'));

alter table watchers add column is_plan boolean not null default false;
update watchers w set is_plan = true
  from sales_funnels sf
 where sf.id = w.sales_funnel_id and w.front_id is null
   and w.metric = case sf.resultado when 'lead' then 'cpl' else 'cpa_geral' end;
create unique index watchers_one_plan_per_project on watchers (sales_funnel_id) where is_plan;

alter table watchers drop constraint watchers_metric_check;
alter table watchers add constraint watchers_metric_check
  check (metric in ('cpa_geral', 'cpa_anuncio', 'cpl', 'cpm', 'ctr', 'connect_rate', 'investimento', 'frequencia', 'roas', 'custo_checkout', 'custo_visita'));

create or replace function public.watcher_day(p_watcher_id uuid, p_day date)
returns table (spend numeric, value numeric, status text)
language plpgsql stable set search_path = ''
as $$
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
    -- The front's sales: the project's sales of the day whose ad runs in a campaign the front
    -- counts. The 60 days only bound which campaigns are read; a campaign's front is its own.
    with front_ads as (
      select distinct a.ad_id
      from public.get_client_campaigns(w.client_id, p_day - 60, p_day + 1) c
      join public.ad_creative_spend_daily a on a.campaign_id = c.campaign_id
      where w.front_id = any (c.front_ids)
    )
    select count(*) filter (where s.papel = 'entrada'),
           coalesce(sum(s.valor_liquido) filter (where s.papel <> 'ascensao'), 0)
      into v_vendas_anuncio, v_receita
      from public.sales s
      join front_ads fa on fa.ad_id = private.sale_ad_id(s.utm_campaign, s.utm_content)
     where s.sales_funnel_id = w.sales_funnel_id
       and s.data_venda >= (p_day::timestamp at time zone 'America/Sao_Paulo')
       and s.data_venda < ((p_day + 1)::timestamp at time zone 'America/Sao_Paulo');
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
$$;

drop function public.get_client_daily(uuid, date, date);
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
  vendas_apos_dados bigint,
  receita_ascensao_liquida numeric,
  spend_compra_com_imposto numeric,
  spend_lead_com_imposto numeric,
  spend_sem_frente_com_imposto numeric,
  vendas_sem_projeto bigint
)
language sql stable set search_path = ''
as $$
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
  days as (
    select coalesce(sp.data, sa.data) as day, sp.spend, sp.leads, sp.spend_compra, sp.spend_lead, sp.spend_sem_frente,
      sa.vendas, sa.vendas_anuncio, sa.receita_liquida, sa.vendas_apos_dados, sa.receita_ascensao_liquida, sa.vendas_sem_projeto
    from spend sp
    full join sales_by_day sa on sa.data = sp.data
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
    coalesce(d.receita_liquida, 0),
    case when d.day = (select data from today) then (select dados_ate from today) end,
    coalesce(d.vendas_apos_dados, 0)::bigint,
    coalesce(d.receita_ascensao_liquida, 0),
    coalesce(d.spend_compra, 0) * d.tax,
    coalesce(d.spend_lead, 0) * d.tax,
    coalesce(d.spend_sem_frente, 0) * d.tax,
    coalesce(d.vendas_sem_projeto, 0)::bigint
  from taxed d
  order by 1
$$;
revoke all on function public.get_client_daily(uuid, date, date) from public, anon;
grant execute on function public.get_client_daily(uuid, date, date) to authenticated, service_role;
