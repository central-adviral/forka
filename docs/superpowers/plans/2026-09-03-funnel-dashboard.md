# Funnel Dashboard (LaunchOps → ab-test-tool) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-client "Funil de Vendas" module to ab-test-tool that syncs sales and Meta Ads spend from the LaunchOps Blacksheep Supabase project on a schedule, and enriches the existing per-ad test report with that spend.

**Architecture:** New tables (`sales`, `ad_spend_daily`, `ad_creative_spend_daily`, `funnel_sync_state`) mirror LaunchOps data inside ab-test-tool's own Supabase project. A Vercel Cron job hits an internal API route that reads from a second, LaunchOps-scoped Supabase client and upserts into those tables. Read paths (dashboard UI, enriched RPCs) only ever touch the local mirror — never LaunchOps directly. Fetch (IO) and transform/upsert (testable) are split into separate functions throughout, so sync logic is testable with synthetic rows instead of a live cross-project connection.

**Tech Stack:** Next.js 16 (App Router), `@supabase/supabase-js`, `@supabase/ssr`, Postgres (Supabase), Zod, Vitest.

**Spec:** [docs/superpowers/specs/2026-09-03-funnel-dashboard-design.md](../specs/2026-09-03-funnel-dashboard-design.md)

## Global Constraints

- All new tables get RLS; `authenticated` gets `select` only, `service_role` gets full access — writes only ever happen via the service-role sync path, never from user-facing code (spec, "Modelo de dados").
- `ad_spend_daily` stores one row **per `operacao_id`**, never a pre-aggregated total — aggregation across operations happens at read time, not write time (spec, "Por que `ad_spend_daily` guarda uma linha por operação").
- The `ad_creative_spend_daily` unique constraint must use `nulls not distinct` (spec + code review finding #3).
- Any query joining `ad_creative_spend_daily` against `click_events`/`conversions` must pre-aggregate spend in a CTE before joining — never join the raw daily rows directly against click-level rows (spec + code review finding #1).
- Sync must never advance a cursor on failure, and must never let a LaunchOps read error break the dashboard UI (spec, "Tratamento de erros e casos de borda").
- New code follows existing repo conventions: repo functions take a `SupabaseClient` as first arg and throw on `error`; server actions are `'use server'` + Zod-validated; UI follows the existing dark-card Tailwind tokens already used in `integrations/page.tsx` and the client list page.

---

## Task 1: Schema migration — funnel tables

**Files:**
- Create: `supabase/migrations/0029_funnel_dashboard.sql`
- Test: `supabase/migrations/0029_funnel_dashboard.integration.test.ts`

**Interfaces:**
- Produces: tables `sales`, `ad_spend_daily`, `ad_creative_spend_daily`, `funnel_sync_state`; columns `clients.launchops_operacao_ids uuid[]`, `clients.launchops_produto_nomes text[]`. All later tasks read/write these exact names.

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Apply the migration locally**

Run: `npx supabase db push` (or `npx supabase migration up` against the local dev stack, per the project's existing workflow)
Expected: migration `0029_funnel_dashboard` applied with no errors.

- [ ] **Step 3: Write the failing integration test**

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

const serviceDb = createServiceRoleClient()
let clientId: string

beforeAll(async () => {
  const { data: user } = await serviceDb.auth.admin.createUser({
    email: `funnel-owner-${Date.now()}@example.com`,
    password: 'password123',
    email_confirm: true,
  })
  const { data: client } = await serviceDb
    .from('clients')
    .insert({ owner_id: user!.user!.id, name: 'Funnel RLS', slug: `funnel-rls-${Date.now()}` })
    .select()
    .single()
  clientId = client!.id

  await serviceDb.from('sales').insert({
    client_id: clientId,
    external_id: `sale-${Date.now()}`,
    data_venda: new Date().toISOString(),
    status: 'aprovada',
    valor_bruto: 10,
  })
})

describe('funnel tables RLS', () => {
  it('lets the service role select the seeded sale', async () => {
    const { data, error } = await serviceDb.from('sales').select('id').eq('client_id', clientId)
    expect(error).toBeNull()
    expect(data!.length).toBe(1)
  })

  it('grants the authenticated role select-only access to the new tables', async () => {
    const { data, error } = await serviceDb
      .from('information_schema.role_table_grants' as never)
      .select('privilege_type')
      .eq('table_name', 'sales')
      .eq('grantee', 'authenticated')
    expect(error).toBeNull()
    const privileges = (data as { privilege_type: string }[]).map((row) => row.privilege_type)
    expect(privileges).toEqual(['SELECT'])
  })
})
```

Run: `npm run test:integration -- 0029_funnel_dashboard`
Expected: FAIL before Step 2's migration is applied (tables don't exist yet). Apply Step 2 first if not already done, then this becomes the confirming run.

- [ ] **Step 4: Confirm the test passes against the applied migration**

Run: `npm run test:integration -- 0029_funnel_dashboard`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0029_funnel_dashboard.sql supabase/migrations/0029_funnel_dashboard.integration.test.ts
git commit -m "feat(db): add funnel dashboard tables (sales, ad_spend_daily, ad_creative_spend_daily, funnel_sync_state)"
```

---

## Task 2: LaunchOps client factory

**Files:**
- Create: `src/lib/launchops/client.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `createLaunchOpsClient(): SupabaseClient` — used by Task 4/5/6's fetch functions and the sync route (Task 7). Never imported outside `src/lib/launchops/` and `src/app/api/internal/sync-funnel/`.

- [ ] **Step 1: Add env vars to `.env.example`**

```
LAUNCHOPS_SUPABASE_URL=
LAUNCHOPS_SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
```

- [ ] **Step 2: Write the client factory**

```typescript
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fetchWithTimeout } from '@/lib/supabase/fetch-with-timeout'

export function createLaunchOpsClient(): SupabaseClient {
  return createClient(
    process.env.LAUNCHOPS_SUPABASE_URL!,
    process.env.LAUNCHOPS_SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, global: { fetch: fetchWithTimeout } }
  )
}
```

- [ ] **Step 3: Type-check**

Run: `npm run build` (or `npx tsc --noEmit` if faster during iteration)
Expected: no type errors from this file.

- [ ] **Step 4: Commit**

```bash
git add src/lib/launchops/client.ts .env.example
git commit -m "feat(launchops): add cross-project client factory"
```

---

## Task 3: Sync state repo

**Files:**
- Create: `src/lib/repo/funnel-sync-state-repo.ts`
- Test: `src/lib/repo/funnel-sync-state-repo.integration.test.ts`

**Interfaces:**
- Consumes: `SupabaseClient` from `@supabase/supabase-js` (any client with write access to `funnel_sync_state`, i.e. service role).
- Produces:
  - `type SyncEntity = 'sales' | 'ad_spend_daily' | 'ad_creative_spend_daily'`
  - `getSyncCursor(db, clientId: string, entity: SyncEntity): Promise<string | null>`
  - `recordSyncResult(db, params: { clientId: string; entity: SyncEntity; result: 'ok' | 'error'; message?: string; newCursor?: string }): Promise<void>` — used by Task 4/5/6's orchestration and Task 7's route; read by Task 10's UI via a thin wrapper.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getSyncCursor, recordSyncResult } from './funnel-sync-state-repo'

const db = createServiceRoleClient()
let clientId: string

beforeAll(async () => {
  const { data: user } = await db.auth.admin.createUser({
    email: `sync-state-${Date.now()}@example.com`,
    password: 'password123',
    email_confirm: true,
  })
  const { data: client } = await db
    .from('clients')
    .insert({ owner_id: user!.user!.id, name: 'SyncState', slug: `sync-state-${Date.now()}` })
    .select()
    .single()
  clientId = client!.id
})

describe('funnel-sync-state-repo', () => {
  it('returns null cursor when the entity has never synced', async () => {
    const cursor = await getSyncCursor(db, clientId, 'sales')
    expect(cursor).toBeNull()
  })

  it('records a successful sync and advances the cursor', async () => {
    await recordSyncResult(db, { clientId, entity: 'sales', result: 'ok', newCursor: '2026-09-01T00:00:00Z' })
    const cursor = await getSyncCursor(db, clientId, 'sales')
    expect(cursor).toBe('2026-09-01T00:00:00.000Z')
  })

  it('does not advance the cursor on a failed sync', async () => {
    await recordSyncResult(db, { clientId, entity: 'sales', result: 'ok', newCursor: '2026-09-01T00:00:00Z' })
    await recordSyncResult(db, { clientId, entity: 'sales', result: 'error', message: 'LaunchOps timeout' })
    const cursor = await getSyncCursor(db, clientId, 'sales')
    expect(cursor).toBe('2026-09-01T00:00:00.000Z')
  })
})
```

Run: `npm run test:integration -- funnel-sync-state-repo`
Expected: FAIL with "Cannot find module './funnel-sync-state-repo'"

- [ ] **Step 2: Write the implementation**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

export type SyncEntity = 'sales' | 'ad_spend_daily' | 'ad_creative_spend_daily'

export async function getSyncCursor(db: SupabaseClient, clientId: string, entity: SyncEntity): Promise<string | null> {
  const { data, error } = await db
    .from('funnel_sync_state')
    .select('cursor_updated_at')
    .eq('client_id', clientId)
    .eq('entity', entity)
    .maybeSingle()
  if (error) throw error
  return (data?.cursor_updated_at as string | undefined) ?? null
}

export async function recordSyncResult(
  db: SupabaseClient,
  params: {
    clientId: string
    entity: SyncEntity
    result: 'ok' | 'error'
    message?: string
    newCursor?: string
  }
): Promise<void> {
  const update: Record<string, unknown> = {
    client_id: params.clientId,
    entity: params.entity,
    last_run_at: new Date().toISOString(),
    last_result: params.result,
    last_message: params.message ?? null,
  }
  if (params.result === 'ok' && params.newCursor) {
    update.cursor_updated_at = params.newCursor
  } else {
    const existing = await getSyncCursor(db, params.clientId, params.entity)
    update.cursor_updated_at = existing
  }
  const { error } = await db.from('funnel_sync_state').upsert(update, { onConflict: 'client_id,entity' })
  if (error) throw error
}
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npm run test:integration -- funnel-sync-state-repo`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/repo/funnel-sync-state-repo.ts src/lib/repo/funnel-sync-state-repo.integration.test.ts
git commit -m "feat(funnel): add sync cursor tracking repo"
```

---

## Task 4: Sales sync (fetch + transform/upsert)

**Files:**
- Create: `src/lib/launchops/sync-sales.ts`
- Test: `src/lib/launchops/sync-sales.test.ts` (pure transform, no DB), `src/lib/launchops/sync-sales.integration.test.ts` (upsert, real local DB)

**Interfaces:**
- Consumes: `SupabaseClient` (LaunchOps client from Task 2 for fetch; app service-role client from `service-role.ts` for upsert).
- Produces:
  - `interface LaunchOpsSaleRow { id: string; data_venda: string; produto_nome: string | null; status: string; valor_bruto: number | null; valor_liquido: number | null; metodo_pagamento: string | null; updated_at: string }`
  - `fetchLaunchOpsSalesRows(launchopsDb, params: { produtoNomes: string[]; since: string | null }): Promise<LaunchOpsSaleRow[]>`
  - `syncSalesForClient(appDb, clientId: string, rows: LaunchOpsSaleRow[]): Promise<{ synced: number; latestUpdatedAt: string | null }>` — used by Task 7's route.

- [ ] **Step 1: Write the failing unit test for the transform**

```typescript
import { describe, it, expect } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { syncSalesForClient } from './sync-sales'

describe('syncSalesForClient', () => {
  it('returns latestUpdatedAt as null for an empty batch, without touching the db', async () => {
    const result = await syncSalesForClient(createServiceRoleClient(), 'unused', [])
    expect(result).toEqual({ synced: 0, latestUpdatedAt: null })
  })
})
```

Run: `npx vitest run src/lib/launchops/sync-sales.test.ts`
Expected: FAIL with "Cannot find module './sync-sales'"

- [ ] **Step 2: Write the implementation**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

export interface LaunchOpsSaleRow {
  id: string
  data_venda: string
  produto_nome: string | null
  status: string
  valor_bruto: number | null
  valor_liquido: number | null
  metodo_pagamento: string | null
  updated_at: string
}

export async function fetchLaunchOpsSalesRows(
  launchopsDb: SupabaseClient,
  params: { produtoNomes: string[]; since: string | null }
): Promise<LaunchOpsSaleRow[]> {
  let query = launchopsDb
    .from('vendas')
    .select('id, data_venda, produto_nome, status, valor_bruto, valor_liquido, metodo_pagamento, updated_at')
    .eq('plataforma', 'hubla')
    .eq('status', 'aprovada')
    .in('produto_nome', params.produtoNomes)
    .order('updated_at', { ascending: true })
  if (params.since) query = query.gt('updated_at', params.since)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as LaunchOpsSaleRow[]
}

export async function syncSalesForClient(
  appDb: SupabaseClient,
  clientId: string,
  rows: LaunchOpsSaleRow[]
): Promise<{ synced: number; latestUpdatedAt: string | null }> {
  if (rows.length === 0) return { synced: 0, latestUpdatedAt: null }

  const payload = rows.map((row) => ({
    client_id: clientId,
    source: 'launchops_sync',
    external_id: row.id,
    data_venda: row.data_venda,
    produto: row.produto_nome,
    status: row.status,
    valor_bruto: row.valor_bruto,
    valor_liquido: row.valor_liquido,
    metodo_pagamento: row.metodo_pagamento,
    updated_at: row.updated_at,
  }))

  const { error } = await appDb.from('sales').upsert(payload, { onConflict: 'client_id,source,external_id' })
  if (error) throw error

  const latestUpdatedAt = rows[rows.length - 1].updated_at
  return { synced: rows.length, latestUpdatedAt }
}
```

- [ ] **Step 3: Run the unit test to verify it passes**

Run: `npx vitest run src/lib/launchops/sync-sales.test.ts`
Expected: PASS

- [ ] **Step 4: Write the failing integration test for the upsert**

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { syncSalesForClient, type LaunchOpsSaleRow } from './sync-sales'

const db = createServiceRoleClient()
let clientId: string

beforeAll(async () => {
  const { data: user } = await db.auth.admin.createUser({
    email: `sync-sales-${Date.now()}@example.com`,
    password: 'password123',
    email_confirm: true,
  })
  const { data: client } = await db
    .from('clients')
    .insert({ owner_id: user!.user!.id, name: 'SyncSales', slug: `sync-sales-${Date.now()}` })
    .select()
    .single()
  clientId = client!.id
})

function row(overrides: Partial<LaunchOpsSaleRow> = {}): LaunchOpsSaleRow {
  return {
    id: crypto.randomUUID(),
    data_venda: '2026-09-01T12:00:00Z',
    produto_nome: '1K Por Dia Latam',
    status: 'aprovada',
    valor_bruto: 7.7,
    valor_liquido: 6.9,
    metodo_pagamento: 'pix',
    updated_at: '2026-09-01T12:00:00Z',
    ...overrides,
  }
}

describe('syncSalesForClient (integration)', () => {
  it('inserts a new sale and re-running with the same row does not duplicate it', async () => {
    const saleRow = row()
    await syncSalesForClient(db, clientId, [saleRow])
    await syncSalesForClient(db, clientId, [saleRow])

    const { data } = await db.from('sales').select('id').eq('client_id', clientId).eq('external_id', saleRow.id)
    expect(data!.length).toBe(1)
  })

  it('updates an existing sale in place when the row is re-synced with new values', async () => {
    const saleRow = row({ valor_bruto: 10 })
    await syncSalesForClient(db, clientId, [saleRow])
    await syncSalesForClient(db, clientId, [{ ...saleRow, valor_bruto: 12 }])

    const { data } = await db
      .from('sales')
      .select('valor_bruto')
      .eq('client_id', clientId)
      .eq('external_id', saleRow.id)
      .single()
    expect(data!.valor_bruto).toBe(12)
  })
})
```

Run: `npm run test:integration -- sync-sales`
Expected: FAIL if run before Step 2's implementation exists. Run it after Step 2 is in place — it then confirms the upsert behavior.

- [ ] **Step 5: Run all sync-sales tests to verify they pass**

Run: `npx vitest run src/lib/launchops/sync-sales.test.ts && npm run test:integration -- sync-sales`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/launchops/sync-sales.ts src/lib/launchops/sync-sales.test.ts src/lib/launchops/sync-sales.integration.test.ts
git commit -m "feat(launchops): sync sales from LaunchOps vendas table"
```

---

## Task 5: Ad spend (account-level) sync

**Files:**
- Create: `src/lib/launchops/sync-ad-spend.ts`
- Test: `src/lib/launchops/sync-ad-spend.test.ts`, `src/lib/launchops/sync-ad-spend.integration.test.ts`

**Interfaces:**
- Produces:
  - `interface LaunchOpsAdSpendRow { operacao_id: string; data_referencia: string; spend: number; impressions: number; clicks: number; leads_periodo: number; updated_at: string }`
  - `fetchLaunchOpsAdSpendRows(launchopsDb, params: { operacaoIds: string[]; since: string | null }): Promise<LaunchOpsAdSpendRow[]>`
  - `interface AggregatedAdSpendRow { operacao_id: string; data: string; spend: number; impressions: number; clicks: number; leads: number }`
  - `aggregateAdSpendByOperacaoDay(rows: LaunchOpsAdSpendRow[]): AggregatedAdSpendRow[]` — pure, unit-tested without a DB.
  - `syncAdSpendForClient(appDb, clientId: string, rows: AggregatedAdSpendRow[]): Promise<{ synced: number }>` — the sync cursor for this entity comes from the caller's own tracking of the raw rows' max `updated_at` (see Task 7), not from this function.

- [ ] **Step 1: Write the failing unit test for the aggregation**

```typescript
import { describe, it, expect } from 'vitest'
import { aggregateAdSpendByOperacaoDay, type LaunchOpsAdSpendRow } from './sync-ad-spend'

describe('aggregateAdSpendByOperacaoDay', () => {
  it('sums spend across multiple campaigns/adsets for the same operation and day', () => {
    const rows: LaunchOpsAdSpendRow[] = [
      { operacao_id: 'op-1', data_referencia: '2026-09-01', spend: 100, impressions: 1000, clicks: 10, leads_periodo: 2, updated_at: '2026-09-01T10:00:00Z' },
      { operacao_id: 'op-1', data_referencia: '2026-09-01', spend: 50, impressions: 500, clicks: 5, leads_periodo: 1, updated_at: '2026-09-01T11:00:00Z' },
      { operacao_id: 'op-1', data_referencia: '2026-09-02', spend: 30, impressions: 300, clicks: 3, leads_periodo: 0, updated_at: '2026-09-02T09:00:00Z' },
    ]
    const result = aggregateAdSpendByOperacaoDay(rows)
    expect(result).toEqual(
      expect.arrayContaining([
        { operacao_id: 'op-1', data: '2026-09-01', spend: 150, impressions: 1500, clicks: 15, leads: 3 },
        { operacao_id: 'op-1', data: '2026-09-02', spend: 30, impressions: 300, clicks: 3, leads: 0 },
      ])
    )
    expect(result.length).toBe(2)
  })

  it('keeps two different operations on the same day as separate rows', () => {
    const rows: LaunchOpsAdSpendRow[] = [
      { operacao_id: 'op-1', data_referencia: '2026-09-01', spend: 100, impressions: 1000, clicks: 10, leads_periodo: 2, updated_at: '2026-09-01T10:00:00Z' },
      { operacao_id: 'op-2', data_referencia: '2026-09-01', spend: 40, impressions: 400, clicks: 4, leads_periodo: 1, updated_at: '2026-09-01T10:00:00Z' },
    ]
    expect(aggregateAdSpendByOperacaoDay(rows).length).toBe(2)
  })
})
```

Run: `npx vitest run src/lib/launchops/sync-ad-spend.test.ts`
Expected: FAIL with "Cannot find module './sync-ad-spend'"

- [ ] **Step 2: Write the implementation**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

export interface LaunchOpsAdSpendRow {
  operacao_id: string
  data_referencia: string
  spend: number
  impressions: number
  clicks: number
  leads_periodo: number
  updated_at: string
}

export interface AggregatedAdSpendRow {
  operacao_id: string
  data: string
  spend: number
  impressions: number
  clicks: number
  leads: number
}

export async function fetchLaunchOpsAdSpendRows(
  launchopsDb: SupabaseClient,
  params: { operacaoIds: string[]; since: string | null }
): Promise<LaunchOpsAdSpendRow[]> {
  let query = launchopsDb
    .from('meta_ads_daily')
    .select('operacao_id, data_referencia, spend, impressions, clicks, leads_periodo, updated_at')
    .in('operacao_id', params.operacaoIds)
    .order('updated_at', { ascending: true })
  if (params.since) query = query.gt('updated_at', params.since)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as LaunchOpsAdSpendRow[]
}

export function aggregateAdSpendByOperacaoDay(rows: LaunchOpsAdSpendRow[]): AggregatedAdSpendRow[] {
  const byKey = new Map<string, AggregatedAdSpendRow>()
  for (const row of rows) {
    const key = `${row.operacao_id}|${row.data_referencia}`
    const existing = byKey.get(key) ?? {
      operacao_id: row.operacao_id,
      data: row.data_referencia,
      spend: 0,
      impressions: 0,
      clicks: 0,
      leads: 0,
    }
    existing.spend += row.spend
    existing.impressions += row.impressions
    existing.clicks += row.clicks
    existing.leads += row.leads_periodo
    byKey.set(key, existing)
  }
  return [...byKey.values()]
}

export async function syncAdSpendForClient(
  appDb: SupabaseClient,
  clientId: string,
  rows: AggregatedAdSpendRow[]
): Promise<{ synced: number }> {
  if (rows.length === 0) return { synced: 0 }

  const payload = rows.map((row) => ({
    client_id: clientId,
    source: 'launchops_sync',
    operacao_id: row.operacao_id,
    data: row.data,
    spend: row.spend,
    impressions: row.impressions,
    clicks: row.clicks,
    leads: row.leads,
    updated_at: new Date().toISOString(),
  }))

  const { error } = await appDb.from('ad_spend_daily').upsert(payload, { onConflict: 'client_id,source,operacao_id,data' })
  if (error) throw error
  return { synced: payload.length }
}
```

- [ ] **Step 3: Run the unit test to verify it passes**

Run: `npx vitest run src/lib/launchops/sync-ad-spend.test.ts`
Expected: PASS

- [ ] **Step 4: Write the failing integration test for the upsert**

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { syncAdSpendForClient, type AggregatedAdSpendRow } from './sync-ad-spend'

const db = createServiceRoleClient()
let clientId: string
const operacaoIdA = crypto.randomUUID()
const operacaoIdB = crypto.randomUUID()

beforeAll(async () => {
  const { data: user } = await db.auth.admin.createUser({
    email: `sync-adspend-${Date.now()}@example.com`,
    password: 'password123',
    email_confirm: true,
  })
  const { data: client } = await db
    .from('clients')
    .insert({ owner_id: user!.user!.id, name: 'SyncAdSpend', slug: `sync-adspend-${Date.now()}` })
    .select()
    .single()
  clientId = client!.id
})

describe('syncAdSpendForClient (integration)', () => {
  it('keeps operation A untouched when only operation B is re-synced for the same day', async () => {
    const rowA: AggregatedAdSpendRow = { operacao_id: operacaoIdA, data: '2026-09-01', spend: 100, impressions: 1000, clicks: 10, leads: 2 }
    const rowB: AggregatedAdSpendRow = { operacao_id: operacaoIdB, data: '2026-09-01', spend: 40, impressions: 400, clicks: 4, leads: 1 }
    await syncAdSpendForClient(db, clientId, [rowA, rowB])

    await syncAdSpendForClient(db, clientId, [{ ...rowB, spend: 55 }])

    const { data } = await db
      .from('ad_spend_daily')
      .select('operacao_id, spend')
      .eq('client_id', clientId)
      .eq('data', '2026-09-01')
      .order('operacao_id')

    const byOp = new Map(data!.map((r) => [r.operacao_id, r.spend]))
    expect(byOp.get(operacaoIdA)).toBe(100)
    expect(byOp.get(operacaoIdB)).toBe(55)
  })
})
```

Run: `npm run test:integration -- sync-ad-spend`
Expected: PASS (this is the regression test for code review finding #2 — run it to confirm, since it exercises real upsert behavior against Postgres, not just JS logic)

- [ ] **Step 5: Commit**

```bash
git add src/lib/launchops/sync-ad-spend.ts src/lib/launchops/sync-ad-spend.test.ts src/lib/launchops/sync-ad-spend.integration.test.ts
git commit -m "feat(launchops): sync account-level ad spend, one row per operation"
```

---

## Task 6: Ad spend (creative-level) sync

**Files:**
- Create: `src/lib/launchops/sync-ad-creative-spend.ts`
- Test: `src/lib/launchops/sync-ad-creative-spend.test.ts`, `src/lib/launchops/sync-ad-creative-spend.integration.test.ts`

**Interfaces:**
- Produces:
  - `interface LaunchOpsAdCreative { id: string; ad_id: string | null; ad_name: string | null }`
  - `interface LaunchOpsAdCreativeSpendRow { anuncio_id: string; data_referencia: string; spend: number; impressions: number; link_clicks: number; updated_at: string }`
  - `fetchLaunchOpsAdCreatives(launchopsDb, operacaoIds: string[]): Promise<LaunchOpsAdCreative[]>`
  - `fetchLaunchOpsAdCreativeSpendRows(launchopsDb, params: { anuncioIds: string[]; since: string | null }): Promise<LaunchOpsAdCreativeSpendRow[]>`
  - `interface JoinedAdCreativeSpendRow { ad_id: string | null; ad_name: string | null; data: string; spend: number; impressions: number; link_clicks: number }`
  - `joinAdCreativeSpend(creatives: LaunchOpsAdCreative[], spendRows: LaunchOpsAdCreativeSpendRow[]): JoinedAdCreativeSpendRow[]` — pure.
  - `syncAdCreativeSpendForClient(appDb, clientId: string, rows: JoinedAdCreativeSpendRow[]): Promise<{ synced: number }>`

- [ ] **Step 1: Write the failing unit test for the join**

```typescript
import { describe, it, expect } from 'vitest'
import { joinAdCreativeSpend, type LaunchOpsAdCreative, type LaunchOpsAdCreativeSpendRow } from './sync-ad-creative-spend'

describe('joinAdCreativeSpend', () => {
  it('attaches ad_id/ad_name to each spend row via anuncio_id, and drops rows with no matching creative', () => {
    const creatives: LaunchOpsAdCreative[] = [{ id: 'anuncio-1', ad_id: '12345', ad_name: 'Criativo A' }]
    const spendRows: LaunchOpsAdCreativeSpendRow[] = [
      { anuncio_id: 'anuncio-1', data_referencia: '2026-09-01', spend: 20, impressions: 200, link_clicks: 5, updated_at: '2026-09-01T00:00:00Z' },
      { anuncio_id: 'anuncio-orphan', data_referencia: '2026-09-01', spend: 5, impressions: 50, link_clicks: 1, updated_at: '2026-09-01T00:00:00Z' },
    ]
    const result = joinAdCreativeSpend(creatives, spendRows)
    expect(result).toEqual([
      { ad_id: '12345', ad_name: 'Criativo A', data: '2026-09-01', spend: 20, impressions: 200, link_clicks: 5 },
    ])
  })
})
```

Run: `npx vitest run src/lib/launchops/sync-ad-creative-spend.test.ts`
Expected: FAIL with "Cannot find module './sync-ad-creative-spend'"

- [ ] **Step 2: Write the implementation**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

export interface LaunchOpsAdCreative {
  id: string
  ad_id: string | null
  ad_name: string | null
}

export interface LaunchOpsAdCreativeSpendRow {
  anuncio_id: string
  data_referencia: string
  spend: number
  impressions: number
  link_clicks: number
  updated_at: string
}

export interface JoinedAdCreativeSpendRow {
  ad_id: string | null
  ad_name: string | null
  data: string
  spend: number
  impressions: number
  link_clicks: number
}

export async function fetchLaunchOpsAdCreatives(
  launchopsDb: SupabaseClient,
  operacaoIds: string[]
): Promise<LaunchOpsAdCreative[]> {
  const { data, error } = await launchopsDb.from('anuncio').select('id, ad_id, ad_name').in('operacao_id', operacaoIds)
  if (error) throw error
  return (data ?? []) as LaunchOpsAdCreative[]
}

export async function fetchLaunchOpsAdCreativeSpendRows(
  launchopsDb: SupabaseClient,
  params: { anuncioIds: string[]; since: string | null }
): Promise<LaunchOpsAdCreativeSpendRow[]> {
  if (params.anuncioIds.length === 0) return []
  let query = launchopsDb
    .from('anuncio_dia')
    .select('anuncio_id, data_referencia, spend, impressions, link_clicks, updated_at')
    .in('anuncio_id', params.anuncioIds)
    .order('updated_at', { ascending: true })
  if (params.since) query = query.gt('updated_at', params.since)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as LaunchOpsAdCreativeSpendRow[]
}

export function joinAdCreativeSpend(
  creatives: LaunchOpsAdCreative[],
  spendRows: LaunchOpsAdCreativeSpendRow[]
): JoinedAdCreativeSpendRow[] {
  const creativeById = new Map(creatives.map((c) => [c.id, c]))
  const joined: JoinedAdCreativeSpendRow[] = []
  for (const row of spendRows) {
    const creative = creativeById.get(row.anuncio_id)
    if (!creative) continue
    joined.push({
      ad_id: creative.ad_id,
      ad_name: creative.ad_name,
      data: row.data_referencia,
      spend: row.spend,
      impressions: row.impressions,
      link_clicks: row.link_clicks,
    })
  }
  return joined
}

export async function syncAdCreativeSpendForClient(
  appDb: SupabaseClient,
  clientId: string,
  rows: JoinedAdCreativeSpendRow[]
): Promise<{ synced: number }> {
  if (rows.length === 0) return { synced: 0 }

  const payload = rows.map((row) => ({
    client_id: clientId,
    source: 'launchops_sync',
    data: row.data,
    ad_id: row.ad_id,
    ad_name: row.ad_name,
    spend: row.spend,
    impressions: row.impressions,
    link_clicks: row.link_clicks,
    updated_at: new Date().toISOString(),
  }))

  const { error } = await appDb
    .from('ad_creative_spend_daily')
    .upsert(payload, { onConflict: 'client_id,source,data,ad_id,ad_name' })
  if (error) throw error
  return { synced: payload.length }
}
```

- [ ] **Step 3: Run the unit test to verify it passes**

Run: `npx vitest run src/lib/launchops/sync-ad-creative-spend.test.ts`
Expected: PASS

- [ ] **Step 4: Write the failing integration test for null-`ad_id` idempotency**

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { syncAdCreativeSpendForClient, type JoinedAdCreativeSpendRow } from './sync-ad-creative-spend'

const db = createServiceRoleClient()
let clientId: string

beforeAll(async () => {
  const { data: user } = await db.auth.admin.createUser({
    email: `sync-adcreative-${Date.now()}@example.com`,
    password: 'password123',
    email_confirm: true,
  })
  const { data: client } = await db
    .from('clients')
    .insert({ owner_id: user!.user!.id, name: 'SyncAdCreative', slug: `sync-adcreative-${Date.now()}` })
    .select()
    .single()
  clientId = client!.id
})

describe('syncAdCreativeSpendForClient (integration)', () => {
  it('does not duplicate a row when ad_id is null and the same batch is synced twice', async () => {
    const row: JoinedAdCreativeSpendRow = { ad_id: null, ad_name: 'Criativo Sem ID', data: '2026-09-01', spend: 10, impressions: 100, link_clicks: 2 }
    await syncAdCreativeSpendForClient(db, clientId, [row])
    await syncAdCreativeSpendForClient(db, clientId, [row])

    const { data } = await db
      .from('ad_creative_spend_daily')
      .select('id')
      .eq('client_id', clientId)
      .eq('data', '2026-09-01')
      .is('ad_id', null)
      .eq('ad_name', 'Criativo Sem ID')
    expect(data!.length).toBe(1)
  })
})
```

Run: `npm run test:integration -- sync-ad-creative-spend`
Expected: PASS (this is the regression test for code review finding #3 — `nulls not distinct` from Task 1 is what makes it pass; temporarily dropping that clause from the migration and re-running this test should make it FAIL, confirming the test actually exercises the fix)

- [ ] **Step 5: Commit**

```bash
git add src/lib/launchops/sync-ad-creative-spend.ts src/lib/launchops/sync-ad-creative-spend.test.ts src/lib/launchops/sync-ad-creative-spend.integration.test.ts
git commit -m "feat(launchops): sync ad-creative-level spend"
```

---

## Task 7: Sync orchestration route + Vercel Cron

**Files:**
- Create: `src/app/api/internal/sync-funnel/route.ts`
- Test: `src/app/api/internal/sync-funnel/route.test.ts`
- Create: `vercel.json`

**Interfaces:**
- Consumes: `createLaunchOpsClient` (Task 2), `createServiceRoleClient` (existing), `fetchLaunchOpsSalesRows`/`syncSalesForClient` (Task 4), `fetchLaunchOpsAdSpendRows`/`aggregateAdSpendByOperacaoDay`/`syncAdSpendForClient` (Task 5), `fetchLaunchOpsAdCreatives`/`fetchLaunchOpsAdCreativeSpendRows`/`joinAdCreativeSpend`/`syncAdCreativeSpendForClient` (Task 6), `getSyncCursor`/`recordSyncResult` (Task 3).
- Produces: `GET /api/internal/sync-funnel` — no other task calls this directly (it's cron-triggered), but Task 10's UI reads its effects via `funnel_sync_state`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/launchops/client', () => ({ createLaunchOpsClient: vi.fn(() => ({})) }))

const listMock = vi.fn()
vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: vi.fn(() => ({
    from: () => ({ select: () => ({ not: () => Promise.resolve({ data: listMock(), error: null }) }) }),
  })),
}))
vi.mock('@/lib/repo/funnel-sync-state-repo', () => ({
  getSyncCursor: vi.fn(async () => null),
  recordSyncResult: vi.fn(async () => undefined),
}))
vi.mock('@/lib/launchops/sync-sales', () => ({
  fetchLaunchOpsSalesRows: vi.fn(async () => []),
  syncSalesForClient: vi.fn(async () => ({ synced: 0, latestUpdatedAt: null })),
}))
vi.mock('@/lib/launchops/sync-ad-spend', () => ({
  fetchLaunchOpsAdSpendRows: vi.fn(async () => []),
  aggregateAdSpendByOperacaoDay: vi.fn(() => []),
  syncAdSpendForClient: vi.fn(async () => ({ synced: 0 })),
}))
vi.mock('@/lib/launchops/sync-ad-creative-spend', () => ({
  fetchLaunchOpsAdCreatives: vi.fn(async () => []),
  fetchLaunchOpsAdCreativeSpendRows: vi.fn(async () => []),
  joinAdCreativeSpend: vi.fn(() => []),
  syncAdCreativeSpendForClient: vi.fn(async () => ({ synced: 0 })),
}))

import { GET } from './route'

describe('GET /api/internal/sync-funnel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-secret'
    listMock.mockReturnValue([])
  })

  it('rejects requests without a valid cron secret', async () => {
    const request = new NextRequest('https://app.example.com/api/internal/sync-funnel')
    const response = await GET(request)
    expect(response.status).toBe(401)
  })

  it('accepts requests with the correct bearer token and returns ok', async () => {
    const request = new NextRequest('https://app.example.com/api/internal/sync-funnel', {
      headers: { authorization: 'Bearer test-secret' },
    })
    const response = await GET(request)
    expect(response.status).toBe(200)
  })
})
```

Run: `npx vitest run src/app/api/internal/sync-funnel/route.test.ts`
Expected: FAIL with "Cannot find module './route'"

- [ ] **Step 2: Write the implementation**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createLaunchOpsClient } from '@/lib/launchops/client'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getSyncCursor, recordSyncResult } from '@/lib/repo/funnel-sync-state-repo'
import { fetchLaunchOpsSalesRows, syncSalesForClient } from '@/lib/launchops/sync-sales'
import { fetchLaunchOpsAdSpendRows, aggregateAdSpendByOperacaoDay, syncAdSpendForClient } from '@/lib/launchops/sync-ad-spend'
import {
  fetchLaunchOpsAdCreatives,
  fetchLaunchOpsAdCreativeSpendRows,
  joinAdCreativeSpend,
  syncAdCreativeSpendForClient,
} from '@/lib/launchops/sync-ad-creative-spend'

