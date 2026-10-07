-- Metas e alvos follow the campaign rules, like the Análises.
--
-- A watcher belongs to a project and, optionally, to one of its fronts; the campaigns are the ones
-- the Regras de campanha give them. The name slice of 0065 was a second way to pick campaigns,
-- parallel to the rules, and it confused more than it helped: a slice is now a front. No
-- watcher in production used it.

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

  if w.metric in ('cpa_geral', 'cpa_anuncio') then
    select fdy.vendas, fdy.vendas_anuncio into v_vendas, v_vendas_anuncio
      from public.get_funnel_daily(w.sales_funnel_id, p_day, p_day + 1) fdy;
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

alter table watchers drop constraint watchers_cpa_is_project_wide;
alter table watchers drop column name_filter;
alter table watchers add constraint watchers_cpa_is_project_wide
  check (front_id is null or metric not in ('cpa_geral', 'cpa_anuncio'));
