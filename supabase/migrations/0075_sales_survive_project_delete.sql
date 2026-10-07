-- Deleting a project no longer deletes its sales (review of 2026-10-07).
--
-- The sales -> project link still cascaded from before attribution (0073): removing a project took
-- every sale it held. Now the link is cleared and the sale stays with the client, unattributed,
-- the same way a product removed from every project leaves its sales. Old sales, written before
-- the attribution trigger existed, go through it once.

alter table sales drop constraint sales_sales_funnel_id_fkey;
alter table sales add constraint sales_sales_funnel_id_fkey
  foreign key (sales_funnel_id) references sales_funnels(id) on delete set null;

-- The foreign key clears sales_funnel_id with an UPDATE; marking the sale unattributed in the same
-- row keeps sales_attribution_consistent true. Named after sales_attribute, so it sees its result.
create function private.unattribute_sale() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.sales_funnel_id is null then
    new.atribuicao := 'sem_atribuicao';
  end if;
  return new;
end
$$;
create trigger sales_unattribute before update of sales_funnel_id on sales
  for each row when (new.sales_funnel_id is null) execute function private.unattribute_sale();

-- One pass of the attribution rule over every sale stored before it existed.
update sales set produto = produto;
