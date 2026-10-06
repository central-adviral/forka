-- Central de Tráfego: each project says what role every product plays.
--
-- Until now a project was a bare list of product names and the upsell flag came from LaunchOps.
-- The gestor now classifies every product of the project: entrada (the CPA base), order bump,
-- upsell/downsell (both in the front revenue and ROAS) and ascensão (the high-ticket sold later,
-- reported as a ROAS of its own beside the front one). The role is stored on each sale so every
-- read-out keeps a plain filter; a product the gestor has not classified falls back to the
-- LaunchOps flag. The product list the sync reads is now derived from this table.

create table project_products (
  sales_funnel_id uuid not null references sales_funnels(id) on delete cascade,
  produto_nome text not null check (btrim(produto_nome) <> ''),
  papel text not null check (papel in ('entrada', 'order_bump', 'upsell', 'ascensao')),
  created_at timestamptz not null default now(),
  primary key (sales_funnel_id, produto_nome)
);
alter table project_products enable row level security;
create policy project_products_read on project_products for select to authenticated
  using (sales_funnel_id in (select sf.id from sales_funnels sf where sf.client_id in (select private.accessible_client_ids('cliente'))));
create policy project_products_write on project_products for all to authenticated
  using (sales_funnel_id in (select sf.id from sales_funnels sf where sf.client_id in (select private.accessible_client_ids('gestor'))))
  with check (sales_funnel_id in (select sf.id from sales_funnels sf where sf.client_id in (select private.accessible_client_ids('gestor'))));
grant select, insert, update, delete on project_products to authenticated, service_role;
revoke all on project_products from anon;

insert into project_products (sales_funnel_id, produto_nome, papel)
select sf.id, nome, 'entrada' from sales_funnels sf, unnest(sf.launchops_produto_nomes) nome
on conflict do nothing;

alter table sales add column papel text not null default 'entrada'
  check (papel in ('entrada', 'order_bump', 'upsell', 'ascensao'));

create function private.sale_papel(p_sales_funnel_id uuid, p_produto text, p_is_upsell boolean) returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select pp.papel from public.project_products pp where pp.sales_funnel_id = p_sales_funnel_id and pp.produto_nome = p_produto),
    case when p_is_upsell then 'upsell' else 'entrada' end)
$$;

create function private.set_sale_papel() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.papel := private.sale_papel(new.sales_funnel_id, new.produto, new.is_upsell);
  return new;
end
$$;
create trigger sales_set_papel before insert or update of produto, is_upsell, sales_funnel_id on sales
  for each row execute function private.set_sale_papel();

update sales set papel = private.sale_papel(sales_funnel_id, produto, is_upsell);

-- A product change re-labels the project's sales, keeps the sync's name list in step and, when a
-- product enters the list, re-reads the sales history (the cursor only moves forward). A product
-- that leaves the project takes its sales with it.
create function private.project_products_changed() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_funnel uuid := coalesce(new.sales_funnel_id, old.sales_funnel_id);
begin
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and new.produto_nome <> old.produto_nome) then
    delete from public.sales where sales_funnel_id = v_funnel and produto = old.produto_nome;
  end if;
  if tg_op <> 'DELETE' then
    update public.sales set papel = new.papel
     where sales_funnel_id = v_funnel and produto = new.produto_nome and papel <> new.papel;
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.produto_nome <> old.produto_nome) then
    delete from public.funnel_sync_state where sales_funnel_id = v_funnel and entity = 'sales';
  end if;
  update public.sales_funnels
     set launchops_produto_nomes = coalesce(
       (select array_agg(pp.produto_nome order by pp.produto_nome) from public.project_products pp where pp.sales_funnel_id = v_funnel),
       '{}')
   where id = v_funnel;
  return null;
end
$$;
create trigger project_products_changed after insert or update or delete on project_products
  for each row execute function private.project_products_changed();

