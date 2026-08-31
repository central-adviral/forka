-- Powers the "acessos totais" summary on the client's test list page: one
-- query for every test under a client, instead of N calls to per-test RPCs.
create or replace function get_client_test_access_counts(p_client_id uuid)
returns table (
  test_id uuid,
  total_accesses bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from clients c where c.id = p_client_id and c.owner_id = auth.uid()
  ) then
    raise exception 'not found or access denied';
  end if;

  return query
  select
    t.id,
    count(ce.id) filter (where ce.is_bot = false)::bigint
  from tests t
  left join click_events ce on ce.test_id = t.id
  where t.client_id = p_client_id
  group by t.id;
end;
$$;

revoke all on function get_client_test_access_counts(uuid) from public;
grant execute on function get_client_test_access_counts(uuid) to authenticated;
