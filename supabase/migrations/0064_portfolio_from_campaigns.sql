-- Central de Tráfego: the Carteira reads the same numbers as the rest of the Central.
--
-- get_portfolio_summary (0052) summed ad_spend_daily, the operation-mapped spend LaunchOps stopped
-- feeding on 2026-09-23, counted every approved sale (upsell and ascension included) and left the
-- Meta tax out. It now takes the spend from the client's campaigns with the tax, counts entry sales
-- and the front revenue only, and adds what a manager scans the portfolio for: today's spend, open
-- alerts and who looks after the client.
--
-- Security definer so it can read the members' e-mails for "responsável"; the rows are limited to
-- the caller's clients, and the names only to callers who work on the client (analista and up).

drop function public.get_portfolio_summary(date);
create function public.get_portfolio_summary(p_since date)
returns table (
  client_id uuid,
  spend numeric,
  spend_today numeric,
  entry_sales bigint,
  net_revenue numeric,
  active_tests bigint,
  last_sync_at timestamptz,
  alerts_crit bigint,
  alerts_warn bigint,
  responsaveis text
)
language sql stable security definer set search_path = ''
as $$
  with today as (select (now() at time zone 'America/Sao_Paulo')::date as data),
  mine as (select private.accessible_client_ids('cliente') as id),
  spend as (
    select cd.client_id, cd.data,
      sum(cd.spend) * coalesce(
        (select t.factor from public.client_tax_rates t
         where t.client_id = cd.client_id and t.valid_from <= cd.data
         order by t.valid_from desc limit 1),
        1) as spend
    from public.campaign_daily cd
    where cd.client_id in (select id from mine) and cd.data >= least(p_since, (select data from today))
    group by cd.client_id, cd.data
  )
  select
    c.id,
    coalesce((select sum(s.spend) from spend s where s.client_id = c.id and s.data >= p_since), 0),
    coalesce((select sum(s.spend) from spend s, today where s.client_id = c.id and s.data = today.data), 0),
    (
      select count(*) from public.sales s
      join public.sales_funnels sf on sf.id = s.sales_funnel_id
      where sf.client_id = c.id and s.status = 'aprovada' and s.papel = 'entrada'
        and s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
    ),
    coalesce((
      select sum(s.valor_liquido) from public.sales s
      join public.sales_funnels sf on sf.id = s.sales_funnel_id
      where sf.client_id = c.id and s.status = 'aprovada' and s.papel <> 'ascensao'
        and s.data_venda >= (p_since::timestamp at time zone 'America/Sao_Paulo')
    ), 0),
    (select count(*) from public.tests t where t.client_id = c.id and t.status = 'active'),
    greatest(
      (select max(r.finished_at) from public.sync_runs r where r.client_id = c.id and r.error is null),
      (select max(fss.last_run_at) from public.funnel_sync_state fss
       join public.sales_funnels sf on sf.id = fss.sales_funnel_id
       where sf.client_id = c.id)
    ),
    (select count(*) from public.alerts a where a.client_id = c.id and a.closed_at is null and a.severity = 'crit'),
    (select count(*) from public.alerts a where a.client_id = c.id and a.closed_at is null and a.severity = 'warn'),
    case when private.has_client_role(c.id, 'analista') then (
      select string_agg(split_part(u.email::text, '@', 1), ', ' order by private.role_rank(m.role) desc, u.email)
      from public.memberships m
      join auth.users u on u.id = m.user_id
      where m.client_id = c.id and m.role in ('owner', 'gestor')
    ) end
  from public.clients c
  where c.id in (select id from mine)
$$;
revoke all on function public.get_portfolio_summary(date) from public, anon;
grant execute on function public.get_portfolio_summary(date) to authenticated;
