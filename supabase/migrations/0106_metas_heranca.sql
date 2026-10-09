-- Metas que valem de cima para baixo (Vitor, 2026-10-08). Funil -> Etapa -> Frente -> vigias e testes.
-- The numbers are typed by the gestor; the Central never invents one. Each level follows the one
-- above unless it has a value of its own ("específica"):
--
-- * A watcher's target null follows its level: a front watcher the front's own meta (else its
--   stage's), a stage watcher the stage meta, a funnel watcher (the plan ones of "Resultado e meta"
--   included) the meta of the funnel's first stage of the metric's measure. Only cost metrics a
--   stage carries can follow (CPA, ROAS, CPL, CPM, custo por visita); the rest are always específica.
--   With nothing to follow the watcher is "sem_meta" and judges nothing.
-- * The band (atenção / crítico) lives on the funnel; a watcher's null band follows it.
-- * watchers.stage_id: a watcher of one stage reads only that stage's campaigns and sales (the same
--   numbers the stage card shows).
-- * A test's teto follows its stage's meta in the stage's measure (CPL, CPA, ROAS when the compra
--   stage has only a ROAS meta, CPM, custo por visita). The funnel's Critérios de decisão may
--   override it (test_rules.teto; absent follows the stage) and a test may have its own (teto).
--   A test keeps the teto it started with (teto_inicial, teto_medida) until "usar a meta nova".
--
-- Backfill: nothing judged today moves. Funnel bands come from the plan watcher; explicit watcher
-- targets and bands become "segue" only where they equal what they would inherit. Running tests
-- snapshot the teto the Quadro judges them with today; a compra funnel whose teto the plan CPA
-- replaced follows the stage from now on, every other funnel keeps its stored teto as override.

-- 1. Columns --------------------------------------------------------------------------------------

alter table public.sales_funnels
  add column warn_pct numeric not null default 20 check (warn_pct >= 0),
  add column crit_pct numeric not null default 40,
  add constraint sales_funnels_band_order check (crit_pct >= warn_pct),
  alter column test_rules set default '{"min": 10, "sat": 10, "conf": 95, "mult": 1.5, "minVisits": 500}'::jsonb;

alter table public.watchers
  add column stage_id uuid,
  add constraint watchers_stage_fkey foreign key (stage_id, sales_funnel_id)
    references public.funnel_stages (id, sales_funnel_id) on delete set null (stage_id),
  add constraint watchers_one_scope check (front_id is null or stage_id is null),
  add constraint watchers_stage_no_ad_cpa check (stage_id is null or metric <> 'cpa_anuncio'),
  add constraint watchers_band_pair check ((warn_pct is null) = (crit_pct is null)),
  alter column target drop not null,
  alter column warn_pct drop not null,
  alter column warn_pct drop default,
  alter column crit_pct drop not null,
  alter column crit_pct drop default,
  drop constraint watchers_last_status_check,
  add constraint watchers_last_status_check check (last_status in ('ok', 'warn', 'crit', 'sem_volume', 'sem_dado', 'sem_meta'));
create index watchers_stage_idx on public.watchers (stage_id) where stage_id is not null;

alter table public.backlog_items
  add column teto numeric check (teto > 0),
  add column teto_inicial numeric check (teto_inicial > 0),
  add column teto_medida text check (teto_medida in ('cpa', 'cpl', 'roas', 'cpm', 'custo_visita'));

-- 2. Watchers: what a target follows ---------------------------------------------------------------

-- The stage measure a watcher metric is the cost of. ROAS is the compra stage's second meta.
create or replace function private.watcher_metric_measure(p_metric text) returns text
language sql immutable set search_path = ''
as $$
  select case
    when p_metric in ('cpa_geral', 'cpa_anuncio', 'roas') then 'compra'
    when p_metric = 'cpl' then 'lead'
    when p_metric = 'cpm' then 'alcance'
    when p_metric = 'custo_visita' then 'visita'
  end