interface FunnelClient {
  id: string
  launchops_operacao_ids: string[] | null
  launchops_produto_nomes: string[] | null
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const appDb = createServiceRoleClient()
  const launchopsDb = createLaunchOpsClient()

  const { data: clients, error: clientsError } = await appDb
    .from('clients')
    .select('id, launchops_operacao_ids, launchops_produto_nomes')
    .not('launchops_operacao_ids', 'is', null)
  if (clientsError) {
    console.error('[sync-funnel-clients-failed]', clientsError)
    return NextResponse.json({ ok: false, error: 'failed to list clients' }, { status: 500 })
  }

  for (const client of (clients ?? []) as FunnelClient[]) {
    await syncSalesEntity(appDb, launchopsDb, client)
    await syncAdSpendEntity(appDb, launchopsDb, client)
    await syncAdCreativeSpendEntity(appDb, launchopsDb, client)
  }

  return NextResponse.json({ ok: true, clientsProcessed: (clients ?? []).length })
}

async function syncSalesEntity(appDb: SupabaseClient, launchopsDb: SupabaseClient, client: FunnelClient) {
  if (!client.launchops_produto_nomes?.length) return
  try {
    const cursor = await getSyncCursor(appDb, client.id, 'sales')
    const rows = await fetchLaunchOpsSalesRows(launchopsDb, { produtoNomes: client.launchops_produto_nomes, since: cursor })
    const { latestUpdatedAt } = await syncSalesForClient(appDb, client.id, rows)
    await recordSyncResult(appDb, { clientId: client.id, entity: 'sales', result: 'ok', newCursor: latestUpdatedAt ?? undefined })
  } catch (err) {
    console.error('[sync-funnel-sales-failed]', { clientId: client.id }, err)
    await recordSyncResult(appDb, { clientId: client.id, entity: 'sales', result: 'error', message: String(err) })
  }
}

