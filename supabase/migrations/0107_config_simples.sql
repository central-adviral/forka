-- Configuração do funil simplificada (Vitor, 2026-10-09). Additive: no number shown today moves.
--
-- * sales_funnels.tag ("etiqueta do funil"): one more "contém" every own front of the funnel needs on
--   the campaign name, next to the stage tag and the front's rules, so two funnels of a client with the
--   same front tags do not dispute a campaign. Unique per client among open funnels, case ignored
--   (private.normalized_tag). Mirrors never match by name, so the tag never touches them.
--   A tag change freezes the client's campaign owners first, as a stage tag change does (0105).
-- * The funnel's result follows its stages: the last open stage of the sequence (parallel ones and
--   ascensão left out). Whenever a stage is added, removed, moved or changes measure, resultado takes
--   that stage's measure; ROAS and checkout stay while the result stage is compra (they live in it).
--   The change goes through the versioned resultado (0104), so it holds from today on, and the plan
--   watcher of the result moves to the new cost and follows the stage meta. The legacy placements
--   that make a stage from resultado itself (a front written without a stage, backfill_funnel_stages)
--   leave resultado as it is.
--
-- Backfill: tag null on every funnel (nothing changes). resultado is only rewritten on an open funnel
-- whose stages say otherwise; a funnel already consistent is not touched.

-- 1. Etiqueta do funil -----------------------------------------------------------------------------

alter table public.sales_funnels
  add column tag text check (tag is null or btrim(tag) <> '');

create unique index sales_funnels_tag_key on public.sales_funnels (client_id, private.normalized_tag(tag))
  where tag is not null and archived_at is null;

create or replace function private.check_funnel_tag_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if private.normalized_tag(new.tag) is distinct from private.normalized_tag(old.tag)
     and exists (select 1 from public.project_fronts f where f.sales_funnel_id = new.id and f.source_sales_funnel_id is null) then
    perform private.freeze_client_owners_once(new.client_id);
  end if;
  return new;
end
$$;
create trigger sales_funnels_tag_change before update of tag on public.sales_funnels
  for each row execute function private.check_funnel_tag_change();

-- An own front takes a campaign when its rules match and the name also contains its stage's tag and
-- its funnel's tag, each when set.
create or replace function public.get_client_campaigns(p_client_id uuid, p_since date, p_until date)
 returns table(campaign_id text, campaign_name text, spend numeric, impressions bigint, link_clicks bigint, leads bigint, first_day date, last_day date, front_ids uuid[], suggested_front_ids uuid[], assignment text)
 language sql
 stable
 set search_path to ''
