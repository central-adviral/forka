-- Central de Tráfego: the test backlog ("Backlog de Testes").
--
-- What to test, what is running and what was decided, per project, in one board: Fila (ordered by
-- ICE), Pronto pra subir (pre-requisites done), Rodando, Decidido (with the learning). A Meta
-- creative test is measured by the tag in the ad name ([T1-A]); a link A/B runs on the existing
-- test engine; "antes e depois" compares two periods. The rules of the game (CPA ceiling, cut,
-- win, saturation) live on the project.

alter table sales_funnels add column test_rules jsonb not null
  default '{"teto": 55, "mult": 1.5, "min": 10, "conf": 95, "minVisits": 500, "sat": 10}'::jsonb;

create table backlog_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  sales_funnel_id uuid not null references sales_funnels(id) on delete cascade,
  code text not null check (code ~ '^T[0-9]+$'),
  title text not null check (btrim(title) <> ''),
  hypothesis text not null default '',
  stage text not null check (stage in ('anuncio', 'pagina', 'checkout', 'oferta', 'formato', 'obrigado', 'ativacao', 'upsell')),
  method text not null check (method in ('meta', 'link', 'antes')),
  status text not null default 'queue' check (status in ('queue', 'ready', 'running', 'decided')),
  impact smallint not null default 5 check (impact between 1 and 10),
  confidence smallint not null default 5 check (confidence between 1 and 10),
  ease smallint not null default 5 check (ease between 1 and 10),
  ice numeric generated always as (round((impact + confidence + ease) / 3.0, 1)) stored,
  metric text not null default '',
  owner text,
  started_at timestamptz,
  decided_at timestamptz,
  result text,
  winner_key text,
  learning text,
  published boolean not null default false,
  ab_test_id uuid references tests(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (sales_funnel_id, code),
  -- A decided test always leaves its learning behind.
  constraint backlog_decided_has_learning check (status <> 'decided' or (learning is not null and btrim(learning) <> ''))
);
create index backlog_items_client_idx on backlog_items (client_id);

create table backlog_variants (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references backlog_items(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  key text not null check (key ~ '^[A-Z]$'),
  name text not null check (btrim(name) <> ''),
  status text not null default 'active' check (status in ('active', 'paused', 'winner')),
  position smallint not null default 0,
  unique (item_id, key)
);

create table backlog_gates (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references backlog_items(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  label text not null check (btrim(label) <> ''),
  done_at timestamptz,
  position smallint not null default 0
);

-- The item's project must belong to its client; variants and gates carry the item's client.
create function private.check_backlog_item() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.sales_funnels sf where sf.id = new.sales_funnel_id and sf.client_id = new.client_id) then
    raise exception 'backlog item project does not belong to client %', new.client_id using errcode = '23514';
  end if;
  return new;
end
$$;
create trigger backlog_items_check before insert or update on backlog_items
  for each row execute function private.check_backlog_item();

create function private.check_backlog_child() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.backlog_items i where i.id = new.item_id and i.client_id = new.client_id) then
    raise exception 'backlog child does not belong to client %', new.client_id using errcode = '23514';
  end if;
  return new;
end
$$;
create trigger backlog_variants_check before insert or update on backlog_variants
  for each row execute function private.check_backlog_child();
create trigger backlog_gates_check before insert or update on backlog_gates
  for each row execute function private.check_backlog_child();

alter table backlog_items enable row level security;
alter table backlog_variants enable row level security;
alter table backlog_gates enable row level security;

-- Who works on the client sees the whole board; a client member sees only what was published and
-- is running or decided.
create policy backlog_items_read on backlog_items for select to authenticated
  using (
    client_id in (select private.accessible_client_ids('analista'))
    or (client_id in (select private.accessible_client_ids('cliente')) and published and status in ('running', 'decided'))
  );
create policy backlog_items_write on backlog_items for all to authenticated
  using (client_id in (select private.accessible_client_ids('gestor')))
  with check (client_id in (select private.accessible_client_ids('gestor')));
create policy backlog_variants_read on backlog_variants for select to authenticated
  using (item_id in (select i.id from public.backlog_items i));
create policy backlog_variants_write on backlog_variants for all to authenticated
  using (client_id in (select private.accessible_client_ids('gestor')))
  with check (client_id in (select private.accessible_client_ids('gestor')));
create policy backlog_gates_read on backlog_gates for select to authenticated
  using (client_id in (select private.accessible_client_ids('analista')));
create policy backlog_gates_write on backlog_gates for all to authenticated
  using (client_id in (select private.accessible_client_ids('gestor')))
  with check (client_id in (select private.accessible_client_ids('gestor')));

grant select, insert, update, delete on backlog_items, backlog_variants, backlog_gates to authenticated, service_role;
revoke all on backlog_items, backlog_variants, backlog_gates from anon;
