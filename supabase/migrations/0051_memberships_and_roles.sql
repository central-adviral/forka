-- Central de Tráfego, Fase 0: access moves from one owner per client to members with a role.
--
-- Until now every policy and every report function asked the same question, `owner_id = auth.uid()`,
-- so a client could only ever be seen by the one person who created it. The Central needs a team
-- (gestor, analista) and the client's own people (read only) on the same client, isolated from every
-- other client in the database, not just hidden by the screens.
--
-- Roles, from least to most: cliente (read) < analista (read) < gestor (writes tests, funnels) <
-- owner (integrations, members, the client itself). A `staff` admin passes every check.
--
-- `clients.owner_id` stays: it is who created the client, it is what the insert policy checks, and
-- the trigger below turns it into the first `owner` membership. Nothing reads it for access anymore.

create schema if not exists private;
-- Policies run as the caller, so the caller needs to reach the functions they call. The schema is
-- not in the Data API's exposed list, so this does not make anything in it callable over REST.
grant usage on schema private to authenticated, service_role;

create table memberships (
  client_id uuid not null references clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'gestor', 'analista', 'cliente')),
  created_at timestamptz not null default now(),
  primary key (client_id, user_id)
);
create index memberships_user_id_idx on memberships(user_id);

create table staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'gestor')),
  created_at timestamptz not null default now()
);

create function private.role_rank(p_role text)
returns int language sql immutable set search_path = ''
as $$
  select case p_role when 'cliente' then 1 when 'analista' then 2 when 'gestor' then 3 when 'owner' then 4 end
$$;

-- security definer so a policy on `memberships` can call it without recursing into its own RLS.
create function private.has_client_role(p_client_id uuid, p_min_role text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.client_id = p_client_id
      and m.user_id = (select auth.uid())
      and private.role_rank(m.role) >= private.role_rank(p_min_role)
  ) or exists (
    select 1 from public.staff s where s.user_id = (select auth.uid()) and s.role = 'admin'
  )
$$;

-- The set form is what the policies use: `client_id in (select ...)` is evaluated once per query
-- and hashed, where a per-row function call would run once for every click_event scanned.
create function private.accessible_client_ids(p_min_role text)
returns setof uuid language sql stable security definer set search_path = ''
as $$
  select m.client_id from public.memberships m
  where m.user_id = (select auth.uid())
    and private.role_rank(m.role) >= private.role_rank(p_min_role)
  union
  select c.id from public.clients c
  where exists (select 1 from public.staff s where s.user_id = (select auth.uid()) and s.role = 'admin')
$$;

revoke all on function private.role_rank(text), private.has_client_role(uuid, text),
  private.accessible_client_ids(text) from public, anon;
grant execute on function private.role_rank(text), private.has_client_role(uuid, text),
  private.accessible_client_ids(text) to authenticated, service_role;

-- The app's server actions that write with the service role (secrets) check the caller's role
-- through this, on the caller's own session, before bypassing RLS.
create function public.has_client_role(p_client_id uuid, p_min_role text)
returns boolean language sql stable set search_path = ''
as $$ select private.has_client_role(p_client_id, p_min_role) $$;
revoke all on function public.has_client_role(uuid, text) from public, anon;
grant execute on function public.has_client_role(uuid, text) to authenticated, service_role;

-- Every existing owner becomes the owner member of their client.
insert into memberships (client_id, user_id, role)
select id, owner_id, 'owner' from clients
on conflict (client_id, user_id) do nothing;

