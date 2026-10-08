-- The past does not change: a project or a front is archived instead of deleted. Deleting cascaded
-- campaign owners, watchers and pages and nulled the project of its sales, so old numbers moved.
-- An archived front keeps the campaigns it owns and claims no new ones; an archived project keeps
-- its sales, gets no new ones and its watchers stop. is_active (paused) stays a separate concept.

alter table public.sales_funnels add column archived_at timestamptz;
alter table public.project_fronts add column archived_at timestamptz;

-- Name claims only come from live fronts of live projects.
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
      array_agg(lower(normalize(r.value, NFC))) filter (where r.kind = 'include') as includes,
      array_agg(lower(normalize(r.value, NFC))) filter (where r.kind = 'exclude') as excludes
    from public.project_fronts f
    join public.sales_funnels sf on sf.id = f.sales_funnel_id
    left join public.naming_rules r on r.front_id = f.id
    where sf.client_id = p_client_id and f.source_sales_funnel_id is null
      and f.archived_at is null and sf.archived_at is null
    group by f.id
  ),
  matched as (
    select
      c.*,
      coalesce(
        (select array_agg(f.id order by f.id) from fronts f
         where f.includes is not null
           and (select bool_and(strpos(lower(normalize(c.campaign_name, NFC)), i) > 0) from unnest(f.includes) i)
           and not coalesce((select bool_or(strpos(lower(normalize(c.campaign_name, NFC)), e) > 0) from unnest(f.excludes) e), false)),
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
         where owner_front.id = r.owner_front),
        '{}')
    end,
    r.suggested,
    r.assignment
  from resolved r
  order by r.spend desc
$function$;

-- A new owner (insert or a change of front) cannot be an archived front or a front of an archived project.
create or replace function private.check_campaign_front()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if not exists (
    select 1 from public.project_fronts f
    join public.sales_funnels sf on sf.id = f.sales_funnel_id
    where f.id = new.front_id and sf.client_id = new.client_id and f.source_sales_funnel_id is null
  ) then
    raise exception 'front % cannot own campaigns of client %', new.front_id, new.client_id using errcode = '23514';
  end if;
  if (tg_op = 'INSERT' or new.front_id is distinct from old.front_id) and exists (
    select 1 from public.project_fronts f
    join public.sales_funnels sf on sf.id = f.sales_funnel_id
    where f.id = new.front_id and (f.archived_at is not null or sf.archived_at is not null)
  ) then
    raise exception 'front % is archived', new.front_id using errcode = '23514';
  end if;
  return new;
end
$function$;

-- A rule change elsewhere re-decides auto owners, but never takes a campaign from an archived front.
create or replace function private.release_auto_campaign_fronts()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_front_id uuid := coalesce(new.front_id, old.front_id);
  v_value text := lower(normalize(coalesce(new.value, old.value), NFC));
begin
  delete from public.campaign_fronts cf
  using public.project_fronts f join public.sales_funnels sf on sf.id = f.sales_funnel_id
  where f.id = v_front_id and cf.client_id = sf.client_id and cf.source = 'auto'
    and (
      cf.front_id = v_front_id
      or exists (
        select 1 from public.campaign_daily cd
        where cd.client_id = cf.client_id and cd.campaign_id = cf.campaign_id
          and strpos(lower(normalize(cd.campaign_name, NFC)), v_value) > 0
      )
    )
    and not exists (
      select 1 from public.project_fronts af
      join public.sales_funnels asf on asf.id = af.sales_funnel_id
      where af.id = cf.front_id and (af.archived_at is not null or asf.archived_at is not null)
    );
  return null;
end
$function$;