drop function public.get_funnel_daily(uuid, date, date);
create function public.get_funnel_daily(p_sales_funnel_id uuid, p_since date, p_until date)
returns table (
  data date,
  vendas bigint,
  vendas_anuncio bigint,
  vendas_upsell bigint,
  receita_bruta numeric,
  receita_liquida numeric,
  spend numeric,
  spend_com_imposto numeric,
  impressions bigint,
  clicks bigint,
  reach bigint,
  link_clicks bigint,
  landing_page_views bigint,
  initiate_checkout bigint,
  spend_source text,
  dados_ate timestamptz,
  vendas_apos_dados bigint,
  vendas_ascensao bigint,
  receita_ascensao_bruta numeric,
  receita_ascensao_liquida numeric
)
language sql stable set search_path = ''
as $$
  with project as (
    select sf.client_id from public.sales_funnels sf where sf.id = p_sales_funnel_id
  ),
  -- Today's spend is the Meta's number as of the last pull; sales keep arriving after it. Today's
  -- sales are cut at that moment so its CPA compares like with like; the rest is reported apart.
  today as (
    select
      (now() at time zone 'America/Sao_Paulo')::date as data,
      (select max(cd.source_updated_at) from public.campaign_daily cd, project p
       where cd.client_id = p.client_id and cd.data = (now() at time zone 'America/Sao_Paulo')::date) as dados_ate
  ),
  by_fronts as (
    select exists (select 1 from public.project_fronts f where f.sales_funnel_id = p_sales_funnel_id) as yes,
      (select min(cd.data) from public.campaign_daily cd, project p where cd.client_id = p.client_id) as since
  ),
  dated_sales as (
    select s.*, (s.data_venda at time zone 'America/Sao_Paulo')::date as data_sp,
      (t.dados_ate is not null and (s.data_venda at time zone 'America/Sao_Paulo')::date = t.data and s.data_venda > t.dados_ate) as apos_dados
    from public.sales s, today t
    where s.sales_funnel_id = p_sales_funnel_id
      and s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
      and s.data_venda < (p_until::timestamp at time zone 'America/Sao_Paulo')
  ),
  sales as (
    select
      s.data_sp as data,
      count(*) filter (where s.papel = 'entrada' and not s.apos_dados) as vendas,
      count(*) filter (where s.papel = 'entrada' and not s.apos_dados and s.origem in ('anuncio', 'anuncio_legado')) as vendas_anuncio,
      count(*) filter (where s.papel in ('order_bump', 'upsell') and not s.apos_dados) as vendas_upsell,
      coalesce(sum(s.valor_bruto) filter (where s.papel <> 'ascensao' and not s.apos_dados), 0) as receita_bruta,
      coalesce(sum(s.valor_liquido) filter (where s.papel <> 'ascensao' and not s.apos_dados), 0) as receita_liquida,
      count(*) filter (where s.apos_dados) as vendas_apos_dados,
      count(*) filter (where s.papel = 'ascensao' and not s.apos_dados) as vendas_ascensao,
      coalesce(sum(s.valor_bruto) filter (where s.papel = 'ascensao' and not s.apos_dados), 0) as receita_ascensao_bruta,
      coalesce(sum(s.valor_liquido) filter (where s.papel = 'ascensao' and not s.apos_dados), 0) as receita_ascensao_liquida
    from dated_sales s
    group by 1
  ),
  spend as (
    select fd.data, sum(fd.spend) as spend, sum(fd.impressions) as impressions, sum(fd.clicks) as clicks,
      sum(fd.reach) as reach, sum(fd.link_clicks) as link_clicks, sum(fd.landing_page_views) as landing_page_views,
      sum(fd.initiate_checkout) as initiate_checkout
    from public.get_project_front_daily(p_sales_funnel_id, p_since, p_until) fd, by_fronts
    where by_fronts.yes and fd.data >= by_fronts.since
    group by fd.data
    union all
    select a.data, sum(a.spend), sum(a.impressions), sum(a.clicks), sum(a.reach), sum(a.link_clicks),
      sum(a.landing_page_views), sum(a.initiate_checkout)
    from public.ad_spend_daily a, by_fronts
    where not (by_fronts.yes and a.data >= coalesce(by_fronts.since, 'infinity'::date)) and a.sales_funnel_id = p_sales_funnel_id and a.data >= p_since and a.data < p_until
    group by a.data
  ),
  days as (
    select
      coalesce(s.data, sp.data) as data,
      coalesce(s.vendas, 0)::bigint as vendas,
      coalesce(s.vendas_anuncio, 0)::bigint as vendas_anuncio,
      coalesce(s.vendas_upsell, 0)::bigint as vendas_upsell,
      coalesce(s.receita_bruta, 0) as receita_bruta,
      coalesce(s.receita_liquida, 0) as receita_liquida,
      coalesce(sp.spend, 0) as spend,
      coalesce(sp.impressions, 0)::bigint as impressions,
      coalesce(sp.clicks, 0)::bigint as clicks,
      coalesce(sp.reach, 0)::bigint as reach,
      coalesce(sp.link_clicks, 0)::bigint as link_clicks,
      coalesce(sp.landing_page_views, 0)::bigint as landing_page_views,
      coalesce(sp.initiate_checkout, 0)::bigint as initiate_checkout,
      coalesce(s.vendas_apos_dados, 0)::bigint as vendas_apos_dados,
      coalesce(s.vendas_ascensao, 0)::bigint as vendas_ascensao,
      coalesce(s.receita_ascensao_bruta, 0) as receita_ascensao_bruta,
      coalesce(s.receita_ascensao_liquida, 0) as receita_ascensao_liquida
    from sales s
    full join spend sp on sp.data = s.data
  )
  select
    d.data, d.vendas, d.vendas_anuncio, d.vendas_upsell, d.receita_bruta, d.receita_liquida, d.spend,
    d.spend * coalesce(
      (select t.factor from public.client_tax_rates t, project p
       where t.client_id = p.client_id and t.valid_from <= d.data
       order by t.valid_from desc limit 1),
      1),
    d.impressions, d.clicks, d.reach, d.link_clicks, d.landing_page_views, d.initiate_checkout,
    case when (select b.yes and d.data >= b.since from by_fronts b) then 'frentes' else 'operacao' end,
    case when d.data = (select t.data from today t) then (select t.dados_ate from today t) end,
    d.vendas_apos_dados, d.vendas_ascensao, d.receita_ascensao_bruta, d.receita_ascensao_liquida
  from days d
  order by 1
