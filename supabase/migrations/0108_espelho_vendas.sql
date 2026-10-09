-- Espelho de vendas na etapa (Vitor, 2026-10-09). A stage may show the sales of another funnel of the
-- same client, without taking them away: "Lançamento T15 › Captação paga" shows the entry sales of
-- "1K por dia" (its paid leads) and "1K por dia › Ascensão" shows the Mentoria VOE sales of the T15.
--
-- * funnel_stages.mirror_funnel_id: the funnel whose sales the stage shows. Same client, never the
--   stage's own funnel, only lead, compra and ascensao stages. mirror_papeis: the roles of the source
--   funnel's sales that count ({entrada} when not given). mirror_products: when set, only the sales of
--   those products (sales.produto, as project_products names them).
-- * The stage window bounds the mirrored sales by the day of the sale, as it bounds the stage spend.
--   Refunds follow the source: the refund counts on its own day. A mirror stage keeps its own fronts
--   (a mirror front gives Captação paga its spend) and its own sales.
-- * Every mirrored sale is one result of the stage, whatever its role in the source: an ascensão in an
--   ascensao stage (Mentoria VOE is entrada in the T15 and ascensão in the 1K), an entry sale in a
--   compra stage, a paid lead in a lead stage (cost per lead = stage spend / buyers).
-- * Read-only view: sales.sales_funnel_id never changes, so funnel and client totals (get_funnel_daily,
--   get_client_daily, Hoje) never count a mirrored sale twice. Only the stage reads see them, through
--   private.funnel_stage_sales (espelho = true): get_funnel_stage_daily (vendas_espelho too) and the
--   stage watchers of watcher_day. get_funnel_stage_origin leaves them out: no campaign of the funnel
--   brought them, the stage card says where they come from.
-- * No chains: the mirrored rows are the source funnel's own sales, never the ones its stages mirror.

-- 1. Columns and guards ---------------------------------------------------------------------------

alter table public.funnel_stages
  add column mirror_funnel_id uuid references public.sales_funnels(id) on delete set null,
  add column mirror_papeis text[],
  add column mirror_products text[],
  add constraint funnel_stages_mirror_not_self check (mirror_funnel_id is distinct from sales_funnel_id),
  add constraint funnel_stages_mirror_measure check (mirror_funnel_id is null or measure in ('lead', 'compra', 'ascensao')),
  add constraint funnel_stages_mirror_papeis check (mirror_papeis is null
    or (cardinality(mirror_papeis) > 0 and mirror_papeis <@ array['entrada', 'order_bump', 'upsell', 'ascensao'])),
  add constraint funnel_stages_mirror_products check (mirror_products is null or cardinality(mirror_products) > 0);
create index funnel_stages_mirror_idx on public.funnel_stages (mirror_funnel_id) where mirror_funnel_id is not null;

-- Same client only; without a source the filters go too, with one the roles default to entrada.
create or replace function private.check_stage_mirror() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.mirror_funnel_id is null then
    new.mirror_papeis := null;
    new.mirror_products := null;
    return new;
  end if;
  if new.mirror_funnel_id = new.sales_funnel_id then
    raise exception 'a stage cannot mirror its own funnel' using errcode = '23514';
  end if;
  if (select sf.client_id from public.sales_funnels sf where sf.id = new.mirror_funnel_id)
     is distinct from (select sf.client_id from public.sales_funnels sf where sf.id = new.sales_funnel_id) then
    raise exception 'mirror funnel must be of the same client' using errcode = '23514';
  end if;
  new.mirror_papeis := coalesce(new.mirror_papeis, array['entrada']);
  return new;
end
$$;
create trigger funnel_stages_mirror before insert or update of mirror_funnel_id, mirror_papeis, mirror_products, sales_funnel_id
  on public.funnel_stages for each row execute function private.check_stage_mirror();

-- 2. Reads ----------------------------------------------------------------------------------------

-- Redefined from the 0105 definition (new column espelho, so dropped and created again): the own
-- sales as before, plus the mirrored sales of the funnel's mirror stages, with the stage's role.
drop function private.funnel_stage_sales(uuid, date, date);
create function private.funnel_stage_sales(p_sales_funnel_id uuid, p_from date, p_to date)
 returns table(papel text, valor_liquido numeric, data_venda timestamptz, reembolsado_em timestamptz, stage_id uuid, origin_stage_id uuid, espelho boolean)
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
    origin.stage_id,
    false
  from sales s
  left join campaign_stage origin on origin.campaign_id = s.campanha_id
  union all
  select case when st.measure = 'ascensao' then 'ascensao' else 'entrada' end, s.valor_liquido, s.data_venda, s.reembolsado_em,
    st.id, null::uuid, true
  from public.funnel_stages st
  join public.sales s on s.sales_funnel_id = st.mirror_funnel_id
  where st.sales_funnel_id = p_sales_funnel_id and st.mirror_funnel_id is not null
    and s.papel = any (st.mirror_papeis)
    and (st.mirror_products is null or s.produto = any (st.mirror_products))
    and (st.janela_inicio is null or (s.data_venda at time zone 'America/Sao_Paulo')::date >= st.janela_inicio)
    and (st.janela_fim is null or (s.data_venda at time zone 'America/Sao_Paulo')::date <= st.janela_fim)
    and ((s.data_venda >= (p_from::timestamp at time zone 'America/Sao_Paulo') and s.data_venda < (p_to::timestamp at time zone 'America/Sao_Paulo'))
      or (s.reembolsado_em >= (p_from::timestamp at time zone 'America/Sao_Paulo') and s.reembolsado_em < (p_to::timestamp at time zone 'America/Sao_Paulo')))
