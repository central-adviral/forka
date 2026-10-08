-- Acabamento dos dados (Vitor, 2026-10-08). Additive: existing rows read the same numbers.
--
-- * project_fronts.janela_inicio / janela_fim: a mirror front's own date window. A mirror reads the
--   source project's spend only inside it; empty falls back to the project's starts_on / ends_on (0054).
-- * pages.tipo: the page kind the wizard used to keep only in the label ("Captura · Frente").
-- * sales_funnels.encerrado_em: when the project closed. A closed project takes no sale made after
--   it; the ones before stay, so a resync does not move the past. A draft still takes sales.
-- * reattribute_pending_sales: the late-campaign fill (0103) also sets anuncio_funnel_id.
-- * sales_funnels_resultado_history: what each project produced on each day, so a resultado change
--   no longer rewrites the compra/lead split of get_client_daily's past days.

-- 1. Mirror window --------------------------------------------------------------------------------

alter table public.project_fronts
  add column janela_inicio date,
  add column janela_fim date,
  add constraint project_fronts_window_only_mirror check (source_sales_funnel_id is not null or (janela_inicio is null and janela_fim is null)),
  add constraint project_fronts_window_order check (janela_fim is null or janela_inicio is null or janela_fim >= janela_inicio);

create or replace function public.get_project_front_daily(p_sales_funnel_id uuid, p_since date, p_until date)
 returns table(front_id uuid, data date, spend numeric, impressions bigint, clicks bigint, link_clicks bigint, landing_page_views bigint, leads bigint, reach bigint, initiate_checkout bigint)
 language sql
 stable
 set search_path to ''
as $function$
  with project as (
    select sf.client_id, sf.starts_on, sf.ends_on from public.sales_funnels sf where sf.id = p_sales_funnel_id
  ),
  classified as (
    select c.campaign_id, unnest(c.front_ids) as front_id
    from project p, public.get_client_campaigns(p.client_id, p_since, p_until) c
  )
  select
    cl.front_id, cd.data, sum(cd.spend), sum(cd.impressions)::bigint, sum(cd.clicks)::bigint, sum(cd.link_clicks)::bigint,
    sum(cd.landing_page_views)::bigint, sum(cd.leads)::bigint, sum(cd.reach)::bigint, sum(cd.initiate_checkout)::bigint
  from classified cl
  join public.project_fronts f on f.id = cl.front_id and f.sales_funnel_id = p_sales_funnel_id
  join project p on true
  join public.campaign_daily cd
    on cd.client_id = p.client_id and cd.campaign_id = cl.campaign_id and cd.data >= p_since and cd.data < p_until
  where f.source_sales_funnel_id is null
     or ((coalesce(f.janela_inicio, p.starts_on) is null or cd.data >= coalesce(f.janela_inicio, p.starts_on))
         and (coalesce(f.janela_fim, p.ends_on) is null or cd.data <= coalesce(f.janela_fim, p.ends_on)))
  group by cl.front_id, cd.data
  order by cd.data, cl.front_id
$function$;

-- A mirror is listed on a campaign only when its window overlaps the campaign's days in the range.
create or replace function public.get_client_campaigns(p_client_id uuid, p_since date, p_until date)
 returns table(campaign_id text, campaign_name text, spend numeric, impressions bigint, link_clicks bigint, leads bigint, first_day date, last_day date, front_ids uuid[], suggested_front_ids uuid[], assignment text)
 language sql
 stable
 set search_path to ''
