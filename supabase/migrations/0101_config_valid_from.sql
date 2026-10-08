-- The past does not change (wave 4): a product role, a product entering or leaving a project, or a
-- naming rule applies from now on. Until here a product change re-attributed and re-labelled every
-- sale of the product, and a rule change released the campaigns it touched, so past numbers moved.
-- The past only changes through an explicit "aplicar desde" (apply_config_since), with a preview.
--
-- Products: project_products stays the current config the screens edit; project_products_history
-- keeps every version with its validity, the current one open until 'infinity'. A sale's project and
-- role come from the versions valid at its data_venda, so a resync of an old sale decides it the same
-- way it was decided then. Existing rows are valid since '-infinity': today's numbers stay identical.

create table public.project_products_history (
  sales_funnel_id uuid not null references public.sales_funnels(id) on delete cascade,
  produto_nome text not null,
  papel text not null check (papel in ('entrada', 'order_bump', 'upsell', 'ascensao')),
  valid_from timestamptz not null,
  valid_until timestamptz not null default 'infinity',
  check (valid_from < valid_until)
);
create index project_products_history_product_idx on public.project_products_history (produto_nome, sales_funnel_id);
alter table public.project_products_history enable row level security;
create policy project_products_history_read on public.project_products_history for select to authenticated
  using (sales_funnel_id in (select sf.id from public.sales_funnels sf where sf.client_id in (select private.accessible_client_ids('cliente'))));
grant select on public.project_products_history to authenticated, service_role;
revoke all on public.project_products_history from anon;

insert into public.project_products_history (sales_funnel_id, produto_nome, papel, valid_from)
select pp.sales_funnel_id, pp.produto_nome, pp.papel, '-infinity' from public.project_products pp;

drop trigger sales_set_papel on public.sales;
drop function private.set_sale_papel();
drop function private.sale_papel(uuid, text, boolean);

create function private.sale_papel(p_sales_funnel_id uuid, p_produto text, p_is_upsell boolean, p_at timestamptz)
 returns text
 language sql
 stable security definer
 set search_path to ''
as $function$
  select coalesce(
    (select h.papel from public.project_products_history h
     where h.sales_funnel_id = p_sales_funnel_id and h.produto_nome = p_produto
       and h.valid_from <= p_at and p_at < h.valid_until),
    case when p_is_upsell then 'upsell' else 'entrada' end)
$function$;

create function private.set_sale_papel()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  new.papel := private.sale_papel(new.sales_funnel_id, new.produto, new.is_upsell, new.data_venda);
  return new;
end
$function$;
create trigger sales_set_papel before insert or update of produto, is_upsell, sales_funnel_id, data_venda on public.sales
  for each row execute function private.set_sale_papel();

-- The candidates are the projects that sold the product on the sale's date.
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
    return new;
  end if;

  if new.client_id is null then
    select sf.client_id into new.client_id from public.sales_funnels sf where sf.id = new.sales_funnel_id;
  end if;

  v_campaign := private.sale_campaign_id(new.client_id, new.utm_campaign, new.utm_content);
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

-- A product change opens a new version from now and closes the old one; sales already stored keep
-- their project and role. A product with no sale stored for the client is valid since always: there
-- is no past of it to protect, and its history arriving with the next sync changes no number shown.
create or replace function private.project_products_changed()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_funnel uuid := coalesce(new.sales_funnel_id, old.sales_funnel_id);
  v_client uuid;
begin
  select sf.client_id into v_client from public.sales_funnels sf where sf.id = v_funnel;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and (new.produto_nome <> old.produto_nome or new.papel <> old.papel)) then
    -- A version opened in this same transaction never was in force.
    delete from public.project_products_history
     where sales_funnel_id = v_funnel and produto_nome = old.produto_nome and valid_until = 'infinity' and valid_from >= now();
    update public.project_products_history set valid_until = now()
     where sales_funnel_id = v_funnel and produto_nome = old.produto_nome and valid_until = 'infinity';
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and (new.produto_nome <> old.produto_nome or new.papel <> old.papel)) then
    insert into public.project_products_history (sales_funnel_id, produto_nome, papel, valid_from)
    values (v_funnel, new.produto_nome, new.papel,
      case when exists (select 1 from public.sales s where s.client_id = v_client and s.produto = new.produto_nome)
        then now() else '-infinity' end);
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
$function$;

-- Naming rules: before a rule changes, every campaign the rules give an owner today is fixed to it,
-- so only campaigns without an owner (new ones, or unclassified) are decided by the new rules.
-- p_front_ids null = every front of the client.
create or replace function private.freeze_fronts_before_archive(p_client_id uuid, p_front_ids uuid[])
 returns void
 language sql
 set search_path to ''
as $function$
  insert into public.campaign_fronts (client_id, campaign_id, front_id, source)
  select p_client_id, c.campaign_id, c.suggested_front_ids[1], 'auto'
  from public.get_client_campaigns(p_client_id, '2000-01-01', current_date + 1) c
  where c.assignment = 'nome' and (p_front_ids is null or c.suggested_front_ids[1] = any (p_front_ids))
  on conflict (client_id, campaign_id) do nothing;
$function$;

drop trigger naming_rules_release_auto on public.naming_rules;
drop function private.release_auto_campaign_fronts();

-- Before the first rule row of the transaction changes, so the owners frozen are the ones the rules
-- gave before it: a later row of the same save must not freeze a half-applied rule set. A rule
-- deleted by its front's deletion finds no front any more and freezes nothing.
create function private.freeze_owners_before_rule_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_client uuid;
  v_done text := coalesce(current_setting('ct.rules_frozen_clients', true), '');