async function syncAdSpendEntity(appDb: SupabaseClient, launchopsDb: SupabaseClient, client: FunnelClient) {
  if (!client.launchops_operacao_ids?.length) return
  try {
    const cursor = await getSyncCursor(appDb, client.id, 'ad_spend_daily')
    const rawRows = await fetchLaunchOpsAdSpendRows(launchopsDb, { operacaoIds: client.launchops_operacao_ids, since: cursor })
    const aggregated = aggregateAdSpendByOperacaoDay(rawRows)
    await syncAdSpendForClient(appDb, client.id, aggregated)
    const latestUpdatedAt = rawRows.length > 0 ? rawRows[rawRows.length - 1].updated_at : undefined
    await recordSyncResult(appDb, { clientId: client.id, entity: 'ad_spend_daily', result: 'ok', newCursor: latestUpdatedAt })
  } catch (err) {
    console.error('[sync-funnel-ad-spend-failed]', { clientId: client.id }, err)
    await recordSyncResult(appDb, { clientId: client.id, entity: 'ad_spend_daily', result: 'error', message: String(err) })
  }
}

async function syncAdCreativeSpendEntity(appDb: SupabaseClient, launchopsDb: SupabaseClient, client: FunnelClient) {
  if (!client.launchops_operacao_ids?.length) return
  try {
    const cursor = await getSyncCursor(appDb, client.id, 'ad_creative_spend_daily')
    const creatives = await fetchLaunchOpsAdCreatives(launchopsDb, client.launchops_operacao_ids)
    const spendRows = await fetchLaunchOpsAdCreativeSpendRows(launchopsDb, { anuncioIds: creatives.map((c) => c.id), since: cursor })
    const joined = joinAdCreativeSpend(creatives, spendRows)
    await syncAdCreativeSpendForClient(appDb, client.id, joined)
    const latestUpdatedAt = spendRows.length > 0 ? spendRows[spendRows.length - 1].updated_at : undefined
    await recordSyncResult(appDb, { clientId: client.id, entity: 'ad_creative_spend_daily', result: 'ok', newCursor: latestUpdatedAt })
  } catch (err) {
    console.error('[sync-funnel-ad-creative-spend-failed]', { clientId: client.id }, err)
    await recordSyncResult(appDb, { clientId: client.id, entity: 'ad_creative_spend_daily', result: 'error', message: String(err) })
  }
}
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npx vitest run src/app/api/internal/sync-funnel/route.test.ts`
Expected: PASS

- [ ] **Step 4: Add the Vercel Cron config**

```json
{
  "crons": [
    { "path": "/api/internal/sync-funnel", "schedule": "0 * * * *" }
  ]
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/internal/sync-funnel/route.ts src/app/api/internal/sync-funnel/route.test.ts vercel.json
git commit -m "feat(funnel): add hourly sync route and Vercel Cron schedule"
```

---

## Task 8: Enrich `get_test_report_by_ad`/`get_test_report_by_source` with spend

**Files:**
- Create: `supabase/migrations/0030_report_ad_spend.sql`
- Test: `supabase/migrations/0030_report_ad_spend.integration.test.ts`

**Interfaces:**
- Consumes: `ad_creative_spend_daily` (Task 1).
- Produces: `get_test_report_by_ad(p_test_id, p_since, p_until)` and `get_test_report_by_source(p_test_id, p_since, p_until)` now also return `ad_spend numeric`, `ad_impressions bigint`, `ad_link_clicks bigint`. Consumed by Task 9's UI (test report page).

- [ ] **Step 1: Write the migration**

```sql
drop function if exists get_test_report_by_ad(uuid, timestamptz, timestamptz);

create or replace function get_test_report_by_ad(p_test_id uuid, p_since timestamptz default null, p_until timestamptz default null)
returns table (
  variant_id uuid,
  variant_name text,
  ad_name text,
  clicks bigint,
  visitors bigint,
  conversions bigint,
  revenue_cents bigint,
  bot_clicks bigint,
  ad_spend numeric,
  ad_impressions bigint,
  ad_link_clicks bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and c.owner_id = auth.uid()
  ) then
    raise exception 'not found or access denied';
  end if;

  select client_id into v_client_id from tests where id = p_test_id;

  return query
  with ad_spend_agg as (
    select
      coalesce(ad_id, ad_name) as ad_ref,
      sum(spend) as spend,
      sum(impressions) as impressions,
      sum(link_clicks) as link_clicks
    from ad_creative_spend_daily
    where client_id = v_client_id
      and (p_since is null or data >= p_since::date)
      and (p_until is null or data < p_until::date)
    group by coalesce(ad_id, ad_name)
  )
  select
    v.id,
    v.name,
    coalesce(nullif(ce.source_utms->>'fb_ad_id', ''), nullif(ce.source_utms->>'utm_term', ''), '(sem anúncio)') as ad_name,
    count(distinct ce.id) filter (where ce.is_bot = false)::bigint,
    count(distinct ce.visitor_id) filter (where ce.is_bot = false)::bigint,
    count(distinct cv.id) filter (where ce.is_bot = false)::bigint,
    coalesce(sum(cv.value_cents) filter (where ce.is_bot = false), 0)::bigint,
    count(distinct ce.id) filter (where ce.is_bot = true)::bigint,
    max(asa.spend),
    max(asa.impressions),
    max(asa.link_clicks)
  from variants v
  join tests t on t.id = v.test_id
  left join click_events ce on ce.variant_id = v.id
    and (p_since is null or ce.created_at >= p_since)
    and (p_until is null or ce.created_at < p_until)
  left join conversions cv on cv.click_event_id = ce.id and cv.source = t.conversion_method
  left join ad_spend_agg asa
    on asa.ad_ref = coalesce(ce.source_utms->>'fb_ad_id', ce.source_utms->>'utm_term')
  where v.test_id = p_test_id
  group by v.id, v.name, coalesce(nullif(ce.source_utms->>'fb_ad_id', ''), nullif(ce.source_utms->>'utm_term', ''), '(sem anúncio)')
  order by v.name, ad_name;
end;
$$;

drop function if exists get_test_report_by_source(uuid, timestamptz, timestamptz);

create or replace function get_test_report_by_source(p_test_id uuid, p_since timestamptz default null, p_until timestamptz default null)
returns table (
  variant_id uuid,
  variant_name text,
  utm_source text,
  clicks bigint,
  visitors bigint,
  conversions bigint,
  revenue_cents bigint,
  bot_clicks bigint,
  ad_spend numeric,
  ad_impressions bigint,
  ad_link_clicks bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and c.owner_id = auth.uid()
  ) then
    raise exception 'not found or access denied';
  end if;

  select client_id into v_client_id from tests where id = p_test_id;

  return query
  with ad_spend_agg as (
    select
      coalesce(ad_id, ad_name) as ad_ref,
      sum(spend) as spend,
      sum(impressions) as impressions,
      sum(link_clicks) as link_clicks
    from ad_creative_spend_daily
    where client_id = v_client_id
      and (p_since is null or data >= p_since::date)
      and (p_until is null or data < p_until::date)
    group by coalesce(ad_id, ad_name)
  )
  select
    v.id,
    v.name,
    coalesce(nullif(ce.source_utms->>'utm_source', ''), '(direto)') as utm_source,
    count(distinct ce.id) filter (where ce.is_bot = false)::bigint,
    count(distinct ce.visitor_id) filter (where ce.is_bot = false)::bigint,
    count(distinct cv.id) filter (where ce.is_bot = false)::bigint,
    coalesce(sum(cv.value_cents) filter (where ce.is_bot = false), 0)::bigint,
    count(distinct ce.id) filter (where ce.is_bot = true)::bigint,
    max(asa.spend),
    max(asa.impressions),
    max(asa.link_clicks)
  from variants v
  join tests t on t.id = v.test_id
  left join click_events ce on ce.variant_id = v.id
    and (p_since is null or ce.created_at >= p_since)
    and (p_until is null or ce.created_at < p_until)
  left join conversions cv on cv.click_event_id = ce.id and cv.source = t.conversion_method
  left join ad_spend_agg asa
    on asa.ad_ref = coalesce(ce.source_utms->>'fb_ad_id', ce.source_utms->>'utm_term')
  where v.test_id = p_test_id
  group by v.id, v.name, coalesce(nullif(ce.source_utms->>'utm_source', ''), '(direto)')
  order by v.name, utm_source;
end;
$$;

revoke all on function get_test_report_by_ad(uuid, timestamptz, timestamptz) from public;
grant execute on function get_test_report_by_ad(uuid, timestamptz, timestamptz) to authenticated;
revoke all on function get_test_report_by_source(uuid, timestamptz, timestamptz) from public;
grant execute on function get_test_report_by_source(uuid, timestamptz, timestamptz) to authenticated;
```

- [ ] **Step 2: Apply the migration locally**

Run: `npx supabase db push`
Expected: migration `0030_report_ad_spend` applied with no errors.

- [ ] **Step 3: Write the failing integration test for the fan-out regression**

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

const db = createServiceRoleClient()
let testId: string
let clientId: string

beforeAll(async () => {
  const { data: user } = await db.auth.admin.createUser({
    email: `report-ad-spend-${Date.now()}@example.com`,
    password: 'password123',
    email_confirm: true,
  })
  const { data: client } = await db
    .from('clients')
    .insert({ owner_id: user!.user!.id, name: 'ReportAdSpend', slug: `report-ad-spend-${Date.now()}` })
    .select()
    .single()
  clientId = client!.id
  const { data: test } = await db
    .from('tests')
    .insert({ client_id: clientId, name: 'T', slug: `report-ad-spend-t-${Date.now()}`, conversion_method: 'hubla_webhook' })
    .select()
    .single()
  testId = test!.id
  const { data: variant } = await db
    .from('variants')
    .insert({ test_id: testId, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a' })
    .select()
    .single()
  const variantId = variant!.id

  // 3 clicks for the same ad, plus 5 days of R$10 spend for that ad — a broken
  // (non-pre-aggregated) join would multiply spend by click count (15x R$10 instead of R$50 total).
  for (let i = 0; i < 3; i++) {
    await db.from('click_events').insert({
      test_id: testId,
      variant_id: variantId,
      visitor_id: `visitor-${i}`,
      tracking_id: crypto.randomUUID(),
      source_utms: { fb_ad_id: 'ad-123' },
    })
  }
  const spendRows = Array.from({ length: 5 }, (_, i) => ({
    client_id: clientId,
    source: 'launchops_sync',
    data: `2026-09-0${i + 1}`,
    ad_id: 'ad-123',
    ad_name: 'Criativo X',
    spend: 10,
    impressions: 100,
    link_clicks: 2,
  }))
  await db.from('ad_creative_spend_daily').insert(spendRows)
})

describe('get_test_report_by_ad — spend enrichment', () => {
  it('returns total spend for the period, not spend multiplied by click count', async () => {
    const { data, error } = await db.rpc('get_test_report_by_ad', { p_test_id: testId, p_since: null, p_until: null })
    expect(error).toBeNull()
    const row = (data as { ad_name: string; clicks: number; ad_spend: number }[]).find((r) => r.ad_name === 'ad-123')
    expect(row?.clicks).toBe(3)
    expect(row?.ad_spend).toBe(50)
  })
})
```

Run: `npm run test:integration -- report_ad_spend`
Expected: PASS (with the CTE-based migration from Step 1 already applied — temporarily replacing the CTE join with a direct join against `ad_creative_spend_daily` and re-running should make this FAIL with `ad_spend` = 150, confirming the test catches the regression)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:integration -- report_ad_spend`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0030_report_ad_spend.sql supabase/migrations/0030_report_ad_spend.integration.test.ts
git commit -m "feat(reports): join ad spend into per-ad and per-source test reports"
```

---

## Task 9: Capture `fb_ad_id`/`fb_adset_id`/`fb_campaign_id` on click

**Files:**
- Modify: `src/app/r/[slug]/route.ts:36-41` and `:84-89`
- Modify: `src/app/r/[slug]/route.test.ts`

**Interfaces:**
- Produces: `click_events.source_utms` now also includes `fb_ad_id`, `fb_adset_id`, `fb_campaign_id` when present on the incoming URL. Consumed by Task 8's RPCs (already written assuming this key exists).

- [ ] **Step 1: Write the failing test**

Add to `route.test.ts`, inside the existing `describe('GET /r/[slug]')` block:

```typescript
  it('captures fb_ad_id, fb_adset_id and fb_campaign_id from the incoming ad click', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      id: 'test-1',
      slug: 'oferta-x',
      status: 'active',
      fallback_url: null,
      test_type: 'page',
      sales_page_url: null,
      variants: [{ id: 'v1', name: 'A', weight_pct: 100, destination_url: 'https://example.com/page', is_control: false }],
    })
    vi.mocked(getOrAssignVariant).mockResolvedValue('v1')

    const request = new NextRequest(
      'https://ir.example.com/r/oferta-x?fb_ad_id=120210000000001&fb_adset_id=120210000000002&fb_campaign_id=120210000000003'
    )
    await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })

    expect(insertClickEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sourceUtms: expect.objectContaining({
          fb_ad_id: '120210000000001',
          fb_adset_id: '120210000000002',
          fb_campaign_id: '120210000000003',
        }),
      })
    )
  })

  it('forwards fb_ad_id onto the destination url alongside the standard utms', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      id: 'test-1',
      slug: 'oferta-x',
      status: 'active',
      fallback_url: null,
      test_type: 'page',
      sales_page_url: null,
      variants: [{ id: 'v1', name: 'A', weight_pct: 100, destination_url: 'https://example.com/page', is_control: false }],
    })
    vi.mocked(getOrAssignVariant).mockResolvedValue('v1')

    const request = new NextRequest('https://ir.example.com/r/oferta-x?fb_ad_id=120210000000001')
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })
    const location = new URL(response.headers.get('location')!)
    expect(location.searchParams.get('fb_ad_id')).toBe('120210000000001')
  })
```

Run: `npx vitest run src/app/r/\[slug\]/route.test.ts`
Expected: FAIL — `fb_ad_id` etc. are missing from `sourceUtms` and absent from the destination URL.

- [ ] **Step 2: Update the capture lists in `route.ts`**

In the bot branch (around line 36-41):

```typescript
    const botSourceUtms = Object.fromEntries(
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'fb_ad_id', 'fb_adset_id', 'fb_campaign_id'].map((key) => [
        key,
        request.nextUrl.searchParams.get(key) ?? '',
      ])
    )
```

In the main branch (around line 84-89):

```typescript
  const sourceUtms = Object.fromEntries(
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'fb_ad_id', 'fb_adset_id', 'fb_campaign_id'].map((key) => [
      key,
      request.nextUrl.searchParams.get(key) ?? '',
    ])
  )
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npx vitest run src/app/r/\[slug\]/route.test.ts`
Expected: PASS (all tests in the file, including the pre-existing ones)

- [ ] **Step 4: Commit**

```bash
git add src/app/r/\[slug\]/route.ts src/app/r/\[slug\]/route.test.ts
git commit -m "feat(tracking): capture Meta ad/adset/campaign ids on click"
```

---

## Task 10: Client mapping settings + Funnel dashboard UI

**Files:**
- Create: `src/lib/repo/funnel-repo.ts`
- Create: `src/app/dashboard/clients/[clientSlug]/funnel/page.tsx`
- Modify: `src/app/dashboard/clients/[clientSlug]/integrations/page.tsx` (add a "LaunchOps" section)
- Modify: `src/app/dashboard/clients/[clientSlug]/integrations/actions.ts` (add `saveLaunchOpsMapping`)
- Modify: `src/app/dashboard/clients/[clientSlug]/page.tsx` (nav link to the new tab)
- Test: `src/lib/repo/funnel-repo.integration.test.ts`

**Interfaces:**
- Consumes: `sales`, `ad_spend_daily`, `funnel_sync_state` (Task 1), `SyncEntity` (Task 3).
- Produces:
  - `interface DailyFunnelRow { data: string; vendas: number; receitaBruta: number; receitaLiquida: number; spend: number; roas: number | null; cac: number | null }`
  - `getDailyFunnel(db, clientId: string, since: string, until: string): Promise<DailyFunnelRow[]>`
  - `interface SyncHealth { entity: string; lastRunAt: string | null; lastResult: string | null; lastMessage: string | null }`
  - `getFunnelSyncHealth(db, clientId: string): Promise<SyncHealth[]>`

- [ ] **Step 1: Write the failing integration test for `getDailyFunnel`**

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getDailyFunnel, getFunnelSyncHealth } from './funnel-repo'