as $function$
  with campaigns as (
    select
      cd.campaign_id,
      (array_agg(cd.campaign_name order by cd.data desc))[1] as campaign_name,
      sum(cd.spend) as spend,
      sum(cd.impressions)::bigint as impressions,
      sum(cd.link_clicks)::bigint as link_clicks,
      sum(cd.leads)::bigint as leads,
      min(cd.data) as first_day,
      max(cd.data) as last_day
    from public.campaign_daily cd
    where cd.client_id = p_client_id and cd.data >= p_since and cd.data < p_until
    group by cd.campaign_id
    having sum(cd.spend) > 0
  ),
  fronts as (
    select
      f.id,
      array_agg(lower(normalize(r.value, NFC))) filter (where r.kind = 'include') as includes,
      array_agg(lower(normalize(r.value, NFC))) filter (where r.kind = 'exclude') as excludes
    from public.project_fronts f
    join public.sales_funnels sf on sf.id = f.sales_funnel_id
    left join public.naming_rules r on r.front_id = f.id
    where sf.client_id = p_client_id and f.source_sales_funnel_id is null
      and f.archived_at is null and sf.archived_at is null
    group by f.id
  ),
  matched as (
    select
      c.*,
      coalesce(
        (select array_agg(f.id order by f.id) from fronts f
         where f.includes is not null
           and (select bool_and(strpos(lower(normalize(c.campaign_name, NFC)), i) > 0) from unnest(f.includes) i)
           and not coalesce((select bool_or(strpos(lower(normalize(c.campaign_name, NFC)), e) > 0) from unnest(f.excludes) e), false)),
        '{}'
      ) as suggested
    from campaigns c
  ),
  resolved as (
    select
      m.*,
      case when cf.front_id is not null then cf.front_id when cardinality(m.suggested) = 1 then m.suggested[1] end as owner_front,
      case when cf.front_id is not null then cf.source when cardinality(m.suggested) = 1 then 'nome' end as assignment
    from matched m
    left join public.campaign_fronts cf on cf.client_id = p_client_id and cf.campaign_id = m.campaign_id
  )
  select
    r.campaign_id, r.campaign_name, r.spend, r.impressions, r.link_clicks, r.leads, r.first_day, r.last_day,
    case when r.owner_front is null then '{}'::uuid[]
      else array[r.owner_front] || coalesce(
        (select array_agg(mirror.id order by mirror.id)
         from public.project_fronts owner_front
         join public.project_fronts mirror on mirror.source_sales_funnel_id = owner_front.sales_funnel_id
         join public.sales_funnels msf on msf.id = mirror.sales_funnel_id
         where owner_front.id = r.owner_front
           and (coalesce(mirror.janela_inicio, msf.starts_on) is null or coalesce(mirror.janela_inicio, msf.starts_on) <= r.last_day)
           and (coalesce(mirror.janela_fim, msf.ends_on) is null or coalesce(mirror.janela_fim, msf.ends_on) >= r.first_day)),
        '{}')
    end,
    r.suggested,
    r.assignment
  from resolved r
  order by r.spend desc
$function$;

create or replace function public.get_project_data_quality(p_sales_funnel_id uuid, p_since date, p_until date)
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
      where f.sales_funnel_id = p_sales_funnel_id and f.source_sales_funnel_id is not null
        and coalesce(f.janela_inicio, v_starts) is null and coalesce(f.janela_fim, v_ends) is null),
    (select count(*) from public.watchers w
      where w.sales_funnel_id = p_sales_funnel_id and w.is_active and w.created_at < now() - interval '2 days'
        and (w.last_day is null or w.last_day < (now() at time zone 'America/Sao_Paulo')::date - 2 or w.last_status = 'sem_dado'));
end;
$function$;

-- 2. Page kind ------------------------------------------------------------------------------------

alter table public.pages add column tipo text check (tipo in ('captura', 'obrigado', 'vendas', 'checkout'));
-- The wizard's labels start with the kind ("Captura · Captação"); other labels stay without one.
create or replace function public.page_kind_of_label(p_label text) returns text
language sql immutable set search_path = ''
as $$ select (regexp_match(lower(p_label), '^(captura|obrigado|vendas|checkout)\M'))[1] $$;
revoke all on function public.page_kind_of_label(text) from public, anon;
grant execute on function public.page_kind_of_label(text) to authenticated, service_role;
update public.pages set tipo = public.page_kind_of_label(label) where public.page_kind_of_label(label) is not null;

-- 3. A closed project takes no new sale -----------------------------------------------------------

alter table public.sales_funnels add column encerrado_em timestamptz;
-- When a project closed before this column existed is unknown: from now on is the date that moves no sale.
update public.sales_funnels set encerrado_em = now() where status = 'encerrado';

create or replace function private.sync_funnel_status()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  if tg_op = 'INSERT' then
    -- An insert that only says is_active = false (the old form, old tests) is a stopped project.
    if not new.is_active and new.status = 'rodando' then
      new.status := 'encerrado';
    end if;
  elsif new.status is not distinct from old.status and new.is_active is distinct from old.is_active then
    new.status := case when new.is_active then 'rodando' else 'encerrado' end;
  end if;
  new.is_active := new.status = 'rodando';
  if new.status <> 'encerrado' then
    new.encerrado_em := null;
  elsif tg_op = 'INSERT' or old.status <> 'encerrado' then
    new.encerrado_em := now();
  end if;
  return new;
end
$function$;

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

  -- A closed project (encerrado_em set) still takes the sales made before it closed.
  select coalesce(array_agg(h.sales_funnel_id), '{}') into v_candidates
    from public.project_products_history h
    join public.sales_funnels sf on sf.id = h.sales_funnel_id
   where sf.client_id = new.client_id and h.produto_nome = new.produto and sf.archived_at is null
     and (sf.encerrado_em is null or new.data_venda < sf.encerrado_em)
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
     and not exists (select 1 from public.sales_funnels sf where sf.id = new.sales_funnel_id
                     and (sf.archived_at is not null or sf.encerrado_em <= new.data_venda))
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

