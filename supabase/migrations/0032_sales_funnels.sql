-- supabase/migrations/0032_sales_funnels.sql

-- Credencial de acesso à fonte de dados do funil, por cliente (substitui as variáveis de
-- ambiente globais LAUNCHOPS_SUPABASE_URL/LAUNCHOPS_SUPABASE_SERVICE_ROLE_KEY).
alter table clients add column funnel_source_url text;
alter table clients add column funnel_source_service_role_key text;

create table sales_funnels (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  slug text not null,
  launchops_operacao_ids uuid[],
  launchops_produto_nomes text[],
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, slug)
);

alter table sales_funnels enable row level security;
create policy "sales_funnels_via_client_owner" on sales_funnels
  for all using (exists (select 1 from clients c where c.id = sales_funnels.client_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from clients c where c.id = sales_funnels.client_id and c.owner_id = auth.uid()));

grant select, insert, update, delete on sales_funnels to authenticated;

-- sales: client_id -> sales_funnel_id
-- 0029 created an RLS policy referencing sales.client_id directly -- must drop it
-- before the column can be dropped, then recreate it (same name) through sales_funnels.
drop policy "sales_via_client_owner" on sales;
alter table sales drop constraint sales_client_id_source_external_id_key;
alter table sales drop column client_id;
alter table sales add column sales_funnel_id uuid not null references sales_funnels(id) on delete cascade;
alter table sales add constraint sales_funnel_source_external_id_key unique (sales_funnel_id, source, external_id);
create policy "sales_via_client_owner" on sales
  for select using (exists (
    select 1 from sales_funnels sf join clients c on c.id = sf.client_id
    where sf.id = sales.sales_funnel_id and c.owner_id = auth.uid()
  ));

-- ad_spend_daily: client_id -> sales_funnel_id (same RLS caveat as sales above)
drop policy "ad_spend_daily_via_client_owner" on ad_spend_daily;
alter table ad_spend_daily drop constraint ad_spend_daily_client_id_source_operacao_id_data_key;
alter table ad_spend_daily drop column client_id;
alter table ad_spend_daily add column sales_funnel_id uuid not null references sales_funnels(id) on delete cascade;
alter table ad_spend_daily add constraint ad_spend_daily_funnel_source_operacao_data_key
  unique (sales_funnel_id, source, operacao_id, data);
create policy "ad_spend_daily_via_client_owner" on ad_spend_daily
  for select using (exists (
    select 1 from sales_funnels sf join clients c on c.id = sf.client_id
    where sf.id = ad_spend_daily.sales_funnel_id and c.owner_id = auth.uid()
  ));

-- ad_creative_spend_daily: client_id -> sales_funnel_id (same RLS caveat as sales above)
drop policy "ad_creative_spend_daily_via_client_owner" on ad_creative_spend_daily;
alter table ad_creative_spend_daily drop constraint ad_creative_spend_daily_client_id_source_data_ad_id_ad_name_key;
alter table ad_creative_spend_daily drop column client_id;
alter table ad_creative_spend_daily add column sales_funnel_id uuid not null references sales_funnels(id) on delete cascade;
alter table ad_creative_spend_daily add constraint ad_creative_spend_daily_funnel_source_data_ad_key
  unique nulls not distinct (sales_funnel_id, source, data, ad_id, ad_name);
drop index if exists ad_creative_spend_daily_report_idx;
create index ad_creative_spend_daily_report_idx
  on ad_creative_spend_daily(sales_funnel_id, ad_id, ad_name, data);
create policy "ad_creative_spend_daily_via_client_owner" on ad_creative_spend_daily
  for select using (exists (
    select 1 from sales_funnels sf join clients c on c.id = sf.client_id
    where sf.id = ad_creative_spend_daily.sales_funnel_id and c.owner_id = auth.uid()
  ));

