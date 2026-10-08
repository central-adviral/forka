-- Refunds leave the test's numbers (Testes 2.0, review of 2026-10-08).
--
-- Revenue only went up: a refunded Hubla sale kept counting as a buyer, a sale and its revenue in
-- every A/B report. Hubla sends `invoice.refunded` with the same invoice id as the payment (and no
-- separate chargeback event: a chargeback arrives as a refund). The webhook now moves that
-- conversion out of `conversions` into `conversion_refunds`, in one transaction, so every report
-- (people, buyers, sales, revenue, chance, day by day) drops it with no change of its own, and the
-- refund stays on record. A refund that arrives again finds nothing to move and changes nothing.

create table conversion_refunds (
  conversion_id uuid primary key,
  click_event_id uuid not null references click_events(id) on delete cascade,
  source text not null,
  external_event_id text,
  value_cents integer,
  converted_at timestamptz not null,
  refunded_at timestamptz not null,
  recorded_at timestamptz not null default now()
);
create index conversion_refunds_click_idx on conversion_refunds (click_event_id);

alter table conversion_refunds enable row level security;
-- Read like the conversions it came from; written only by the function below (service role).
create policy conversion_refunds_read on conversion_refunds for select to authenticated
  using (click_event_id in (select ce.id from click_events ce));

create function public.refund_hubla_conversion(p_client_id uuid, p_external_event_id text, p_refunded_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_conversion public.conversions%rowtype;
begin
  -- Only a conversion of this client's tests: the webhook is per client.
  select cv.* into v_conversion
  from public.conversions cv
  join public.click_events ce on ce.id = cv.click_event_id
  join public.tests t on t.id = ce.test_id
  where cv.external_event_id = p_external_event_id and cv.source = 'hubla_webhook' and t.client_id = p_client_id;
  if not found then
    return false;
  end if;

  insert into public.conversion_refunds (conversion_id, click_event_id, source, external_event_id, value_cents, converted_at, refunded_at)
  values (v_conversion.id, v_conversion.click_event_id, v_conversion.source, v_conversion.external_event_id, v_conversion.value_cents, v_conversion.created_at, p_refunded_at)
  on conflict (conversion_id) do nothing;
  delete from public.conversions where id = v_conversion.id;
  return true;
end;
$function$;

revoke all on function public.refund_hubla_conversion(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.refund_hubla_conversion(uuid, text, timestamptz) to service_role;
