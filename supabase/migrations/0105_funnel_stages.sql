-- Etapas no funil (Vitor, 2026-10-08). Funil -> Etapa -> Frente. Additive: no number shown today moves.
--
-- * funnel_stages: a block of the customer journey (Captação, Vendas...). Its measure is fixed and
--   says what the stage produces and what its cost is: alcance (CPM), lead (CPL), visita (cost per
--   landing page view), compra (CPA and ROAS), ascensao (rate and revenue). A stage's tag, when set,
--   is one more "contém" every own front of the stage needs on the campaign name; mirrors ignore it.
-- * project_fronts.stage_id: every front belongs to one stage of its own project. A front written
--   without one (old forms, tests, the wizard) lands in the project's stage of its metric's measure,
--   created when missing: the same grouping the backfill below uses.
-- * Sales reach a stage by product role inside the project that sold them: entrada, order bump and
--   upsell go to the compra stage, ascensão to the ascensao stage. With two compra stages, the one
--   whose campaigns carry the sale's campaign takes it; otherwise the first by position.
-- * funnel_cost_combos: "custo combinado", the spend of chosen stages over revenue (ROAS) or over
--   one stage's result. client_stage_presets: the client's ready stages; empty uses the app's defaults.
-- * backlog_items.funnel_stage_id: the stage a test belongs to (backlog_items.stage is something
--   else: the conversion point under test).
--
-- Backfill: per project, one stage per measure of its fronts (front metric, else the project's
-- resultado), tag null so no campaign changes front. A project whose stages differ in measure gets a
-- "CPA geral (antigo)" combo with every stage's spend, so the old all-spend number stays visible.

-- 1. Tables ---------------------------------------------------------------------------------------

create table public.funnel_stages (
  id uuid primary key default gen_random_uuid(),
  sales_funnel_id uuid not null references public.sales_funnels(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  tag text check (tag is null or btrim(tag) <> ''),
  measure text not null check (measure in ('alcance', 'lead', 'visita', 'compra', 'ascensao')),
  position integer not null default 0,
  parallel boolean not null default false,
  janela_inicio date,
  janela_fim date,
  meta numeric check (meta > 0),
  meta_roas numeric check (meta_roas > 0),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, sales_funnel_id),
  constraint funnel_stages_window_order check (janela_fim is null or janela_inicio is null or janela_fim >= janela_inicio),
  constraint funnel_stages_roas_only_compra check (meta_roas is null or measure = 'compra')
);
create index funnel_stages_funnel_idx on public.funnel_stages (sales_funnel_id, position);

alter table public.funnel_stages enable row level security;
create policy funnel_stages_read on public.funnel_stages for select to authenticated
  using (sales_funnel_id in (select sf.id from public.sales_funnels sf where sf.client_id in (select private.accessible_client_ids('cliente'))));
create policy funnel_stages_insert on public.funnel_stages for insert to authenticated
  with check (sales_funnel_id in (select sf.id from public.sales_funnels sf where sf.client_id in (select private.accessible_client_ids('gestor'))));
create policy funnel_stages_update on public.funnel_stages for update to authenticated
  using (sales_funnel_id in (select sf.id from public.sales_funnels sf where sf.client_id in (select private.accessible_client_ids('gestor'))))
  with check (sales_funnel_id in (select sf.id from public.sales_funnels sf where sf.client_id in (select private.accessible_client_ids('gestor'))));
create policy funnel_stages_delete on public.funnel_stages for delete to authenticated
  using (sales_funnel_id in (select sf.id from public.sales_funnels sf where sf.client_id in (select private.accessible_client_ids('gestor'))));
grant select, insert, update, delete on public.funnel_stages to authenticated, service_role;
revoke all on public.funnel_stages from anon;

alter table public.project_fronts
  add column stage_id uuid,
  add constraint project_fronts_stage_fkey foreign key (stage_id, sales_funnel_id) references public.funnel_stages (id, sales_funnel_id);
create index project_fronts_stage_idx on public.project_fronts (stage_id);