-- funnel_sync_state: client_id -> sales_funnel_id (new composite PK; same RLS caveat as sales above)
drop policy "funnel_sync_state_via_client_owner" on funnel_sync_state;
alter table funnel_sync_state drop constraint funnel_sync_state_pkey;
alter table funnel_sync_state drop column client_id;
alter table funnel_sync_state add column sales_funnel_id uuid not null references sales_funnels(id) on delete cascade;
alter table funnel_sync_state add primary key (sales_funnel_id, entity);
create policy "funnel_sync_state_via_client_owner" on funnel_sync_state
  for select using (exists (
    select 1 from sales_funnels sf join clients c on c.id = sf.client_id
    where sf.id = funnel_sync_state.sales_funnel_id and c.owner_id = auth.uid()
  ));

-- Campos antigos no client nunca foram preenchidos (confirmado 2026-09-04) -- remove sem backfill.
alter table clients drop column launchops_operacao_ids;
alter table clients drop column launchops_produto_nomes;

-- get_test_report_by_ad: ad_spend_agg agora soma o gasto de TODOS os sales_funnels do cliente
-- do teste (ad_creative_spend_daily não carrega mais client_id direto). Resto da função
-- (exclusão de bot, receita, contagem de clique/visitante, casamento por identidade do
-- anúncio) inalterado desde a 0031.
drop function if exists get_test_report_by_ad(uuid, timestamptz, timestamptz);

create or replace function get_test_report_by_ad(p_test_id uuid, p_since timestamptz default null, p_until timestamptz default null)
returns table (
  variant_id uuid,
  variant_name text,
  ad_name text,
  clicks bigint,
  visitors bigint,
  conversions bigint,
  revenue_cents bigint,
  bot_clicks bigint,
  ad_spend numeric,
  ad_impressions bigint,
  ad_link_clicks bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and c.owner_id = auth.uid()
  ) then
    raise exception 'not found or access denied';
  end if;

  select client_id into v_client_id from tests where id = p_test_id;

  return query
  with ad_spend_agg as (
    select
      coalesce(nullif(acsd.ad_id, ''), nullif(acsd.ad_name, '')) as ad_ref,
      sum(acsd.spend) as spend,
      sum(acsd.impressions) as impressions,
      sum(acsd.link_clicks) as link_clicks
    from ad_creative_spend_daily acsd
    join sales_funnels sf on sf.id = acsd.sales_funnel_id
    where sf.client_id = v_client_id
      and (p_since is null or acsd.data >= p_since::date)
      and (p_until is null or acsd.data < p_until::date)
    group by coalesce(nullif(acsd.ad_id, ''), nullif(acsd.ad_name, ''))
  )
  select
    v.id,
    v.name,
    coalesce(nullif(ce.source_utms->>'fb_ad_id', ''), nullif(ce.source_utms->>'utm_term', ''), '(sem anúncio)') as ad_name,
    count(distinct ce.id) filter (where ce.is_bot = false)::bigint,
    count(distinct ce.visitor_id) filter (where ce.is_bot = false)::bigint,
    count(distinct cv.id) filter (where ce.is_bot = false)::bigint,
    coalesce(sum(cv.value_cents) filter (where ce.is_bot = false), 0)::bigint,
    count(distinct ce.id) filter (where ce.is_bot = true)::bigint,
    max(asa.spend),
    max(asa.impressions)::bigint,
    max(asa.link_clicks)::bigint
  from variants v
  join tests t on t.id = v.test_id
  left join click_events ce on ce.variant_id = v.id
    and (p_since is null or ce.created_at >= p_since)
    and (p_until is null or ce.created_at < p_until)
  left join conversions cv on cv.click_event_id = ce.id and cv.source = t.conversion_method
  left join ad_spend_agg asa
    on asa.ad_ref = coalesce(nullif(ce.source_utms->>'fb_ad_id', ''), nullif(ce.source_utms->>'utm_term', ''))
  where v.test_id = p_test_id
  group by v.id, v.name, coalesce(nullif(ce.source_utms->>'fb_ad_id', ''), nullif(ce.source_utms->>'utm_term', ''), '(sem anúncio)')
  order by v.name, ad_name;
end;
$$;

revoke all on function get_test_report_by_ad(uuid, timestamptz, timestamptz) from public;
grant execute on function get_test_report_by_ad(uuid, timestamptz, timestamptz) to authenticated;
