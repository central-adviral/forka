-- Central de Tráfego, Fase 1: campaigns as the unit of spend, classified into project fronts by name.
--
-- Until now a project only saw spend through LaunchOps' operation mapping (campanha_meta_frente),
-- which stopped being maintained on 2026-08-25: every campaign created after that reaches
-- LaunchOps with no operation, so no project ever counted it. Here the Central keeps every
-- campaign's daily numbers per client, whatever its operation, and decides which project front a
-- campaign belongs to from rules on its name -- the "Regras de campanha" screen of the prototype.

create table campaign_daily (
  client_id uuid not null references clients(id) on delete cascade,
  data date not null,
  campaign_id text not null,
  campaign_name text not null,
  spend numeric not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  link_clicks bigint not null default 0,
  landing_page_views bigint not null default 0,
  leads bigint not null default 0,
  reach bigint not null default 0,
  initiate_checkout bigint not null default 0,
  synced_at timestamptz not null default now(),
  primary key (client_id, data, campaign_id)
);
create index campaign_daily_client_campaign_idx on campaign_daily (client_id, campaign_id, data);

create table project_fronts (
  id uuid primary key default gen_random_uuid(),
  sales_funnel_id uuid not null references sales_funnels(id) on delete cascade,
  code text not null check (btrim(code) <> ''),
  name text not null check (btrim(name) <> ''),
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (sales_funnel_id, code)
);

-- A front takes a campaign when its name contains every `include` value and none of the
-- `exclude` values, case- and accent-composition-insensitive. A front with no include takes
-- nothing: an empty front must not swallow every campaign of the client.
create table naming_rules (
  id uuid primary key default gen_random_uuid(),
  front_id uuid not null references project_fronts(id) on delete cascade,
  kind text not null check (kind in ('include', 'exclude')),
  value text not null check (btrim(value) <> ''),
  created_at timestamptz not null default now(),
  unique (front_id, kind, value)
);

alter table campaign_daily enable row level security;
alter table project_fronts enable row level security;
alter table naming_rules enable row level security;

create policy campaign_daily_read on campaign_daily for select to authenticated
  using (client_id in (select private.accessible_client_ids('cliente')));

create policy project_fronts_read on project_fronts for select to authenticated
  using (sales_funnel_id in (select sf.id from sales_funnels sf where sf.client_id in (select private.accessible_client_ids('cliente'))));
create policy project_fronts_insert on project_fronts for insert to authenticated
  with check (sales_funnel_id in (select sf.id from sales_funnels sf where sf.client_id in (select private.accessible_client_ids('gestor'))));
create policy project_fronts_update on project_fronts for update to authenticated
  using (sales_funnel_id in (select sf.id from sales_funnels sf where sf.client_id in (select private.accessible_client_ids('gestor'))))
  with check (sales_funnel_id in (select sf.id from sales_funnels sf where sf.client_id in (select private.accessible_client_ids('gestor'))));
create policy project_fronts_delete on project_fronts for delete to authenticated
  using (sales_funnel_id in (select sf.id from sales_funnels sf where sf.client_id in (select private.accessible_client_ids('gestor'))));

create policy naming_rules_read on naming_rules for select to authenticated
  using (front_id in (select f.id from project_fronts f));
create policy naming_rules_insert on naming_rules for insert to authenticated
  with check (front_id in (
    select f.id from project_fronts f join sales_funnels sf on sf.id = f.sales_funnel_id
    where sf.client_id in (select private.accessible_client_ids('gestor'))));
create policy naming_rules_delete on naming_rules for delete to authenticated
  using (front_id in (
    select f.id from project_fronts f join sales_funnels sf on sf.id = f.sales_funnel_id
    where sf.client_id in (select private.accessible_client_ids('gestor'))));

grant select on campaign_daily to authenticated;
grant select, insert, update, delete on campaign_daily to service_role;
grant select, insert, update, delete on project_fronts, naming_rules to authenticated, service_role;
revoke all on campaign_daily, project_fronts, naming_rules from anon;

-- Every campaign of the client with spend in the window, with the fronts (of any project of the
-- client) its latest name falls into. An empty `front_ids` is a campaign no report counts; more
-- than one is spend that would be counted twice. security invoker: RLS decides what is visible.
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
  front_ids uuid[]
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
    where sf.client_id = p_client_id
    group by f.id
  )
  select
    c.campaign_id, c.campaign_name, c.spend, c.impressions, c.link_clicks, c.leads, c.first_day, c.last_day,
    coalesce(
      (select array_agg(f.id order by f.id) from fronts f
       where f.includes is not null
         and (select bool_and(strpos(lower(normalize(c.campaign_name, NFC)), i) > 0) from unnest(f.includes) i)
         and not coalesce((select bool_or(strpos(lower(normalize(c.campaign_name, NFC)), e) > 0) from unnest(f.excludes) e), false)),
      '{}'
    )
  from campaigns c
  order by c.spend desc
