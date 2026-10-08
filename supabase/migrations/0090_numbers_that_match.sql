-- Números que batem (Arquitetura dos Números, onda 1, 2026-10-08). No data is rewritten here.
--
-- * attribute_sale: with an ad that two projects' campaigns ran, the project came from a
--   "limit 1" with no order, so the same sale could land in different projects. The newest day the
--   ad ran wins, then the project id, so the answer is always the same.
-- * A naming rule edit released every frozen campaign owner of the client, so adding "[GER]" to one
--   front could move old campaigns of another project. Only the campaigns the rule can touch are
--   released now: the ones that front owns and the ones whose name contains the rule's text.
-- * reattribute_pending_sales: a sale is attributed when it arrives. The first sale of a new ad,
--   synced before that ad's spend, stayed "sem projeto" for good. The sync now asks again for those
--   sales once the ad is known.
-- * get_client_daily (Hoje): the CPA divided ALL the client's spend (lead projects and campaigns
--   with no front included) by the sales of the projects, and sales with no project were left out.
--   Now the spend comes split by the owner project's result (compra, lead) and without a front,
--   so CPA uses the purchase spend and CPL the lead spend; sales count client-wide, with the
--   ones with no project apart.
-- * get_portfolio_summary (Carteira): sales and revenue count client-wide too.

create or replace function private.attribute_sale() returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  v_candidates uuid[];
  v_ad text;
  v_by_ad uuid;
begin
  if new.client_id is null then
    select sf.client_id into new.client_id from public.sales_funnels sf where sf.id = new.sales_funnel_id;
  end if;

  select coalesce(array_agg(pp.sales_funnel_id), '{}') into v_candidates
    from public.project_products pp
    join public.sales_funnels sf on sf.id = pp.sales_funnel_id
   where sf.client_id = new.client_id and pp.produto_nome = new.produto;

  if cardinality(v_candidates) = 1 then
    new.sales_funnel_id := v_candidates[1];
    new.atribuicao := 'produto';
    return new;
  end if;

  if cardinality(v_candidates) > 1 then
    v_ad := private.sale_ad_id(new.utm_campaign, new.utm_content);
    if v_ad is not null then
      select pf.sales_funnel_id into v_by_ad
        from public.ad_creative_spend_daily a
        join public.campaign_fronts cf on cf.client_id = new.client_id and cf.campaign_id = a.campaign_id
        join public.project_fronts pf on pf.id = cf.front_id
       where a.ad_id = v_ad and pf.sales_funnel_id = any (v_candidates)
       order by a.data desc, pf.sales_funnel_id
       limit 1;
      if v_by_ad is not null then
        new.sales_funnel_id := v_by_ad;
        new.atribuicao := 'anuncio';
        return new;
      end if;
    end if;
  end if;

  -- No project lists the product: a write that names its project keeps it (a project still read by
  -- its LaunchOps name list, before Produtos existed); otherwise the sale has no project.
  if cardinality(v_candidates) = 0 and new.sales_funnel_id is not null then
    new.atribuicao := 'produto';
    return new;
  end if;

  new.sales_funnel_id := null;
  new.atribuicao := 'sem_atribuicao';
  return new;
end
$function$;

create or replace function private.release_auto_campaign_fronts() returns trigger
language plpgsql security definer set search_path = ''
as $$
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
    );
  return null;
end
$$;

create function public.reattribute_pending_sales(p_client_id uuid)
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
       and exists (select 1 from public.ad_creative_spend_daily a where a.ad_id = private.sale_ad_id(s.utm_campaign, s.utm_content))
    returning s.atribuicao
  )
  select count(*) filter (where atribuicao <> 'sem_atribuicao') into v_count from touched;
  return v_count;