$$;

create or replace function private.stage_meta_for(p_stage_id uuid, p_metric text) returns numeric
language sql stable set search_path = ''
as $$
  select case when p_metric = 'roas' then st.meta_roas else st.meta end
  from public.funnel_stages st
  where st.id = p_stage_id and st.measure = private.watcher_metric_measure(p_metric)
$$;

-- The stage a funnel's result of a measure lives in: the first open one, as sales are placed (0105).
create or replace function private.result_stage_id(p_sales_funnel_id uuid, p_measure text) returns uuid
language sql stable set search_path = ''
as $$
  select st.id from public.funnel_stages st
  where st.sales_funnel_id = p_sales_funnel_id and st.measure = p_measure
  order by st.archived_at is not null, st.position, st.created_at
  limit 1
$$;

-- What a watcher without a target of its own judges against, and where it comes from: 'frente'
-- (the front's own meta for that metric) or 'etapa' (the stage's, with the stage). No row value
-- when nothing above has one.
create or replace function private.watcher_inherited(p_sales_funnel_id uuid, p_front_id uuid, p_stage_id uuid, p_metric text)
returns table(value numeric, source text, stage_id uuid)
language sql stable set search_path = ''
as $$
  with front as (
    select f.stage_id,
      case
        when p_metric = public.result_watcher_metric(f.metrica_principal, true) then f.alvo_principal
        when p_metric = public.result_watcher_metric(f.metrica_secundaria, true) then f.alvo_secundaria
      end as alvo
    from public.project_fronts f where f.id = p_front_id
  ),
  level as (
    select (select fr.alvo from front fr) as alvo,
      case
        when p_front_id is not null then (select fr.stage_id from front fr)
        when p_stage_id is not null then p_stage_id
        else private.result_stage_id(p_sales_funnel_id, private.watcher_metric_measure(p_metric))
      end as stage_id
  )
  select coalesce(l.alvo, private.stage_meta_for(l.stage_id, p_metric)),
    case when l.alvo is not null then 'frente' when private.stage_meta_for(l.stage_id, p_metric) is not null then 'etapa' end,
    case when l.alvo is null then l.stage_id end
  from level l
$$;

-- PostgREST computed fields: select('effective_target, target_source, ...') on watchers.
create or replace function public.effective_target(w public.watchers) returns numeric
language sql stable set search_path = ''
as $$
  select coalesce(w.target, (select i.value from private.watcher_inherited(w.sales_funnel_id, w.front_id, w.stage_id, w.metric) i))
$$;

-- 'especifica', 'frente' or 'etapa'; null when the watcher has no target to judge against.
create or replace function public.target_source(w public.watchers) returns text
language sql stable set search_path = ''
as $$
  select case when w.target is not null then 'especifica'
    else (select i.source from private.watcher_inherited(w.sales_funnel_id, w.front_id, w.stage_id, w.metric) i) end
$$;

-- The stage whose meta a following watcher uses (null for a specific one or one following a front).
create or replace function public.target_stage_id(w public.watchers) returns uuid
language sql stable set search_path = ''
as $$
  select case when w.target is null then
    (select i.stage_id from private.watcher_inherited(w.sales_funnel_id, w.front_id, w.stage_id, w.metric) i where i.source = 'etapa') end
$$;

create or replace function public.effective_warn_pct(w public.watchers) returns numeric
language sql stable set search_path = ''
as $$ select coalesce(w.warn_pct, (select sf.warn_pct from public.sales_funnels sf where sf.id = w.sales_funnel_id)) $$;

create or replace function public.effective_crit_pct(w public.watchers) returns numeric
language sql stable set search_path = ''
as $$ select coalesce(w.crit_pct, (select sf.crit_pct from public.sales_funnels sf where sf.id = w.sales_funnel_id)) $$;

