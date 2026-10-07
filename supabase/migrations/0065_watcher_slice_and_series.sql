-- Central de Tráfego: watchers on a slice of campaigns, frequency, and a 14-day trail.
--
-- * name_filter narrows a watcher to the client's campaigns whose name contains a text ("Escala",
--   "[RMK]"), so the scale structure and the remarketing get separate alerts. Like a front, a
--   slice has no sales of its own, so the CPA metrics stay project-wide.
-- * frequencia = impressions ÷ reach. Reach is summed over campaigns and days, so a person reached
--   by two campaigns counts twice and the number is a floor of the real frequency; good enough to
--   see an audience saturate.
-- * watcher_day computes one watcher on one day. evaluate_watchers and the Painel's 14-day chart
--   both use it, so the alert and the chart can never disagree.

alter table watchers add column name_filter text check (name_filter is null or btrim(name_filter) <> '');
alter table watchers drop constraint watchers_metric_check;
alter table watchers add constraint watchers_metric_check
  check (metric in ('cpa_geral', 'cpa_anuncio', 'cpl', 'cpm', 'ctr', 'connect_rate', 'investimento', 'frequencia'));
alter table watchers drop constraint watchers_cpa_is_project_wide;
alter table watchers add constraint watchers_cpa_is_project_wide
  check ((front_id is null and name_filter is null) or metric not in ('cpa_geral', 'cpa_anuncio'));

create function public.watcher_day(p_watcher_id uuid, p_day date)
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

  if w.name_filter is not null then
    select coalesce(sum(cd.spend), 0) * v_tax, coalesce(sum(cd.impressions), 0), coalesce(sum(cd.link_clicks), 0),
           coalesce(sum(cd.landing_page_views), 0), coalesce(sum(cd.leads), 0), coalesce(sum(cd.reach), 0)
      into v_spend, v_impr, v_clicks, v_lpv, v_leads, v_reach
      from public.campaign_daily cd
     where cd.client_id = w.client_id and cd.data = p_day
       and lower(normalize(cd.campaign_name, NFC)) like '%' || lower(normalize(w.name_filter, NFC)) || '%';
  else
    select coalesce(sum(fd.spend), 0) * v_tax, coalesce(sum(fd.impressions), 0), coalesce(sum(fd.link_clicks), 0),
           coalesce(sum(fd.landing_page_views), 0), coalesce(sum(fd.leads), 0), coalesce(sum(fd.reach), 0)
      into v_spend, v_impr, v_clicks, v_lpv, v_leads, v_reach
      from public.get_project_front_daily(w.sales_funnel_id, p_day, p_day + 1) fd
     where w.front_id is null or fd.front_id = w.front_id;
  end if;

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

-- The last closed days of one watcher, for the Painel's chart.
create function public.watcher_series(p_watcher_id uuid, p_days integer)
returns table (day date, spend numeric, value numeric, status text)
language sql stable set search_path = ''
as $$
  select d.day::date, wd.spend, wd.value, wd.status
  from generate_series(
    (now() at time zone 'America/Sao_Paulo')::date - p_days,
    (now() at time zone 'America/Sao_Paulo')::date - 1,
    interval '1 day'
  ) as d(day)
  cross join lateral public.watcher_day(p_watcher_id, d.day::date) wd
  order by 1
$$;
revoke all on function public.watcher_day(uuid, date), public.watcher_series(uuid, integer) from public, anon;
grant execute on function public.watcher_day(uuid, date), public.watcher_series(uuid, integer) to authenticated, service_role;

create or replace function public.evaluate_watchers(p_client_id uuid)
returns integer
language plpgsql volatile set search_path = ''
as $$
declare
  w record;
  r record;
  v_day date := (now() at time zone 'America/Sao_Paulo')::date - 1;
  v_count integer := 0;
begin
  for w in select id from public.watchers where client_id = p_client_id and is_active loop
    select * into r from public.watcher_day(w.id, v_day);

    update public.watchers
       set last_day = v_day, last_value = r.value, last_status = r.status, evaluated_at = now()
     where id = w.id;

    if r.status in ('warn', 'crit') then
      update public.alerts set severity = r.status, value = r.value, day = v_day, updated_at = now()
       where watcher_id = w.id and closed_at is null;
      if not found then
        insert into public.alerts (watcher_id, client_id, severity, value, day) values (w.id, p_client_id, r.status, r.value, v_day);
      end if;
    elsif r.status = 'ok' then
      update public.alerts set closed_at = now(), updated_at = now() where watcher_id = w.id and closed_at is null;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;
