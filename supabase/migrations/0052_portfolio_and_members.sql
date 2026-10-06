-- Central de Tráfego, Fase 0: the Carteira (portfolio) summary and the members screen.

-- One row per client the caller can see. security invoker on purpose: RLS on every table below
-- already decides what the caller may see, so the function cannot leak more than plain selects.
create function public.get_portfolio_summary(p_since date)
returns table (
  client_id uuid,
  spend numeric,
  approved_sales bigint,
  net_revenue numeric,
  active_tests bigint,
  last_sync_at timestamptz
)
language sql stable set search_path = ''
as $$
  select
    c.id,
    coalesce((
      select sum(a.spend) from public.ad_spend_daily a
      join public.sales_funnels sf on sf.id = a.sales_funnel_id
      where sf.client_id = c.id and a.data >= p_since
    ), 0),
    (
      select count(*) from public.sales s
      join public.sales_funnels sf on sf.id = s.sales_funnel_id
      where sf.client_id = c.id and s.status = 'aprovada'
        and (s.data_venda at time zone 'America/Sao_Paulo')::date >= p_since
    ),
    coalesce((
      select sum(s.valor_liquido) from public.sales s
      join public.sales_funnels sf on sf.id = s.sales_funnel_id
      where sf.client_id = c.id and s.status = 'aprovada'
        and (s.data_venda at time zone 'America/Sao_Paulo')::date >= p_since
    ), 0),
    (select count(*) from public.tests t where t.client_id = c.id and t.status = 'active'),
    (
      select max(fss.last_run_at) from public.funnel_sync_state fss
      join public.sales_funnels sf on sf.id = fss.sales_funnel_id
      where sf.client_id = c.id
    )
  from public.clients c
$$;
revoke all on function public.get_portfolio_summary(date) from public, anon;
grant execute on function public.get_portfolio_summary(date) to authenticated;

-- Members with their e-mail, which lives in auth.users and is not reachable over the Data API.
-- Owner only: a member list with e-mails is not something a read-only client user should see.
create function public.list_client_members(p_client_id uuid)
returns table (user_id uuid, email text, role text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.has_client_role(p_client_id, 'owner') then
    raise exception 'not found or access denied';
  end if;
  return query
  select m.user_id, u.email::text, m.role, m.created_at
  from public.memberships m
  join auth.users u on u.id = m.user_id
  where m.client_id = p_client_id
  order by private.role_rank(m.role) desc, u.email;
end;
$$;
revoke all on function public.list_client_members(uuid) from public, anon;
grant execute on function public.list_client_members(uuid) to authenticated;

-- Resolving an e-mail to a user is server-side only (service role): exposed to signed-in users it
-- would tell anyone whether an address has an account.
create function public.user_id_by_email(p_email text)
returns uuid
language sql stable security definer set search_path = ''
as $$ select u.id from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1 $$;
revoke all on function public.user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.user_id_by_email(text) to service_role;