const db = createServiceRoleClient()
let clientId: string
const operacaoIdA = crypto.randomUUID()
const operacaoIdB = crypto.randomUUID()

beforeAll(async () => {
  const { data: user } = await db.auth.admin.createUser({
    email: `funnel-repo-${Date.now()}@example.com`,
    password: 'password123',
    email_confirm: true,
  })
  const { data: client } = await db
    .from('clients')
    .insert({ owner_id: user!.user!.id, name: 'FunnelRepo', slug: `funnel-repo-${Date.now()}` })
    .select()
    .single()
  clientId = client!.id

  await db.from('sales').insert([
    { client_id: clientId, external_id: 's1', data_venda: '2026-09-01T10:00:00Z', status: 'aprovada', valor_bruto: 10, valor_liquido: 9 },
    { client_id: clientId, external_id: 's2', data_venda: '2026-09-01T11:00:00Z', status: 'aprovada', valor_bruto: 20, valor_liquido: 18 },
  ])
  await db.from('ad_spend_daily').insert([
    { client_id: clientId, operacao_id: operacaoIdA, data: '2026-09-01', spend: 5 },
    { client_id: clientId, operacao_id: operacaoIdB, data: '2026-09-01', spend: 7 },
  ])
  await db
    .from('funnel_sync_state')
    .upsert({ client_id: clientId, entity: 'sales', last_run_at: '2026-09-01T12:00:00Z', last_result: 'ok' }, { onConflict: 'client_id,entity' })
})

