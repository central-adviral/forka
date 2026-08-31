-- Powers two new charts: clicks by day of week and by hour of day. Both are
-- bucketed in America/Sao_Paulo local time (the only timezone this app's users
-- operate in today), respect the existing p_since/p_until window, exclude bots,
-- and always return all 7 weekdays / 24 hours (even at zero) via generate_series
-- so the charts never have gaps.

create or replace function get_test_report_by_weekday(p_test_id uuid, p_since timestamptz default null, p_until timestamptz default null)
returns table (
  weekday int,
  clicks bigint,
  conversions bigint,
  revenue_cents bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversion_method text;
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and c.owner_id = auth.uid()
  ) then
    raise exception 'not found or access denied';
  end if;

  select t.conversion_method into v_conversion_method from tests t where t.id = p_test_id;

  return query
  select
    d.weekday,
    count(distinct ce.id)::bigint,
    count(distinct cv.id)::bigint,
    coalesce(sum(cv.value_cents), 0)::bigint
  from generate_series(0, 6) as d(weekday)
  left join click_events ce
    on ce.test_id = p_test_id
    and ce.is_bot = false
    and extract(dow from ce.created_at at time zone 'America/Sao_Paulo')::int = d.weekday
    and (p_since is null or ce.created_at >= p_since)
    and (p_until is null or ce.created_at < p_until)
  left join conversions cv on cv.click_event_id = ce.id and cv.source = v_conversion_method
  group by d.weekday
  order by d.weekday;
end;
$$;

create or replace function get_test_report_by_hour(p_test_id uuid, p_since timestamptz default null, p_until timestamptz default null)
returns table (
  hour int,
  clicks bigint,
  conversions bigint,
  revenue_cents bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversion_method text;
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and c.owner_id = auth.uid()
  ) then
    raise exception 'not found or access denied';
  end if;

  select t.conversion_method into v_conversion_method from tests t where t.id = p_test_id;

  return query
  select
    d.hour,
    count(distinct ce.id)::bigint,
    count(distinct cv.id)::bigint,
    coalesce(sum(cv.value_cents), 0)::bigint
  from generate_series(0, 23) as d(hour)
  left join click_events ce
    on ce.test_id = p_test_id
    and ce.is_bot = false
    and extract(hour from ce.created_at at time zone 'America/Sao_Paulo')::int = d.hour
    and (p_since is null or ce.created_at >= p_since)
    and (p_until is null or ce.created_at < p_until)
  left join conversions cv on cv.click_event_id = ce.id and cv.source = v_conversion_method
  group by d.hour
  order by d.hour;
end;
$$;

revoke all on function get_test_report_by_weekday(uuid, timestamptz, timestamptz) from public;
grant execute on function get_test_report_by_weekday(uuid, timestamptz, timestamptz) to authenticated;
revoke all on function get_test_report_by_hour(uuid, timestamptz, timestamptz) from public;
grant execute on function get_test_report_by_hour(uuid, timestamptz, timestamptz) to authenticated;
