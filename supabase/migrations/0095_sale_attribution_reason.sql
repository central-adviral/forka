-- Atribuição que se explica (Arquitetura dos Números, onda 3, 2026-10-08). Two new columns are
-- filled for the sales already there; no sale changes project.
--
-- * Every sale keeps why it is in its project (motivo) and which project's campaign its ad ran in
--   (anuncio_funnel_id). Vitor's decision: a product only project A sells, bought through project
--   B's ad, counts in A and shows in B as "venda gerada para outro projeto", so B's ad CPA is fair.
-- * Sales of a front: the project's sales whose ad runs in a campaign the front owns, as the per
--   front watchers read them (0086). Mirror fronts only read spend (Vitor's decision), so they have
--   no sales of their own.
-- * A campaign whose owner changes does not move sales already attributed: changes apply from now
--   on. Sales still without a project are decided again every sync (0090).

alter table sales
  add column motivo text check (motivo in ('produto_exclusivo', 'anuncio_do_projeto', 'produto_em_varios_sem_anuncio', 'produto_fora_de_projeto', 'lista_launchops')),
  add column anuncio_funnel_id uuid references sales_funnels(id) on delete set null;
create index sales_anuncio_funnel_idx on sales (anuncio_funnel_id) where anuncio_funnel_id is not null;
-- Attribution looks an ad up by its id on every sale; the backfill below does it for every sale.
create index ad_creative_spend_daily_ad_idx on ad_creative_spend_daily (ad_id, data desc);

-- The project whose campaign (newest day) ran this ad: the owner front's project.
create function private.ad_owner_project(p_client_id uuid, p_ad text) returns uuid
language sql stable set search_path = ''
as $$
  select pf.sales_funnel_id
  from public.ad_creative_spend_daily a
  join public.campaign_fronts cf on cf.client_id = p_client_id and cf.campaign_id = a.campaign_id
  join public.project_fronts pf on pf.id = cf.front_id
  where a.ad_id = p_ad
  order by a.data desc, pf.sales_funnel_id
  limit 1
$$;

create or replace function private.attribute_sale() returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  v_candidates uuid[];
  v_ad text;
  v_owner uuid;
  v_by_ad uuid;
begin
  if new.client_id is null then
    select sf.client_id into new.client_id from public.sales_funnels sf where sf.id = new.sales_funnel_id;
  end if;

  v_ad := private.sale_ad_id(new.utm_campaign, new.utm_content);
  v_owner := case when v_ad is not null then private.ad_owner_project(new.client_id, v_ad) end;
  new.anuncio_funnel_id := v_owner;

  select coalesce(array_agg(pp.sales_funnel_id), '{}') into v_candidates
    from public.project_products pp
    join public.sales_funnels sf on sf.id = pp.sales_funnel_id
   where sf.client_id = new.client_id and pp.produto_nome = new.produto;

  if cardinality(v_candidates) = 1 then
    new.sales_funnel_id := v_candidates[1];
    new.atribuicao := 'produto';
    new.motivo := 'produto_exclusivo';
    return new;
  end if;

  if cardinality(v_candidates) > 1 then
    -- Among the projects that sell the product, the one whose campaign ran the ad last (0090).
    if v_ad is not null then
      select pf.sales_funnel_id into v_by_ad
        from public.ad_creative_spend_daily a
        join public.campaign_fronts cf on cf.client_id = new.client_id and cf.campaign_id = a.campaign_id
        join public.project_fronts pf on pf.id = cf.front_id
       where a.ad_id = v_ad and pf.sales_funnel_id = any (v_candidates)
       order by a.data desc, pf.sales_funnel_id
       limit 1;
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
  if new.sales_funnel_id is not null then
    new.atribuicao := 'produto';
    new.motivo := 'lista_launchops';
    return new;
  end if;

  new.atribuicao := 'sem_atribuicao';
  new.motivo := 'produto_fora_de_projeto';
  return new;
end
$function$;

-- The sales already there get their reason and ad project; their project stays as it is.
update sales s set
  anuncio_funnel_id = private.ad_owner_project(s.client_id, private.sale_ad_id(s.utm_campaign, s.utm_content)),
  motivo = case
    when s.atribuicao = 'anuncio' then 'anuncio_do_projeto'
    when s.atribuicao = 'produto' and (select count(*) from project_products pp join sales_funnels sf on sf.id = pp.sales_funnel_id
                                       where sf.client_id = s.client_id and pp.produto_nome = s.produto) = 1 then 'produto_exclusivo'
    when s.atribuicao = 'produto' then 'lista_launchops'
    when (select count(*) from project_products pp join sales_funnels sf on sf.id = pp.sales_funnel_id
          where sf.client_id = s.client_id and pp.produto_nome = s.produto) > 1 then 'produto_em_varios_sem_anuncio'
    else 'produto_fora_de_projeto'
  end;

-- Per front: entry sales and net revenue of the sales whose ad runs in a campaign the front owns.
create function public.get_project_front_sales(p_sales_funnel_id uuid, p_since date, p_until date)
returns table (front_id uuid, vendas bigint, receita_liquida numeric)
language plpgsql stable security definer set search_path = ''
as $$
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
  front_ads as (
    select distinct c.front_ids[1] as front_id, a.ad_id
    from public.get_client_campaigns(v_client_id, p_since - 60, p_until) c
    join public.ad_creative_spend_daily a on a.campaign_id = c.campaign_id
    where c.front_ids[1] in (select id from own_fronts)
  )
  select fa.front_id,
    count(*) filter (where s.papel = 'entrada'),
    coalesce(sum(s.valor_liquido) filter (where s.papel <> 'ascensao'), 0)
  from public.sales s
  join front_ads fa on fa.ad_id = private.sale_ad_id(s.utm_campaign, s.utm_content)
  where s.sales_funnel_id = p_sales_funnel_id
    and s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
    and s.data_venda < (p_until::timestamp at time zone 'America/Sao_Paulo')
    and not private.sale_after_meta_pull(s.client_id, s.data_venda)
  group by fa.front_id;
end;
$$;
revoke all on function public.get_project_front_sales(uuid, date, date) from public, anon;
grant execute on function public.get_project_front_sales(uuid, date, date) to authenticated;

-- Sales one project's ad brought to another project's product, both ways.
create function public.get_project_cross_sales(p_sales_funnel_id uuid, p_since date, p_until date)
returns table (geradas_para_outro bigint, vindas_de_outro bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_client_id uuid;
begin
  select sf.client_id into v_client_id from public.sales_funnels sf
  where sf.id = p_sales_funnel_id and private.has_client_role(sf.client_id, 'cliente');
  if v_client_id is null then
    raise exception 'not found or access denied';
  end if;

  return query
  select
    count(*) filter (where s.anuncio_funnel_id = p_sales_funnel_id and s.sales_funnel_id is distinct from p_sales_funnel_id),
    count(*) filter (where s.sales_funnel_id = p_sales_funnel_id and s.anuncio_funnel_id is not null and s.anuncio_funnel_id <> p_sales_funnel_id)
  from public.sales s
  where s.client_id = v_client_id and s.papel = 'entrada'
    and s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
    and s.data_venda < (p_until::timestamp at time zone 'America/Sao_Paulo')
    and not private.sale_after_meta_pull(s.client_id, s.data_venda);
end;
$$;
revoke all on function public.get_project_cross_sales(uuid, date, date) from public, anon;
grant execute on function public.get_project_cross_sales(uuid, date, date) to authenticated;