describe('funnel-repo', () => {
  it('aggregates sales across multiple sales rows for the same day', async () => {
    const rows = await getDailyFunnel(db, clientId, '2026-09-01', '2026-09-02')
    const day = rows.find((r) => r.data === '2026-09-01')
    expect(day?.vendas).toBe(2)
    expect(day?.receitaBruta).toBe(30)
    expect(day?.receitaLiquida).toBe(27)
  })

  it('sums ad_spend_daily across both operations for the same day', async () => {
    const rows = await getDailyFunnel(db, clientId, '2026-09-01', '2026-09-02')
    const day = rows.find((r) => r.data === '2026-09-01')
    expect(day?.spend).toBe(12)
    expect(day?.roas).toBeCloseTo(30 / 12)
  })

  it('reports sync health for a client', async () => {
    const health = await getFunnelSyncHealth(db, clientId)
    const sales = health.find((h) => h.entity === 'sales')
    expect(sales?.lastResult).toBe('ok')
  })
})
```

Run: `npm run test:integration -- funnel-repo`
Expected: FAIL with "Cannot find module './funnel-repo'"

- [ ] **Step 2: Write `funnel-repo.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

export interface DailyFunnelRow {
  data: string
  vendas: number
  receitaBruta: number
  receitaLiquida: number
  spend: number
  roas: number | null
  cac: number | null
}

