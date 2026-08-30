-- Records bot/crawler clicks (previously discarded entirely by /r/[slug]) so their
-- volume is visible, while keeping every existing report metric unaffected: all four
-- report RPCs now exclude is_bot=true click_events from their click_events join, and a
-- new get_test_bot_click_count RPC surfaces the excluded count separately.

alter table click_events add column is_bot boolean not null default false;

drop function if exists get_test_report(uuid, timestamptz);

create or replace function get_test_report(p_test_id uuid, p_since timestamptz default null)
returns table (
  variant_id uuid,
  variant_name text,
  weight_pct numeric,
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
  select v.id, v.name, v.weight_pct,
         count(distinct ce.id)::bigint,
         count(distinct cv.id)::bigint
  from variants v
  join tests t on t.id = v.test_id
  left join click_events ce on ce.variant_id = v.id and ce.is_bot = false and (p_since is null or ce.created_at >= p_since)
  left join conversions cv on cv.click_event_id = ce.id and cv.source = t.conversion_method
  where v.test_id = p_test_id
  group by v.id, v.name, v.weight_pct
  order by v.name;
end;
$$;

drop function if exists get_test_report_by_source(uuid, timestamptz);

create or replace function get_test_report_by_source(p_test_id uuid, p_since timestamptz default null)
returns table (
  variant_id uuid,
  variant_name text,
  utm_source text,
  visits bigint,
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
    coalesce(nullif(ce.source_utms->>'utm_source', ''), '(direto)') as utm_source,
    count(distinct ce.id)::bigint,
    count(distinct cv.id)::bigint,
    coalesce(sum(cv.value_cents), 0)::bigint
  from variants v
  join tests t on t.id = v.test_id
  left join click_events ce on ce.variant_id = v.id and ce.is_bot = false and (p_since is null or ce.created_at >= p_since)
  left join conversions cv on cv.click_event_id = ce.id and cv.source = t.conversion_method
  where v.test_id = p_test_id
  group by v.id, v.name, coalesce(nullif(ce.source_utms->>'utm_source', ''), '(direto)')
  order by v.name, utm_source;
end;
$$;

drop function if exists get_test_report_by_ad(uuid, timestamptz);

create or replace function get_test_report_by_ad(p_test_id uuid, p_since timestamptz default null)
returns table (
  variant_id uuid,
  variant_name text,
  ad_name text,
  clicks bigint,
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
    coalesce(nullif(ce.source_utms->>'utm_term', ''), '(sem anúncio)') as ad_name,
    count(distinct ce.id)::bigint,
    count(distinct cv.id)::bigint,
    coalesce(sum(cv.value_cents), 0)::bigint
  from variants v
  join tests t on t.id = v.test_id
  left join click_events ce on ce.variant_id = v.id and ce.is_bot = false and (p_since is null or ce.created_at >= p_since)
  left join conversions cv on cv.click_event_id = ce.id and cv.source = t.conversion_method
  where v.test_id = p_test_id
  group by v.id, v.name, coalesce(nullif(ce.source_utms->>'utm_term', ''), '(sem anúncio)')
  order by v.name, ad_name;
end;
$$;

drop function if exists get_test_report_totals(uuid, timestamptz);

create or replace function get_test_report_totals(p_test_id uuid, p_since timestamptz default null)
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
  left join click_events ce on ce.variant_id = v.id and ce.is_bot = false and (p_since is null or ce.created_at >= p_since)
  left join conversions cv on cv.click_event_id = ce.id and cv.source = t.conversion_method
  where v.test_id = p_test_id
  group by v.id, v.name
  order by v.name;
end;
$$;

create or replace function get_test_bot_click_count(p_test_id uuid, p_since timestamptz default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  result bigint;
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and c.owner_id = auth.uid()
  ) then
    raise exception 'not found or access denied';
  end if;

  select count(*) into result
  from click_events ce
  where ce.test_id = p_test_id
    and ce.is_bot = true
    and (p_since is null or ce.created_at >= p_since);

  return result;
end;
$$;

-- Every drop+recreate above reset these functions' ACL back to the Postgres default
-- (execute granted to public). Re-apply the authenticated-only grant this codebase
-- otherwise uses everywhere (see 0001/0003), closing that gap for all five functions.
revoke all on function get_test_report(uuid, timestamptz) from public;
grant execute on function get_test_report(uuid, timestamptz) to authenticated;
revoke all on function get_test_report_by_source(uuid, timestamptz) from public;
grant execute on function get_test_report_by_source(uuid, timestamptz) to authenticated;
revoke all on function get_test_report_by_ad(uuid, timestamptz) from public;
grant execute on function get_test_report_by_ad(uuid, timestamptz) to authenticated;
revoke all on function get_test_report_totals(uuid, timestamptz) from public;
grant execute on function get_test_report_totals(uuid, timestamptz) to authenticated;
revoke all on function get_test_bot_click_count(uuid, timestamptz) from public;
grant execute on function get_test_bot_click_count(uuid, timestamptz) to authenticated;
