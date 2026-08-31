-- get_test_report_by_source's "visits" column was actually a raw click count
-- (count(distinct ce.id) never deduped anything, since click_events.id is already
-- unique per row), unlike "Total por variante" and "Por anúncio", which both split
-- clicks from true distinct-visitor counts. Renames visits -> clicks and adds a real
-- visitors column, so all three report tables are consistent.

drop function if exists get_test_report_by_source(uuid, timestamptz);

create or replace function get_test_report_by_source(p_test_id uuid, p_since timestamptz default null)
returns table (
  variant_id uuid,
  variant_name text,
  utm_source text,
  clicks bigint,
  visitors bigint,
  conversions bigint,
  revenue_cents bigint,
  bot_clicks bigint
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
    count(distinct ce.id) filter (where ce.is_bot = false)::bigint,
    count(distinct ce.visitor_id) filter (where ce.is_bot = false)::bigint,
    count(distinct cv.id)::bigint,
    coalesce(sum(cv.value_cents), 0)::bigint,
    count(distinct ce.id) filter (where ce.is_bot = true)::bigint
  from variants v
  join tests t on t.id = v.test_id
  left join click_events ce on ce.variant_id = v.id and (p_since is null or ce.created_at >= p_since)
  left join conversions cv on cv.click_event_id = ce.id and cv.source = t.conversion_method
  where v.test_id = p_test_id
  group by v.id, v.name, coalesce(nullif(ce.source_utms->>'utm_source', ''), '(direto)')
  order by v.name, utm_source;
end;
$$;

revoke all on function get_test_report_by_source(uuid, timestamptz) from public;
grant execute on function get_test_report_by_source(uuid, timestamptz) to authenticated;
