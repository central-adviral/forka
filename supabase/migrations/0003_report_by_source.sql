create or replace function get_test_report_by_source(p_test_id uuid)
returns table (
  variant_id uuid,
  variant_name text,
  utm_source text,
  visits bigint,
  conversions bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and c.owner_id = auth.uid()
  ) then
    raise exception 'not found or access denied';
  end if;

  return query
  select
    v.id,
    v.name,
    coalesce(nullif(ce.source_utms->>'utm_source', ''), '(direto)') as utm_source,
    count(distinct ce.id)::bigint,
    count(distinct cv.id)::bigint
  from variants v
  join tests t on t.id = v.test_id
  join click_events ce on ce.variant_id = v.id
  left join conversions cv on cv.click_event_id = ce.id and cv.source = t.conversion_method
  where v.test_id = p_test_id
  group by v.id, v.name, coalesce(nullif(ce.source_utms->>'utm_source', ''), '(direto)')
  order by v.name, utm_source;
end;
$$;

revoke all on function get_test_report_by_source(uuid) from public;
grant execute on function get_test_report_by_source(uuid) to authenticated;