revoke all on function public.effective_target(public.watchers) from public, anon;
revoke all on function public.target_source(public.watchers) from public, anon;
revoke all on function public.target_stage_id(public.watchers) from public, anon;
revoke all on function public.effective_warn_pct(public.watchers) from public, anon;
revoke all on function public.effective_crit_pct(public.watchers) from public, anon;
grant execute on function public.effective_target(public.watchers) to authenticated, service_role;
grant execute on function public.target_source(public.watchers) to authenticated, service_role;
grant execute on function public.target_stage_id(public.watchers) to authenticated, service_role;
grant execute on function public.effective_warn_pct(public.watchers) to authenticated, service_role;
grant execute on function public.effective_crit_pct(public.watchers) to authenticated, service_role;

-- The plan target (0105) is the plan watcher's effective target: its own, else the result stage's.
create or replace function private.plan_target(p_sales_funnel_id uuid, p_metric text) returns numeric
language sql stable set search_path = ''
as $$
  select public.effective_target(w) from public.watchers w
  where w.sales_funnel_id = p_sales_funnel_id and w.front_id is null and w.plan_role is not null
    and w.metric = public.result_watcher_metric(p_metric, false)
  order by w.plan_role = 'principal' desc
  limit 1
$$;

-- 3. Watchers: the evaluation ---------------------------------------------------------------------

-- Redefined from the 0104 definition: the target and band are the effective ones, a stage watcher
-- reads only its stage (spend of its fronts inside its window, sales the stage counts, as
-- get_funnel_stage_daily), and a watcher with no target is sem_meta.
create or replace function public.watcher_day(p_watcher_id uuid, p_day date)
 returns table(spend numeric, value numeric, status text)
 language plpgsql
 stable
 set search_path to ''
as $function$
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
  v_target numeric;
  v_warn numeric;
  v_crit numeric;
  v_stage public.funnel_stages;
  v_stage_fronts uuid[];
begin
  select * into w from public.watchers where id = p_watcher_id;
  if not found then
    return;
  end if;
  v_target := public.effective_target(w);
  v_warn := public.effective_warn_pct(w);
  v_crit := public.effective_crit_pct(w);

  if w.stage_id is not null then
    select * into v_stage from public.funnel_stages st where st.id = w.stage_id;
    -- Outside the stage's window the stage spends and sells nothing.
    v_stage_fronts := case
      when (v_stage.janela_inicio is null or p_day >= v_stage.janela_inicio) and (v_stage.janela_fim is null or p_day <= v_stage.janela_fim)
      then array(select f.id from public.project_fronts f where f.stage_id = w.stage_id)
      else '{}'::uuid[] end;
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
   where case
     when w.front_id is not null then fd.front_id = w.front_id
     when w.stage_id is not null then fd.front_id = any (v_stage_fronts)
     else true
   end;

  if w.stage_id is not null and w.metric in ('cpa_geral', 'roas') then
    -- The stage's sales of the day, as get_funnel_stage_daily counts them.
    select count(*) filter (where p.papel in ('entrada', 'ascensao') and p.sold),
           coalesce(sum(p.valor_liquido) filter (where p.sold), 0) - coalesce(sum(p.valor_liquido) filter (where p.refunded), 0)
      into v_vendas, v_receita
      from (
        select s.papel, s.valor_liquido,
          s.data_venda >= (p_day::timestamp at time zone 'America/Sao_Paulo')
            and s.data_venda < ((p_day + 1)::timestamp at time zone 'America/Sao_Paulo')
            and not private.sale_after_meta_pull(w.client_id, s.data_venda) as sold,
          coalesce(s.reembolsado_em >= (p_day::timestamp at time zone 'America/Sao_Paulo')
            and s.reembolsado_em < ((p_day + 1)::timestamp at time zone 'America/Sao_Paulo'), false) as refunded
        from private.funnel_stage_sales(w.sales_funnel_id, p_day, p_day + 1) s
        where s.stage_id = w.stage_id and cardinality(v_stage_fronts) > 0
      ) p;
  elsif w.metric in ('cpa_geral', 'cpa_anuncio', 'roas') and w.front_id is null then
    select fdy.vendas, fdy.vendas_anuncio, fdy.receita_liquida into v_vendas, v_vendas_anuncio, v_receita
      from public.get_funnel_daily(w.sales_funnel_id, p_day, p_day + 1) fdy;
  elsif w.metric in ('cpa_anuncio', 'roas') then
    -- The front's sales: the project's sales of the day whose campaign the front counts.
    -- The 60 days only bound which campaigns are read.
    with front_campaigns as (
      select c.campaign_id
      from public.get_client_campaigns(w.client_id, p_day - 60, p_day + 1) c
      where w.front_id = any (c.front_ids)
    )
    select count(*) filter (where s.papel = 'entrada'),
           coalesce(sum(s.valor_liquido) filter (where s.papel <> 'ascensao'), 0)
      into v_vendas_anuncio, v_receita
      from public.sales s
      join front_campaigns fc on fc.campaign_id = s.campanha_id
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
  elsif v_target is null then
    status := 'sem_meta';
  else
    -- How far off the target, in %, in the direction that is bad for this metric.
    v_off := case public.watcher_metric_direction(w.metric)
      when 'sobe' then (v_value / v_target - 1) * 100
      else (1 - v_value / v_target) * 100
    end;
    status := case when v_off > v_crit then 'crit' when v_off > v_warn then 'warn' else 'ok' end;
  end if;
  spend := v_spend;
  value := v_value;
  return next;