$function$;
revoke all on function private.funnel_stage_sales(uuid, date, date) from public, anon;
grant execute on function private.funnel_stage_sales(uuid, date, date) to authenticated, service_role;

-- Redefined from the 0105 definition (new column vendas_espelho, so dropped and created again):
-- vendas and receita_liquida include the mirrored sales; vendas_espelho says how many of them.
drop function public.get_funnel_stage_daily(uuid, date, date);
create function public.get_funnel_stage_daily(p_funnel_id uuid, p_from date, p_to date)
 returns table(stage_id uuid, data date, spend numeric, spend_com_imposto numeric, impressions bigint, reach bigint, clicks bigint, link_clicks bigint, landing_page_views bigint, leads bigint, initiate_checkout bigint, vendas bigint, reembolsos bigint, receita_liquida numeric, receita_reembolsada_liquida numeric, vendas_espelho bigint)
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
      count(*) filter (where p.papel in ('entrada', 'ascensao') and p.espelho) as vendas_espelho,
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
      so.vendas, so.vendas_espelho, so.receita, r.reembolsos, r.receita as receita_reembolsada
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
    coalesce(d.receita_reembolsada, 0),
    coalesce(d.vendas_espelho, 0)::bigint
  from days d
  order by d.data, d.stage_id;
end;
$function$;
revoke all on function public.get_funnel_stage_daily(uuid, date, date) from public, anon;
grant execute on function public.get_funnel_stage_daily(uuid, date, date) to authenticated, service_role;

-- Redefined from the 0105 definition: the mirrored sales stay out (no campaign of the funnel brought them).
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
  where p.papel = 'entrada' and not p.espelho
    and p.data_venda >= (p_from::timestamp at time zone 'America/Sao_Paulo')
    and p.data_venda < (p_to::timestamp at time zone 'America/Sao_Paulo')
    and not private.sale_after_meta_pull(v_client_id, p.data_venda)
    and private.sale_counts(p.reembolsado_em, p_to)
  group by p.stage_id, p.origin_stage_id;
end;
$function$;

-- 3. Watchers -------------------------------------------------------------------------------------

-- Redefined from the 0106 definition: a stage watcher also reads the stage's mirrored sales (the
-- window already bounds them, so a mirror stage without fronts still has them), and the CPL of a
-- mirror lead stage divides by the mirrored buyers, as the stage card does.
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
  v_target numeric;
  v_warn numeric;
  v_crit numeric;
  v_stage public.funnel_stages;
  v_stage_fronts uuid[];
  v_mirror_leads boolean := false;
begin
  select * into w from public.watchers where id = p_watcher_id;
  if not found then
    return;
  end if;
  v_target := public.effective_target(w);
  v_warn := public.effective_warn_pct(w);
  v_crit := public.effective_crit_pct(w);

  if w.stage_id is not null then
    select * into v_stage from public.funnel_stages st where st.id = w.stage_id;
    -- Outside the stage's window the stage spends and sells nothing.
    v_stage_fronts := case
      when (v_stage.janela_inicio is null or p_day >= v_stage.janela_inicio) and (v_stage.janela_fim is null or p_day <= v_stage.janela_fim)
      then array(select f.id from public.project_fronts f where f.stage_id = w.stage_id)
      else '{}'::uuid[] end;
    v_mirror_leads := v_stage.mirror_funnel_id is not null and v_stage.measure = 'lead';
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
   where case
     when w.front_id is not null then fd.front_id = w.front_id
     when w.stage_id is not null then fd.front_id = any (v_stage_fronts)
     else true
   end;

  if w.stage_id is not null and (w.metric in ('cpa_geral', 'roas') or (w.metric = 'cpl' and v_mirror_leads)) then
    -- The stage's sales of the day, as get_funnel_stage_daily counts them.
    select count(*) filter (where p.papel in ('entrada', 'ascensao') and p.sold),
           coalesce(sum(p.valor_liquido) filter (where p.sold), 0) - coalesce(sum(p.valor_liquido) filter (where p.refunded), 0)
      into v_vendas, v_receita
      from (
        select s.papel, s.valor_liquido,
          s.data_venda >= (p_day::timestamp at time zone 'America/Sao_Paulo')
            and s.data_venda < ((p_day + 1)::timestamp at time zone 'America/Sao_Paulo')
            and not private.sale_after_meta_pull(w.client_id, s.data_venda) as sold,
          coalesce(s.reembolsado_em >= (p_day::timestamp at time zone 'America/Sao_Paulo')
            and s.reembolsado_em < ((p_day + 1)::timestamp at time zone 'America/Sao_Paulo'), false) as refunded
        from private.funnel_stage_sales(w.sales_funnel_id, p_day, p_day + 1) s
        where s.stage_id = w.stage_id and (s.espelho or cardinality(v_stage_fronts) > 0)
      ) p;
    if v_mirror_leads then
      v_leads := v_vendas;
    end if;
  elsif w.metric in ('cpa_geral', 'cpa_anuncio', 'roas') and w.front_id is null then
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
  elsif v_target is null then
    status := 'sem_meta';
  else
    -- How far off the target, in %, in the direction that is bad for this metric.
    v_off := case public.watcher_metric_direction(w.metric)
      when 'sobe' then (v_value / v_target - 1) * 100
      else (1 - v_value / v_target) * 100
    end;
    status := case when v_off > v_crit then 'crit' when v_off > v_warn then 'warn' else 'ok' end;
  end if;
  spend := v_spend;
  value := v_value;
  return next;
end
$function$;