-- 4. A late campaign also names the project that owns the ad --------------------------------------

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

  -- A sale stored before its campaign reached campaign_daily becomes an ad sale once it does, and
  -- its ad's project is known with it. The sale's own project is not decided again.
  update public.sales s
     set campanha_id = c.campaign_id,
         anuncio_funnel_id = private.campaign_owner_project(s.client_id, c.campaign_id)
    from (select s2.id, private.sale_campaign_id(s2.client_id, s2.utm_campaign, s2.utm_content) as campaign_id
            from public.sales s2
           where s2.client_id = p_client_id and s2.campanha_id is null
             and s2.data_venda >= now() - interval '7 days'
             and private.sale_ad_id(s2.utm_campaign, s2.utm_content) is not null) c
   where s.id = c.id and c.campaign_id is not null;
  return v_count;
end
$function$;

-- 5. Versioned resultado --------------------------------------------------------------------------

create table public.sales_funnels_resultado_history (
  sales_funnel_id uuid not null references public.sales_funnels(id) on delete cascade,
  resultado text not null,
  valid_from date not null,
  valid_until date not null default 'infinity',
  primary key (sales_funnel_id, valid_from),
  check (valid_from < valid_until)
);
alter table public.sales_funnels_resultado_history enable row level security;
create policy sales_funnels_resultado_history_read on public.sales_funnels_resultado_history for select to authenticated
  using (sales_funnel_id in (select sf.id from public.sales_funnels sf where sf.client_id in (select private.accessible_client_ids('cliente'))));
grant select on public.sales_funnels_resultado_history to authenticated, service_role;
revoke all on public.sales_funnels_resultado_history from anon;

insert into public.sales_funnels_resultado_history (sales_funnel_id, resultado, valid_from)
select sf.id, sf.resultado, '-infinity' from public.sales_funnels sf;

-- Rewrites the history so p_resultado holds from p_from on; what held before p_from stays.
create or replace function private.set_resultado_since(p_sales_funnel_id uuid, p_resultado text, p_from date)
 returns void
 language sql
 security definer
 set search_path to ''
as $function$
  delete from public.sales_funnels_resultado_history where sales_funnel_id = p_sales_funnel_id and valid_from >= p_from;
  update public.sales_funnels_resultado_history set valid_until = p_from where sales_funnel_id = p_sales_funnel_id and valid_until > p_from;
  insert into public.sales_funnels_resultado_history (sales_funnel_id, resultado, valid_from) values (p_sales_funnel_id, p_resultado, p_from);
$function$;

-- A new project has no past: its resultado holds since always. A change holds from today (São Paulo).
create or replace function private.track_resultado()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.sales_funnels_resultado_history (sales_funnel_id, resultado, valid_from) values (new.id, new.resultado, '-infinity');
  elsif new.resultado is distinct from old.resultado then
    perform private.set_resultado_since(new.id, new.resultado, (now() at time zone 'America/Sao_Paulo')::date);
  end if;
  return null;
end
$function$;
create trigger sales_funnels_resultado_history after insert or update of resultado on public.sales_funnels
  for each row execute function private.track_resultado();

-- "Aplicar desde" (0101) also makes the current resultado hold from the chosen date.
create or replace function private.apply_config_since(p_sales_funnel_id uuid, p_since date)
 returns table(sales_changed bigint, sales_in bigint, revenue_in numeric, sales_out bigint, revenue_out numeric, role_changed bigint, campaigns_changed bigint, spend_in numeric, spend_out numeric)
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_client uuid;
  v_resultado text;
  v_at timestamptz := p_since::timestamp at time zone 'America/Sao_Paulo';
  v_fronts uuid[];
  v_before jsonb;
  v_after jsonb;