end
$function$;

-- watcher_day runs on the caller (the evaluation's service role, the Alertas trail's user); the sales
-- it reads stay under the caller's RLS.
grant execute on function private.funnel_stage_sales(uuid, date, date) to authenticated, service_role;

-- Redefined from the 0104 definition: a watcher of an archived stage is not evaluated either, and a
-- watcher left without a target closes its open alert (nothing to be off from).
create or replace function public.evaluate_watchers(p_client_id uuid)
 returns integer
 language plpgsql
 set search_path to ''
as $function$
declare
  w record;
  r record;
  v_day date := (now() at time zone 'America/Sao_Paulo')::date - 1;
  v_count integer := 0;
begin
  for w in
    select wa.id from public.watchers wa
    join public.sales_funnels sf on sf.id = wa.sales_funnel_id
    left join public.project_fronts pf on pf.id = wa.front_id
    left join public.funnel_stages st on st.id = wa.stage_id
    where wa.client_id = p_client_id and wa.is_active and sf.archived_at is null and pf.archived_at is null
      and st.archived_at is null and sf.status = 'rodando'
  loop
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
    elsif r.status in ('ok', 'sem_meta') then
      update public.alerts set closed_at = now(), updated_at = now() where watcher_id = w.id and closed_at is null;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$function$;

-- 4. Tests: the teto ------------------------------------------------------------------------------

-- The Critérios de decisão teto as the app reads it (readRules): a number from 1 to 100000, else none.
create or replace function private.rules_teto(p_rules jsonb) returns numeric
language sql immutable set search_path = ''
as $$
  select case when x.v between 1 and 100000 then x.v end
  from (select case
    when jsonb_typeof(p_rules -> 'teto') = 'number' then (p_rules ->> 'teto')::numeric
    when jsonb_typeof(p_rules -> 'teto') = 'string' and btrim(p_rules ->> 'teto') ~ '^[0-9]+(\.[0-9]+)?$' then btrim(p_rules ->> 'teto')::numeric
  end as v) x
$$;