create table public.funnel_cost_combos (
  id uuid primary key default gen_random_uuid(),
  sales_funnel_id uuid not null references public.sales_funnels(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  stage_ids uuid[] not null check (cardinality(stage_ids) > 0),
  over text not null check (over in ('receita', 'stage')),
  over_stage_id uuid,
  enabled boolean not null default true,
  meta numeric check (meta > 0),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint funnel_cost_combos_over_stage check ((over = 'stage') = (over_stage_id is not null)),
  constraint funnel_cost_combos_over_stage_fkey foreign key (over_stage_id, sales_funnel_id) references public.funnel_stages (id, sales_funnel_id)
);
create index funnel_cost_combos_funnel_idx on public.funnel_cost_combos (sales_funnel_id, position);

alter table public.funnel_cost_combos enable row level security;
create policy funnel_cost_combos_read on public.funnel_cost_combos for select to authenticated
  using (sales_funnel_id in (select sf.id from public.sales_funnels sf where sf.client_id in (select private.accessible_client_ids('cliente'))));
create policy funnel_cost_combos_insert on public.funnel_cost_combos for insert to authenticated
  with check (sales_funnel_id in (select sf.id from public.sales_funnels sf where sf.client_id in (select private.accessible_client_ids('gestor'))));
create policy funnel_cost_combos_update on public.funnel_cost_combos for update to authenticated
  using (sales_funnel_id in (select sf.id from public.sales_funnels sf where sf.client_id in (select private.accessible_client_ids('gestor'))))
  with check (sales_funnel_id in (select sf.id from public.sales_funnels sf where sf.client_id in (select private.accessible_client_ids('gestor'))));
create policy funnel_cost_combos_delete on public.funnel_cost_combos for delete to authenticated
  using (sales_funnel_id in (select sf.id from public.sales_funnels sf where sf.client_id in (select private.accessible_client_ids('gestor'))));
grant select, insert, update, delete on public.funnel_cost_combos to authenticated, service_role;
revoke all on public.funnel_cost_combos from anon;

create table public.client_stage_presets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  tag text check (tag is null or btrim(tag) <> ''),
  measure text not null check (measure in ('alcance', 'lead', 'visita', 'compra', 'ascensao')),
  parallel boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index client_stage_presets_client_idx on public.client_stage_presets (client_id, position);

alter table public.client_stage_presets enable row level security;
create policy client_stage_presets_read on public.client_stage_presets for select to authenticated
  using (client_id in (select private.accessible_client_ids('cliente')));
create policy client_stage_presets_write on public.client_stage_presets for all to authenticated
  using (client_id in (select private.accessible_client_ids('gestor')))
  with check (client_id in (select private.accessible_client_ids('gestor')));
grant select, insert, update, delete on public.client_stage_presets to authenticated, service_role;
revoke all on public.client_stage_presets from anon;

alter table public.backlog_items
  add column funnel_stage_id uuid,
  add constraint backlog_items_funnel_stage_fkey foreign key (funnel_stage_id, sales_funnel_id)
    references public.funnel_stages (id, sales_funnel_id) on delete set null (funnel_stage_id);

-- 2. Helpers --------------------------------------------------------------------------------------

-- A front or project metric's stage measure: CPA, ROAS and checkout all live in the sale stage.
create or replace function private.stage_measure_of(p_metric text) returns text
language sql immutable set search_path = ''
as $$
  select case
    when p_metric in ('compra', 'roas', 'checkout') then 'compra'
    when p_metric in ('lead', 'alcance', 'visita') then p_metric
  end
$$;

create or replace function private.stage_default_name(p_measure text) returns text
language sql immutable set search_path = ''
as $$
  select case p_measure
    when 'compra' then 'Vendas'
    when 'lead' then 'Captação'
    when 'alcance' then 'Reconhecimento'
    when 'visita' then 'Aquecimento'
    when 'ascensao' then 'Ascensão'
  end
$$;

-- The project's plan target ("Resultado e meta", 0094/0102) in a metric's terms, the principal first.
create or replace function private.plan_target(p_sales_funnel_id uuid, p_metric text) returns numeric
language sql stable set search_path = ''
as $$
  select w.target from public.watchers w
  where w.sales_funnel_id = p_sales_funnel_id and w.front_id is null and w.plan_role is not null
    and w.metric = public.result_watcher_metric(p_metric, false)
  order by w.plan_role = 'principal' desc
  limit 1
$$;

-- A naming-rule change and a stage-tag change apply from now on: the campaigns the names give
-- today are frozen to their front first, once per client per transaction (as in 0070).
create or replace function private.freeze_client_owners_once(p_client_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_done text := coalesce(current_setting('ct.rules_frozen_clients', true), '');
begin
  if p_client_id is not null and strpos(v_done, p_client_id::text) = 0 then
    perform private.freeze_fronts_before_archive(p_client_id, null);
    perform set_config('ct.rules_frozen_clients', v_done || p_client_id::text || ',', true);
  end if;
end
$$;

create or replace function private.normalized_tag(p_tag text) returns text
language sql immutable set search_path = ''
as $$ select nullif(lower(normalize(btrim(p_tag), NFC)), '') $$;

-- 3. Backfill -------------------------------------------------------------------------------------

-- Builds the project's stages from its fronts. Re-runnable: fronts move to the new stages and the old
-- ones (and the combos and test links on them) go away. Service role only.
create or replace function public.backfill_funnel_stages(p_sales_funnel_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_resultado text;
  v_old uuid[];
  v_position integer := 0;
  v_stage uuid;
  v_over uuid;
  g record;
begin
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
end
$$;
revoke all on function public.backfill_funnel_stages(uuid) from public, anon, authenticated;
grant execute on function public.backfill_funnel_stages(uuid) to service_role;

select public.backfill_funnel_stages(sf.id) from public.sales_funnels sf;

alter table public.project_fronts alter column stage_id set not null;

-- 4. Integrity triggers ---------------------------------------------------------------------------

-- A front written without a stage lands in its project's open stage of its measure, created when
-- missing. A front cannot enter or reopen in an archived stage. Moving a front between stages of
-- different tags changes which campaigns it takes, so the owners are frozen first.
create or replace function private.check_front_stage() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_resultado text;
  v_measure text;
  v_stage public.funnel_stages;
begin
  if new.stage_id is null then
    select sf.resultado into v_resultado from public.sales_funnels sf where sf.id = new.sales_funnel_id;
    v_measure := private.stage_measure_of(coalesce(new.metrica_principal, v_resultado));
    select st.id into new.stage_id from public.funnel_stages st
    where st.sales_funnel_id = new.sales_funnel_id and st.measure = v_measure and st.archived_at is null
    order by st.position, st.created_at limit 1;
    if new.stage_id is null then
      insert into public.funnel_stages (sales_funnel_id, name, measure, position, meta, meta_roas)
      values (
        new.sales_funnel_id, private.stage_default_name(v_measure), v_measure,
        coalesce((select max(st.position) + 1 from public.funnel_stages st where st.sales_funnel_id = new.sales_funnel_id), 0),
        coalesce(private.plan_target(new.sales_funnel_id, v_measure), case when new.metrica_principal = v_measure then new.alvo_principal end),
        case when v_measure = 'compra' then coalesce(
          private.plan_target(new.sales_funnel_id, 'roas'),
          case when new.metrica_principal = 'roas' then new.alvo_principal when new.metrica_secundaria = 'roas' then new.alvo_secundaria end) end)
      returning id into new.stage_id;
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
$$;
create trigger project_fronts_stage before insert or update of stage_id, archived_at on public.project_fronts
  for each row execute function private.check_front_stage();

-- Archiving a stage asks its fronts to be moved or archived first. A tag change freezes the owners.
create or replace function private.check_stage_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.archived_at is not null and old.archived_at is null
     and exists (select 1 from public.project_fronts f where f.stage_id = new.id and f.archived_at is null) then
    raise exception 'stage % still has active fronts: move or archive them first', new.id using errcode = '23514';
  end if;
  if private.normalized_tag(new.tag) is distinct from private.normalized_tag(old.tag)
     and exists (select 1 from public.project_fronts f where f.stage_id = new.id and f.source_sales_funnel_id is null) then
    perform private.freeze_client_owners_once((select sf.client_id from public.sales_funnels sf where sf.id = new.sales_funnel_id));
  end if;
  return new;
end
$$;
create trigger funnel_stages_change before update on public.funnel_stages
  for each row execute function private.check_stage_change();

create or replace function private.check_cost_combo() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (
    select 1 from unnest(new.stage_ids) s(id)
    where not exists (select 1 from public.funnel_stages st where st.id = s.id and st.sales_funnel_id = new.sales_funnel_id)
  ) then
    raise exception 'combo stages must belong to project %', new.sales_funnel_id using errcode = '23514';
  end if;
  return new;
end
$$;
create trigger funnel_cost_combos_check before insert or update on public.funnel_cost_combos
  for each row execute function private.check_cost_combo();

-- 5. Campaign matching with the stage tag ---------------------------------------------------------

-- An own front takes a campaign when its rules match and, if its stage has a tag, the name also
-- contains the tag. Mirrors never match by name, so the tag never touches them.
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
      array_agg(lower(normalize(r.value, NFC))) filter (where r.kind = 'include') as includes,
      array_agg(lower(normalize(r.value, NFC))) filter (where r.kind = 'exclude') as excludes
    from public.project_fronts f
    join public.sales_funnels sf on sf.id = f.sales_funnel_id
    left join public.funnel_stages st on st.id = f.stage_id
    left join public.naming_rules r on r.front_id = f.id
    where sf.client_id = p_client_id and f.source_sales_funnel_id is null
      and f.archived_at is null and sf.archived_at is null
    group by f.id, st.tag
  ),
  matched as (
    select
      c.*,
      coalesce(
        (select array_agg(f.id order by f.id) from fronts f
         where f.includes is not null
           and (select bool_and(strpos(lower(normalize(c.campaign_name, NFC)), i) > 0) from unnest(f.includes) i)
           and not coalesce((select bool_or(strpos(lower(normalize(c.campaign_name, NFC)), e) > 0) from unnest(f.excludes) e), false)
           and (f.stage_tag is null or strpos(lower(normalize(c.campaign_name, NFC)), f.stage_tag) > 0)),
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

-- The rule preview judges with the stage tag too, so it shows what the rule will really take.
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
    group by f.id, st.tag
  ),
  campaigns as (
    select c.campaign_id, c.campaign_name, c.spend, c.front_ids,
      (select array_agg(ru.front_id) from rules ru
       where cardinality(ru.includes) > 0
         and (select bool_and(strpos(lower(normalize(c.campaign_name, NFC)), i) > 0) from unnest(ru.includes) i)
         and not coalesce((select bool_or(strpos(lower(normalize(c.campaign_name, NFC)), e) > 0) from unnest(ru.excludes) e), false)
         and (ru.stage_tag is null or strpos(lower(normalize(c.campaign_name, NFC)), ru.stage_tag) > 0)) as matches
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

-- 6. Reads ----------------------------------------------------------------------------------------

-- Every sale of the project that sold or was refunded in the range, with the stage that counts it
-- and the stage whose campaign brought it (origin, null when no campaign of the project carries it).
-- A stage with a window only takes the sales of its days.
create or replace function private.funnel_stage_sales(p_sales_funnel_id uuid, p_from date, p_to date)
 returns table(papel text, valor_liquido numeric, data_venda timestamptz, reembolsado_em timestamptz, stage_id uuid, origin_stage_id uuid)
 language sql
 stable
 set search_path to ''
as $function$
  with stages as (
    select st.id, st.measure, st.position, st.created_at, st.archived_at, st.janela_inicio, st.janela_fim
    from public.funnel_stages st where st.sales_funnel_id = p_sales_funnel_id
  ),
  campaign_stage as (
    select distinct on (c.campaign_id) c.campaign_id, st.id as stage_id
    from public.sales_funnels sf
    cross join lateral public.get_client_campaigns(sf.client_id, p_from - 60, p_to) c
    cross join lateral unnest(c.front_ids) as cf(front_id)
    join public.project_fronts f on f.id = cf.front_id and f.sales_funnel_id = p_sales_funnel_id
    join stages st on st.id = f.stage_id
    where sf.id = p_sales_funnel_id
    order by c.campaign_id, st.position, st.created_at
  ),
  sales as (
    select s.papel, s.valor_liquido, s.data_venda, s.reembolsado_em, s.campanha_id,
      (s.data_venda at time zone 'America/Sao_Paulo')::date as dia,
      case when s.papel = 'ascensao' then 'ascensao' else 'compra' end as measure
    from public.sales s
    where s.sales_funnel_id = p_sales_funnel_id and s.papel is not null
      and ((s.data_venda >= (p_from::timestamp at time zone 'America/Sao_Paulo') and s.data_venda < (p_to::timestamp at time zone 'America/Sao_Paulo'))
        or (s.reembolsado_em >= (p_from::timestamp at time zone 'America/Sao_Paulo') and s.reembolsado_em < (p_to::timestamp at time zone 'America/Sao_Paulo')))
  )
  select s.papel, s.valor_liquido, s.data_venda, s.reembolsado_em,
    coalesce(
      (select st.id from stages st
       where st.id = origin.stage_id and st.measure = s.measure
         and (st.janela_inicio is null or s.dia >= st.janela_inicio) and (st.janela_fim is null or s.dia <= st.janela_fim)),
      (select st.id from stages st
       where st.measure = s.measure
         and (st.janela_inicio is null or s.dia >= st.janela_inicio) and (st.janela_fim is null or s.dia <= st.janela_fim)
       order by st.archived_at is not null, st.position, st.created_at limit 1)),
    origin.stage_id
  from sales s
  left join campaign_stage origin on origin.campaign_id = s.campanha_id
$function$;
revoke all on function private.funnel_stage_sales(uuid, date, date) from public, anon, authenticated;

-- Per stage per day. Spend and Meta counts come from the stage's fronts (get_project_front_daily),
-- inside the stage's window. vendas: entry sales (ascensão in an ascensao stage) on the day they
-- were made, without the ones after today's Meta pull; reembolsos on the day of the refund;
-- receita_liquida is net of the refunds of the day, as in get_funnel_daily.
create or replace function public.get_funnel_stage_daily(p_funnel_id uuid, p_from date, p_to date)
 returns table(stage_id uuid, data date, spend numeric, spend_com_imposto numeric, impressions bigint, reach bigint, clicks bigint, link_clicks bigint, landing_page_views bigint, leads bigint, initiate_checkout bigint, vendas bigint, reembolsos bigint, receita_liquida numeric, receita_reembolsada_liquida numeric)
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_client_id uuid;
begin
  select sf.client_id into v_client_id from public.sales_funnels sf
  where sf.id = p_funnel_id and private.has_client_role(sf.client_id, 'cliente');
  if v_client_id is null then
    raise exception 'not found or access denied';
  end if;

  return query
  with spend as (
    select f.stage_id, fd.data, sum(fd.spend) as spend, sum(fd.impressions) as impressions, sum(fd.reach) as reach,
      sum(fd.clicks) as clicks, sum(fd.link_clicks) as link_clicks, sum(fd.landing_page_views) as landing_page_views,
      sum(fd.leads) as leads, sum(fd.initiate_checkout) as initiate_checkout
    from public.get_project_front_daily(p_funnel_id, p_from, p_to) fd
    join public.project_fronts f on f.id = fd.front_id
    join public.funnel_stages st on st.id = f.stage_id
    where (st.janela_inicio is null or fd.data >= st.janela_inicio) and (st.janela_fim is null or fd.data <= st.janela_fim)
    group by f.stage_id, fd.data
  ),
  placed as (
    select * from private.funnel_stage_sales(p_funnel_id, p_from, p_to) p where p.stage_id is not null
  ),
  sold as (
    select p.stage_id, (p.data_venda at time zone 'America/Sao_Paulo')::date as data,
      count(*) filter (where p.papel in ('entrada', 'ascensao')) as vendas,
      sum(p.valor_liquido) as receita
    from placed p
    where p.data_venda >= (p_from::timestamp at time zone 'America/Sao_Paulo')
      and p.data_venda < (p_to::timestamp at time zone 'America/Sao_Paulo')
      and not private.sale_after_meta_pull(v_client_id, p.data_venda)
    group by 1, 2
  ),
  refunded as (
    select p.stage_id, (p.reembolsado_em at time zone 'America/Sao_Paulo')::date as data,
      count(*) filter (where p.papel in ('entrada', 'ascensao')) as reembolsos,
      sum(p.valor_liquido) as receita
    from placed p
    where p.reembolsado_em >= (p_from::timestamp at time zone 'America/Sao_Paulo')
      and p.reembolsado_em < (p_to::timestamp at time zone 'America/Sao_Paulo')
    group by 1, 2
  ),
  days as (
    select coalesce(sp.stage_id, so.stage_id, r.stage_id) as stage_id, coalesce(sp.data, so.data, r.data) as data,
      sp.spend, sp.impressions, sp.reach, sp.clicks, sp.link_clicks, sp.landing_page_views, sp.leads, sp.initiate_checkout,
      so.vendas, so.receita, r.reembolsos, r.receita as receita_reembolsada
    from spend sp
    full join sold so on so.stage_id = sp.stage_id and so.data = sp.data
    full join refunded r on r.stage_id = coalesce(sp.stage_id, so.stage_id) and r.data = coalesce(sp.data, so.data)
  )
  select d.stage_id, d.data,
    coalesce(d.spend, 0),
    coalesce(d.spend, 0) * coalesce((select t.factor from public.client_tax_rates t
                                     where t.client_id = v_client_id and t.valid_from <= d.data
                                     order by t.valid_from desc limit 1), 1),
    coalesce(d.impressions, 0)::bigint, coalesce(d.reach, 0)::bigint, coalesce(d.clicks, 0)::bigint,
    coalesce(d.link_clicks, 0)::bigint, coalesce(d.landing_page_views, 0)::bigint, coalesce(d.leads, 0)::bigint,
    coalesce(d.initiate_checkout, 0)::bigint,
    coalesce(d.vendas, 0)::bigint, coalesce(d.reembolsos, 0)::bigint,
    coalesce(d.receita, 0) - coalesce(d.receita_reembolsada, 0),
    coalesce(d.receita_reembolsada, 0)
  from days d
  order by d.data, d.stage_id;
end;
$function$;
revoke all on function public.get_funnel_stage_daily(uuid, date, date) from public, anon;
grant execute on function public.get_funnel_stage_daily(uuid, date, date) to authenticated, service_role;

-- Where the project's entry sales of the range came from: the stage that counts them and the stage
-- whose campaign brought them ("venda em Vendas, vinda da Captação"). A sale refunded before the end
-- of the range does not count (sale_counts, 0099).
create or replace function public.get_funnel_stage_origin(p_funnel_id uuid, p_from date, p_to date)
 returns table(stage_id uuid, origin_stage_id uuid, vendas bigint)
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_client_id uuid;
begin
  select sf.client_id into v_client_id from public.sales_funnels sf
  where sf.id = p_funnel_id and private.has_client_role(sf.client_id, 'cliente');
  if v_client_id is null then
    raise exception 'not found or access denied';
  end if;

  return query
  select p.stage_id, p.origin_stage_id, count(*)
  from private.funnel_stage_sales(p_funnel_id, p_from, p_to) p
  where p.papel = 'entrada'
    and p.data_venda >= (p_from::timestamp at time zone 'America/Sao_Paulo')
    and p.data_venda < (p_to::timestamp at time zone 'America/Sao_Paulo')
    and not private.sale_after_meta_pull(v_client_id, p.data_venda)
    and private.sale_counts(p.reembolsado_em, p_to)
  group by p.stage_id, p.origin_stage_id;
end;
$function$;
revoke all on function public.get_funnel_stage_origin(uuid, date, date) from public, anon;
grant execute on function public.get_funnel_stage_origin(uuid, date, date) to authenticated, service_role;

-- 7. Writes ---------------------------------------------------------------------------------------

-- Stages, combos and presets are written through RLS like fronts; only the order is one call.
create or replace function public.reorder_funnel_stages(p_funnel_id uuid, p_stage_ids uuid[])
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if not exists (select 1 from public.sales_funnels sf where sf.id = p_funnel_id and private.has_client_role(sf.client_id, 'gestor')) then
    raise exception 'not found or access denied' using errcode = '42501';
  end if;
  update public.funnel_stages st set position = o.n - 1
  from unnest(p_stage_ids) with ordinality o(id, n)
  where st.id = o.id and st.sales_funnel_id = p_funnel_id;
end
$function$;
revoke all on function public.reorder_funnel_stages(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_funnel_stages(uuid, uuid[]) to authenticated, service_role;
