-- Migration 0024 restructured get_test_report_totals's click_events join to add
-- p_until, and in doing so dropped the `ce.is_bot = false` condition that 0019
-- established for this specific function. clicks/visitors were patched with a
-- FILTER clause, but conversions/revenue_cents were plain aggregates with no
-- bot filter at all, so any conversion tied to a bot-flagged click_event leaked
-- into "Total por variante"'s revenue/conversions while clicks/visitors stayed
-- correctly bot-free. This restores the original bot-free-join semantics (the
-- "Total por variante" table must stay 100% bot-free, not just on some columns).

drop function if exists get_test_report_totals(uuid, timestamptz, timestamptz);

create or replace function get_test_report_totals(p_test_id uuid, p_since timestamptz default null, p_until timestamptz default null)
returns table (
  variant_id uuid,
  variant_name text,
  clicks bigint,
  visitors bigint,
  conversions bigint,
  revenue_cents bigint
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
    count(distinct ce.id)::bigint,
    count(distinct ce.visitor_id)::bigint,
    count(distinct cv.id)::bigint,
    coalesce(sum(cv.value_cents), 0)::bigint
  from variants v
  join tests t on t.id = v.test_id
  left join click_events ce on ce.variant_id = v.id and ce.is_bot = false
    and (p_since is null or ce.created_at >= p_since)
    and (p_until is null or ce.created_at < p_until)
  left join conversions cv on cv.click_event_id = ce.id and cv.source = t.conversion_method
  where v.test_id = p_test_id
  group by v.id, v.name
  order by v.name;
end;
$$;

revoke all on function get_test_report_totals(uuid, timestamptz, timestamptz) from public;
grant execute on function get_test_report_totals(uuid, timestamptz, timestamptz) to authenticated;
