-- Two breakdowns the sales funnel screen had no way to answer: which product carries the
-- revenue, and what time of day people actually buy. Both aggregate in the database rather
-- than shipping thousands of sales rows to the page to be counted in JavaScript.
--
-- Hours are bucketed in America/Sao_Paulo, matching how the rest of the funnel reads days:
-- an operator looking at "sales at 20h" means eight in the evening their time, not UTC.

create or replace function get_funnel_sales_by_product(
  p_sales_funnel_id uuid,
  p_since date default null,
  p_until date default null
)
returns table (produto text, sales_count bigint, revenue numeric)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from sales_funnels sf join clients c on c.id = sf.client_id
    where sf.id = p_sales_funnel_id and c.owner_id = auth.uid()
  ) then
    raise exception 'not found or access denied';
  end if;

  return query
  select
    coalesce(nullif(btrim(s.produto), ''), '(sem produto)') as produto,
    count(*)::bigint as sales_count,
    sum(coalesce(s.valor_liquido, 0)) as revenue
  from sales s
  where s.sales_funnel_id = p_sales_funnel_id
    and (p_since is null or s.data_venda >= p_since)
    and (p_until is null or s.data_venda < p_until + 1)
  group by 1
  order by 3 desc;
end;
$$;

revoke all on function get_funnel_sales_by_product(uuid, date, date) from public;
grant execute on function get_funnel_sales_by_product(uuid, date, date) to authenticated;

create or replace function get_funnel_sales_by_hour(
  p_sales_funnel_id uuid,
  p_since date default null,
  p_until date default null
)
returns table (hour int, sales_count bigint, revenue numeric)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from sales_funnels sf join clients c on c.id = sf.client_id
    where sf.id = p_sales_funnel_id and c.owner_id = auth.uid()
  ) then
    raise exception 'not found or access denied';
  end if;

  -- Every hour of the day is returned, empty ones included, so the chart keeps a stable
  -- 24-column shape instead of collapsing the quiet hours out of the axis.
  return query
  select
    h.hour::int,
    count(s.id)::bigint,
    coalesce(sum(s.valor_liquido), 0)
  from generate_series(0, 23) as h(hour)
  left join sales s
    on extract(hour from (s.data_venda at time zone 'America/Sao_Paulo')) = h.hour
   and s.sales_funnel_id = p_sales_funnel_id
   and (p_since is null or s.data_venda >= p_since)
   and (p_until is null or s.data_venda < p_until + 1)
  group by h.hour
  order by h.hour;
end;
$$;

revoke all on function get_funnel_sales_by_hour(uuid, date, date) from public;
grant execute on function get_funnel_sales_by_hour(uuid, date, date) to authenticated;