as $function$
  with campaigns as (
    select
      cd.campaign_id,
      (array_agg(cd.campaign_name order by cd.data desc))[1] as campaign_name,
      sum(cd.spend) as spend,
      sum(cd.impressions)::bigint as impressions,
      sum(cd.link_clicks)::bigint as link_clicks,
      sum(cd.leads)::bigint as leads,
      min(cd.data) as first_day,
      max(cd.data) as last_day
    from public.campaign_daily cd
    where cd.client_id = p_client_id and cd.data >= p_since and cd.data < p_until
    group by cd.campaign_id
    having sum(cd.spend) > 0
  ),
  fronts as (
    select
      f.id,
      private.normalized_tag(st.tag) as stage_tag,
      private.normalized_tag(sf.tag) as funnel_tag,
      array_agg(lower(normalize(r.value, NFC))) filter (where r.kind = 'include') as includes,
      array_agg(lower(normalize(r.value, NFC))) filter (where r.kind = 'exclude') as excludes
    from public.project_fronts f
    join public.sales_funnels sf on sf.id = f.sales_funnel_id
    left join public.funnel_stages st on st.id = f.stage_id
    left join public.naming_rules r on r.front_id = f.id
    where sf.client_id = p_client_id and f.source_sales_funnel_id is null
      and f.archived_at is null and sf.archived_at is null
    group by f.id, st.tag, sf.tag
  ),
  matched as (
    select
      c.*,
      coalesce(
        (select array_agg(f.id order by f.id) from fronts f
         where f.includes is not null
           and (select bool_and(strpos(lower(normalize(c.campaign_name, NFC)), i) > 0) from unnest(f.includes) i)
           and not coalesce((select bool_or(strpos(lower(normalize(c.campaign_name, NFC)), e) > 0) from unnest(f.excludes) e), false)
           and (f.stage_tag is null or strpos(lower(normalize(c.campaign_name, NFC)), f.stage_tag) > 0)
           and (f.funnel_tag is null or strpos(lower(normalize(c.campaign_name, NFC)), f.funnel_tag) > 0)),
        '{}'
      ) as suggested
    from campaigns c
  ),
  resolved as (
    select
      m.*,
      case when cf.front_id is not null then cf.front_id when cardinality(m.suggested) = 1 then m.suggested[1] end as owner_front,
      case when cf.front_id is not null then cf.source when cardinality(m.suggested) = 1 then 'nome' end as assignment
    from matched m
    left join public.campaign_fronts cf on cf.client_id = p_client_id and cf.campaign_id = m.campaign_id
  )
  select
    r.campaign_id, r.campaign_name, r.spend, r.impressions, r.link_clicks, r.leads, r.first_day, r.last_day,
    case when r.owner_front is null then '{}'::uuid[]
      else array[r.owner_front] || coalesce(
        (select array_agg(mirror.id order by mirror.id)
         from public.project_fronts owner_front
         join public.project_fronts mirror on mirror.source_sales_funnel_id = owner_front.sales_funnel_id
         join public.sales_funnels msf on msf.id = mirror.sales_funnel_id
         where owner_front.id = r.owner_front
           and (coalesce(mirror.janela_inicio, msf.starts_on) is null or coalesce(mirror.janela_inicio, msf.starts_on) <= r.last_day)
           and (coalesce(mirror.janela_fim, msf.ends_on) is null or coalesce(mirror.janela_fim, msf.ends_on) >= r.first_day)),
        '{}')
    end,
    r.suggested,
    r.assignment
  from resolved r
  order by r.spend desc
$function$;

-- The rule preview judges with the stage and funnel tags too, so it shows what the rule will take.
create or replace function public.preview_naming_rule(p_front_id uuid, p_kind text, p_value text)
 returns table(campaigns bigint, spend numeric, disputed bigint, kept_by_others bigint)
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_client_id uuid;
  v_value text := lower(normalize(btrim(p_value), NFC));
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select sf.client_id into v_client_id
  from public.project_fronts f join public.sales_funnels sf on sf.id = f.sales_funnel_id
  where f.id = p_front_id and private.has_client_role(sf.client_id, 'gestor');
  if v_client_id is null then
    raise exception 'not found or access denied';
  end if;
  if p_kind not in ('include', 'exclude') or v_value = '' then
    raise exception 'invalid rule';
  end if;

  return query
  with rules as (
    select f.id as front_id,
      private.normalized_tag(st.tag) as stage_tag,
      private.normalized_tag(sf.tag) as funnel_tag,
      array_agg(lower(normalize(r.value, NFC))) filter (where r.kind = 'include')
        || case when f.id = p_front_id and p_kind = 'include' then array[v_value] else '{}'::text[] end as includes,
      array_agg(lower(normalize(r.value, NFC))) filter (where r.kind = 'exclude')
        || case when f.id = p_front_id and p_kind = 'exclude' then array[v_value] else '{}'::text[] end as excludes
    from public.project_fronts f
    join public.sales_funnels sf on sf.id = f.sales_funnel_id
    left join public.funnel_stages st on st.id = f.stage_id
    left join public.naming_rules r on r.front_id = f.id
    where sf.client_id = v_client_id and f.source_sales_funnel_id is null
      and f.archived_at is null and sf.archived_at is null
    group by f.id, st.tag, sf.tag
  ),
  campaigns as (
    select c.campaign_id, c.campaign_name, c.spend, c.front_ids,
      (select array_agg(ru.front_id) from rules ru
       where cardinality(ru.includes) > 0
         and (select bool_and(strpos(lower(normalize(c.campaign_name, NFC)), i) > 0) from unnest(ru.includes) i)
         and not coalesce((select bool_or(strpos(lower(normalize(c.campaign_name, NFC)), e) > 0) from unnest(ru.excludes) e), false)
         and (ru.stage_tag is null or strpos(lower(normalize(c.campaign_name, NFC)), ru.stage_tag) > 0)
         and (ru.funnel_tag is null or strpos(lower(normalize(c.campaign_name, NFC)), ru.funnel_tag) > 0)) as matches
    from public.get_client_campaigns(v_client_id, v_today - 30, v_today + 1) c
  ),
  named as (
    select * from campaigns c where p_front_id = any (coalesce(c.matches, '{}'))
  ),
  taken as (
    select * from named n where cardinality(n.front_ids) = 0
  )
  select
    (select count(*) from taken),
    coalesce((select sum(t.spend) from taken t), 0),
    (select count(*) from taken t where cardinality(t.matches) > 1),
    (select count(*) from named n where cardinality(n.front_ids) > 0 and n.front_ids[1] <> p_front_id);
