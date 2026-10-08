-- Venda de anúncio: uma regra só (2026-10-08).
--
-- Decision (Vitor, option A): a sale is an ad sale when its campaign is identified. Until now the
-- project counted origem in ('anuncio', 'anuncio_legado') (0055) and the fronts counted the sales
-- whose UTM resolves a campaign (0096): the legacy utm_source=facebookads sales with no id were ad
-- sales for the project and for no front. Now both read sales.campanha_id.
--
-- * sales.campanha_id: the campaign private.sale_campaign_id resolves, set by attribute_sale on every
--   write (archived projects included: it is a fact of the sale, not an attribution) and backfilled.
-- * reattribute_pending_sales (every sync) also resolves the last 7 days' sales stored before their
--   campaign reached campaign_daily. It writes the column directly: no trigger re-runs attribution.
-- * get_funnel_daily, get_client_daily: vendas_anuncio = entry sales with campanha_id; new
--   vendas_anuncio_sem_id = entry sales that look like an ad (origem anuncio/anuncio_legado) but
--   whose campaign is not identified, so nothing disappears from the screen.
-- * get_project_data_quality: same rule; vendas_com_id_anuncio (now the same as vendas_anuncio)
--   gives way to vendas_anuncio_sem_id, and sem_utm/bio/outro count only sales with no campaign.
-- * get_project_front_sales, watcher_day: join on s.campanha_id instead of resolving per row.

alter table public.sales add column campanha_id text;

update public.sales s
   set campanha_id = private.sale_campaign_id(s.client_id, s.utm_campaign, s.utm_content)
 where private.sale_ad_id(s.utm_campaign, s.utm_content) is not null;

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
    new.campanha_id := private.sale_campaign_id(new.client_id, new.utm_campaign, new.utm_content);
    return new;
  end if;

  if new.client_id is null then
    select sf.client_id into new.client_id from public.sales_funnels sf where sf.id = new.sales_funnel_id;
  end if;

  v_campaign := private.sale_campaign_id(new.client_id, new.utm_campaign, new.utm_content);
  new.campanha_id := v_campaign;
  v_owner := private.campaign_owner_project(new.client_id, v_campaign);
  new.anuncio_funnel_id := v_owner;

  select coalesce(array_agg(h.sales_funnel_id), '{}') into v_candidates
    from public.project_products_history h
    join public.sales_funnels sf on sf.id = h.sales_funnel_id
   where sf.client_id = new.client_id and h.produto_nome = new.produto and sf.archived_at is null
     and h.valid_from <= new.data_venda and new.data_venda < h.valid_until;

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

  -- No project sold the product on that date. A write that names a project that never listed it
  -- keeps it (a project still read by its LaunchOps name list, before Produtos existed). A project
  -- that lists it only from a later date does not get it: that would change its past.
  if new.sales_funnel_id is not null
     and not exists (select 1 from public.sales_funnels sf where sf.id = new.sales_funnel_id and sf.archived_at is not null)
     and not exists (select 1 from public.project_products_history h where h.sales_funnel_id = new.sales_funnel_id and h.produto_nome = new.produto) then
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