create function private.add_creator_as_owner()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.memberships (client_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (client_id, user_id) do nothing;
  return new;
end;
$$;
create trigger clients_add_creator_as_owner
  after insert on clients
  for each row execute function private.add_creator_as_owner();

-- ---------------------------------------------------------------------------------------------
-- Policies: every `*_via_client_owner` policy is replaced by a role check.
-- ---------------------------------------------------------------------------------------------

drop policy "clients_owner_all" on clients;
drop policy "tests_via_client_owner" on tests;
drop policy "variants_via_client_owner" on variants;
drop policy "click_events_select_via_client_owner" on click_events;
drop policy "conversions_select_via_client_owner" on conversions;
drop policy "variant_assignments_select_via_client_owner" on variant_assignments;
drop policy "sales_funnels_via_client_owner" on sales_funnels;
drop policy "sales_via_client_owner" on sales;
drop policy "ad_spend_daily_via_client_owner" on ad_spend_daily;
drop policy "ad_creative_spend_daily_via_client_owner" on ad_creative_spend_daily;
drop policy "funnel_sync_state_via_client_owner" on funnel_sync_state;

-- clients: any member reads; only an owner changes or deletes it. Creating a client is still open to
-- any signed-in user for themselves, as it was -- the trigger above makes them its owner. The
-- `owner_id` read lets `insert ... returning` see the row it just wrote: the trigger runs after the
-- RETURNING check, so the membership does not exist yet at that instant.
create policy clients_read on clients for select to authenticated
  using (id in (select private.accessible_client_ids('cliente')) or owner_id = (select auth.uid()));
create policy clients_insert on clients for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy clients_update on clients for update to authenticated
  using (id in (select private.accessible_client_ids('owner')))
  with check (id in (select private.accessible_client_ids('owner')));
create policy clients_delete on clients for delete to authenticated
  using (id in (select private.accessible_client_ids('owner')));

create policy tests_read on tests for select to authenticated
  using (client_id in (select private.accessible_client_ids('cliente')));
create policy tests_insert on tests for insert to authenticated
  with check (client_id in (select private.accessible_client_ids('gestor')));
create policy tests_update on tests for update to authenticated
  using (client_id in (select private.accessible_client_ids('gestor')))
  with check (client_id in (select private.accessible_client_ids('gestor')));
create policy tests_delete on tests for delete to authenticated
  using (client_id in (select private.accessible_client_ids('gestor')));

create policy variants_read on variants for select to authenticated
  using (test_id in (select t.id from tests t where t.client_id in (select private.accessible_client_ids('cliente'))));
create policy variants_insert on variants for insert to authenticated
  with check (test_id in (select t.id from tests t where t.client_id in (select private.accessible_client_ids('gestor'))));
create policy variants_update on variants for update to authenticated
  using (test_id in (select t.id from tests t where t.client_id in (select private.accessible_client_ids('gestor'))))
  with check (test_id in (select t.id from tests t where t.client_id in (select private.accessible_client_ids('gestor'))));
create policy variants_delete on variants for delete to authenticated
  using (test_id in (select t.id from tests t where t.client_id in (select private.accessible_client_ids('gestor'))));

create policy click_events_read on click_events for select to authenticated
  using (test_id in (select t.id from tests t where t.client_id in (select private.accessible_client_ids('cliente'))));
create policy variant_assignments_read on variant_assignments for select to authenticated
  using (test_id in (select t.id from tests t where t.client_id in (select private.accessible_client_ids('cliente'))));
create policy conversions_read on conversions for select to authenticated
  using (click_event_id in (
    select ce.id from click_events ce join tests t on t.id = ce.test_id
    where t.client_id in (select private.accessible_client_ids('cliente'))
  ));

create policy sales_funnels_read on sales_funnels for select to authenticated
  using (client_id in (select private.accessible_client_ids('cliente')));
create policy sales_funnels_insert on sales_funnels for insert to authenticated
  with check (client_id in (select private.accessible_client_ids('gestor')));
create policy sales_funnels_update on sales_funnels for update to authenticated
  using (client_id in (select private.accessible_client_ids('gestor')))
  with check (client_id in (select private.accessible_client_ids('gestor')));
create policy sales_funnels_delete on sales_funnels for delete to authenticated
  using (client_id in (select private.accessible_client_ids('gestor')));

create policy sales_read on sales for select to authenticated
  using (sales_funnel_id in (select sf.id from sales_funnels sf where sf.client_id in (select private.accessible_client_ids('cliente'))));
create policy ad_spend_daily_read on ad_spend_daily for select to authenticated
  using (sales_funnel_id in (select sf.id from sales_funnels sf where sf.client_id in (select private.accessible_client_ids('cliente'))));
create policy ad_creative_spend_daily_read on ad_creative_spend_daily for select to authenticated
  using (sales_funnel_id in (select sf.id from sales_funnels sf where sf.client_id in (select private.accessible_client_ids('cliente'))));
create policy funnel_sync_state_read on funnel_sync_state for select to authenticated
  using (sales_funnel_id in (select sf.id from sales_funnels sf where sf.client_id in (select private.accessible_client_ids('cliente'))));

-- memberships: you see your own rows, and an owner sees and manages everyone on their client.
alter table memberships enable row level security;
create policy memberships_read on memberships for select to authenticated
  using (user_id = (select auth.uid()) or client_id in (select private.accessible_client_ids('owner')));
create policy memberships_insert on memberships for insert to authenticated
  with check (client_id in (select private.accessible_client_ids('owner')));
create policy memberships_update on memberships for update to authenticated
  using (client_id in (select private.accessible_client_ids('owner')))
  with check (client_id in (select private.accessible_client_ids('owner')));
create policy memberships_delete on memberships for delete to authenticated
  using (client_id in (select private.accessible_client_ids('owner')));
grant select, insert, update, delete on memberships to authenticated;
grant select, insert, update, delete on memberships to service_role;

-- staff: read your own row; granting staff is done with the service role only.
alter table staff enable row level security;
create policy staff_read_self on staff for select to authenticated
  using (user_id = (select auth.uid()));
grant select on staff to authenticated;
grant select, insert, update, delete on staff to service_role;
-- Defense in depth if default privileges ever hand these out: RLS already denies, the grants should too.
revoke all on memberships, staff from anon;
revoke insert, update, delete on staff from authenticated;

-- owner_id is who created the client and the clients_read fallback trusts it, so it must not be
-- reassignable: an owner could otherwise hand read access to anyone without a membership.
create function private.forbid_owner_id_change()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'clients.owner_id is immutable; manage access through memberships';
  end if;
  return new;
end;
$$;
create trigger clients_owner_id_immutable
  before update of owner_id on clients
  for each row execute function private.forbid_owner_id_change();

-- A client must keep at least one owner, or only staff could ever manage it again. Cascades from
-- deleting the client or the user are let through: the row is going away with its parent.
create function private.keep_last_owner()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.role <> 'owner' or (tg_op = 'UPDATE' and new.role = 'owner' and new.client_id = old.client_id) then
    return coalesce(new, old);
  end if;
  if not exists (select 1 from public.clients c where c.id = old.client_id)
     or not exists (select 1 from auth.users u where u.id = old.user_id) then
    return coalesce(new, old);
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.client_id = old.client_id and m.role = 'owner' and m.user_id <> old.user_id
  ) then
    raise exception 'a client must keep at least one owner';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger memberships_keep_last_owner
  before update or delete on memberships
  for each row execute function private.keep_last_owner();