$$;
revoke all on function public.get_client_campaigns(uuid, date, date) from public, anon;
grant execute on function public.get_client_campaigns(uuid, date, date) to authenticated, service_role;

-- Daily numbers per front of one project, summed from the campaigns its rules take.
create function public.get_project_front_daily(p_sales_funnel_id uuid, p_since date, p_until date)
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
    select sf.client_id from public.sales_funnels sf where sf.id = p_sales_funnel_id
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
  group by cl.front_id, cd.data
  order by cd.data, cl.front_id
$$;
revoke all on function public.get_project_front_daily(uuid, date, date) from public, anon;
grant execute on function public.get_project_front_daily(uuid, date, date) to authenticated, service_role;

-- One row per São Paulo day for a project: sales summed in the database (the client-side sum this
-- replaces read at most 1000 sales and silently undercounted any busy period), and spend from the
-- project's fronts once it has any -- otherwise from the LaunchOps operation mapping, as before.
create function public.get_funnel_daily(p_sales_funnel_id uuid, p_since date, p_until date)
returns table (
  data date,
  vendas bigint,
  receita_bruta numeric,
  receita_liquida numeric,
  spend numeric,
  impressions bigint,
  clicks bigint,
  reach bigint,
  link_clicks bigint,
  landing_page_views bigint,
  initiate_checkout bigint,
  spend_source text
)
language sql stable set search_path = ''
as $$
  with by_fronts as (
    select exists (select 1 from public.project_fronts f where f.sales_funnel_id = p_sales_funnel_id) as yes
  ),
  sales as (
    select
      (s.data_venda at time zone 'America/Sao_Paulo')::date as data,
      count(*) as vendas,
      coalesce(sum(s.valor_bruto), 0) as receita_bruta,
      coalesce(sum(s.valor_liquido), 0) as receita_liquida
    from public.sales s
    where s.sales_funnel_id = p_sales_funnel_id
      and s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
      and s.data_venda < (p_until::timestamp at time zone 'America/Sao_Paulo')
    group by 1
  ),
  spend as (
    select fd.data, sum(fd.spend) as spend, sum(fd.impressions) as impressions, sum(fd.clicks) as clicks,
      sum(fd.reach) as reach, sum(fd.link_clicks) as link_clicks, sum(fd.landing_page_views) as landing_page_views,
      sum(fd.initiate_checkout) as initiate_checkout
    from public.get_project_front_daily(p_sales_funnel_id, p_since, p_until) fd, by_fronts
    where by_fronts.yes
    group by fd.data
    union all
    select a.data, sum(a.spend), sum(a.impressions), sum(a.clicks), sum(a.reach), sum(a.link_clicks),
      sum(a.landing_page_views), sum(a.initiate_checkout)
    from public.ad_spend_daily a, by_fronts
    where not by_fronts.yes and a.sales_funnel_id = p_sales_funnel_id and a.data >= p_since and a.data < p_until
    group by a.data
  )
  select
    coalesce(s.data, sp.data),
    coalesce(s.vendas, 0)::bigint,
    coalesce(s.receita_bruta, 0),
    coalesce(s.receita_liquida, 0),
    coalesce(sp.spend, 0),
    coalesce(sp.impressions, 0)::bigint,
    coalesce(sp.clicks, 0)::bigint,
    coalesce(sp.reach, 0)::bigint,
    coalesce(sp.link_clicks, 0)::bigint,
    coalesce(sp.landing_page_views, 0)::bigint,
    coalesce(sp.initiate_checkout, 0)::bigint,
    case when (select yes from by_fronts) then 'frentes' else 'operacao' end
  from sales s
  full join spend sp on sp.data = s.data
  order by 1
$$;
revoke all on function public.get_funnel_daily(uuid, date, date) from public, anon;
grant execute on function public.get_funnel_daily(uuid, date, date) to authenticated, service_role;

-- Same 1000-row undercount, same fix: revenue per payment method summed in the database.
create function public.get_funnel_payment_breakdown(p_sales_funnel_id uuid, p_since date, p_until date)
returns table (metodo text, receita numeric)
language sql stable set search_path = ''
as $$
  select coalesce(s.metodo_pagamento, 'desconhecido'), coalesce(sum(s.valor_bruto), 0)
  from public.sales s
  where s.sales_funnel_id = p_sales_funnel_id
    and s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
    and s.data_venda < (p_until::timestamp at time zone 'America/Sao_Paulo')
  group by 1
  order by 2 desc
$$;
revoke all on function public.get_funnel_payment_breakdown(uuid, date, date) from public, anon;
grant execute on function public.get_funnel_payment_breakdown(uuid, date, date) to authenticated, service_role;
