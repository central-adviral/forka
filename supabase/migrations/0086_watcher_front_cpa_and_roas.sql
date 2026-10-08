-- Metas: CPA de anúncio per front, and ROAS (Vitor, 2026-10-08). No data changes.
--
-- A front had only media metrics because its sales were the project's. A sale whose UTM names an
-- ad is tied to that ad's campaign, the same reading 0073 uses to pick its project, so the sales
-- of a front are the project's sales whose ad belongs to a campaign the front counts (owner or
-- mirror, get_client_campaigns). CPA de anúncio now works per front; CPA geral stays project-wide.
-- ROAS = net revenue (without ascensão, as the project page) ÷ spend with tax, project-wide or of
-- the front's sales.

alter table watchers drop constraint watchers_metric_check;
alter table watchers add constraint watchers_metric_check
  check (metric in ('cpa_geral', 'cpa_anuncio', 'cpl', 'cpm', 'ctr', 'connect_rate', 'investimento', 'frequencia', 'roas'));
alter table watchers drop constraint watchers_cpa_is_project_wide;
alter table watchers add constraint watchers_cpa_is_project_wide
  check (front_id is null or metric <> 'cpa_geral');

create or replace function public.watcher_metric_direction(p_metric text) returns text
language sql immutable set search_path = ''
as $$ select case when p_metric in ('ctr', 'connect_rate', 'investimento', 'roas') then 'cai' else 'sobe' end $$;

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
         coalesce(sum(fd.landing_page_views), 0), coalesce(sum(fd.leads), 0), coalesce(sum(fd.reach), 0)
    into v_spend, v_impr, v_clicks, v_lpv, v_leads, v_reach
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