end;
$function$;

-- 2. Resultado do funil from the stages --------------------------------------------------------------

-- The measure of the funnel's result stage: its last open stage of the sequence that is not ascensão.
-- Null when there is none (no stage yet, only parallel ones or only ascensão).
create or replace function private.result_stage_measure(p_sales_funnel_id uuid) returns text
language sql stable set search_path = ''
as $$
  select st.measure from public.funnel_stages st
  where st.sales_funnel_id = p_sales_funnel_id and not st.parallel and st.archived_at is null and st.measure <> 'ascensao'
  order by st.position desc, st.created_at desc
  limit 1
$$;

-- The resultado a funnel should have: the result stage's measure, keeping ROAS or checkout while that
-- stage is compra, and keeping the current one when no stage can be the result.
create or replace function private.derived_resultado(p_current text, p_measure text) returns text
language sql immutable set search_path = ''
as $$
  select case
    when p_measure is null then p_current
    when p_measure = 'compra' and p_current in ('compra', 'roas', 'checkout') then p_current
    else p_measure
  end
$$;

-- Moves resultado to what the stages say. The history (0104) makes it hold from today; a secondary
-- metric equal to the new result goes away with its watcher; the result watcher takes the new cost,
-- follows the stage meta again and its open alert, about the old cost, closes.
create or replace function private.sync_funnel_resultado(p_sales_funnel_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_current text;
  v_secondary text;
  v_next text;
  v_metric text;
begin
  select sf.resultado, sf.metrica_secundaria into v_current, v_secondary from public.sales_funnels sf where sf.id = p_sales_funnel_id;
  if not found then
    return;
  end if;
  v_next := private.derived_resultado(v_current, private.result_stage_measure(p_sales_funnel_id));
  if v_next = v_current then
    return;
  end if;
  v_metric := public.result_watcher_metric(v_next, false);

  update public.sales_funnels
     set resultado = v_next,
         metrica_secundaria = case when metrica_secundaria = v_next then null else metrica_secundaria end,
         updated_at = now()
   where id = p_sales_funnel_id;
  if v_secondary = v_next then
    delete from public.watchers w where w.sales_funnel_id = p_sales_funnel_id and w.front_id is null and w.plan_role = 'secundaria';
  end if;

  with moved as (
    update public.watchers w
       set metric = v_metric, target = null, last_value = null, last_status = null
     where w.sales_funnel_id = p_sales_funnel_id and w.front_id is null and w.plan_role = 'principal' and w.metric <> v_metric
    returning w.id
  )
  update public.alerts a set closed_at = now(), updated_at = now()
   where a.watcher_id in (select m.id from moved m) and a.closed_at is null;
end
$$;
revoke all on function private.sync_funnel_resultado(uuid) from public, anon, authenticated;

-- Stages written by the legacy paths that place a front by the funnel's resultado (a front written
-- without a stage, backfill_funnel_stages) are made from resultado itself: they set
-- ct.keep_resultado so the funnel keeps the measure they were placed by.
create or replace function private.funnel_stages_sync_resultado() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if current_setting('ct.keep_resultado', true) = 'on' then
    return null;
  end if;
  perform private.sync_funnel_resultado(case when tg_op = 'DELETE' then old.sales_funnel_id else new.sales_funnel_id end);
  return null;