export async function getDailyFunnel(
  db: SupabaseClient,
  clientId: string,
  since: string,
  until: string
): Promise<DailyFunnelRow[]> {
  const { data: salesRows, error: salesError } = await db
    .from('sales')
    .select('data_venda, valor_bruto, valor_liquido')
    .eq('client_id', clientId)
    .gte('data_venda', since)
    .lt('data_venda', until)
  if (salesError) throw salesError

  const { data: spendRows, error: spendError } = await db
    .from('ad_spend_daily')
    .select('data, spend')
    .eq('client_id', clientId)
    .gte('data', since)
    .lt('data', until)
  if (spendError) throw spendError

  const byDay = new Map<string, { vendas: number; receitaBruta: number; receitaLiquida: number; spend: number }>()
  const dayKey = (iso: string) => iso.slice(0, 10)

  for (const row of (salesRows ?? []) as { data_venda: string; valor_bruto: number | null; valor_liquido: number | null }[]) {
    const key = dayKey(row.data_venda)
    const entry = byDay.get(key) ?? { vendas: 0, receitaBruta: 0, receitaLiquida: 0, spend: 0 }
    entry.vendas += 1
    entry.receitaBruta += row.valor_bruto ?? 0
    entry.receitaLiquida += row.valor_liquido ?? 0
    byDay.set(key, entry)
  }

  for (const row of (spendRows ?? []) as { data: string; spend: number }[]) {
    const entry = byDay.get(row.data) ?? { vendas: 0, receitaBruta: 0, receitaLiquida: 0, spend: 0 }
    entry.spend += row.spend
    byDay.set(row.data, entry)
  }

  return [...byDay.entries()]
    .map(([data, entry]) => ({
      data,
      ...entry,
      roas: entry.spend > 0 ? entry.receitaBruta / entry.spend : null,
      cac: entry.vendas > 0 ? entry.spend / entry.vendas : null,
    }))
    .sort((a, b) => a.data.localeCompare(b.data))
}

