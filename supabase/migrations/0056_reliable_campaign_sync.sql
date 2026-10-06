-- Central de Tráfego, Fase 1: a campaign sync that cannot double count, leave ghosts or overlap.
--
-- From the data review of 2026-10-06:
--  * Spend now comes from the per-ad table (anuncio_dia), the one whose totals match the fronts;
--    the per-ad-set table it replaces could disagree with the creative numbers.
--  * The re-read window is REPLACED day by day, not upserted: a campaign whose spend LaunchOps
--    moved or removed no longer lingers in the Central.
--  * One sync per client at a time, through a lease that expires on its own if the function dies,
--    so a killed run can never lock a client out.
--  * Every run leaves a row in sync_runs, and every day keeps the newest LaunchOps updated_at it
--    was built from, which is the "Meta data as of" shown on screen.

alter table campaign_daily add column source_updated_at timestamptz;

-- Replaces one São Paulo day of one client in a single transaction.
create function public.replace_campaign_day(p_client_id uuid, p_data date, p_rows jsonb)
returns integer
language plpgsql volatile set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.campaign_daily where client_id = p_client_id and data = p_data;
  insert into public.campaign_daily (
    client_id, data, campaign_id, campaign_name, spend, impressions, clicks, link_clicks,
    landing_page_views, leads, reach, initiate_checkout, source_updated_at, synced_at
  )
  select
    p_client_id, p_data, r.campaign_id, r.campaign_name, r.spend, r.impressions, r.clicks, r.link_clicks,
    r.landing_page_views, r.leads, r.reach, r.initiate_checkout, r.source_updated_at, now()
  from jsonb_to_recordset(p_rows) as r(
    campaign_id text, campaign_name text, spend numeric, impressions bigint, clicks bigint, link_clicks bigint,
    landing_page_views bigint, leads bigint, reach bigint, initiate_checkout bigint, source_updated_at timestamptz
  );
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke all on function public.replace_campaign_day(uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.replace_campaign_day(uuid, date, jsonb) to service_role;

create table sync_leases (
  client_id uuid primary key references clients(id) on delete cascade,
  locked_until timestamptz not null
);
alter table sync_leases enable row level security;
revoke all on sync_leases from anon, authenticated;
grant select, insert, update, delete on sync_leases to service_role;

-- True when this caller now holds the client for p_seconds. A lease left by a dead run expires.
create function public.claim_sync_lease(p_client_id uuid, p_seconds integer)
returns boolean
language sql volatile set search_path = ''
as $$
  with claimed as (
    insert into public.sync_leases (client_id, locked_until)
    values (p_client_id, now() + make_interval(secs => p_seconds))
    on conflict (client_id) do update set locked_until = excluded.locked_until
      where public.sync_leases.locked_until < now()
    returning 1
  )
  select exists (select 1 from claimed)
$$;

create function public.release_sync_lease(p_client_id uuid)
returns void
language sql volatile set search_path = ''
as $$
  update public.sync_leases set locked_until = now() where client_id = p_client_id
$$;
revoke all on function public.claim_sync_lease(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_sync_lease(uuid) from public, anon, authenticated;
grant execute on function public.claim_sync_lease(uuid, integer) to service_role;
grant execute on function public.release_sync_lease(uuid) to service_role;

create table sync_runs (
  id bigint generated always as identity primary key,
  client_id uuid not null references clients(id) on delete cascade,
  kind text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rows_read integer,
  rows_written integer,
  error text
);
create index sync_runs_client_started_idx on sync_runs (client_id, started_at desc);
alter table sync_runs enable row level security;
create policy sync_runs_read on sync_runs for select to authenticated
  using (client_id in (select private.accessible_client_ids('cliente')));
grant select on sync_runs to authenticated;
grant select, insert, update, delete on sync_runs to service_role;
revoke all on sync_runs from anon;
