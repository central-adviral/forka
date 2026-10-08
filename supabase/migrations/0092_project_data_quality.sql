-- Ver de onde vem (Arquitetura dos Números, onda 2, 2026-10-08). Read-only; no data changes.
--
-- * get_project_data_quality: what a project's numbers are made of and what is left out, for the
--   "de onde vem esse número" panel and the quality seals next to the project's title: the entry
--   sales by origin (ad by origin, ad with an id a front can use, no UTM, bio, other), the client's
--   sales with no project, the client's spend with no front and the campaigns two fronts dispute,
--   mirror fronts with no window, and watchers that never get to judge.
-- * preview_naming_rule: before a rule is saved, which campaigns of the last 30 days the front
--   would take with it, their spend, and how many another front would then dispute.

create function public.get_project_data_quality(p_sales_funnel_id uuid, p_since date, p_until date)
returns table (
  vendas_entrada bigint,
  vendas_anuncio bigint,
  vendas_com_id_anuncio bigint,
  vendas_sem_utm bigint,
  vendas_bio bigint,
  vendas_outra_origem bigint,
  cliente_vendas_sem_projeto bigint,
  cliente_gasto_sem_frente numeric,
  cliente_campanhas_sem_frente bigint,
  cliente_campanhas_em_disputa bigint,
  espelhos_sem_janela bigint,
  vigias_sem_avaliar bigint
)
language plpgsql stable security definer set search_path = ''
as $$
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
  ),
  entries as (
    select s.* from sales s where s.sales_funnel_id = p_sales_funnel_id and s.papel = 'entrada'
  ),
  campaigns as (
    select c.* from public.get_client_campaigns(v_client_id, p_since, p_until) c
  )
  select
    (select count(*) from entries),
    (select count(*) from entries e where e.origem in ('anuncio', 'anuncio_legado')),
    (select count(*) from entries e where private.sale_ad_id(e.utm_campaign, e.utm_content) is not null),
    (select count(*) from entries e where e.origem = 'sem_utm'),
    (select count(*) from entries e where e.origem = 'organico_bio'),
    (select count(*) from entries e where e.origem = 'outro'),
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
      where w.sales_funnel_id = p_sales_funnel_id and w.is_active
        and (w.last_day is null or w.last_day < (now() at time zone 'America/Sao_Paulo')::date - 2 or w.last_status = 'sem_dado'));
end;
$$;
revoke all on function public.get_project_data_quality(uuid, date, date) from public, anon;
grant execute on function public.get_project_data_quality(uuid, date, date) to authenticated;

create function public.preview_naming_rule(p_front_id uuid, p_kind text, p_value text)
returns table (campaigns bigint, spend numeric, disputed bigint, released_from_others bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_client_id uuid;
  v_value text := lower(normalize(btrim(p_value), NFC));
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select sf.client_id into v_client_id
  from public.project_fronts f join public.sales_funnels sf on sf.id = f.sales_funnel_id
  where f.id = p_front_id and private.has_client_role(sf.client_id, 'gestor');
  if v_client_id is null then
    raise exception 'not found or access denied';
  end if;
  if p_kind not in ('include', 'exclude') or v_value = '' then
    raise exception 'invalid rule';
  end if;

  return query
  with rules as (
    -- The front's rules with the new one, and every other own front's rules as they are.
    select f.id as front_id,
      array_agg(lower(normalize(r.value, NFC))) filter (where r.kind = 'include')
        || case when f.id = p_front_id and p_kind = 'include' then array[v_value] else '{}'::text[] end as includes,
      array_agg(lower(normalize(r.value, NFC))) filter (where r.kind = 'exclude')
        || case when f.id = p_front_id and p_kind = 'exclude' then array[v_value] else '{}'::text[] end as excludes
    from public.project_fronts f
    join public.sales_funnels sf on sf.id = f.sales_funnel_id
    left join public.naming_rules r on r.front_id = f.id
    where sf.client_id = v_client_id and f.source_sales_funnel_id is null
    group by f.id
  ),
  campaigns as (
    select c.campaign_id, c.campaign_name, c.spend, c.front_ids,
      (select array_agg(ru.front_id) from rules ru
       where cardinality(ru.includes) > 0
         and (select bool_and(strpos(lower(normalize(c.campaign_name, NFC)), i) > 0) from unnest(ru.includes) i)
         and not coalesce((select bool_or(strpos(lower(normalize(c.campaign_name, NFC)), e) > 0) from unnest(ru.excludes) e), false)) as matches
    from public.get_client_campaigns(v_client_id, v_today - 30, v_today + 1) c
  ),
  taken as (
    select * from campaigns c where p_front_id = any (coalesce(c.matches, '{}'))
  )
  select
    (select count(*) from taken),
    coalesce((select sum(t.spend) from taken t), 0),
    (select count(*) from taken t where cardinality(t.matches) > 1),
    (select count(*) from taken t where cardinality(t.front_ids) > 0 and t.front_ids[1] <> p_front_id);
end;
$$;
revoke all on function public.preview_naming_rule(uuid, text, text) from public, anon;
grant execute on function public.preview_naming_rule(uuid, text, text) to authenticated;
