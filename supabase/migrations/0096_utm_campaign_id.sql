-- The UTM names a campaign, not an ad (found in production, 2026-10-08). Two columns are filled
-- again; no sale changes project.
--
-- The recommended template puts {{ad.id}} in utm_campaign, and 0073 onwards read it as an ad id.
-- The client's real ads put {{campaign.id}} there: 44 of the 45 distinct ids in production are
-- campaign ids and none is an ad id, so "by ad" never matched (ad attribution, sales per front,
-- per-front CPA and ROAS, the ad's project). sale_campaign_id takes either: a campaign id as is,
-- an ad id through the campaign that ran it. Everything that went through the ad now goes through
-- the campaign, which is also what fronts own.

create function private.sale_campaign_id(p_client_id uuid, p_utm_campaign text, p_utm_content text) returns text
language sql stable set search_path = ''
as $$
  with id as (select private.sale_ad_id(p_utm_campaign, p_utm_content) as v)
  select coalesce(
    (select cd.campaign_id from public.campaign_daily cd, id where cd.client_id = p_client_id and cd.campaign_id = id.v limit 1),
    (select a.campaign_id from public.ad_creative_spend_daily a, id where a.ad_id = id.v order by a.data desc limit 1))
$$;

create function private.campaign_owner_project(p_client_id uuid, p_campaign_id text) returns uuid
language sql stable set search_path = ''
as $$
  select pf.sales_funnel_id
  from public.campaign_fronts cf
  join public.project_fronts pf on pf.id = cf.front_id
  where cf.client_id = p_client_id and cf.campaign_id = p_campaign_id
$$;

drop function private.ad_owner_project(uuid, text);

create or replace function private.attribute_sale() returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  v_candidates uuid[];
  v_campaign text;
  v_owner uuid;
  v_by_ad uuid;
begin
  if new.client_id is null then
    select sf.client_id into new.client_id from public.sales_funnels sf where sf.id = new.sales_funnel_id;
  end if;

  v_campaign := private.sale_campaign_id(new.client_id, new.utm_campaign, new.utm_content);
  v_owner := private.campaign_owner_project(new.client_id, v_campaign);
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

create or replace function public.reattribute_pending_sales(p_client_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
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
  return v_count;
end
$$;

create or replace function public.watcher_day(p_watcher_id uuid, p_day date)
returns table (spend numeric, value numeric, status text)
language plpgsql stable set search_path = ''
as $$
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
    -- The front's sales: the project's sales of the day whose UTM names a campaign the front
    -- counts (or an ad of one). The 60 days only bound which campaigns are read.
    with front_campaigns as (
      select c.campaign_id
      from public.get_client_campaigns(w.client_id, p_day - 60, p_day + 1) c
      where w.front_id = any (c.front_ids)
    )
    select count(*) filter (where s.papel = 'entrada'),
           coalesce(sum(s.valor_liquido) filter (where s.papel <> 'ascensao'), 0)
      into v_vendas_anuncio, v_receita
      from public.sales s
      join front_campaigns fc on fc.campaign_id = private.sale_campaign_id(s.client_id, s.utm_campaign, s.utm_content)
     where s.sales_funnel_id = w.sales_funnel_id
       and s.data_venda >= (p_day::timestamp at time zone 'America/Sao_Paulo')
       and s.data_venda < ((p_day + 1)::timestamp at time zone 'America/Sao_Paulo');
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
$$;

create or replace function public.get_project_front_sales(p_sales_funnel_id uuid, p_since date, p_until date)
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
  front_campaigns as (
    select c.front_ids[1] as front_id, c.campaign_id
    from public.get_client_campaigns(v_client_id, p_since - 60, p_until) c
    where c.front_ids[1] in (select id from own_fronts)
  )
  select fc.front_id,
    count(*) filter (where s.papel = 'entrada'),
    coalesce(sum(s.valor_liquido) filter (where s.papel <> 'ascensao'), 0)
  from public.sales s
  join front_campaigns fc on fc.campaign_id = private.sale_campaign_id(s.client_id, s.utm_campaign, s.utm_content)
  where s.sales_funnel_id = p_sales_funnel_id
    and s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
    and s.data_venda < (p_until::timestamp at time zone 'America/Sao_Paulo')
    and not private.sale_after_meta_pull(s.client_id, s.data_venda)
  group by fc.front_id;
end;
$$;

-- The sales already there get their ad's project again; their project stays as it is.
update sales s set anuncio_funnel_id = private.campaign_owner_project(s.client_id, private.sale_campaign_id(s.client_id, s.utm_campaign, s.utm_content))
 where private.sale_ad_id(s.utm_campaign, s.utm_content) is not null;
