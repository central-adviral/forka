-- Every sale the test can see, and a way to know how many it saw (data engineer review, 2026-10-08).
-- Additive; no existing row changes.
--
-- * hubla_events: one row per payment or refund the Hubla webhook receives, with what happened to
--   it (counted, no tracking id, unknown click, refunded...). No customer data. Until now a sale
--   without the click's id was answered "ok" and forgotten, so nobody could measure the loss. A
--   refund that arrives before its payment is kept here too, and the payment then does not count.
-- * recover_conversions_from_sales: LaunchOps receives the same Hubla invoice. A synced sale whose
--   utm_content is the tracking id of a click, and whose invoice no conversion holds, becomes the
--   conversion the webhook missed (down, late, token). The invoice id is the key, unique already,
--   so a sale never counts twice; the value is valor_bruto (equal to the webhook amount in all 265
--   pairs in production); created_at is the sale time, so the day-by-day chart is right.
--   recovered_via marks it, for the health panel and to undo it if ever needed.
-- * get_test_data_health: what the test page shows under "Saúde dos dados".

create table hubla_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  invoice_id text,
  kind text not null check (kind in ('payment', 'refund')),
  outcome text not null check (outcome in ('counted', 'duplicate', 'no_tracking', 'unknown_click', 'already_refunded', 'refunded', 'refund_unmatched')),
  click_event_id uuid references click_events(id) on delete set null,
  value_cents integer,
  received_at timestamptz not null default now()
);
create index hubla_events_client_idx on hubla_events (client_id, received_at desc);
create index hubla_events_invoice_idx on hubla_events (invoice_id);
create index hubla_events_click_idx on hubla_events (click_event_id);

alter table hubla_events enable row level security;
-- Written only by the webhook (service role); read by the team.
create policy hubla_events_read on hubla_events for select to authenticated
  using (client_id in (select private.accessible_client_ids('analista')));

alter table conversions add column recovered_via text check (recovered_via in ('launchops_sync'));

create function public.recover_conversions_from_sales(p_client_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer;
begin
  with candidates as (
    select distinct on (s.transaction_id_plataforma)
      s.transaction_id_plataforma as invoice, ce.id as click_id, round(s.valor_bruto * 100)::integer as cents, s.data_venda
    from public.sales s
    join public.click_events ce on ce.tracking_id = s.utm_content and not ce.is_bot
    join public.tests t on t.id = ce.test_id and t.client_id = p_client_id and t.conversion_method = 'hubla_webhook'
    where s.client_id = p_client_id
      and s.transaction_id_plataforma is not null
      and s.data_venda >= now() - interval '90 days'
      -- Bought after the click (a few minutes of clock skew), within the cookie's 30 days.
      and s.data_venda >= ce.created_at - interval '5 minutes'
      and s.data_venda < ce.created_at + interval '30 days'
      and not exists (select 1 from public.conversions cv where cv.external_event_id = s.transaction_id_plataforma)
      and not exists (select 1 from public.conversion_refunds r where r.external_event_id = s.transaction_id_plataforma)
      and not exists (select 1 from public.hubla_events h where h.invoice_id = s.transaction_id_plataforma and h.kind = 'refund')
    order by s.transaction_id_plataforma, ce.created_at
  ),
  inserted as (
    insert into public.conversions (click_event_id, source, external_event_id, value_cents, created_at, recovered_via)
    select c.click_id, 'hubla_webhook', c.invoice, c.cents, c.data_venda, 'launchops_sync' from candidates c
    on conflict (external_event_id) where external_event_id is not null do nothing
    returning id, external_event_id
  )
  update public.sales s set conversion_id = i.id
  from inserted i
  where s.client_id = p_client_id and s.transaction_id_plataforma = i.external_event_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
revoke all on function public.recover_conversions_from_sales(uuid) from public, anon, authenticated;
grant execute on function public.recover_conversions_from_sales(uuid) to service_role;

create function public.get_test_data_health(p_test_id uuid, p_since timestamptz default null)
returns table (
  traceable_sales bigint,
  counted_sales bigint,
  recovered bigint,
  refunds bigint,
  median_delay_seconds numeric,
  clicks bigint,
  bot_clicks bigint,
  rate_limited_clicks bigint,
  buyers bigint,
  buyers_in_other_tests bigint,
  client_untracked_payments bigint
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_client_id uuid;
  v_funnel_id uuid;
begin
  select t.client_id, t.sales_funnel_id into v_client_id, v_funnel_id
  from public.tests t
  where t.id = p_test_id and private.can_read_test(t.id);
  if v_client_id is null then
    raise exception 'not found or access denied';
  end if;

  return query
  with test_clicks as (
    select ce.id, ce.tracking_id, ce.visitor_id, ce.is_bot, ce.rate_limited
    from public.click_events ce
    where ce.test_id = p_test_id and (p_since is null or ce.created_at >= p_since)
  ),
  -- Sales LaunchOps synced that carry the id of one of this test's clicks: the ones the test must see.
  traceable as (
    select s.transaction_id_plataforma as invoice, s.data_venda
    from public.sales s
    join test_clicks tc on tc.tracking_id = s.utm_content and not tc.is_bot
    where s.client_id = v_client_id and s.transaction_id_plataforma is not null
  ),
  test_conversions as (
    select cv.id, cv.created_at, cv.recovered_via, cv.external_event_id, tc.visitor_id
    from public.conversions cv
    join test_clicks tc on tc.id = cv.click_event_id
    where cv.source = 'hubla_webhook'
  ),
  test_buyers as (
    select distinct tcv.visitor_id from test_conversions tcv
  )
  select
    (select count(*) from traceable),
    (select count(*) from traceable tr where exists (select 1 from public.conversions cv where cv.external_event_id = tr.invoice)),
    (select count(*) from test_conversions tcv where tcv.recovered_via is not null),
    (select count(*) from public.conversion_refunds r join test_clicks tc on tc.id = r.click_event_id),
    (select (percentile_cont(0.5) within group (order by extract(epoch from c.created_at - tr.data_venda)))::numeric
       from test_conversions c join traceable tr on tr.invoice = c.external_event_id where c.recovered_via is null),
    (select count(*) from test_clicks),
    (select count(*) from test_clicks tc where tc.is_bot),
    (select count(*) from test_clicks tc where tc.rate_limited and not tc.is_bot),
    (select count(*) from test_buyers),
    (select count(*) from test_buyers b where exists (
       select 1 from public.click_events o join public.tests ot on ot.id = o.test_id
       where o.visitor_id = b.visitor_id and ot.id <> p_test_id and ot.client_id = v_client_id
         and (v_funnel_id is null or ot.sales_funnel_id = v_funnel_id))),
    (select count(*) from public.hubla_events h
      where h.client_id = v_client_id and h.kind = 'payment' and h.outcome = 'no_tracking'
        and (p_since is null or h.received_at >= p_since));
end;
$function$;
revoke all on function public.get_test_data_health(uuid, timestamptz) from public, anon;
grant execute on function public.get_test_data_health(uuid, timestamptz) to authenticated;