begin
  select sf.client_id into v_client
  from public.project_fronts f join public.sales_funnels sf on sf.id = f.sales_funnel_id
  where f.id = coalesce(new.front_id, old.front_id);
  if v_client is not null and strpos(v_done, v_client::text) = 0 then
    perform private.freeze_fronts_before_archive(v_client, null);
    perform set_config('ct.rules_frozen_clients', v_done || v_client::text || ',', true);
  end if;
  return coalesce(new, old);
end
$function$;
create trigger naming_rules_freeze_owners before insert or update or delete on public.naming_rules
  for each row execute function private.freeze_owners_before_rule_change();

-- The preview follows: a new rule only takes campaigns without an owner; the ones it names that
-- already have one keep it.
drop function public.preview_naming_rule(uuid, text, text);
create function public.preview_naming_rule(p_front_id uuid, p_kind text, p_value text)
 returns table(campaigns bigint, spend numeric, disputed bigint, kept_by_others bigint)
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
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
    select f.id as front_id,
      array_agg(lower(normalize(r.value, NFC))) filter (where r.kind = 'include')
        || case when f.id = p_front_id and p_kind = 'include' then array[v_value] else '{}'::text[] end as includes,
      array_agg(lower(normalize(r.value, NFC))) filter (where r.kind = 'exclude')
        || case when f.id = p_front_id and p_kind = 'exclude' then array[v_value] else '{}'::text[] end as excludes
    from public.project_fronts f
    join public.sales_funnels sf on sf.id = f.sales_funnel_id
    left join public.naming_rules r on r.front_id = f.id
    where sf.client_id = v_client_id and f.source_sales_funnel_id is null
      and f.archived_at is null and sf.archived_at is null
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
  named as (
    select * from campaigns c where p_front_id = any (coalesce(c.matches, '{}'))
  ),
  taken as (
    select * from named n where cardinality(n.front_ids) = 0
  )
  select
    (select count(*) from taken),
    coalesce((select sum(t.spend) from taken t), 0),
    (select count(*) from taken t where cardinality(t.matches) > 1),
    (select count(*) from named n where cardinality(n.front_ids) > 0 and n.front_ids[1] <> p_front_id);
end;
$function$;
revoke all on function public.preview_naming_rule(uuid, text, text) from public, anon;
grant execute on function public.preview_naming_rule(uuid, text, text) to authenticated;

-- "Aplicar desde": the project's current products become its config since p_since, its sales since
-- then are decided again, and the auto owners of campaigns with spend since then that the project
-- owns or that its rules name are decided again by the rules as they are. A campaign has one owner
-- for its whole history, so one that spent before and after p_since moves whole.
create function private.apply_config_since(p_sales_funnel_id uuid, p_since date)
 returns table(sales_changed bigint, sales_in bigint, revenue_in numeric, sales_out bigint, revenue_out numeric,
   role_changed bigint, campaigns_changed bigint, spend_in numeric, spend_out numeric)
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_client uuid;
  v_at timestamptz := p_since::timestamp at time zone 'America/Sao_Paulo';
  v_fronts uuid[];
  v_before jsonb;
  v_after jsonb;
begin
  select sf.client_id into v_client from public.sales_funnels sf where sf.id = p_sales_funnel_id;
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
revoke all on function private.apply_config_since(uuid, date) from public, anon, authenticated;

create function public.apply_config_since(p_sales_funnel_id uuid, p_since date)
 returns table(sales_changed bigint, sales_in bigint, revenue_in numeric, sales_out bigint, revenue_out numeric,
   role_changed bigint, campaigns_changed bigint, spend_in numeric, spend_out numeric)
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if not exists (select 1 from public.sales_funnels sf where sf.id = p_sales_funnel_id and private.has_client_role(sf.client_id, 'gestor')) then
    raise exception 'not found or access denied' using errcode = '42501';
  end if;
  if p_since is null or p_since > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'invalid date' using errcode = '22023';
  end if;
  return query select * from private.apply_config_since(p_sales_funnel_id, p_since);
end
$function$;
revoke all on function public.apply_config_since(uuid, date) from public, anon;
grant execute on function public.apply_config_since(uuid, date) to authenticated;

-- The preview runs the apply itself and rolls it back, so its numbers are exactly what Aplicar does.
create function public.preview_apply_since(p_sales_funnel_id uuid, p_since date)
 returns table(sales_changed bigint, sales_in bigint, revenue_in numeric, sales_out bigint, revenue_out numeric,
   role_changed bigint, campaigns_changed bigint, spend_in numeric, spend_out numeric)
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r record;
begin
  if not exists (select 1 from public.sales_funnels sf where sf.id = p_sales_funnel_id and private.has_client_role(sf.client_id, 'gestor')) then
    raise exception 'not found or access denied' using errcode = '42501';
  end if;
  if p_since is null or p_since > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'invalid date' using errcode = '22023';
  end if;
  begin
    select * into r from private.apply_config_since(p_sales_funnel_id, p_since);
    raise exception 'preview rollback' using errcode = 'PV001';
  exception when sqlstate 'PV001' then
    null;
  end;
  return query select r.sales_changed, r.sales_in, r.revenue_in, r.sales_out, r.revenue_out,
    r.role_changed, r.campaigns_changed, r.spend_in, r.spend_out;
end
$function$;
revoke all on function public.preview_apply_since(uuid, date) from public, anon;
grant execute on function public.preview_apply_since(uuid, date) to authenticated;