end
$$;
create trigger funnel_stages_resultado after insert or delete or update of position, parallel, measure, archived_at on public.funnel_stages
  for each row execute function private.funnel_stages_sync_resultado();

-- The legacy placements (0105), unchanged but for ct.keep_resultado around the stages they write.
create or replace function private.check_front_stage()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_resultado text;
  v_measure text;
  v_stage public.funnel_stages;
  v_keep text;
begin
  if new.stage_id is null then
    select sf.resultado into v_resultado from public.sales_funnels sf where sf.id = new.sales_funnel_id;
    v_measure := private.stage_measure_of(coalesce(new.metrica_principal, v_resultado));
    select st.id into new.stage_id from public.funnel_stages st
    where st.sales_funnel_id = new.sales_funnel_id and st.measure = v_measure and st.archived_at is null
    order by st.position, st.created_at limit 1;
    if new.stage_id is null then
      v_keep := current_setting('ct.keep_resultado', true);
      perform set_config('ct.keep_resultado', 'on', true);
      insert into public.funnel_stages (sales_funnel_id, name, measure, position, meta, meta_roas)
      values (
        new.sales_funnel_id, private.stage_default_name(v_measure), v_measure,
        coalesce((select max(st.position) + 1 from public.funnel_stages st where st.sales_funnel_id = new.sales_funnel_id), 0),
        coalesce(private.plan_target(new.sales_funnel_id, v_measure), case when new.metrica_principal = v_measure then new.alvo_principal end),
        case when v_measure = 'compra' then coalesce(
          private.plan_target(new.sales_funnel_id, 'roas'),
          case when new.metrica_principal = 'roas' then new.alvo_principal when new.metrica_secundaria = 'roas' then new.alvo_secundaria end) end)
      returning id into new.stage_id;
      perform set_config('ct.keep_resultado', coalesce(v_keep, ''), true);
    end if;
  end if;

  select * into v_stage from public.funnel_stages st where st.id = new.stage_id;
  if v_stage.archived_at is not null and new.archived_at is null
     and (tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id or old.archived_at is not null) then
    raise exception 'stage % is archived', new.stage_id using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id and new.source_sales_funnel_id is null
     and private.normalized_tag(v_stage.tag) is distinct from
         private.normalized_tag((select st.tag from public.funnel_stages st where st.id = old.stage_id)) then
    perform private.freeze_client_owners_once((select sf.client_id from public.sales_funnels sf where sf.id = new.sales_funnel_id));
  end if;
  return new;
end
$function$;

