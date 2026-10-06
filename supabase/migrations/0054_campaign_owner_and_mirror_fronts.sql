-- Central de Tráfego, Fase 1: every campaign has one owner front, and a front can read another project.
--
-- 0053 classified a campaign live from its current name. Two problems came out of the data review
-- of 2026-10-06: renaming a campaign in the Ads Manager silently moved its whole history to another
-- front, and a campaign whose name matched two fronts was counted in both. Here the name only
-- suggests: a single match is frozen as the campaign's owner on the next sync, a gestor can pin any
-- campaign by hand, and a campaign with two matches stays unclassified until someone picks.
--
-- A front can also read another project instead of owning campaigns (source_sales_funnel_id): the
-- Captação Paga of the T15 launch is the 1K-LATAM perpetual project seen through the launch window.
-- The campaigns keep one owner, so nothing is ever counted twice across projects.

alter table sales_funnels
  add column starts_on date,
  add column ends_on date,
  add constraint sales_funnels_window_order check (ends_on is null or starts_on is null or ends_on >= starts_on);

alter table project_fronts
  add column source_sales_funnel_id uuid references sales_funnels(id) on delete cascade,
  add constraint project_fronts_source_not_self check (source_sales_funnel_id is distinct from sales_funnel_id);

create table campaign_fronts (
  client_id uuid not null references clients(id) on delete cascade,
  campaign_id text not null,
  front_id uuid not null references project_fronts(id) on delete cascade,
  -- auto = frozen from a single name match by the sync; manual = pinned by a gestor.
  source text not null check (source in ('auto', 'manual')),
  assigned_at timestamptz not null default now(),
  primary key (client_id, campaign_id)
);
create index campaign_fronts_front_idx on campaign_fronts (front_id);

-- The owner must be a front of the same client that owns campaigns itself: a front that reads
-- another project has no campaigns of its own.
create function private.check_campaign_front() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.project_fronts f
    join public.sales_funnels sf on sf.id = f.sales_funnel_id
    where f.id = new.front_id and sf.client_id = new.client_id and f.source_sales_funnel_id is null
  ) then
    raise exception 'front % cannot own campaigns of client %', new.front_id, new.client_id using errcode = '23514';
  end if;
  return new;
end
$$;
create trigger campaign_fronts_check before insert or update on campaign_fronts
  for each row execute function private.check_campaign_front();

-- Editing the rules is an explicit decision to re-classify: the frozen (auto) owners of that client
-- are released and the next sync freezes them again from the new rules. Pins by hand stay.
create function private.release_auto_campaign_fronts() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_front_id uuid := coalesce(new.front_id, old.front_id);
begin
  delete from public.campaign_fronts cf
  using public.project_fronts f join public.sales_funnels sf on sf.id = f.sales_funnel_id
  where f.id = v_front_id and cf.client_id = sf.client_id and cf.source = 'auto';
  return null;
end
$$;
create trigger naming_rules_release_auto after insert or delete on naming_rules
  for each row execute function private.release_auto_campaign_fronts();

alter table campaign_fronts enable row level security;
create policy campaign_fronts_read on campaign_fronts for select to authenticated
  using (client_id in (select private.accessible_client_ids('cliente')));
create policy campaign_fronts_insert on campaign_fronts for insert to authenticated
  with check (source = 'manual' and client_id in (select private.accessible_client_ids('gestor')));
create policy campaign_fronts_update on campaign_fronts for update to authenticated
  using (client_id in (select private.accessible_client_ids('gestor')))
  with check (source = 'manual' and client_id in (select private.accessible_client_ids('gestor')));
create policy campaign_fronts_delete on campaign_fronts for delete to authenticated
  using (client_id in (select private.accessible_client_ids('gestor')));
grant select, insert, update, delete on campaign_fronts to authenticated, service_role;
revoke all on campaign_fronts from anon;

-- front_ids: the fronts that COUNT the campaign -- its owner plus every front that reads the
-- owner's project. Empty = unclassified. suggested_front_ids: the fronts whose name rules match.
-- assignment: manual | auto (frozen) | nome (single live match, frozen on the next sync) | null.
drop function public.get_client_campaigns(uuid, date, date);
create function public.get_client_campaigns(p_client_id uuid, p_since date, p_until date)
returns table (
  campaign_id text,
  campaign_name text,
  spend numeric,
  impressions bigint,
  link_clicks bigint,
  leads bigint,
  first_day date,
  last_day date,
  front_ids uuid[],
  suggested_front_ids uuid[],
  assignment text
)
language sql stable set search_path = ''
as $$
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
$$;
revoke all on function public.get_client_campaigns(uuid, date, date) from public, anon;
grant execute on function public.get_client_campaigns(uuid, date, date) to authenticated, service_role;

-- Same sums as 0053, with one change: a front that reads another project only counts the days
-- inside this project's window (starts_on .. ends_on), so the T15 sees the perpetual's campaigns
-- only while the launch runs.
create or replace function public.get_project_front_daily(p_sales_funnel_id uuid, p_since date, p_until date)
returns table (
  front_id uuid,
  data date,
  spend numeric,
  impressions bigint,
  clicks bigint,
  link_clicks bigint,
  landing_page_views bigint,
  leads bigint,
  reach bigint,
  initiate_checkout bigint
)
language sql stable set search_path = ''
as $$
  with project as (
    select sf.client_id, sf.starts_on, sf.ends_on from public.sales_funnels sf where sf.id = p_sales_funnel_id
  ),
  classified as (
    select c.campaign_id, unnest(c.front_ids) as front_id
    from project p, public.get_client_campaigns(p.client_id, p_since, p_until) c
  )
  select
    cl.front_id, cd.data, sum(cd.spend), sum(cd.impressions)::bigint, sum(cd.clicks)::bigint, sum(cd.link_clicks)::bigint,
    sum(cd.landing_page_views)::bigint, sum(cd.leads)::bigint, sum(cd.reach)::bigint, sum(cd.initiate_checkout)::bigint
  from classified cl
  join public.project_fronts f on f.id = cl.front_id and f.sales_funnel_id = p_sales_funnel_id
  join project p on true
  join public.campaign_daily cd
    on cd.client_id = p.client_id and cd.campaign_id = cl.campaign_id and cd.data >= p_since and cd.data < p_until
  where f.source_sales_funnel_id is null
     or ((p.starts_on is null or cd.data >= p.starts_on) and (p.ends_on is null or cd.data <= p.ends_on))
  group by cl.front_id, cd.data
  order by cd.data, cl.front_id
$$;

-- Called by the sync after each campaign read: a campaign with exactly one name match gets that
-- front frozen as its owner, so a later rename does not move its history.
create function public.freeze_campaign_fronts(p_client_id uuid)
returns integer
language sql volatile set search_path = ''
as $$
  with frozen as (
    insert into public.campaign_fronts (client_id, campaign_id, front_id, source)
    select p_client_id, c.campaign_id, c.suggested_front_ids[1], 'auto'
    from public.get_client_campaigns(p_client_id, '2000-01-01', current_date + 1) c
    where c.assignment = 'nome'
    on conflict (client_id, campaign_id) do nothing
    returning 1
  )
  select count(*)::integer from frozen
$$;
revoke all on function public.freeze_campaign_fronts(uuid) from public, anon, authenticated;
grant execute on function public.freeze_campaign_fronts(uuid) to service_role;