end
$$;
revoke all on function public.reattribute_pending_sales(uuid) from public, anon, authenticated;
grant execute on function public.reattribute_pending_sales(uuid) to service_role;

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
  receita_ascensao_liquida numeric,
  spend_compra_com_imposto numeric,
  spend_lead_com_imposto numeric,
  spend_sem_frente_com_imposto numeric,
  vendas_sem_projeto bigint
)
language sql stable set search_path = ''
as $$
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
      coalesce(sum(cd.spend) filter (where o.resultado = 'compra'), 0) as spend_compra,
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
      coalesce(s.papel, 'entrada') as papel, s.origem, s.valor_liquido, s.sales_funnel_id
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
      count(*) filter (where papel = 'entrada' and not apos_dados and origem in ('anuncio', 'anuncio_legado')) as vendas_anuncio,
      coalesce(sum(valor_liquido) filter (where papel <> 'ascensao' and not apos_dados), 0) as receita_liquida,
      count(*) filter (where apos_dados) as vendas_apos_dados,
      coalesce(sum(valor_liquido) filter (where papel = 'ascensao' and not apos_dados), 0) as receita_ascensao_liquida,
      count(*) filter (where sales_funnel_id is null and not apos_dados) as vendas_sem_projeto
    from sales
    group by data
  ),
  days as (
    select coalesce(sp.data, sa.data) as day, sp.spend, sp.leads, sp.spend_compra, sp.spend_lead, sp.spend_sem_frente,
      sa.vendas, sa.vendas_anuncio, sa.receita_liquida, sa.vendas_apos_dados, sa.receita_ascensao_liquida, sa.vendas_sem_projeto
    from spend sp
    full join sales_by_day sa on sa.data = sp.data
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
    coalesce(d.receita_liquida, 0),
    case when d.day = (select data from today) then (select dados_ate from today) end,
    coalesce(d.vendas_apos_dados, 0)::bigint,
    coalesce(d.receita_ascensao_liquida, 0),
    coalesce(d.spend_compra, 0) * d.tax,
    coalesce(d.spend_lead, 0) * d.tax,
    coalesce(d.spend_sem_frente, 0) * d.tax,
    coalesce(d.vendas_sem_projeto, 0)::bigint
  from taxed d
  order by 1
$$;
revoke all on function public.get_client_daily(uuid, date, date) from public, anon;
grant execute on function public.get_client_daily(uuid, date, date) to authenticated, service_role;

create or replace function public.get_portfolio_summary(p_since date)
returns table (
  client_id uuid,
  spend numeric,
  spend_today numeric,
  entry_sales bigint,
  net_revenue numeric,
  active_tests bigint,
  last_sync_at timestamptz,
  alerts_crit bigint,
  alerts_warn bigint,
  responsaveis text
)
language sql stable security definer set search_path = ''
as $$
  with today as (select (now() at time zone 'America/Sao_Paulo')::date as data),
  mine as (select private.accessible_client_ids('cliente') as id),
  spend as (
    select cd.client_id, cd.data,
      sum(cd.spend) * coalesce(
        (select t.factor from public.client_tax_rates t
         where t.client_id = cd.client_id and t.valid_from <= cd.data
         order by t.valid_from desc limit 1),
        1) as spend
    from public.campaign_daily cd
    where cd.client_id in (select id from mine) and cd.data >= least(p_since, (select data from today))
    group by cd.client_id, cd.data
  )
  select
    c.id,
    coalesce((select sum(s.spend) from spend s where s.client_id = c.id and s.data >= p_since), 0),
    coalesce((select sum(s.spend) from spend s, today where s.client_id = c.id and s.data = today.data), 0),
    -- Client-wide: a sale with no project is still the client's sale.
    (
      select count(*) from public.sales s
      where s.client_id = c.id and s.status = 'aprovada' and coalesce(s.papel, 'entrada') = 'entrada'
        and s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
    ),
    coalesce((
      select sum(s.valor_liquido) from public.sales s
      where s.client_id = c.id and s.status = 'aprovada' and coalesce(s.papel, 'entrada') <> 'ascensao'
        and s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
    ), 0),
    (select count(*) from public.tests t where t.client_id = c.id and t.status = 'active'),
    greatest(
      (select max(r.finished_at) from public.sync_runs r where r.client_id = c.id and r.error is null),
      (select max(fss.last_run_at) from public.funnel_sync_state fss
       join public.sales_funnels sf on sf.id = fss.sales_funnel_id
       where sf.client_id = c.id and fss.last_result = 'ok')
    ),
    (select count(*) from public.alerts a where a.client_id = c.id and a.closed_at is null and a.severity = 'crit'),
    (select count(*) from public.alerts a where a.client_id = c.id and a.closed_at is null and a.severity = 'warn'),
    case when private.has_client_role(c.id, 'analista') then (
      select string_agg(split_part(u.email::text, '@', 1), ', ' order by private.role_rank(m.role) desc, u.email)
      from public.memberships m
      join auth.users u on u.id = m.user_id
      where m.client_id = c.id and m.role in ('owner', 'gestor')
    ) end
  from public.clients c
  where c.id in (select id from mine)
$$;