create or replace function public.backfill_funnel_stages(p_sales_funnel_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_resultado text;
  v_old uuid[];
  v_position integer := 0;
  v_stage uuid;
  v_over uuid;
  g record;
  v_keep text;
begin
  v_keep := current_setting('ct.keep_resultado', true);
  perform set_config('ct.keep_resultado', 'on', true);
  select sf.resultado into v_resultado from public.sales_funnels sf where sf.id = p_sales_funnel_id;
  v_old := array(select st.id from public.funnel_stages st where st.sales_funnel_id = p_sales_funnel_id);

  for g in
    select private.stage_measure_of(coalesce(f.metrica_principal, v_resultado)) as measure,
      array_agg(f.id order by f.position, f.created_at, f.id) as fronts,
      case when bool_and(f.janela_inicio is not null and f.janela_fim is not null) then min(f.janela_inicio) end as janela_inicio,
      case when bool_and(f.janela_inicio is not null and f.janela_fim is not null) then max(f.janela_fim) end as janela_fim,
      case when bool_and(f.archived_at is not null) then max(f.archived_at) end as archived_at
    from public.project_fronts f
    where f.sales_funnel_id = p_sales_funnel_id
    group by 1
    order by min(f.position), min(f.created_at)
  loop
    insert into public.funnel_stages (sales_funnel_id, name, measure, position, janela_inicio, janela_fim, meta, meta_roas, archived_at)
    values (
      p_sales_funnel_id, private.stage_default_name(g.measure), g.measure, v_position, g.janela_inicio, g.janela_fim,
      coalesce(
        private.plan_target(p_sales_funnel_id, g.measure),
        (select f.alvo_principal from unnest(g.fronts) with ordinality u(id, n) join public.project_fronts f on f.id = u.id
         where f.metrica_principal = g.measure and f.alvo_principal is not null order by u.n limit 1)),
      case when g.measure = 'compra' then coalesce(
        private.plan_target(p_sales_funnel_id, 'roas'),
        (select case when f.metrica_principal = 'roas' and f.alvo_principal is not null then f.alvo_principal else f.alvo_secundaria end
         from unnest(g.fronts) with ordinality u(id, n) join public.project_fronts f on f.id = u.id
         where (f.metrica_principal = 'roas' and f.alvo_principal is not null) or (f.metrica_secundaria = 'roas' and f.alvo_secundaria is not null)
         order by u.n limit 1)) end,
      g.archived_at)
    returning id into v_stage;
    update public.project_fronts set stage_id = v_stage where id = any (g.fronts);
    v_position := v_position + 1;
  end loop;

  -- A project with no front still has where its result lives.
  if v_position = 0 then
    insert into public.funnel_stages (sales_funnel_id, name, measure, position, meta, meta_roas)
    values (p_sales_funnel_id, private.stage_default_name(private.stage_measure_of(v_resultado)), private.stage_measure_of(v_resultado), 0,
      private.plan_target(p_sales_funnel_id, private.stage_measure_of(v_resultado)),
      case when private.stage_measure_of(v_resultado) = 'compra' then private.plan_target(p_sales_funnel_id, 'roas') end);
  end if;

  delete from public.funnel_cost_combos c
  where c.sales_funnel_id = p_sales_funnel_id and (c.stage_ids && v_old or c.over_stage_id = any (v_old));
  delete from public.funnel_stages st where st.id = any (v_old);

  if (select count(distinct st.measure) from public.funnel_stages st where st.sales_funnel_id = p_sales_funnel_id) > 1 then
    select st.id into v_over from public.funnel_stages st
    where st.sales_funnel_id = p_sales_funnel_id and st.measure = 'compra'
    order by st.archived_at is not null, st.position limit 1;
    insert into public.funnel_cost_combos (sales_funnel_id, name, stage_ids, over, over_stage_id, enabled)
    values (p_sales_funnel_id, 'CPA geral (antigo)',
      array(select st.id from public.funnel_stages st where st.sales_funnel_id = p_sales_funnel_id order by st.position),
      case when v_over is null then 'receita' else 'stage' end, v_over, true);
  end if;

  update public.backlog_items b
     set funnel_stage_id = (select st.id from public.funnel_stages st where st.sales_funnel_id = p_sales_funnel_id
                            order by st.measure = 'compra' desc, st.archived_at is not null, st.position limit 1)
   where b.sales_funnel_id = p_sales_funnel_id and b.funnel_stage_id is null;
  perform set_config('ct.keep_resultado', coalesce(v_keep, ''), true);
end
$function$;

-- 3. Backfill -------------------------------------------------------------------------------------

select private.sync_funnel_resultado(sf.id)
from public.sales_funnels sf
where sf.archived_at is null
  and private.derived_resultado(sf.resultado, private.result_stage_measure(sf.id)) <> sf.resultado;