export interface SyncHealth {
  entity: string
  lastRunAt: string | null
  lastResult: string | null
  lastMessage: string | null
}

export async function getFunnelSyncHealth(db: SupabaseClient, clientId: string): Promise<SyncHealth[]> {
  const { data, error } = await db
    .from('funnel_sync_state')
    .select('entity, last_run_at, last_result, last_message')
    .eq('client_id', clientId)
  if (error) throw error
  return ((data ?? []) as { entity: string; last_run_at: string | null; last_result: string | null; last_message: string | null }[]).map(
    (row) => ({ entity: row.entity, lastRunAt: row.last_run_at, lastResult: row.last_result, lastMessage: row.last_message })
  )
}
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npm run test:integration -- funnel-repo`
Expected: PASS

- [ ] **Step 4: Add the LaunchOps mapping fields to Integrações**

In `src/app/dashboard/clients/[clientSlug]/integrations/actions.ts`, add:

```typescript
const launchopsMappingSchema = z.object({
  client_id: z.string().uuid(),
  client_slug: z.string(),
  launchops_operacao_ids: z.string(),
  launchops_produto_nomes: z.string(),
})

export async function saveLaunchOpsMapping(context: { client_id: string; client_slug: string }, formData: FormData) {
  const result = launchopsMappingSchema.safeParse({
    client_id: context.client_id,
    client_slug: context.client_slug,
    launchops_operacao_ids: formData.get('launchops_operacao_ids'),
    launchops_produto_nomes: formData.get('launchops_produto_nomes'),
  })
  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => issue.message).join('; '))
  }
  const parsed = result.data
  const operacaoIds = parsed.launchops_operacao_ids.split(',').map((s) => s.trim()).filter(Boolean)
  const produtoNomes = parsed.launchops_produto_nomes.split(',').map((s) => s.trim()).filter(Boolean)

  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from('clients')
    .update({ launchops_operacao_ids: operacaoIds, launchops_produto_nomes: produtoNomes })
    .eq('id', parsed.client_id)
  if (error) throw error
  revalidatePath(`/dashboard/clients/${parsed.client_slug}/integrations`)
}
```

In `src/app/dashboard/clients/[clientSlug]/integrations/page.tsx`, add a "LaunchOps" section following the same card/form structure already used for the Domínio and Hubla sections (server component reading `client.launchops_operacao_ids`/`launchops_produto_nomes`, a `<form action={saveLaunchOpsMapping.bind(null, { client_id: client.id, client_slug: client.slug })}>` with two text inputs — `launchops_operacao_ids` and `launchops_produto_nomes`, comma-separated — and a save button, matching the existing Domínio/Hubla sections' markup).

- [ ] **Step 5: Write the Funnel page**

```typescript
import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getDailyFunnel, getFunnelSyncHealth } from '@/lib/repo/funnel-repo'

