-- Central de Tráfego, Fase 3: targets that watch themselves.
--
-- A watcher is one metric of one project (or one front of it) with the target the gestor accepts,
-- how far off is "atenção" and how far is "crítico", and the spend below which the day is too thin
-- to judge. Every sync evaluates the last CLOSED São Paulo day -- today is partial and would cry
-- wolf -- and keeps one open alert per watcher: opened when the number leaves the band, updated
-- while it stays out, closed on its own when it comes back.

create table watchers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  sales_funnel_id uuid not null references sales_funnels(id) on delete cascade,
  front_id uuid references project_fronts(id) on delete cascade,
  metric text not null check (metric in ('cpa_geral', 'cpa_anuncio', 'cpl', 'cpm', 'ctr', 'connect_rate', 'investimento')),
  target numeric not null check (target > 0),
  warn_pct numeric not null default 20 check (warn_pct >= 0),
  crit_pct numeric not null default 40 check (crit_pct >= warn_pct),
  min_spend numeric not null default 0 check (min_spend >= 0),
  is_active boolean not null default true,
  last_day date,
  last_value numeric,
  last_status text check (last_status in ('ok', 'warn', 'crit', 'sem_volume', 'sem_dado')),
  evaluated_at timestamptz,
  created_at timestamptz not null default now(),
  -- A CPA needs sales, and sales belong to the project, not to a front.
  constraint watchers_cpa_is_project_wide check (front_id is null or metric not in ('cpa_geral', 'cpa_anuncio'))
);
create index watchers_client_idx on watchers (client_id);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  watcher_id uuid not null references watchers(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  severity text not null check (severity in ('warn', 'crit')),
  value numeric not null,
  day date not null,
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index alerts_one_open_per_watcher on alerts (watcher_id) where closed_at is null;
create index alerts_client_opened_idx on alerts (client_id, opened_at desc);

-- The project and front must belong to the watcher's client.
create function private.check_watcher() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.sales_funnels sf where sf.id = new.sales_funnel_id and sf.client_id = new.client_id)
     or (new.front_id is not null and not exists (
       select 1 from public.project_fronts f where f.id = new.front_id and f.sales_funnel_id = new.sales_funnel_id)) then
    raise exception 'watcher project or front does not belong to client %', new.client_id using errcode = '23514';
  end if;
  return new;
end
$$;
create trigger watchers_check before insert or update on watchers
  for each row execute function private.check_watcher();

alter table watchers enable row level security;
alter table alerts enable row level security;
create policy watchers_read on watchers for select to authenticated
  using (client_id in (select private.accessible_client_ids('cliente')));
create policy watchers_write on watchers for all to authenticated
  using (client_id in (select private.accessible_client_ids('gestor')))
  with check (client_id in (select private.accessible_client_ids('gestor')));
create policy alerts_read on alerts for select to authenticated
  using (client_id in (select private.accessible_client_ids('cliente')));
grant select, insert, update, delete on watchers to authenticated, service_role;
grant select on alerts to authenticated;
grant select, insert, update, delete on alerts to service_role;
revoke all on watchers, alerts from anon;

-- Lower is better for costs; higher is better for rates and for the investment pace.
create function public.watcher_metric_direction(p_metric text) returns text
language sql immutable set search_path = ''
as $$ select case when p_metric in ('ctr', 'connect_rate', 'investimento') then 'cai' else 'sobe' end $$;

create function public.evaluate_watchers(p_client_id uuid)
returns integer
language plpgsql volatile set search_path = ''
as $$
declare
  w record;
  v_day date := (now() at time zone 'America/Sao_Paulo')::date - 1;
  v_tax numeric;
  v_spend numeric;
  v_impr numeric;
  v_clicks numeric;
  v_lpv numeric;
  v_leads numeric;
  v_vendas numeric;
  v_vendas_anuncio numeric;
  v_value numeric;
  v_status text;
  v_off numeric;
  v_count integer := 0;
begin
  select coalesce((select t.factor from public.client_tax_rates t
                   where t.client_id = p_client_id and t.valid_from <= v_day
                   order by t.valid_from desc limit 1), 1)
    into v_tax;

  for w in select * from public.watchers where client_id = p_client_id and is_active loop
    select coalesce(sum(fd.spend), 0) * v_tax, coalesce(sum(fd.impressions), 0), coalesce(sum(fd.link_clicks), 0),
           coalesce(sum(fd.landing_page_views), 0), coalesce(sum(fd.leads), 0)
      into v_spend, v_impr, v_clicks, v_lpv, v_leads
      from public.get_project_front_daily(w.sales_funnel_id, v_day, v_day + 1) fd
     where w.front_id is null or fd.front_id = w.front_id;

    v_vendas := null;
    if w.metric in ('cpa_geral', 'cpa_anuncio') then
      select fdy.vendas, fdy.vendas_anuncio into v_vendas, v_vendas_anuncio
        from public.get_funnel_daily(w.sales_funnel_id, v_day, v_day + 1) fdy;
    end if;

    v_value := case w.metric
      when 'investimento' then v_spend
      when 'cpl' then v_spend / nullif(v_leads, 0)
      when 'cpm' then v_spend / nullif(v_impr, 0) * 1000
      when 'ctr' then v_clicks / nullif(v_impr, 0) * 100
      when 'connect_rate' then v_lpv / nullif(v_clicks, 0) * 100
      when 'cpa_geral' then v_spend / nullif(v_vendas, 0)
      when 'cpa_anuncio' then v_spend / nullif(v_vendas_anuncio, 0)
    end;

    if v_spend < w.min_spend then
      v_status := 'sem_volume';
    elsif v_value is null then
      v_status := 'sem_dado';
    else
      -- How far off the target, in %, in the direction that is bad for this metric.
      v_off := case public.watcher_metric_direction(w.metric)
        when 'sobe' then (v_value / w.target - 1) * 100
        else (1 - v_value / w.target) * 100
      end;
      v_status := case when v_off > w.crit_pct then 'crit' when v_off > w.warn_pct then 'warn' else 'ok' end;
    end if;

    update public.watchers
       set last_day = v_day, last_value = v_value, last_status = v_status, evaluated_at = now()
     where id = w.id;

    if v_status in ('warn', 'crit') then
      update public.alerts set severity = v_status, value = v_value, day = v_day, updated_at = now()
       where watcher_id = w.id and closed_at is null;
      if not found then
        insert into public.alerts (watcher_id, client_id, severity, value, day) values (w.id, p_client_id, v_status, v_value, v_day);
      end if;
    elsif v_status = 'ok' then
      update public.alerts set closed_at = now(), updated_at = now() where watcher_id = w.id and closed_at is null;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;
revoke all on function public.evaluate_watchers(uuid) from public, anon, authenticated;
grant execute on function public.evaluate_watchers(uuid) to service_role;
