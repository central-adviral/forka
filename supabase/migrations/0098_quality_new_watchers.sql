-- A watcher created today has not had a sync yet: it is not "a watcher that never judges". The
-- seal now looks only at watchers older than two days (Configurar › Conferir flagged every new plan).

create or replace function public.get_project_data_quality(p_sales_funnel_id uuid, p_since date, p_until date)
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
      where w.sales_funnel_id = p_sales_funnel_id and w.is_active and w.created_at < now() - interval '2 days'
        and (w.last_day is null or w.last_day < (now() at time zone 'America/Sao_Paulo')::date - 2 or w.last_status = 'sem_dado'));
end;
$$;