-- The teto a test is judged with now, where it comes from and in which cost. The stage is the
-- test's, else the funnel result's. A compra stage judges by CPA; by ROAS only when the value comes
-- from a stage that has a ROAS meta and no CPA meta. Ascensão has no creative cost: no medida.
create or replace function private.test_teto(p_item public.backlog_items)
returns table(value numeric, source text, medida text)
language sql stable set search_path = ''
as $$
  with funnel as (
    select sf.resultado, private.rules_teto(sf.test_rules) as override
    from public.sales_funnels sf where sf.id = p_item.sales_funnel_id
  ),
  stage as (
    select st.measure, st.meta, st.meta_roas
    from funnel f
    join public.funnel_stages st
      on st.id = coalesce(p_item.funnel_stage_id, private.result_stage_id(p_item.sales_funnel_id, private.stage_measure_of(f.resultado)))
  ),
  base as (
    select f.override, s.meta, s.meta_roas, coalesce(s.measure, private.stage_measure_of(f.resultado)) as measure
    from funnel f left join stage s on true
  )
  select
    case
      when p_item.teto is not null then p_item.teto
      when b.override is not null then b.override
      when b.measure = 'compra' then coalesce(b.meta, b.meta_roas)
      when b.measure <> 'ascensao' then b.meta
    end,
    case
      when p_item.teto is not null then 'especifica'
      when b.override is not null then 'criterios'
      when (b.measure = 'compra' and coalesce(b.meta, b.meta_roas) is not null) or (b.measure <> 'ascensao' and b.meta is not null) then 'etapa'
    end,
    case
      when b.measure = 'compra' and p_item.teto is null and b.override is null and b.meta is null and b.meta_roas is not null then 'roas'
      else case b.measure when 'compra' then 'cpa' when 'lead' then 'cpl' when 'alcance' then 'cpm' when 'visita' then 'custo_visita' end
    end
  from base b
$$;

create or replace function public.effective_teto(b public.backlog_items) returns numeric
language sql stable set search_path = ''
as $$ select t.value from private.test_teto(b) t $$;

-- 'especifica', 'criterios' or 'etapa'; null when nothing gives the test a teto.
create or replace function public.effective_teto_source(b public.backlog_items) returns text
language sql stable set search_path = ''
as $$ select t.source from private.test_teto(b) t $$;

create or replace function public.effective_teto_medida(b public.backlog_items) returns text
language sql stable set search_path = ''
as $$ select t.medida from private.test_teto(b) t $$;

revoke all on function public.effective_teto(public.backlog_items) from public, anon;
revoke all on function public.effective_teto_source(public.backlog_items) from public, anon;
revoke all on function public.effective_teto_medida(public.backlog_items) from public, anon;
grant execute on function public.effective_teto(public.backlog_items) to authenticated, service_role;
grant execute on function public.effective_teto_source(public.backlog_items) to authenticated, service_role;
grant execute on function public.effective_teto_medida(public.backlog_items) to authenticated, service_role;

-- "Usar a meta nova": the running test takes the teto it would get today. Runs on the user's
-- session, so only a gestor or owner changes a row; false when nothing changed.
create or replace function public.use_current_teto(p_item_id uuid) returns boolean
language plpgsql set search_path = ''
as $$
begin
  update public.backlog_items b
     set (teto_inicial, teto_medida) = (select t.value, t.medida from private.test_teto(b) t)
   where b.id = p_item_id and b.status = 'running';
  return found;
end
$$;
revoke all on function public.use_current_teto(uuid) from public, anon;
grant execute on function public.use_current_teto(uuid) to authenticated, service_role;

-- 5. Making existing values follow ------------------------------------------------------------------

