-- clients.funnel_source_service_role_key holds the service-role key of the client's own Supabase
-- -- full read/write, RLS bypassed -- and clients.hubla_webhook_token holds the webhook secret.
-- Both sit in a table with `grant select ... to authenticated` (0001_init.sql:93) whose policy
-- returns the whole row to its owner, so `select *` from a logged-in browser returns both in
-- plain text. Removing the value from the rendered form closed the HTML path and left this one
-- open.
--
-- Secrets move to a table the data API cannot reach: RLS on, no policies, no grant. Only
-- service_role, which bypasses RLS, reads or writes it -- and service_role only runs server-side.
--
-- Expand step. The columns stay on `clients` until the code reading this table is deployed;
-- 0046 drops them. Dropping them here would break the running deployment mid-flight.

create table if not exists client_secrets (
  client_id uuid primary key references clients(id) on delete cascade,
  funnel_source_service_role_key text,
  hubla_webhook_token text,
  updated_at timestamptz not null default now()
);

alter table client_secrets enable row level security;

-- Deliberately no policy and no grant to anon/authenticated: a table with RLS enabled and no
-- policy denies every request that is not service_role.
revoke all on client_secrets from anon, authenticated;
grant select, insert, update, delete on client_secrets to service_role;

insert into client_secrets (client_id, funnel_source_service_role_key, hubla_webhook_token)
select id, funnel_source_service_role_key, hubla_webhook_token
from clients
where funnel_source_service_role_key is not null or hubla_webhook_token is not null
on conflict (client_id) do update
  set funnel_source_service_role_key = excluded.funnel_source_service_role_key,
      hubla_webhook_token = excluded.hubla_webhook_token,
      updated_at = now();
