create or replace function get_usage_stats()
returns table (
  total_clients bigint,
  total_tests bigint,
  total_click_events bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    (select count(*) from clients where owner_id = auth.uid())::bigint,
    (select count(*) from tests t join clients c on c.id = t.client_id where c.owner_id = auth.uid())::bigint,
    (select count(*)
       from click_events ce
       join tests t on t.id = ce.test_id
       join clients c on c.id = t.client_id
       where c.owner_id = auth.uid())::bigint;
end;
$$;

revoke all on function get_usage_stats() from public;
grant execute on function get_usage_stats() to authenticated;