-- ---------------------------------------------------------------------------------------------
-- Report functions: same bodies, the ownership check becomes a role check. They are security
-- definer, so they bypass the policies above and must keep doing their own check.
-- Reading reports needs `cliente`; creating a test needs `gestor`.
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_test_with_variants(p_client_id uuid, p_name text, p_slug text, p_fallback_url text, p_conversion_method text, p_test_type text, p_sales_page_url text, p_variants jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_test_id uuid;
  v_total numeric;
begin
  if not private.has_client_role(p_client_id, 'gestor') then
    raise exception 'access denied';
  end if;

  if p_test_type not in ('page', 'checkout') then
    raise exception 'invalid test_type: %', p_test_type;
  end if;

  if p_test_type = 'checkout' and (p_sales_page_url is null or p_sales_page_url = '') then
    raise exception 'checkout tests require a sales page url';
  end if;

  select sum((v->>'weight_pct')::numeric) into v_total from jsonb_array_elements(p_variants) v;
  if v_total is null or abs(v_total - 100) > 0.01 then
    raise exception 'variant weights must sum to 100, got %', v_total;
  end if;

  insert into tests (client_id, name, slug, fallback_url, conversion_method, test_type, sales_page_url)
  values (p_client_id, p_name, p_slug, p_fallback_url, p_conversion_method, p_test_type,
          nullif(p_sales_page_url, ''))
  returning id into v_test_id;

  insert into variants (test_id, name, weight_pct, destination_url, thank_you_url, is_control)
  select v_test_id, v->>'name', (v->>'weight_pct')::numeric, v->>'destination_url', v->>'thank_you_url', (ord = 1)
  from jsonb_array_elements(p_variants) with ordinality as t(v, ord);

  return v_test_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_client_test_access_counts(p_client_id uuid)
 RETURNS TABLE(test_id uuid, total_accesses bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1 from clients c where c.id = p_client_id and private.has_client_role(c.id, 'cliente')
  ) then
    raise exception 'not found or access denied';
  end if;

  return query
  select
    t.id,
    count(ce.id) filter (where ce.is_bot = false)::bigint
  from tests t
  left join click_events ce on ce.test_id = t.id
  where t.client_id = p_client_id
  group by t.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_funnel_report_by_creative(p_sales_funnel_id uuid, p_since date DEFAULT NULL::date, p_until date DEFAULT NULL::date)
 RETURNS TABLE(ad_name text, ad_id text, adset_name text, ad_count integer, spend numeric, impressions bigint, link_clicks bigint, sales_count bigint, revenue numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client_id uuid;
begin
  select sf.client_id into v_client_id
  from sales_funnels sf join clients c on c.id = sf.client_id
  where sf.id = p_sales_funnel_id and private.has_client_role(c.id, 'cliente');

  if v_client_id is null then
    raise exception 'not found or access denied';
  end if;

  return query
  -- NFC on both sides of every name comparison: "Marçal" arrives pre-composed from one source and
  -- decomposed from the other, and plain equality misses every accented name.
  with spend_ads as (
    select
      nullif(acsd.ad_id, '') as ad_id,
      lower(btrim(normalize(coalesce(acsd.ad_name, ''), NFC))) as norm_name,
      lower(btrim(normalize(coalesce(acsd.adset_name, ''), NFC))) as norm_adset,
      lower(btrim(normalize(coalesce(acsd.campaign_name, ''), NFC))) as norm_campaign,
      max(acsd.ad_name) as ad_label,
      max(acsd.adset_name) as adset_label,
      sum(acsd.spend) filter (
        where (p_since is null or acsd.data >= p_since) and (p_until is null or acsd.data < p_until)
      ) as spend,
      sum(acsd.impressions) filter (
        where (p_since is null or acsd.data >= p_since) and (p_until is null or acsd.data < p_until)
      ) as impressions,
      sum(acsd.link_clicks) filter (
        where (p_since is null or acsd.data >= p_since) and (p_until is null or acsd.data < p_until)
      ) as link_clicks
    from ad_creative_spend_daily acsd
    where acsd.sales_funnel_id = p_sales_funnel_id
    group by 1, 2, 3, 4
  ),
  -- One row per ad, so joining a sale to it cannot multiply that sale: an ad renamed mid-flight
  -- has several rows in spend_ads and would otherwise duplicate the revenue joined to it.
  spend_ad_ids as (
    select distinct sa.ad_id from spend_ads sa where sa.ad_id is not null
  ),
  -- Name -> id at three levels of specificity. Every level refuses to resolve a key that serves
  -- more than one ad: unresolved beats resolved wrongly.
  -- `alias_ad_id`, not `ad_id`: plpgsql keeps the RETURNS TABLE column names in scope inside the
  -- body, so an unqualified `ad_id` here would be ambiguous (42702).
  alias_name_adset_campaign as (
    select sa.norm_name, sa.norm_adset, sa.norm_campaign, min(sa.ad_id) as alias_ad_id
    from spend_ads sa
    where sa.ad_id is not null and sa.norm_name <> '' and sa.norm_campaign <> ''
    group by 1, 2, 3
    having count(distinct sa.ad_id) = 1
  ),
  alias_name_adset as (
    select sa.norm_name, sa.norm_adset, min(sa.ad_id) as alias_ad_id
    from spend_ads sa
    where sa.ad_id is not null and sa.norm_name <> ''
    group by 1, 2
    having count(distinct sa.ad_id) = 1
  ),
  alias_name as (
    select sa.norm_name, min(sa.ad_id) as alias_ad_id
    from spend_ads sa
    where sa.ad_id is not null and sa.norm_name <> ''
    group by 1
    having count(distinct sa.ad_id) = 1
  ),
  -- Every click this client ever received, keyed by the tracking id a sale can carry. Not
  -- date-filtered, for the reason 0044 records: which ad a sale came from is a fact about the
  -- sale, not about the window being looked at.
  tracked_clicks as (
    select
      ce.tracking_id::text as tracking_id,
      nullif(ce.source_utms->>'fb_ad_id', '') as click_ad_id,
      nullif(lower(btrim(normalize(coalesce(ce.source_utms->>'utm_term', ''), NFC))), '') as click_norm_name
    from click_events ce
    join variants v on v.id = ce.variant_id
    join tests t on t.id = v.test_id
    where t.client_id = v_client_id
  ),
  sale_rows as (
    select
      s.id as sale_id,
      coalesce(s.valor_liquido, 0) as revenue,
      nullif(lower(btrim(normalize(coalesce(s.utm_term, ''), NFC))), '') as norm_name,
      lower(btrim(normalize(coalesce(s.utm_content, ''), NFC))) as norm_adset,
      -- utm_medium, not utm_campaign: the former is the Meta campaign name, the latter is now the
      -- ad id (and, before the template change, a hand-typed label).
      lower(btrim(normalize(coalesce(s.utm_medium, ''), NFC))) as norm_campaign,
      -- Trailing run of >= 6 digits: the bare {{ad.id}}, or one behind a leftover label.
      substring(coalesce(s.utm_campaign, '') from '([0-9]{6,})[[:space:]]*$') as utm_ad_id,
      s.utm_term as name_label,
      s.utm_content as adset_label,
      tc.click_ad_id,
      tc.click_norm_name
    from sales s
    left join tracked_clicks tc on tc.tracking_id = s.utm_content
    where s.sales_funnel_id = p_sales_funnel_id
      and (p_since is null or s.data_venda >= p_since)
      and (p_until is null or s.data_venda < p_until + 1)
  ),
  resolved_sales as (
    select
      sr.*,
      coalesce(
        sai.ad_id,
        sr.click_ad_id,
        an_click.alias_ad_id,
        anac.alias_ad_id,
        ana.alias_ad_id,
        an.alias_ad_id
      ) as resolved_ad_id,
      -- A sale resolved by id, or through its click, has no adset of its own to report: the adset
      -- is already known from the ad, and utm_content held a tracking id. Blanking it keeps that
      -- tracking id from being read as an adset named like a uuid.
      case
        when sai.ad_id is not null or sr.click_ad_id is not null or an_click.alias_ad_id is not null
          then null
        else sr.adset_label
      end as own_adset_label
    from sale_rows sr
    left join spend_ad_ids sai on sai.ad_id = sr.utm_ad_id
    left join alias_name an_click on an_click.norm_name = sr.click_norm_name
    left join alias_name_adset_campaign anac
      on anac.norm_name = sr.norm_name
     and anac.norm_adset = sr.norm_adset
     and anac.norm_campaign = sr.norm_campaign
    left join alias_name_adset ana on ana.norm_name = sr.norm_name and ana.norm_adset = sr.norm_adset
    left join alias_name an on an.norm_name = sr.norm_name
  ),
  sales_by_key as (
    select
      case
        when rs.resolved_ad_id is not null then 'id:' || rs.resolved_ad_id
        else 'name:' || coalesce(rs.norm_name, '') || '|' || rs.norm_adset
      end as ad_key,
      max(rs.name_label) as name_label,
      max(rs.own_adset_label) as adset_label,
      count(*) as sales_count,
      sum(rs.revenue) as revenue
    from resolved_sales rs
    where rs.norm_name is not null or rs.resolved_ad_id is not null
    group by 1
  ),
  spend_by_key as (
    select
      case
        when sa.ad_id is not null then 'id:' || sa.ad_id
        else 'name:' || sa.norm_name || '|' || sa.norm_adset
      end as ad_key,
      max(sa.ad_label) as ad_label,
      max(sa.adset_label) as adset_label,
      count(distinct sa.ad_id)::integer as n_ads,
      case when count(distinct sa.ad_id) = 1 then max(sa.ad_id) end as resolved_ad_id,
      coalesce(sum(sa.spend), 0) as spend,
      coalesce(sum(sa.impressions), 0) as impressions,
      coalesce(sum(sa.link_clicks), 0) as link_clicks
    from spend_ads sa
    group by 1
  )
  -- Full join: an ad that spent without selling still shows (that is the one worth pausing), and a
  -- sale whose ad has no spend synced still shows its revenue.
  select
    coalesce(sp.ad_label, sl.name_label, '(sem anúncio)'),
    sp.resolved_ad_id,
    nullif(coalesce(sp.adset_label, sl.adset_label, ''), ''),
    coalesce(sp.n_ads, 0),
    coalesce(sp.spend, 0),
    coalesce(sp.impressions, 0)::bigint,
    coalesce(sp.link_clicks, 0)::bigint,
    coalesce(sl.sales_count, 0)::bigint,
    coalesce(sl.revenue, 0)
  from spend_by_key sp
  full outer join sales_by_key sl on sl.ad_key = sp.ad_key
  order by coalesce(sl.revenue, 0) desc, coalesce(sp.spend, 0) desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_funnel_sales_by_hour(p_sales_funnel_id uuid, p_since date DEFAULT NULL::date, p_until date DEFAULT NULL::date)
 RETURNS TABLE(hour integer, sales_count bigint, revenue numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1 from sales_funnels sf join clients c on c.id = sf.client_id
    where sf.id = p_sales_funnel_id and private.has_client_role(c.id, 'cliente')
  ) then
    raise exception 'not found or access denied';
  end if;

  -- Every hour of the day is returned, empty ones included, so the chart keeps a stable
  -- 24-column shape instead of collapsing the quiet hours out of the axis.
  return query
  select
    h.hour::int,
    count(s.id)::bigint,
    coalesce(sum(s.valor_liquido), 0)
  from generate_series(0, 23) as h(hour)
  left join sales s
    on extract(hour from (s.data_venda at time zone 'America/Sao_Paulo')) = h.hour
   and s.sales_funnel_id = p_sales_funnel_id
   and (p_since is null or s.data_venda >= p_since)
   and (p_until is null or s.data_venda < p_until + 1)
  group by h.hour
  order by h.hour;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_funnel_sales_by_product(p_sales_funnel_id uuid, p_since date DEFAULT NULL::date, p_until date DEFAULT NULL::date)
 RETURNS TABLE(produto text, sales_count bigint, revenue numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1 from sales_funnels sf join clients c on c.id = sf.client_id
    where sf.id = p_sales_funnel_id and private.has_client_role(c.id, 'cliente')
  ) then
    raise exception 'not found or access denied';
  end if;

  return query
  select
    coalesce(nullif(btrim(s.produto), ''), '(sem produto)') as produto,
    count(*)::bigint as sales_count,
    sum(coalesce(s.valor_liquido, 0)) as revenue
  from sales s
  where s.sales_funnel_id = p_sales_funnel_id
    and (p_since is null or s.data_venda >= p_since)
    and (p_until is null or s.data_venda < p_until + 1)
  group by 1
  order by 3 desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_test_bot_click_count(p_test_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result bigint;
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and private.has_client_role(c.id, 'cliente')
  ) then
    raise exception 'not found or access denied';
  end if;

  select count(*) into result
  from click_events ce
  where ce.test_id = p_test_id
    and ce.is_bot = true
    and (p_since is null or ce.created_at >= p_since);

  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_test_report(p_test_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(variant_id uuid, variant_name text, weight_pct numeric, visits bigint, conversions bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and private.has_client_role(c.id, 'cliente')
  ) then
    raise exception 'not found or access denied';
  end if;

  return query
  select v.id, v.name, v.weight_pct,
         count(distinct ce.id)::bigint,
         count(distinct cv.id)::bigint
  from variants v
  join tests t on t.id = v.test_id
  left join click_events ce on ce.variant_id = v.id and ce.is_bot = false
    and (p_since is null or ce.created_at >= p_since)
    and (p_until is null or ce.created_at < p_until)
  left join conversions cv on cv.click_event_id = ce.id and cv.source = t.conversion_method
  where v.test_id = p_test_id
  group by v.id, v.name, v.weight_pct
  order by v.name;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_test_report_by_ad(p_test_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(variant_id uuid, variant_name text, ad_name text, clicks bigint, visitors bigint, conversions bigint, revenue_cents bigint, bot_clicks bigint, ad_spend numeric, ad_impressions bigint, ad_link_clicks bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client_id uuid;
  v_conversion_method text;
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and private.has_client_role(c.id, 'cliente')
  ) then
    raise exception 'not found or access denied';
  end if;

  select client_id, conversion_method into v_client_id, v_conversion_method from tests where id = p_test_id;

  return query
  with click_rows as (
    select
      v.id as v_id,
      v.name as v_name,
      ce.id as click_id,
      ce.visitor_id,
      ce.is_bot,
      ce.created_at,
      cv.id as conversion_id,
      cv.value_cents,
      nullif(ce.source_utms->>'fb_ad_id', '') as click_ad_id,
      nullif(ce.source_utms->>'utm_term', '') as click_ad_name,
      nullif(lower(btrim(normalize(coalesce(ce.source_utms->>'utm_term', ''), NFC))), '') as click_norm_name
    from variants v
    left join click_events ce on ce.variant_id = v.id
      and (p_since is null or ce.created_at >= p_since)
      and (p_until is null or ce.created_at < p_until)
    left join conversions cv on cv.click_event_id = ce.id and cv.source = v_conversion_method
    where v.test_id = p_test_id
  ),
  -- Name -> id, learned from every click this test ever received that carried both. Reads the
  -- full history, not the report window: a name a click identified in August still identifies
  -- the same ad in a September report. A name serving two ads is left out -- better unresolved
  -- than resolved wrongly.
  ad_alias as (
    select
      nullif(lower(btrim(normalize(coalesce(ce.source_utms->>'utm_term', ''), NFC))), '') as norm_name,
      min(nullif(ce.source_utms->>'fb_ad_id', '')) as ad_id
    from variants v
    join click_events ce on ce.variant_id = v.id
    where v.test_id = p_test_id
      and nullif(ce.source_utms->>'fb_ad_id', '') is not null
      and nullif(lower(btrim(normalize(coalesce(ce.source_utms->>'utm_term', ''), NFC))), '') is not null
    group by 1
    having count(distinct nullif(ce.source_utms->>'fb_ad_id', '')) = 1
  ),
  -- Second source for the same map, for a name no click ever carried an id for. Same rule.
  spend_alias as (
    select
      lower(btrim(normalize(acsd.ad_name, NFC))) as norm_name,
      min(acsd.ad_id) as ad_id
    from ad_creative_spend_daily acsd
    join sales_funnels sf on sf.id = acsd.sales_funnel_id
    where sf.client_id = v_client_id
      and nullif(acsd.ad_id, '') is not null
      and nullif(btrim(acsd.ad_name), '') is not null
    group by 1
    having count(distinct acsd.ad_id) = 1
  ),
  resolved as (
    select
      c.*,
      coalesce(
        'id:' || coalesce(c.click_ad_id, a.ad_id, sa.ad_id),
        'name:' || c.click_norm_name,
        '(sem anúncio)'
      ) as ad_key
    from click_rows c
    left join ad_alias a on a.norm_name = c.click_norm_name
    left join spend_alias sa on sa.norm_name = c.click_norm_name
  ),
  spend_by_key as (
    select
      case
        when nullif(acsd.ad_id, '') is not null then 'id:' || acsd.ad_id
        else 'name:' || lower(btrim(normalize(coalesce(acsd.ad_name, ''), NFC)))
      end as ad_key,
      max(acsd.ad_name) as spend_label,
      max(acsd.adset_name) as adset_name,
      max(acsd.campaign_name) as campaign_name,
      max(nullif(acsd.ad_id, '')) as ad_id,
      sum(acsd.spend) as spend,
      sum(acsd.impressions) as impressions,
      sum(acsd.link_clicks) as link_clicks
    from ad_creative_spend_daily acsd
    join sales_funnels sf on sf.id = acsd.sales_funnel_id
    where sf.client_id = v_client_id
      and (p_since is null or acsd.data >= p_since::date)
      and (p_until is null or acsd.data < p_until::date)
    group by 1
  ),
  -- Fallback label for an ad the spend sync has not reached yet. The spend table wins when it
  -- has the id, since it holds the name the ad carries in Meta right now -- and it holds one
  -- canonical spelling, where clicks carry whatever bytes the browser sent (NFC or NFD).
  click_label as (
    select ad_key, (array_agg(click_ad_name order by created_at desc nulls last))[1] as label
    from resolved
    where click_ad_name is not null
    group by ad_key
  ),
  base_labels as (
    select
      k.ad_key,
      coalesce(s.spend_label, cl.label, '(sem anúncio)') as base,
      s.adset_name,
      s.campaign_name,
      coalesce(s.ad_id, substring(k.ad_key from '^id:(.+)$')) as ad_id
    from (select distinct ad_key from resolved) k
    left join click_label cl on cl.ad_key = k.ad_key
    left join spend_by_key s on s.ad_key = k.ad_key
  ),
  labels as (
    select
      ad_key,
      case
        when count(*) over (partition by base) = 1 then base
        -- A bucket that never resolved to an id. It is not an ad, it is the leftover traffic of
        -- a name two ads answer to, and saying so beats dressing it up as a third ad.
        when ad_id is null then base || ' · anúncio não identificado'
        when count(*) over (partition by base, coalesce(adset_name, '')) = 1 and adset_name is not null
          then base || ' · ' || adset_name
        when count(*) over (partition by base, coalesce(adset_name, ''), coalesce(campaign_name, '')) = 1
          and campaign_name is not null then base || ' · ' || campaign_name
        else base || ' · id …' || right(ad_id, 6)
      end as label
    from base_labels
  )
  select
    r.v_id,
    r.v_name,
    l.label,
    count(distinct r.click_id) filter (where r.is_bot = false)::bigint,
    count(distinct r.visitor_id) filter (where r.is_bot = false)::bigint,
    count(distinct r.conversion_id) filter (where r.is_bot = false)::bigint,
    coalesce(sum(r.value_cents) filter (where r.is_bot = false), 0)::bigint,
    count(distinct r.click_id) filter (where r.is_bot = true)::bigint,
    max(s.spend),
    max(s.impressions)::bigint,
    max(s.link_clicks)::bigint
  from resolved r
  join labels l on l.ad_key = r.ad_key
  left join spend_by_key s on s.ad_key = r.ad_key
  group by r.v_id, r.v_name, r.ad_key, l.label
  order by r.v_name, l.label;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_test_report_by_hour(p_test_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(hour integer, clicks bigint, conversions bigint, revenue_cents bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_conversion_method text;
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and private.has_client_role(c.id, 'cliente')
  ) then
    raise exception 'not found or access denied';
  end if;

  select t.conversion_method into v_conversion_method from tests t where t.id = p_test_id;

  return query
  select
    d.hour,
    count(distinct ce.id)::bigint,
    count(distinct cv.id)::bigint,
    coalesce(sum(cv.value_cents), 0)::bigint
  from generate_series(0, 23) as d(hour)
  left join click_events ce
    on ce.test_id = p_test_id
    and ce.is_bot = false
    and extract(hour from ce.created_at at time zone 'America/Sao_Paulo')::int = d.hour
    and (p_since is null or ce.created_at >= p_since)
    and (p_until is null or ce.created_at < p_until)
  left join conversions cv on cv.click_event_id = ce.id and cv.source = v_conversion_method
  group by d.hour
  order by d.hour;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_test_report_by_source(p_test_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(variant_id uuid, variant_name text, utm_source text, clicks bigint, visitors bigint, conversions bigint, revenue_cents bigint, bot_clicks bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client_id uuid;
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and private.has_client_role(c.id, 'cliente')
  ) then
    raise exception 'not found or access denied';
  end if;

  select client_id into v_client_id from tests where id = p_test_id;

  return query
  select
    v.id,
    v.name,
    coalesce(nullif(ce.source_utms->>'utm_source', ''), '(direto)') as utm_source,
    count(distinct ce.id) filter (where ce.is_bot = false)::bigint,
    count(distinct ce.visitor_id) filter (where ce.is_bot = false)::bigint,
    count(distinct cv.id) filter (where ce.is_bot = false)::bigint,
    coalesce(sum(cv.value_cents) filter (where ce.is_bot = false), 0)::bigint,
    count(distinct ce.id) filter (where ce.is_bot = true)::bigint
  from variants v
  join tests t on t.id = v.test_id
  left join click_events ce on ce.variant_id = v.id
    and (p_since is null or ce.created_at >= p_since)
    and (p_until is null or ce.created_at < p_until)
  left join conversions cv on cv.click_event_id = ce.id and cv.source = t.conversion_method
  where v.test_id = p_test_id
  group by v.id, v.name, coalesce(nullif(ce.source_utms->>'utm_source', ''), '(direto)')
  order by v.name, utm_source;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_test_report_by_weekday(p_test_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(weekday integer, clicks bigint, conversions bigint, revenue_cents bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_conversion_method text;
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and private.has_client_role(c.id, 'cliente')
  ) then
    raise exception 'not found or access denied';
  end if;

  select t.conversion_method into v_conversion_method from tests t where t.id = p_test_id;

  return query
  select
    d.weekday,
    count(distinct ce.id)::bigint,
    count(distinct cv.id)::bigint,
    coalesce(sum(cv.value_cents), 0)::bigint
  from generate_series(0, 6) as d(weekday)
  left join click_events ce
    on ce.test_id = p_test_id
    and ce.is_bot = false
    and extract(dow from ce.created_at at time zone 'America/Sao_Paulo')::int = d.weekday
    and (p_since is null or ce.created_at >= p_since)
    and (p_until is null or ce.created_at < p_until)
  left join conversions cv on cv.click_event_id = ce.id and cv.source = v_conversion_method
  group by d.weekday
  order by d.weekday;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_test_report_totals(p_test_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(variant_id uuid, variant_name text, clicks bigint, visitors bigint, conversions bigint, revenue_cents bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and private.has_client_role(c.id, 'cliente')
  ) then
    raise exception 'not found or access denied';
  end if;

  return query
  select
    v.id,
    v.name,
    count(distinct ce.id)::bigint,
    count(distinct ce.visitor_id)::bigint,
    count(distinct cv.id)::bigint,
    coalesce(sum(cv.value_cents), 0)::bigint
  from variants v
  join tests t on t.id = v.test_id
  left join click_events ce on ce.variant_id = v.id and ce.is_bot = false
    and (p_since is null or ce.created_at >= p_since)
    and (p_until is null or ce.created_at < p_until)
  left join conversions cv on cv.click_event_id = ce.id and cv.source = t.conversion_method
  where v.test_id = p_test_id
  group by v.id, v.name
  order by v.name;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_usage_stats()
 RETURNS TABLE(total_clients bigint, total_tests bigint, total_click_events bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
  select
    (select count(*) from clients where id in (select private.accessible_client_ids('cliente')))::bigint,
    (select count(*) from tests t where t.client_id in (select private.accessible_client_ids('cliente')))::bigint,
    (select count(*)
       from click_events ce
       join tests t on t.id = ce.test_id
       where t.client_id in (select private.accessible_client_ids('cliente')))::bigint;
end;
$function$;