-- A target or band that equals what it would inherit becomes "segue"; nothing judged changes.
-- Front plan watchers are left alone: the front's own meta lives on the front and 0102 copies it.
create or replace function private.normalize_targets(p_sales_funnel_id uuid) returns void
language plpgsql set search_path = ''
as $$
begin
  update public.watchers w set target = null
   where w.sales_funnel_id = p_sales_funnel_id and w.target is not null
     and not (w.front_id is not null and w.plan_role is not null)
     and w.target = (select i.value from private.watcher_inherited(w.sales_funnel_id, w.front_id, w.stage_id, w.metric) i);
  update public.watchers w set warn_pct = null, crit_pct = null
    from public.sales_funnels sf
   where sf.id = w.sales_funnel_id and w.sales_funnel_id = p_sales_funnel_id
     and w.warn_pct = sf.warn_pct and w.crit_pct = sf.crit_pct;
end
$$;

-- The new-funnel wizard writes the plan watchers before the stages exist; once they do, the plan
-- follows them.
create or replace function public.normalize_funnel_targets(p_sales_funnel_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.sales_funnels sf where sf.id = p_sales_funnel_id and private.has_client_role(sf.client_id, 'gestor')) then
    raise exception 'not found or access denied' using errcode = '42501';
  end if;
  perform private.normalize_targets(p_sales_funnel_id);
end
$$;
revoke all on function public.normalize_funnel_targets(uuid) from public, anon;
grant execute on function public.normalize_funnel_targets(uuid) to authenticated, service_role;

-- 6. Backfill -------------------------------------------------------------------------------------

-- The funnel band is the plan watcher's.
update public.sales_funnels sf set warn_pct = w.warn_pct, crit_pct = w.crit_pct
  from public.watchers w
 where w.sales_funnel_id = sf.id and w.front_id is null and w.plan_role = 'principal';

-- The teto the Quadro judges each running test with today: in a compra funnel with exactly one
-- funnel CPA geral watcher, its target (withPlanTeto); otherwise the stored teto or the default 55.
-- A lead funnel reads paid leads in the purchases' place, so its tests are judged by CPL.
with plan as (
  select sf.id,
    case when sf.resultado = 'compra' and (select count(*) from public.watchers w where w.sales_funnel_id = sf.id and w.front_id is null and w.metric = 'cpa_geral') = 1
      then (select w.target from public.watchers w where w.sales_funnel_id = sf.id and w.front_id is null and w.metric = 'cpa_geral') end as plan_teto,
    coalesce(private.rules_teto(sf.test_rules), 55) as stored_teto,
    sf.resultado
  from public.sales_funnels sf
)
update public.backlog_items b
   set teto_inicial = coalesce(p.plan_teto, p.stored_teto),
       teto_medida = case when p.resultado = 'lead' then 'cpl' else 'cpa' end
  from plan p
 where p.id = b.sales_funnel_id and b.status = 'running';

-- Where the plan CPA replaced the stored teto, the teto now follows the stage. Everywhere else the
-- number the Quadro used (the stored one, or the default 55) stays as the Critérios override.
update public.sales_funnels sf
   set test_rules = case
     when sf.resultado = 'compra' and (select count(*) from public.watchers w where w.sales_funnel_id = sf.id and w.front_id is null and w.metric = 'cpa_geral') = 1
       then sf.test_rules - 'teto'
     else sf.test_rules || jsonb_build_object('teto', coalesce(private.rules_teto(sf.test_rules), 55))
   end;

select private.normalize_targets(sf.id) from public.sales_funnels sf;

-- 7. A test keeps the teto it started with --------------------------------------------------------

-- Entering Rodando snapshots the teto; so do a teto of its own or a stage change while it runs
-- (both are about this test). A change of the stage meta or of the Critérios does not.
create or replace function private.snapshot_test_teto() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.status = 'running' and (tg_op = 'INSERT' or old.status is distinct from 'running'
     or new.teto is distinct from old.teto or new.funnel_stage_id is distinct from old.funnel_stage_id) then
    select t.value, t.medida into new.teto_inicial, new.teto_medida from private.test_teto(new) t;
  end if;
  return new;
end
$$;
create trigger backlog_items_teto before insert or update of status, teto, funnel_stage_id on public.backlog_items
  for each row execute function private.snapshot_test_teto();