$$;
revoke all on function public.get_funnel_daily(uuid, date, date) from public, anon;
grant execute on function public.get_funnel_daily(uuid, date, date) to authenticated, service_role;

drop function public.get_client_daily(uuid, date, date);
create function public.get_client_daily(p_client_id uuid, p_since date, p_until date)
returns table (
  data date,
  spend numeric,
  spend_com_imposto numeric,
  leads bigint,
  vendas bigint,
  vendas_anuncio bigint,
  receita_liquida numeric,
  dados_ate timestamptz,
  vendas_apos_dados bigint,
  receita_ascensao_liquida numeric
)
language sql stable set search_path = ''
as $$
  with today as (
    select
      (now() at time zone 'America/Sao_Paulo')::date as data,
      (select max(cd.source_updated_at) from public.campaign_daily cd
       where cd.client_id = p_client_id and cd.data = (now() at time zone 'America/Sao_Paulo')::date) as dados_ate
  ),
  spend as (
    select cd.data, sum(cd.spend) as spend, sum(cd.leads) as leads
    from public.campaign_daily cd
    where cd.client_id = p_client_id and cd.data >= p_since and cd.data < p_until
    group by cd.data
  ),
  sales as (
    select
      (s.data_venda at time zone 'America/Sao_Paulo')::date as data,
      (t.dados_ate is not null and (s.data_venda at time zone 'America/Sao_Paulo')::date = t.data and s.data_venda > t.dados_ate) as apos_dados,
      s.papel, s.origem, s.valor_liquido
    from public.sales s
    join public.sales_funnels sf on sf.id = s.sales_funnel_id and sf.client_id = p_client_id
    cross join today t
    where s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
      and s.data_venda < (p_until::timestamp at time zone 'America/Sao_Paulo')
  ),
  sales_by_day as (
    select
      data,
      count(*) filter (where papel = 'entrada' and not apos_dados) as vendas,
      count(*) filter (where papel = 'entrada' and not apos_dados and origem in ('anuncio', 'anuncio_legado')) as vendas_anuncio,
      coalesce(sum(valor_liquido) filter (where papel <> 'ascensao' and not apos_dados), 0) as receita_liquida,
      count(*) filter (where apos_dados) as vendas_apos_dados,
      coalesce(sum(valor_liquido) filter (where papel = 'ascensao' and not apos_dados), 0) as receita_ascensao_liquida
    from sales
    group by data
  )
  select
    coalesce(sp.data, sa.data) as data,
    coalesce(sp.spend, 0),
    coalesce(sp.spend, 0) * coalesce(
      (select t.factor from public.client_tax_rates t
       where t.client_id = p_client_id and t.valid_from <= coalesce(sp.data, sa.data)
       order by t.valid_from desc limit 1),
      1),
    coalesce(sp.leads, 0)::bigint,
    coalesce(sa.vendas, 0)::bigint,
    coalesce(sa.vendas_anuncio, 0)::bigint,
    coalesce(sa.receita_liquida, 0),
    case when coalesce(sp.data, sa.data) = (select data from today) then (select dados_ate from today) end,
    coalesce(sa.vendas_apos_dados, 0)::bigint,
    coalesce(sa.receita_ascensao_liquida, 0)
  from spend sp
  full join sales_by_day sa on sa.data = sp.data
  order by 1
$$;
revoke all on function public.get_client_daily(uuid, date, date) from public, anon;
grant execute on function public.get_client_daily(uuid, date, date) to authenticated, service_role;

drop function public.get_funnel_sales_by_origin(uuid, date, date);
create function public.get_funnel_sales_by_origin(p_sales_funnel_id uuid, p_since date, p_until date)
returns table (origem text, vendas bigint, vendas_upsell bigint, receita_bruta numeric)
language sql stable set search_path = ''
as $$
  select
    s.origem,
    count(*) filter (where s.papel = 'entrada'),
    count(*) filter (where s.papel in ('order_bump', 'upsell')),
    coalesce(sum(s.valor_bruto) filter (where s.papel <> 'ascensao'), 0)
  from public.sales s
  where s.sales_funnel_id = p_sales_funnel_id
    and s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
    and s.data_venda < (p_until::timestamp at time zone 'America/Sao_Paulo')
  group by s.origem
  order by 2 desc
$$;
revoke all on function public.get_funnel_sales_by_origin(uuid, date, date) from public, anon;
grant execute on function public.get_funnel_sales_by_origin(uuid, date, date) to authenticated, service_role;