create or replace function public.preview_naming_rule(p_front_id uuid, p_kind text, p_value text)
 returns table(campaigns bigint, spend numeric, disputed bigint, released_from_others bigint)
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
    -- The front's rules with the new one, and every other own live front's rules as they are.
    select f.id as front_id,
      array_agg(lower(normalize(r.value, NFC))) filter (where r.kind = 'include')
        || case when f.id = p_front_id and p_kind = 'include' then array[v_value] else '{}'::text[] end as includes,
      array_agg(lower(normalize(r.value, NFC))) filter (where r.kind = 'exclude')
        || case when f.id = p_front_id and p_kind = 'exclude' then array[v_value] else '{}'::text[] end as excludes
    from public.project_fronts f
    join public.sales_funnels sf on sf.id = f.sales_funnel_id
    left join public.naming_rules r on r.front_id = f.id
    where sf.client_id = v_client_id and f.source_sales_funnel_id is null
      and f.archived_at is null and sf.archived_at is null
    group by f.id
  ),
  campaigns as (
    select c.campaign_id, c.campaign_name, c.spend, c.front_ids,
      (select array_agg(ru.front_id) from rules ru
       where cardinality(ru.includes) > 0
         and (select bool_and(strpos(lower(normalize(c.campaign_name, NFC)), i) > 0) from unnest(ru.includes) i)
         and not coalesce((select bool_or(strpos(lower(normalize(c.campaign_name, NFC)), e) > 0) from unnest(ru.excludes) e), false)) as matches
    from public.get_client_campaigns(v_client_id, v_today - 30, v_today + 1) c
  ),
  taken as (
    select * from campaigns c where p_front_id = any (coalesce(c.matches, '{}'))
  )
  select
    (select count(*) from taken),
    coalesce((select sum(t.spend) from taken t), 0),
    (select count(*) from taken t where cardinality(t.matches) > 1),
    (select count(*) from taken t where cardinality(t.front_ids) > 0 and t.front_ids[1] <> p_front_id);
end;
$function$;

-- An archived project is no candidate for a sale, and a sale it already has stays with it when a
-- resync rewrites the row.
create or replace function private.attribute_sale()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_candidates uuid[];
  v_campaign text;
  v_owner uuid;
  v_by_ad uuid;
begin
  if tg_op = 'UPDATE' and old.sales_funnel_id is not null
     and exists (select 1 from public.sales_funnels sf where sf.id = old.sales_funnel_id and sf.archived_at is not null) then
    new.sales_funnel_id := old.sales_funnel_id;
    new.atribuicao := old.atribuicao;
    new.motivo := old.motivo;
    new.anuncio_funnel_id := old.anuncio_funnel_id;
    return new;
  end if;

  if new.client_id is null then
    select sf.client_id into new.client_id from public.sales_funnels sf where sf.id = new.sales_funnel_id;
  end if;

  v_campaign := private.sale_campaign_id(new.client_id, new.utm_campaign, new.utm_content);
  v_owner := private.campaign_owner_project(new.client_id, v_campaign);
  new.anuncio_funnel_id := v_owner;

  select coalesce(array_agg(pp.sales_funnel_id), '{}') into v_candidates
    from public.project_products pp
    join public.sales_funnels sf on sf.id = pp.sales_funnel_id
   where sf.client_id = new.client_id and pp.produto_nome = new.produto and sf.archived_at is null;

  if cardinality(v_candidates) = 1 then
    new.sales_funnel_id := v_candidates[1];
    new.atribuicao := 'produto';
    new.motivo := 'produto_exclusivo';
    return new;
  end if;

  if cardinality(v_candidates) > 1 then
    -- Among the projects that sell the product, the one that owns the campaign the UTM names.
    if v_owner = any (v_candidates) then
      v_by_ad := v_owner;
    end if;
    if v_by_ad is not null then
      new.sales_funnel_id := v_by_ad;
      new.atribuicao := 'anuncio';
      new.motivo := 'anuncio_do_projeto';
      return new;
    end if;
    new.sales_funnel_id := null;
    new.atribuicao := 'sem_atribuicao';
    new.motivo := 'produto_em_varios_sem_anuncio';
    return new;
  end if;

  -- No project lists the product: a write that names its project keeps it (a project still read by
  -- its LaunchOps name list, before Produtos existed); otherwise the sale has no project.
  if new.sales_funnel_id is not null
     and not exists (select 1 from public.sales_funnels sf where sf.id = new.sales_funnel_id and sf.archived_at is not null) then
    new.atribuicao := 'produto';
    new.motivo := 'lista_launchops';
    return new;
  end if;

  new.sales_funnel_id := null;
  new.atribuicao := 'sem_atribuicao';
  new.motivo := 'produto_fora_de_projeto';
  return new;