export default async function FunnelPage({ params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, name, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()

  const until = new Date().toISOString().slice(0, 10)
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const [rows, health] = await Promise.all([
    getDailyFunnel(supabase, client.id, since, until),
    getFunnelSyncHealth(supabase, client.id),
  ])

  const currency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  return (
    <div className="p-8">
      <h1 className="mb-6 font-['Space_Grotesk'] text-xl font-semibold">Funil de Vendas — {client.name}</h1>

      <div className="mb-6 rounded-2xl border border-white/[0.08] p-4 text-[13.5px] text-[#8A90A6]">
        Spend pode estar subestimado — parte do gasto do Meta Ads ainda não está atribuída a esta operação na fonte.
        {health.map((h) => (
          <div key={h.entity}>
            {h.entity}: {h.lastResult === 'error' ? `erro na última sincronização (${h.lastMessage ?? 'sem detalhes'})` : `ok, última execução ${h.lastRunAt ?? 'nunca'}`}
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/[0.08]">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="text-left text-[#8A90A6]">
              <th className="p-3">Dia</th>
              <th className="p-3">Vendas</th>
              <th className="p-3">Receita bruta</th>
              <th className="p-3">Spend</th>
              <th className="p-3">ROAS</th>
              <th className="p-3">CAC</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.data} className="border-t border-white/[0.08]">
                <td className="p-3">{row.data}</td>
                <td className="p-3">{row.vendas}</td>
                <td className="p-3">{currency(row.receitaBruta)}</td>
                <td className="p-3">{currency(row.spend)}</td>
                <td className="p-3">{row.roas !== null ? row.roas.toFixed(2) : '—'}</td>
                <td className="p-3">{row.cac !== null ? currency(row.cac) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Add the nav link**

In `src/app/dashboard/clients/[clientSlug]/page.tsx`, add a link next to "Integrações" (same style):

```typescript
          <a
            href={`/dashboard/clients/${client.slug}/funnel`}
            className="rounded-[9px] border border-white/[0.08] px-4 py-2.5 text-[13.5px] font-medium text-[#8A90A6]"
          >
            Funil de Vendas
          </a>
```

- [ ] **Step 7: Type-check and run the full test suite**

Run: `npm run build && npm run test`
Expected: build succeeds, all unit tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/repo/funnel-repo.ts src/lib/repo/funnel-repo.integration.test.ts \
  src/app/dashboard/clients/\[clientSlug\]/funnel/page.tsx \
  src/app/dashboard/clients/\[clientSlug\]/integrations/page.tsx \
  src/app/dashboard/clients/\[clientSlug\]/integrations/actions.ts \
  src/app/dashboard/clients/\[clientSlug\]/page.tsx
git commit -m "feat(funnel): add client mapping settings and Funil de Vendas dashboard page"
```

---

## Task 11: Display ad spend/CPM/CTR on the existing test report page

**Added after the final whole-branch review** (finding I4): the spec's UI section said the enriched `get_test_report_by_ad` columns should appear on the existing test report page as extra columns in the "Por anúncio" table, but the original 10-task plan never included that UI wiring — Tasks 8/9 built the data path but nothing displayed it. Confirmed via grep: no file under `src/` reads `ad_spend`/`ad_impressions`/`ad_link_clicks`.

**Files:**
- Modify: `src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/page.tsx`

**Interfaces:**
- Consumes: `get_test_report_by_ad`'s existing `ad_spend numeric`, `ad_impressions bigint`, `ad_link_clicks bigint` columns (Task 8/final-review-fix — already returned by the RPC, just not read by this page yet).

- [ ] **Step 1: Update the `AdReportRow` interface**

```typescript
interface AdReportRow {
  variant_id: string
  variant_name: string
  ad_name: string
  clicks: number
  visitors: number
  conversions: number
  revenue_cents: number
  bot_clicks: number
  ad_spend: number | null
  ad_impressions: number | null
  ad_link_clicks: number | null
}
```

- [ ] **Step 2: Add tooltip copy to `METRIC_INFO`**

```typescript
  gasto: 'Total investido em mídia paga nesse anúncio, vindo do Meta Ads.',
  cpm: 'Custo por mil impressões do anúncio no Meta Ads.',
  ctr: 'Porcentagem de impressões do anúncio que viraram clique no link, direto no Meta Ads.',
```

- [ ] **Step 3: Add 3 header cells to the "Por anúncio" table**

In the `<thead>` of the "Por anúncio" section (the one with `<th className={TH_CLASS}>Anúncio</th>`), after the existing `ThWithInfo` headers and before the closing `</tr>`:

```tsx
                    <ThWithInfo label="Gasto" info={METRIC_INFO.gasto} />
                    <ThWithInfo label="CPM" info={METRIC_INFO.cpm} />
                    <ThWithInfo label="CTR" info={METRIC_INFO.ctr} />
```

- [ ] **Step 4: Add 3 data cells to each ad row**

In the `adRows.map((row) => (...))` body, after the existing `<RateCell rate={...} />` and before the closing `</tr>`:

```tsx
                        <td className={TD_CLASS}>R$ {((row.ad_spend ?? 0) / 1).toFixed(2)}</td>
                        <td className={TD_CLASS}>
                          {row.ad_impressions ? `R$ ${(((row.ad_spend ?? 0) / row.ad_impressions) * 1000).toFixed(2)}` : '—'}
                        </td>
                        <td className={TD_CLASS}>
                          {row.ad_impressions ? `${(((row.ad_link_clicks ?? 0) / row.ad_impressions) * 100).toFixed(1)}%` : '—'}
                        </td>
```

(`ad_spend` is already in reais as a `numeric`, not cents like `revenue_cents` — don't divide by 100.)

- [ ] **Step 5: Update the empty-state `colSpan`**

The "Nenhum clique com anúncio identificado ainda." row currently has `colSpan={9}` — change it to `colSpan={12}` (9 existing columns + 3 new ones).

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all clean. This file has no dedicated unit test (server component, no existing `page.test.tsx`) — every other derived metric in this same table (R$/clique, R$/acesso, Taxa) already follows this untested-inline-arithmetic pattern, so CPM/CTR are consistent with existing convention, not a new gap.

Manually verify in a browser if practical: load a test report page for a test with `get_test_report_by_ad` rows that have non-null `ad_spend`, confirm Gasto/CPM/CTR render sensibly (no `NaN`, no crash on `ad_impressions = 0`).

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/clients/\[clientSlug\]/tests/\[testSlug\]/page.tsx
git commit -m "feat(reports): display ad spend, CPM and CTR on the per-ad test report table"
```

---

## Final check

- [ ] Run `npm run lint && npm run build && npm run test && npm run test:integration`
- [ ] Manually configure `LAUNCHOPS_SUPABASE_URL`, `LAUNCHOPS_SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` in `.env.local` and in the Vercel project's env vars before relying on the cron in production — per the spec's security recommendation, consider scoping the LaunchOps key to a dedicated read-only Postgres role before going further than personal testing.
- [ ] Set `launchops_operacao_ids`/`launchops_produto_nomes` on at least one real client (e.g. the `1K_LATAM`/`1K-LATAM` operations) via the new Integrações section, then trigger `GET /api/internal/sync-funnel` manually (with the correct `Authorization: Bearer $CRON_SECRET` header) to confirm data appears in `/dashboard/clients/<slug>/funnel`.