begin
  select sf.client_id, sf.resultado into v_client, v_resultado from public.sales_funnels sf where sf.id = p_sales_funnel_id;
  v_fronts := array(select f.id from public.project_fronts f where f.sales_funnel_id = p_sales_funnel_id and f.source_sales_funnel_id is null);

  select coalesce(jsonb_object_agg(c.campaign_id, jsonb_build_object('project', pf.sales_funnel_id, 'spend', c.spend)), '{}')
    into v_before
  from public.get_client_campaigns(v_client, '2000-01-01', current_date + 1) c
  left join public.project_fronts pf on pf.id = c.front_ids[1]
  left join public.sales_funnels psf on psf.id = pf.sales_funnel_id
  where (c.front_ids[1] = any (v_fronts) or c.suggested_front_ids && v_fronts)
    and c.assignment is distinct from 'manual'
    and (pf.id is null or (pf.archived_at is null and psf.archived_at is null))
    and exists (select 1 from public.campaign_daily cd
                where cd.client_id = v_client and cd.campaign_id = c.campaign_id and cd.data >= p_since and cd.spend > 0);

  delete from public.campaign_fronts cf
  where cf.client_id = v_client and cf.source = 'auto' and v_before ? cf.campaign_id;
  insert into public.campaign_fronts (client_id, campaign_id, front_id, source)
  select v_client, c.campaign_id, c.suggested_front_ids[1], 'auto'
  from public.get_client_campaigns(v_client, '2000-01-01', current_date + 1) c
  where c.assignment = 'nome' and v_before ? c.campaign_id
  on conflict (client_id, campaign_id) do nothing;

  select coalesce(jsonb_object_agg(c.campaign_id, pf.sales_funnel_id), '{}') into v_after
  from public.get_client_campaigns(v_client, '2000-01-01', current_date + 1) c
  left join public.project_fronts pf on pf.id = c.front_ids[1]
  where v_before ? c.campaign_id;

  delete from public.project_products_history
   where sales_funnel_id = p_sales_funnel_id and valid_until <> 'infinity' and valid_from >= v_at;
  update public.project_products_history set valid_until = v_at
   where sales_funnel_id = p_sales_funnel_id and valid_until <> 'infinity' and valid_from < v_at and valid_until > v_at;
  update public.project_products_history set valid_from = v_at
   where sales_funnel_id = p_sales_funnel_id and valid_until = 'infinity' and valid_from > v_at;

  perform private.set_resultado_since(p_sales_funnel_id, v_resultado, p_since);

  return query
  with moved as (
    -- Clearing the project first keeps the sync hint out: sales_attribute decides from the products alone.
    update public.sales s set sales_funnel_id = null, produto = s.produto
    from (
      select o.id, o.sales_funnel_id as old_funnel, o.papel as old_papel from public.sales o
      where o.client_id = v_client and o.data_venda >= v_at
        and (o.sales_funnel_id = p_sales_funnel_id
             or o.produto in (select h.produto_nome from public.project_products_history h where h.sales_funnel_id = p_sales_funnel_id))
    ) o
    where s.id = o.id
    returning o.old_funnel, o.old_papel, s.sales_funnel_id as new_funnel, s.papel as new_papel, s.valor_liquido
  ),
  campaigns as (
    select (v_before -> k ->> 'project')::uuid as old_project, (v_after ->> k)::uuid as new_project, (v_before -> k ->> 'spend')::numeric as spend
    from jsonb_object_keys(v_before) k
  )
  select
    (select count(*) from moved m where m.old_funnel is distinct from m.new_funnel or m.old_papel <> m.new_papel),
    (select count(*) from moved m where m.new_funnel = p_sales_funnel_id and m.old_funnel is distinct from p_sales_funnel_id),
    (select coalesce(sum(m.valor_liquido), 0) from moved m where m.new_funnel = p_sales_funnel_id and m.old_funnel is distinct from p_sales_funnel_id),
    (select count(*) from moved m where m.old_funnel = p_sales_funnel_id and m.new_funnel is distinct from p_sales_funnel_id),
    (select coalesce(sum(m.valor_liquido), 0) from moved m where m.old_funnel = p_sales_funnel_id and m.new_funnel is distinct from p_sales_funnel_id),
    (select count(*) from moved m where m.old_funnel = p_sales_funnel_id and m.new_funnel = p_sales_funnel_id and m.old_papel <> m.new_papel),
    (select count(*) from campaigns c where c.old_project is distinct from c.new_project),
    (select coalesce(sum(c.spend), 0) from campaigns c where c.new_project = p_sales_funnel_id and c.old_project is distinct from p_sales_funnel_id),
    (select coalesce(sum(c.spend), 0) from campaigns c where c.old_project = p_sales_funnel_id and c.new_project is distinct from p_sales_funnel_id);
end
$function$;

create or replace function public.get_client_daily(p_client_id uuid, p_since date, p_until date)
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
  -- The project that owns each campaign (mirrors never own); what it produced is read per day below.
  owners as (
    select c.campaign_id, f.sales_funnel_id
    from public.get_client_campaigns(p_client_id, p_since, p_until) c
    join public.project_fronts f on f.id = c.front_ids[1]
    where cardinality(c.front_ids) > 0
  ),
  spend as (
    select cd.data, sum(cd.spend) as spend, sum(cd.leads) as leads,
      coalesce(sum(cd.spend) filter (where h.resultado in ('compra', 'roas')), 0) as spend_compra,
      coalesce(sum(cd.spend) filter (where h.resultado = 'lead'), 0) as spend_lead,
      coalesce(sum(cd.spend) filter (where o.campaign_id is null), 0) as spend_sem_frente
    from public.campaign_daily cd
    left join owners o on o.campaign_id = cd.campaign_id
    left join public.sales_funnels_resultado_history h
      on h.sales_funnel_id = o.sales_funnel_id and cd.data >= h.valid_from and cd.data < h.valid_until
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
