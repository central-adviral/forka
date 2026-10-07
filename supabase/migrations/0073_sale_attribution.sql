-- Sale attribution (owner decision 1A, 2026-10-07).
--
-- A sale is stored once per client and belongs to at most one project:
--   1. its product is listed in exactly one project of the client -> that project ('produto');
--   2. listed in several -> the project that owns the campaign of the ad in its UTM ('anuncio');
--   3. otherwise -> no project ('sem_atribuicao'), still kept and counted per client.
-- Removing a product from a project no longer deletes its sales: they are attributed again, and
-- end up 'sem_atribuicao' when no other project lists the product.

alter table sales add column client_id uuid references clients(id) on delete cascade;
update sales s set client_id = sf.client_id from sales_funnels sf where sf.id = s.sales_funnel_id;
alter table sales alter column client_id set not null;
alter table sales alter column sales_funnel_id drop not null;
alter table sales add column atribuicao text not null default 'produto'
  check (atribuicao in ('produto', 'anuncio', 'sem_atribuicao'));
alter table sales add constraint sales_attribution_consistent
  check ((sales_funnel_id is null) = (atribuicao = 'sem_atribuicao'));

-- The old per-project key stays for now: the code running when this is applied still upserts on
-- it. It goes in a later migration, once the client-wide key below is the only one in use.
alter table sales add constraint sales_client_source_external_id_key unique (client_id, source, external_id);
create index if not exists sales_client_unattributed_idx on sales (client_id, data_venda) where sales_funnel_id is null;

drop policy sales_read on sales;
create policy sales_read on sales for select to authenticated
  using (client_id in (select private.accessible_client_ids('cliente')));

-- The ad id a sale carries: the trailing digits of utm_campaign (the current template) or a bare
-- numeric utm_content (the older one) -- the same reading the creative report uses.
create function private.sale_ad_id(p_utm_campaign text, p_utm_content text) returns text
language sql immutable set search_path = ''
as $$
  select coalesce(
    substring(coalesce(p_utm_campaign, '') from '([0-9]{6,})[[:space:]]*$'),
    case when coalesce(p_utm_content, '') ~ '^[0-9]{6,}$' then p_utm_content end)
$$;

create function private.attribute_sale() returns trigger
language plpgsql security definer set search_path = ''
as $$
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
$$;
-- Named to sort before sales_set_papel: Postgres fires same-event BEFORE triggers by name, and
-- the role is read from the project this one picks.
create trigger sales_attribute before insert or update of produto, utm_campaign, utm_content, client_id on sales
  for each row execute function private.attribute_sale();

-- A product change re-attributes the client's sales of that product instead of deleting them.
create or replace function private.project_products_changed() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_funnel uuid := coalesce(new.sales_funnel_id, old.sales_funnel_id);
  v_client uuid;
begin
  select sf.client_id into v_client from public.sales_funnels sf where sf.id = v_funnel;
  -- Touching produto fires sales_attribute, which picks the project from the lists as they are now.
  -- The project is cleared first, so a product no project lists any more leaves its sales unattributed.
  update public.sales set sales_funnel_id = null, produto = produto
   where client_id = v_client
     and produto in (old.produto_nome, new.produto_nome);
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