create or replace function public.reattribute_pending_sales(p_client_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_count integer;
begin
  -- Touching produto fires sales_attribute, which decides again with the ads known now.
  with touched as (
    update public.sales s set produto = s.produto
     where s.client_id = p_client_id and s.atribuicao = 'sem_atribuicao'
       and private.sale_campaign_id(s.client_id, s.utm_campaign, s.utm_content) is not null
    returning s.atribuicao
  )
  select count(*) filter (where atribuicao <> 'sem_atribuicao') into v_count from touched;

  -- A sale stored before its campaign reached campaign_daily becomes an ad sale once it does.
  update public.sales s
     set campanha_id = private.sale_campaign_id(s.client_id, s.utm_campaign, s.utm_content)
   where s.client_id = p_client_id and s.campanha_id is null
     and s.data_venda >= now() - interval '7 days'
     and private.sale_ad_id(s.utm_campaign, s.utm_content) is not null
     and private.sale_campaign_id(s.client_id, s.utm_campaign, s.utm_content) is not null;
  return v_count;
end
$function$;

drop function public.get_funnel_daily(uuid, date, date);
create function public.get_funnel_daily(p_sales_funnel_id uuid, p_since date, p_until date)
 returns table(data date, vendas bigint, vendas_anuncio bigint, vendas_upsell bigint, receita_bruta numeric, receita_liquida numeric, spend numeric, spend_com_imposto numeric, impressions bigint, clicks bigint, reach bigint, link_clicks bigint, landing_page_views bigint, initiate_checkout bigint, spend_source text, dados_ate timestamp with time zone, vendas_apos_dados bigint, vendas_ascensao bigint, receita_ascensao_bruta numeric, receita_ascensao_liquida numeric, reembolsos bigint, receita_reembolsada_liquida numeric, vendas_anuncio_sem_id bigint)
 language sql
 stable
 set search_path to ''
as $function$
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
      count(*) filter (where s.papel = 'entrada' and not s.apos_dados and s.campanha_id is not null) as vendas_anuncio,
      count(*) filter (where s.papel = 'entrada' and not s.apos_dados and s.campanha_id is null and s.origem in ('anuncio', 'anuncio_legado')) as vendas_anuncio_sem_id,
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
  -- The refunds, on the São Paulo day they happened, whatever day the sale was.
  refunds as (
    select
      (s.reembolsado_em at time zone 'America/Sao_Paulo')::date as data,
      count(*) filter (where s.papel <> 'ascensao') as reembolsos,
      coalesce(sum(s.valor_bruto) filter (where s.papel <> 'ascensao'), 0) as bruta,
      coalesce(sum(s.valor_liquido) filter (where s.papel <> 'ascensao'), 0) as liquida,
      coalesce(sum(s.valor_bruto) filter (where s.papel = 'ascensao'), 0) as ascensao_bruta,
      coalesce(sum(s.valor_liquido) filter (where s.papel = 'ascensao'), 0) as ascensao_liquida
    from public.sales s
    where s.sales_funnel_id = p_sales_funnel_id
      and s.reembolsado_em >= (p_since::timestamp at time zone 'America/Sao_Paulo')
      and s.reembolsado_em < (p_until::timestamp at time zone 'America/Sao_Paulo')
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
      coalesce(s.data, sp.data, r.data) as data,
      coalesce(s.vendas, 0)::bigint as vendas,
      coalesce(s.vendas_anuncio, 0)::bigint as vendas_anuncio,
      coalesce(s.vendas_upsell, 0)::bigint as vendas_upsell,
      coalesce(s.receita_bruta, 0) - coalesce(r.bruta, 0) as receita_bruta,
      coalesce(s.receita_liquida, 0) - coalesce(r.liquida, 0) as receita_liquida,
      coalesce(sp.spend, 0) as spend,
      coalesce(sp.impressions, 0)::bigint as impressions,
      coalesce(sp.clicks, 0)::bigint as clicks,
      coalesce(sp.reach, 0)::bigint as reach,
      coalesce(sp.link_clicks, 0)::bigint as link_clicks,
      coalesce(sp.landing_page_views, 0)::bigint as landing_page_views,
      coalesce(sp.initiate_checkout, 0)::bigint as initiate_checkout,
      coalesce(s.vendas_apos_dados, 0)::bigint as vendas_apos_dados,
      coalesce(s.vendas_ascensao, 0)::bigint as vendas_ascensao,
      coalesce(s.receita_ascensao_bruta, 0) - coalesce(r.ascensao_bruta, 0) as receita_ascensao_bruta,
      coalesce(s.receita_ascensao_liquida, 0) - coalesce(r.ascensao_liquida, 0) as receita_ascensao_liquida,
      coalesce(r.reembolsos, 0)::bigint as reembolsos,
      coalesce(r.liquida, 0) as receita_reembolsada_liquida,
      coalesce(s.vendas_anuncio_sem_id, 0)::bigint as vendas_anuncio_sem_id
    from sales s
    full join spend sp on sp.data = s.data
    full join refunds r on r.data = coalesce(s.data, sp.data)
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
    d.vendas_apos_dados, d.vendas_ascensao, d.receita_ascensao_bruta, d.receita_ascensao_liquida,
    d.reembolsos, d.receita_reembolsada_liquida, d.vendas_anuncio_sem_id
  from days d
  order by 1
$function$;
revoke all on function public.get_funnel_daily(uuid, date, date) from public, anon;
grant execute on function public.get_funnel_daily(uuid, date, date) to authenticated, service_role;

drop function public.get_client_daily(uuid, date, date);
create function public.get_client_daily(p_client_id uuid, p_since date, p_until date)
 returns table(data date, spend numeric, spend_com_imposto numeric, leads bigint, vendas bigint, vendas_anuncio bigint, receita_liquida numeric, dados_ate timestamp with time zone, vendas_apos_dados bigint, receita_ascensao_liquida numeric, spend_compra_com_imposto numeric, spend_lead_com_imposto numeric, spend_sem_frente_com_imposto numeric, vendas_sem_projeto bigint, reembolsos bigint, receita_reembolsada_liquida numeric, vendas_anuncio_sem_id bigint)
 language sql
 stable
 set search_path to ''
as $function$
  with today as (
    select
      (now() at time zone 'America/Sao_Paulo')::date as data,
      (select max(cd.source_updated_at) from public.campaign_daily cd
       where cd.client_id = p_client_id and cd.data = (now() at time zone 'America/Sao_Paulo')::date) as dados_ate
  ),
  -- The project that owns each campaign (mirrors never own), and what that project produces.
  owners as (
    select c.campaign_id, sf.resultado
    from public.get_client_campaigns(p_client_id, p_since, p_until) c
    join public.project_fronts f on f.id = c.front_ids[1]
    join public.sales_funnels sf on sf.id = f.sales_funnel_id
    where cardinality(c.front_ids) > 0
  ),
  spend as (
    select cd.data, sum(cd.spend) as spend, sum(cd.leads) as leads,
      coalesce(sum(cd.spend) filter (where o.resultado in ('compra', 'roas')), 0) as spend_compra,
      coalesce(sum(cd.spend) filter (where o.resultado = 'lead'), 0) as spend_lead,
      coalesce(sum(cd.spend) filter (where o.campaign_id is null), 0) as spend_sem_frente
    from public.campaign_daily cd
    left join owners o on o.campaign_id = cd.campaign_id
    where cd.client_id = p_client_id and cd.data >= p_since and cd.data < p_until
    group by cd.data
  ),
  sales as (
    select
      (s.data_venda at time zone 'America/Sao_Paulo')::date as data,
      (t.dados_ate is not null and (s.data_venda at time zone 'America/Sao_Paulo')::date = t.data and s.data_venda > t.dados_ate) as apos_dados,
      -- A sale with no project has no role from a project: it counts as an entry.
      coalesce(s.papel, 'entrada') as papel, s.origem, s.campanha_id, s.valor_liquido, s.sales_funnel_id
    from public.sales s
    cross join today t
    where s.client_id = p_client_id
      and s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
      and s.data_venda < (p_until::timestamp at time zone 'America/Sao_Paulo')
  ),
  sales_by_day as (
    select
      data,
      count(*) filter (where papel = 'entrada' and not apos_dados) as vendas,
      count(*) filter (where papel = 'entrada' and not apos_dados and campanha_id is not null) as vendas_anuncio,
      count(*) filter (where papel = 'entrada' and not apos_dados and campanha_id is null and origem in ('anuncio', 'anuncio_legado')) as vendas_anuncio_sem_id,
      coalesce(sum(valor_liquido) filter (where papel <> 'ascensao' and not apos_dados), 0) as receita_liquida,
      count(*) filter (where apos_dados) as vendas_apos_dados,
      coalesce(sum(valor_liquido) filter (where papel = 'ascensao' and not apos_dados), 0) as receita_ascensao_liquida,
      count(*) filter (where sales_funnel_id is null and not apos_dados) as vendas_sem_projeto
    from sales
    group by data
  ),
  -- The refunds, on the São Paulo day they happened, whatever day the sale was.
  refunds as (
    select
      (s.reembolsado_em at time zone 'America/Sao_Paulo')::date as data,
      count(*) filter (where coalesce(s.papel, 'entrada') <> 'ascensao') as reembolsos,
      coalesce(sum(s.valor_liquido) filter (where coalesce(s.papel, 'entrada') <> 'ascensao'), 0) as liquida,
      coalesce(sum(s.valor_liquido) filter (where s.papel = 'ascensao'), 0) as ascensao_liquida
    from public.sales s
    where s.client_id = p_client_id
      and s.reembolsado_em >= (p_since::timestamp at time zone 'America/Sao_Paulo')
      and s.reembolsado_em < (p_until::timestamp at time zone 'America/Sao_Paulo')
    group by 1
  ),
  days as (
    select coalesce(sp.data, sa.data, r.data) as day, sp.spend, sp.leads, sp.spend_compra, sp.spend_lead, sp.spend_sem_frente,
      sa.vendas, sa.vendas_anuncio, sa.vendas_anuncio_sem_id, sa.receita_liquida, sa.vendas_apos_dados, sa.receita_ascensao_liquida, sa.vendas_sem_projeto,
      r.reembolsos, r.liquida as receita_reembolsada_liquida, r.ascensao_liquida as receita_ascensao_reembolsada
    from spend sp
    full join sales_by_day sa on sa.data = sp.data
    full join refunds r on r.data = coalesce(sp.data, sa.data)
  ),
  taxed as (
    select d.*,
      coalesce((select t.factor from public.client_tax_rates t
                where t.client_id = p_client_id and t.valid_from <= d.day
                order by t.valid_from desc limit 1), 1) as tax
    from days d
  )
  select
    d.day,
    coalesce(d.spend, 0),
    coalesce(d.spend, 0) * d.tax,
    coalesce(d.leads, 0)::bigint,
    coalesce(d.vendas, 0)::bigint,
    coalesce(d.vendas_anuncio, 0)::bigint,
    coalesce(d.receita_liquida, 0) - coalesce(d.receita_reembolsada_liquida, 0),
    case when d.day = (select data from today) then (select dados_ate from today) end,
    coalesce(d.vendas_apos_dados, 0)::bigint,
    coalesce(d.receita_ascensao_liquida, 0) - coalesce(d.receita_ascensao_reembolsada, 0),
    coalesce(d.spend_compra, 0) * d.tax,
    coalesce(d.spend_lead, 0) * d.tax,
    coalesce(d.spend_sem_frente, 0) * d.tax,
    coalesce(d.vendas_sem_projeto, 0)::bigint,
    coalesce(d.reembolsos, 0)::bigint,
    coalesce(d.receita_reembolsada_liquida, 0),
    coalesce(d.vendas_anuncio_sem_id, 0)::bigint
  from taxed d
  order by 1
$function$;
revoke all on function public.get_client_daily(uuid, date, date) from public, anon;
grant execute on function public.get_client_daily(uuid, date, date) to authenticated, service_role;

drop function public.get_project_data_quality(uuid, date, date);
create function public.get_project_data_quality(p_sales_funnel_id uuid, p_since date, p_until date)
 returns table(vendas_entrada bigint, vendas_anuncio bigint, vendas_anuncio_sem_id bigint, vendas_sem_utm bigint, vendas_bio bigint, vendas_outra_origem bigint, cliente_vendas_sem_projeto bigint, cliente_gasto_sem_frente numeric, cliente_campanhas_sem_frente bigint, cliente_campanhas_em_disputa bigint, espelhos_sem_janela bigint, vigias_sem_avaliar bigint)
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_client_id uuid;
  v_starts date;
  v_ends date;
begin
  select sf.client_id, sf.starts_on, sf.ends_on into v_client_id, v_starts, v_ends
  from public.sales_funnels sf
  where sf.id = p_sales_funnel_id and private.has_client_role(sf.client_id, 'cliente');
  if v_client_id is null then
    raise exception 'not found or access denied';
  end if;

  return query
  with sales as (
    select s.* from public.sales s
    where s.client_id = v_client_id
      and s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
      and s.data_venda < (p_until::timestamp at time zone 'America/Sao_Paulo')
      and not private.sale_after_meta_pull(s.client_id, s.data_venda)
      and private.sale_counts(s.reembolsado_em, p_until)
  ),
  entries as (
    select s.* from sales s where s.sales_funnel_id = p_sales_funnel_id and s.papel = 'entrada'
  ),
  campaigns as (
    select c.* from public.get_client_campaigns(v_client_id, p_since, p_until) c
  )
  select
    (select count(*) from entries),
    (select count(*) from entries e where e.campanha_id is not null),
    (select count(*) from entries e where e.campanha_id is null and e.origem in ('anuncio', 'anuncio_legado')),
    (select count(*) from entries e where e.campanha_id is null and e.origem = 'sem_utm'),
    (select count(*) from entries e where e.campanha_id is null and e.origem = 'organico_bio'),
    (select count(*) from entries e where e.campanha_id is null and e.origem = 'outro'),
    (select count(*) from sales s where s.sales_funnel_id is null),
    coalesce((
      select sum(cd.spend * coalesce((select t.factor from public.client_tax_rates t
                                      where t.client_id = v_client_id and t.valid_from <= cd.data
                                      order by t.valid_from desc limit 1), 1))
      from public.campaign_daily cd
      join campaigns c on c.campaign_id = cd.campaign_id and cardinality(c.front_ids) = 0
      where cd.client_id = v_client_id and cd.data >= p_since and cd.data < p_until
    ), 0),
    (select count(*) from campaigns c where cardinality(c.front_ids) = 0),
    (select count(*) from campaigns c where cardinality(c.front_ids) = 0 and cardinality(c.suggested_front_ids) > 1),
    (select count(*) from public.project_fronts f
      where f.sales_funnel_id = p_sales_funnel_id and f.source_sales_funnel_id is not null and v_starts is null and v_ends is null),
    (select count(*) from public.watchers w
      where w.sales_funnel_id = p_sales_funnel_id and w.is_active and w.created_at < now() - interval '2 days'
        and (w.last_day is null or w.last_day < (now() at time zone 'America/Sao_Paulo')::date - 2 or w.last_status = 'sem_dado'));
end;
$function$;
revoke all on function public.get_project_data_quality(uuid, date, date) from public, anon;
grant execute on function public.get_project_data_quality(uuid, date, date) to authenticated;

create or replace function public.get_project_front_sales(p_sales_funnel_id uuid, p_since date, p_until date)
 returns table(front_id uuid, vendas bigint, receita_liquida numeric)
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_client_id uuid;
begin
  select sf.client_id into v_client_id from public.sales_funnels sf
  where sf.id = p_sales_funnel_id and private.has_client_role(sf.client_id, 'cliente');
  if v_client_id is null then
    raise exception 'not found or access denied';
  end if;

  return query
  with own_fronts as (
    select f.id from public.project_fronts f where f.sales_funnel_id = p_sales_funnel_id and f.source_sales_funnel_id is null
  ),
  front_campaigns as (
    select c.front_ids[1] as front_id, c.campaign_id
    from public.get_client_campaigns(v_client_id, p_since - 60, p_until) c
    where c.front_ids[1] in (select id from own_fronts)
  )
  select fc.front_id,
    count(*) filter (where s.papel = 'entrada'),
    coalesce(sum(s.valor_liquido) filter (where s.papel <> 'ascensao'), 0)
  from public.sales s
  join front_campaigns fc on fc.campaign_id = s.campanha_id
  where s.sales_funnel_id = p_sales_funnel_id
    and s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
    and s.data_venda < (p_until::timestamp at time zone 'America/Sao_Paulo')
    and not private.sale_after_meta_pull(s.client_id, s.data_venda)
    and private.sale_counts(s.reembolsado_em, p_until)
  group by fc.front_id;
end;
$function$;

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
begin
  select * into w from public.watchers where id = p_watcher_id;
  if not found then
    return;
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
   where w.front_id is null or fd.front_id = w.front_id;

  if w.metric in ('cpa_geral', 'cpa_anuncio', 'roas') and w.front_id is null then
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
  else
    -- How far off the target, in %, in the direction that is bad for this metric.
    v_off := case public.watcher_metric_direction(w.metric)
      when 'sobe' then (v_value / w.target - 1) * 100
      else (1 - v_value / w.target) * 100
    end;
    status := case when v_off > w.crit_pct then 'crit' when v_off > w.warn_pct then 'warn' else 'ok' end;
  end if;
  spend := v_spend;
  value := v_value;
  return next;
end
$function$;