end
$function$;

-- Watchers of an archived project or front are not evaluated (watcher_day itself is unchanged).
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
    where wa.client_id = p_client_id and wa.is_active and sf.archived_at is null and pf.archived_at is null
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
    elsif r.status = 'ok' then
      update public.alerts set closed_at = now(), updated_at = now() where watcher_id = w.id and closed_at is null;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$function$;

-- Before a front stops claiming by name, the campaigns its rules own today are fixed to it, so its
-- past keeps them. Open alerts of its watchers close: nothing evaluates them any more.
create or replace function private.freeze_fronts_before_archive(p_client_id uuid, p_front_ids uuid[])
 returns void
 language sql
 set search_path to ''
as $function$
  insert into public.campaign_fronts (client_id, campaign_id, front_id, source)
  select p_client_id, c.campaign_id, c.suggested_front_ids[1], 'auto'
  from public.get_client_campaigns(p_client_id, '2000-01-01', current_date + 1) c
  where c.assignment = 'nome' and c.suggested_front_ids[1] = any (p_front_ids)
  on conflict (client_id, campaign_id) do nothing;
$function$;

create or replace function public.set_project_archived(p_sales_funnel_id uuid, p_archived boolean)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_client_id uuid;
begin
  select sf.client_id into v_client_id from public.sales_funnels sf
  where sf.id = p_sales_funnel_id and private.has_client_role(sf.client_id, 'gestor');
  if v_client_id is null then
    raise exception 'not found or access denied' using errcode = '42501';
  end if;

  if p_archived then
    perform private.freeze_fronts_before_archive(v_client_id,
      array(select f.id from public.project_fronts f where f.sales_funnel_id = p_sales_funnel_id));
    update public.sales_funnels set archived_at = now() where id = p_sales_funnel_id and archived_at is null;
    update public.alerts a set closed_at = now(), updated_at = now()
    from public.watchers w where w.id = a.watcher_id and w.sales_funnel_id = p_sales_funnel_id and a.closed_at is null;
  else
    update public.sales_funnels set archived_at = null where id = p_sales_funnel_id;
  end if;
end
$function$;

create or replace function public.set_front_archived(p_front_id uuid, p_archived boolean)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_client_id uuid;
begin
  select sf.client_id into v_client_id
  from public.project_fronts f join public.sales_funnels sf on sf.id = f.sales_funnel_id
  where f.id = p_front_id and private.has_client_role(sf.client_id, 'gestor');
  if v_client_id is null then
    raise exception 'not found or access denied' using errcode = '42501';
  end if;

  if p_archived then
    perform private.freeze_fronts_before_archive(v_client_id, array[p_front_id]);
    update public.project_fronts set archived_at = now() where id = p_front_id and archived_at is null;
    update public.alerts a set closed_at = now(), updated_at = now()
    from public.watchers w where w.id = a.watcher_id and w.front_id = p_front_id and a.closed_at is null;
  else
    update public.project_fronts set archived_at = null where id = p_front_id;
  end if;
end
$function$;

revoke all on function private.freeze_fronts_before_archive(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.set_project_archived(uuid, boolean) from public, anon;
grant execute on function public.set_project_archived(uuid, boolean) to authenticated;
revoke all on function public.set_front_archived(uuid, boolean) from public, anon;
grant execute on function public.set_front_archived(uuid, boolean) to authenticated;
