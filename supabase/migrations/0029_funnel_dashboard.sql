alter table clients add column launchops_operacao_ids uuid[];
alter table clients add column launchops_produto_nomes text[];

create table sales (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  source text not null default 'launchops_sync',
  external_id text not null,
  data_venda timestamptz not null,
  produto text,
  status text not null,
  valor_bruto numeric,
  valor_liquido numeric,
  metodo_pagamento text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, source, external_id)
);

create table ad_spend_daily (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  source text not null default 'launchops_sync',
  operacao_id uuid not null,
  data date not null,
  spend numeric not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  leads bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, source, operacao_id, data)
);

create table ad_creative_spend_daily (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  source text not null default 'launchops_sync',
  data date not null,
  ad_id text,
  ad_name text,
  spend numeric not null default 0,
  impressions bigint not null default 0,
  link_clicks bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (client_id, source, data, ad_id, ad_name)
);

create index ad_creative_spend_daily_report_idx
  on ad_creative_spend_daily(client_id, ad_id, ad_name, data);

create table funnel_sync_state (
  client_id uuid not null references clients(id) on delete cascade,
  entity text not null check (entity in ('sales','ad_spend_daily','ad_creative_spend_daily')),
  cursor_updated_at timestamptz,
  last_run_at timestamptz,
  last_result text,
  last_message text,
  primary key (client_id, entity)
);

alter table sales enable row level security;
alter table ad_spend_daily enable row level security;
alter table ad_creative_spend_daily enable row level security;
alter table funnel_sync_state enable row level security;

create policy "sales_via_client_owner" on sales
  for select using (exists (select 1 from clients c where c.id = sales.client_id and c.owner_id = auth.uid()));
create policy "ad_spend_daily_via_client_owner" on ad_spend_daily
  for select using (exists (select 1 from clients c where c.id = ad_spend_daily.client_id and c.owner_id = auth.uid()));
create policy "ad_creative_spend_daily_via_client_owner" on ad_creative_spend_daily
  for select using (exists (select 1 from clients c where c.id = ad_creative_spend_daily.client_id and c.owner_id = auth.uid()));
create policy "funnel_sync_state_via_client_owner" on funnel_sync_state
  for select using (exists (select 1 from clients c where c.id = funnel_sync_state.client_id and c.owner_id = auth.uid()));

grant select on sales, ad_spend_daily, ad_creative_spend_daily, funnel_sync_state to authenticated;
grant all on sales, ad_spend_daily, ad_creative_spend_daily, funnel_sync_state to service_role;
