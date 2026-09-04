# LaunchOps Sync Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen the existing LaunchOps sync (sales + ad creative spend) to capture a reconciliation key against `conversions` and ad campaign/adset hierarchy — both already present in LaunchOps' own schema but discarded by the current sync's column selection.

**Architecture:** One additive migration adds two columns to `sales` (`transaction_id_plataforma`, `conversion_id`) and four to `ad_creative_spend_daily` (`campaign_id`, `campaign_name`, `adset_id`, `adset_name`). `sync-sales.ts` widens its LaunchOps read and does a one-shot lookup against `conversions.external_event_id` to fill `conversion_id` before writing. `sync-ad-creative-spend.ts` widens its LaunchOps read to pass the ad hierarchy straight through. No RLS, grants, UI, or report changes.

**Tech Stack:** Next.js 16 / TypeScript, Supabase (Postgres + `@supabase/supabase-js`), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-04-launchops-sync-enrichment-design.md`

## Global Constraints

- No `any` type in TypeScript — use precise types, matching the existing style in the files touched.
- Unit tests run via `npm run test`; integration tests via `npm run test:integration`, which requires a local Supabase instance running (`supabase start`) and reads `.env.test` — never `.env.local`.
- Migration files in `supabase/migrations/` are numbered sequentially. Before creating a new one, always run `ls supabase/migrations/` and confirm the number is not already taken — a same-day collision is exactly what happened while writing the spec for this plan.
- No RLS policy or grant changes in this plan. The new columns land on tables (`sales`, `ad_creative_spend_daily`) that already have their policies and grants; adding a column does not change who reads or writes.
- No UI or report changes in this plan — this is data-layer only. Do not touch anything under `src/app/dashboard/`.
- Buyer identity (email, phone, name) is explicitly out of scope. Do not add `comprador_*` fields anywhere in this plan — this was a conscious decision, not an oversight.

---

### Task 1: Migration — reconciliation and hierarchy columns

**Files:**
- Create: `supabase/migrations/0034_launchops_sync_enrichment.sql`
- Create: `supabase/migrations/0034_launchops_sync_enrichment.integration.test.ts`

**Interfaces:**
- Produces: `sales.transaction_id_plataforma` (text, nullable), `sales.conversion_id` (uuid, nullable, FK to `conversions.id` on delete set null), `ad_creative_spend_daily.campaign_id` / `campaign_name` / `adset_id` / `adset_name` (all text, nullable). Tasks 2 and 3 write to these columns.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0034_launchops_sync_enrichment.sql

alter table sales add column transaction_id_plataforma text;
alter table sales add column conversion_id uuid references conversions(id) on delete set null;

alter table ad_creative_spend_daily add column campaign_id text;
alter table ad_creative_spend_daily add column campaign_name text;
alter table ad_creative_spend_daily add column adset_id text;
alter table ad_creative_spend_daily add column adset_name text;
```

- [ ] **Step 2: Write the integration test**

```ts
// supabase/migrations/0034_launchops_sync_enrichment.integration.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

const db = createServiceRoleClient()
let clientId: string
let salesFunnelId: string
let clickEventId: string

beforeAll(async () => {
  const { data: user } = await db.auth.admin.createUser({
    email: `migration-0034-${Date.now()}@example.com`,
    password: 'password123',
    email_confirm: true,
  })
  const { data: client } = await db
    .from('clients')
    .insert({ owner_id: user!.user!.id, name: 'Migration0034', slug: `migration-0034-${Date.now()}` })
    .select()
    .single()
  clientId = client!.id
  const { data: funnel } = await db
    .from('sales_funnels')
    .insert({ client_id: clientId, name: 'Migration0034 Funnel', slug: 'migration-0034-funnel' })
    .select()
    .single()
  salesFunnelId = funnel!.id
  const { data: test } = await db
    .from('tests')
    .insert({ client_id: clientId, name: 'Migration0034 Test', slug: `migration-0034-test-${Date.now()}`, conversion_method: 'hubla_webhook' })
    .select()
    .single()
  const { data: variant } = await db
    .from('variants')
    .insert({ test_id: test!.id, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a' })
    .select()
    .single()
  const { data: clickEvent } = await db
    .from('click_events')
    .insert({ test_id: test!.id, variant_id: variant!.id, visitor_id: 'visitor-0034', tracking_id: crypto.randomUUID(), source_utms: {} })
    .select()
    .single()
  clickEventId = clickEvent!.id
})

describe('migration 0034 — launchops sync enrichment columns', () => {
  it('accepts transaction_id_plataforma and conversion_id on sales', async () => {
    const { data: conversion } = await db
      .from('conversions')
      .insert({ click_event_id: clickEventId, source: 'hubla_webhook', external_event_id: `inv_0034_${Date.now()}`, value_cents: 770 })
      .select()
      .single()
    const { data: sale, error } = await db
      .from('sales')
      .insert({
        sales_funnel_id: salesFunnelId,
        source: 'launchops_sync',
        external_id: crypto.randomUUID(),
        data_venda: '2026-09-01T00:00:00Z',
        status: 'aprovada',
        transaction_id_plataforma: 'txn-0034',
        conversion_id: conversion!.id,
      })
      .select()
      .single()
    expect(error).toBeNull()
    expect(sale!.transaction_id_plataforma).toBe('txn-0034')
    expect(sale!.conversion_id).toBe(conversion!.id)
  })

  it('sets conversion_id to null (does not delete the sale) when the linked conversion is deleted', async () => {
    const { data: conversion } = await db
      .from('conversions')
      .insert({ click_event_id: clickEventId, source: 'hubla_webhook', external_event_id: `inv_0034_del_${Date.now()}`, value_cents: 770 })
      .select()
      .single()
    const { data: sale } = await db
      .from('sales')
      .insert({
        sales_funnel_id: salesFunnelId,
        source: 'launchops_sync',
        external_id: crypto.randomUUID(),
        data_venda: '2026-09-01T00:00:00Z',
        status: 'aprovada',
        conversion_id: conversion!.id,
      })
      .select()
      .single()

    await db.from('conversions').delete().eq('id', conversion!.id)

    const { data: saleAfterDelete } = await db.from('sales').select('id, conversion_id').eq('id', sale!.id).single()
    expect(saleAfterDelete).not.toBeNull()
    expect(saleAfterDelete!.conversion_id).toBeNull()
  })

  it('accepts campaign_id/campaign_name/adset_id/adset_name on ad_creative_spend_daily', async () => {
    const { data, error } = await db
      .from('ad_creative_spend_daily')
      .insert({
        sales_funnel_id: salesFunnelId,
        source: 'launchops_sync',
        data: '2026-09-01',
        ad_id: 'ad-0034',
        ad_name: 'Criativo 0034',
        campaign_id: 'camp-0034',
        campaign_name: 'Campanha 0034',
        adset_id: 'adset-0034',
        adset_name: 'Conjunto 0034',
        spend: 10,
      })
      .select()
      .single()
    expect(error).toBeNull()
    expect(data!.campaign_id).toBe('camp-0034')
    expect(data!.adset_name).toBe('Conjunto 0034')
  })
})
```

- [ ] **Step 3: Apply the migration to the local Supabase instance**

Run: `supabase db reset`
Expected: migration `0034_launchops_sync_enrichment` applies with no errors, alongside all prior migrations.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:integration -- 0034`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0034_launchops_sync_enrichment.sql supabase/migrations/0034_launchops_sync_enrichment.integration.test.ts
git commit -m "feat(db): add reconciliation and ad-hierarchy columns to sales / ad_creative_spend_daily"
```

---

### Task 2: Widen `sync-sales.ts` — reconciliation

**Files:**
- Modify: `src/lib/launchops/sync-sales.ts`
- Modify: `src/lib/launchops/sync-sales.integration.test.ts`

**Interfaces:**
- Consumes: `sales.conversion_id`, `sales.transaction_id_plataforma` (from Task 1). `conversions` table (`id`, `external_event_id`), already existing.
- Produces: `LaunchOpsSaleRow.transaction_id_plataforma: string | null` — read by `syncSalesForFunnel`. No other file in this plan consumes this.

- [ ] **Step 1: Write the failing integration tests**

Replace the top of `src/lib/launchops/sync-sales.integration.test.ts` (imports, `beforeAll`, and the `row` helper) with:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { syncSalesForFunnel, type LaunchOpsSaleRow } from './sync-sales'

const db = createServiceRoleClient()
let salesFunnelId: string
let matchedExternalEventId: string
let matchedConversionId: string

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
  const { data: funnel } = await db
    .from('sales_funnels')
    .insert({ client_id: client!.id, name: 'SyncSales Funnel', slug: 'sync-sales-funnel' })
    .select()
    .single()
  salesFunnelId = funnel!.id

  const { data: test } = await db
    .from('tests')
    .insert({ client_id: client!.id, name: 'SyncSales Test', slug: `sync-sales-test-${Date.now()}`, conversion_method: 'hubla_webhook' })
    .select()
    .single()
  const { data: variant } = await db
    .from('variants')
    .insert({ test_id: test!.id, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a' })
    .select()
    .single()
  const { data: clickEvent } = await db
    .from('click_events')
    .insert({ test_id: test!.id, variant_id: variant!.id, visitor_id: 'visitor-sync-sales', tracking_id: crypto.randomUUID(), source_utms: {} })
    .select()
    .single()
  matchedExternalEventId = `inv_${Date.now()}`
  const { data: conversion } = await db
    .from('conversions')
    .insert({ click_event_id: clickEvent!.id, source: 'hubla_webhook', external_event_id: matchedExternalEventId, value_cents: 770 })
    .select()
    .single()
  matchedConversionId = conversion!.id
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
    transaction_id_plataforma: null,
    ...overrides,
  }
}
```

Then add these tests inside the existing `describe('syncSalesForFunnel (integration)', ...)` block, after the two tests already there:

```ts
  it('links conversion_id when transaction_id_plataforma matches an existing conversion external_event_id', async () => {
    const saleRow = row({ transaction_id_plataforma: matchedExternalEventId })
    await syncSalesForFunnel(db, salesFunnelId, [saleRow])

    const { data } = await db
      .from('sales')
      .select('conversion_id')
      .eq('sales_funnel_id', salesFunnelId)
      .eq('external_id', saleRow.id)
      .single()
    expect(data!.conversion_id).toBe(matchedConversionId)
  })

  it('leaves conversion_id null when transaction_id_plataforma does not match any conversion', async () => {
    const saleRow = row({ transaction_id_plataforma: `inv_no_match_${Date.now()}` })
    await syncSalesForFunnel(db, salesFunnelId, [saleRow])

    const { data } = await db
      .from('sales')
      .select('conversion_id')
      .eq('sales_funnel_id', salesFunnelId)
      .eq('external_id', saleRow.id)
      .single()
    expect(data!.conversion_id).toBeNull()
  })

  it('leaves conversion_id null when transaction_id_plataforma is null', async () => {
    const saleRow = row({ transaction_id_plataforma: null })
    await syncSalesForFunnel(db, salesFunnelId, [saleRow])

    const { data } = await db
      .from('sales')
      .select('conversion_id')
      .eq('sales_funnel_id', salesFunnelId)
      .eq('external_id', saleRow.id)
      .single()
    expect(data!.conversion_id).toBeNull()
  })
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm run test:integration -- sync-sales`
Expected: FAIL — TypeScript error or runtime error, because `LaunchOpsSaleRow` does not yet have `transaction_id_plataforma` and `syncSalesForFunnel` does not write `conversion_id`.

- [ ] **Step 3: Implement the reconciliation logic**

Replace the full contents of `src/lib/launchops/sync-sales.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllPages } from './sync-ad-spend'

export interface LaunchOpsSaleRow {
  id: string
  data_venda: string
  produto_nome: string | null
  status: string
  valor_bruto: number | null
  valor_liquido: number | null
  metodo_pagamento: string | null
  updated_at: string
  transaction_id_plataforma: string | null
}

export async function fetchLaunchOpsSalesRows(
  launchopsDb: SupabaseClient,
  params: { produtoNomes: string[]; since: string | null }
): Promise<LaunchOpsSaleRow[]> {
  // PostgREST caps a single response at ~1000 rows — a full-history first sync (since=null)
  // that hits the cap would otherwise silently truncate and advance the cursor past
  // everything still unsynced. Page through the full result, same fix as ad spend.
  return fetchAllPages<LaunchOpsSaleRow>((from, to) => {
    let query = launchopsDb
      .from('vendas')
      .select(
        'id, data_venda, produto_nome, status, valor_bruto, valor_liquido, metodo_pagamento, updated_at, transaction_id_plataforma'
      )
      .eq('plataforma', 'hubla')
      .eq('status', 'aprovada')
      .in('produto_nome', params.produtoNomes)
      .order('updated_at', { ascending: true })
      .range(from, to)
    if (params.since) query = query.gt('updated_at', params.since)
    return query
  })
}

const UPSERT_BATCH_SIZE = 500

async function findConversionIdsByExternalEventId(
  appDb: SupabaseClient,
  externalEventIds: string[]
): Promise<Map<string, string>> {
  const conversionIdByExternalEventId = new Map<string, string>()
  if (externalEventIds.length === 0) return conversionIdByExternalEventId

  const { data, error } = await appDb.from('conversions').select('id, external_event_id').in('external_event_id', externalEventIds)
  if (error) throw error
  for (const conversion of data ?? []) {
    if (conversion.external_event_id) conversionIdByExternalEventId.set(conversion.external_event_id, conversion.id)
  }
  return conversionIdByExternalEventId
}

export async function syncSalesForFunnel(
  appDb: SupabaseClient,
  salesFunnelId: string,
  rows: LaunchOpsSaleRow[]
): Promise<{ synced: number; latestUpdatedAt: string | null }> {
  if (rows.length === 0) return { synced: 0, latestUpdatedAt: null }

  // Best-effort reconciliation: transaction_id_plataforma (LaunchOps) and conversions.external_event_id
  // (ab-test-tool) both hold the Hubla invoice id. Most sales won't have a match — that's expected,
  // not an error. One lookup for the whole batch, before it gets sliced into write batches below.
  const transactionIds = [...new Set(rows.map((row) => row.transaction_id_plataforma).filter((id): id is string => Boolean(id)))]
  const conversionIdByTransactionId = await findConversionIdsByExternalEventId(appDb, transactionIds)

  const payload = rows.map((row) => ({
    sales_funnel_id: salesFunnelId,
    source: 'launchops_sync',
    external_id: row.id,
    data_venda: row.data_venda,
    produto: row.produto_nome,
    status: row.status,
    valor_bruto: row.valor_bruto,
    valor_liquido: row.valor_liquido,
    metodo_pagamento: row.metodo_pagamento,
    updated_at: row.updated_at,
    transaction_id_plataforma: row.transaction_id_plataforma,
    conversion_id: row.transaction_id_plataforma ? conversionIdByTransactionId.get(row.transaction_id_plataforma) ?? null : null,
  }))

  // A single upsert covering thousands of rows (e.g. a first full-history sync) risks
  // hitting a request-size or statement-timeout limit. Write in bounded batches instead.
  for (let i = 0; i < payload.length; i += UPSERT_BATCH_SIZE) {
    const batch = payload.slice(i, i + UPSERT_BATCH_SIZE)
    const { error } = await appDb.from('sales').upsert(batch, { onConflict: 'sales_funnel_id,source,external_id' })
    if (error) throw error
  }

  const latestUpdatedAt = rows[rows.length - 1].updated_at
  return { synced: rows.length, latestUpdatedAt }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:integration -- sync-sales`
Expected: PASS (5 tests: the 2 pre-existing plus the 3 new ones)

- [ ] **Step 5: Run the unit test file too (unaffected, confirms nothing broke)**

Run: `npm run test -- sync-sales`
Expected: PASS (1 test — `sync-sales.test.ts`'s empty-batch case is unaffected by this change)

- [ ] **Step 6: Commit**

```bash
git add src/lib/launchops/sync-sales.ts src/lib/launchops/sync-sales.integration.test.ts
git commit -m "feat(launchops): reconcile synced sales against conversions by transaction id"
```

---

### Task 3: Widen `sync-ad-creative-spend.ts` — campaign/adset hierarchy

**Files:**
- Modify: `src/lib/launchops/sync-ad-creative-spend.ts`
- Modify: `src/lib/launchops/sync-ad-creative-spend.test.ts`
- Modify: `src/lib/launchops/sync-ad-creative-spend.integration.test.ts`

**Interfaces:**
- Consumes: `ad_creative_spend_daily.campaign_id` / `campaign_name` / `adset_id` / `adset_name` (from Task 1).
- Produces: `JoinedAdCreativeSpendRow` gains `campaign_id`, `campaign_name`, `adset_id`, `adset_name` (all `string | null`). No other file in this plan consumes this type.

- [ ] **Step 1: Write the failing unit test**

Replace the full contents of `src/lib/launchops/sync-ad-creative-spend.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { joinAdCreativeSpend, type LaunchOpsAdCreative, type LaunchOpsAdCreativeSpendRow } from './sync-ad-creative-spend'

describe('joinAdCreativeSpend', () => {
  it('attaches ad_id/ad_name/campaign_id/campaign_name/adset_id/adset_name to each spend row via anuncio_id, and drops rows with no matching creative', () => {
    const creatives: LaunchOpsAdCreative[] = [
      {
        id: 'anuncio-1',
        ad_id: '12345',
        ad_name: 'Criativo A',
        campaign_id: 'camp-1',
        campaign_name: 'Campanha X',
        adset_id: 'adset-1',
        adset_name: 'Conjunto Y',
      },
    ]
    const spendRows: LaunchOpsAdCreativeSpendRow[] = [
      { anuncio_id: 'anuncio-1', data_referencia: '2026-09-01', spend: 20, impressions: 200, link_clicks: 5, updated_at: '2026-09-01T00:00:00Z' },
      { anuncio_id: 'anuncio-orphan', data_referencia: '2026-09-01', spend: 5, impressions: 50, link_clicks: 1, updated_at: '2026-09-01T00:00:00Z' },
    ]
    const result = joinAdCreativeSpend(creatives, spendRows)
    expect(result).toEqual([
      {
        ad_id: '12345',
        ad_name: 'Criativo A',
        campaign_id: 'camp-1',
        campaign_name: 'Campanha X',
        adset_id: 'adset-1',
        adset_name: 'Conjunto Y',
        data: '2026-09-01',
        spend: 20,
        impressions: 200,
        link_clicks: 5,
      },
    ])
  })

  it('passes through null campaign_id/adset_id when the LaunchOps ad record has no hierarchy set', () => {
    const creatives: LaunchOpsAdCreative[] = [
      { id: 'anuncio-2', ad_id: '999', ad_name: 'Criativo Antigo', campaign_id: null, campaign_name: null, adset_id: null, adset_name: null },
    ]
    const spendRows: LaunchOpsAdCreativeSpendRow[] = [
      { anuncio_id: 'anuncio-2', data_referencia: '2026-09-01', spend: 10, impressions: 100, link_clicks: 2, updated_at: '2026-09-01T00:00:00Z' },
    ]
    const result = joinAdCreativeSpend(creatives, spendRows)
    expect(result[0].campaign_id).toBeNull()
    expect(result[0].campaign_name).toBeNull()
    expect(result[0].adset_id).toBeNull()
    expect(result[0].adset_name).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- sync-ad-creative-spend`
Expected: FAIL — TypeScript error, `LaunchOpsAdCreative` has no `campaign_id`/`campaign_name`/`adset_id`/`adset_name`.

- [ ] **Step 3: Implement the hierarchy pass-through**

Replace the full contents of `src/lib/launchops/sync-ad-creative-spend.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllPages } from './sync-ad-spend'

export interface LaunchOpsAdCreative {
  id: string
  ad_id: string | null
  ad_name: string | null
  campaign_id: string | null
  campaign_name: string | null
  adset_id: string | null
  adset_name: string | null
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
  campaign_id: string | null
  campaign_name: string | null
  adset_id: string | null
  adset_name: string | null
  data: string
  spend: number
  impressions: number
  link_clicks: number
}

export async function fetchLaunchOpsAdCreatives(
  launchopsDb: SupabaseClient,
  operacaoIds: string[]
): Promise<LaunchOpsAdCreative[]> {
  const { data, error } = await launchopsDb
    .from('anuncio')
    .select('id, ad_id, ad_name, campaign_id, campaign_name, adset_id, adset_name')
    .in('operacao_id', operacaoIds)
  if (error) throw error
  return (data ?? []) as LaunchOpsAdCreative[]
}

export async function fetchLaunchOpsAdCreativeSpendRows(
  launchopsDb: SupabaseClient,
  params: { anuncioIds: string[]; since: string | null }
): Promise<LaunchOpsAdCreativeSpendRow[]> {
  if (params.anuncioIds.length === 0) return []
  // PostgREST caps a single response at ~1000 rows — a full-history first sync (since=null)
  // that hits the cap would otherwise silently truncate and advance the cursor past
  // everything still unsynced. Page through the full result, same fix as ad spend.
  return fetchAllPages<LaunchOpsAdCreativeSpendRow>((from, to) => {
    let query = launchopsDb
      .from('anuncio_dia')
      .select('anuncio_id, data_referencia, spend, impressions, link_clicks, updated_at')
      .in('anuncio_id', params.anuncioIds)
      .order('updated_at', { ascending: true })
      .range(from, to)
    if (params.since) query = query.gt('updated_at', params.since)
    return query
  })
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
      campaign_id: creative.campaign_id,
      campaign_name: creative.campaign_name,
      adset_id: creative.adset_id,
      adset_name: creative.adset_name,
      data: row.data_referencia,
      spend: row.spend,
      impressions: row.impressions,
      link_clicks: row.link_clicks,
    })
  }
  return joined
}

export async function syncAdCreativeSpendForFunnel(
  appDb: SupabaseClient,
  salesFunnelId: string,
  rows: JoinedAdCreativeSpendRow[]
): Promise<{ synced: number }> {
  if (rows.length === 0) return { synced: 0 }

  const payload = rows.map((row) => ({
    sales_funnel_id: salesFunnelId,
    source: 'launchops_sync',
    data: row.data,
    ad_id: row.ad_id,
    ad_name: row.ad_name,
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name,
    adset_id: row.adset_id,
    adset_name: row.adset_name,
    spend: row.spend,
    impressions: row.impressions,
    link_clicks: row.link_clicks,
    updated_at: new Date().toISOString(),
  }))

  // Same batching rationale as syncSalesForFunnel: bound each upsert regardless of how
  // many ad/day rows a full-history sync ends up joining.
  for (let i = 0; i < payload.length; i += 500) {
    const batch = payload.slice(i, i + 500)
    const { error } = await appDb
      .from('ad_creative_spend_daily')
      .upsert(batch, { onConflict: 'sales_funnel_id,source,data,ad_id,ad_name' })
    if (error) throw error
  }
  return { synced: payload.length }
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npm run test -- sync-ad-creative-spend`
Expected: PASS (2 tests)

- [ ] **Step 5: Extend the integration test to verify the columns persist end-to-end**

Add this test inside the existing `describe('syncAdCreativeSpendForFunnel (integration)', ...)` block in `src/lib/launchops/sync-ad-creative-spend.integration.test.ts`, after the existing test:

```ts
  it('persists campaign_id/campaign_name/adset_id/adset_name alongside the spend row', async () => {
    const row: JoinedAdCreativeSpendRow = {
      ad_id: 'ad-hier-1',
      ad_name: 'Criativo Hierarquia',
      campaign_id: 'camp-99',
      campaign_name: 'Campanha 99',
      adset_id: 'adset-99',
      adset_name: 'Conjunto 99',
      data: '2026-09-02',
      spend: 15,
      impressions: 150,
      link_clicks: 3,
    }
    await syncAdCreativeSpendForFunnel(db, salesFunnelId, [row])

    const { data } = await db
      .from('ad_creative_spend_daily')
      .select('campaign_id, campaign_name, adset_id, adset_name')
      .eq('sales_funnel_id', salesFunnelId)
      .eq('ad_id', 'ad-hier-1')
      .single()
    expect(data).toEqual({ campaign_id: 'camp-99', campaign_name: 'Campanha 99', adset_id: 'adset-99', adset_name: 'Conjunto 99' })
  })
```

- [ ] **Step 6: Run the integration test to verify it passes**

Run: `npm run test:integration -- sync-ad-creative-spend`
Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add src/lib/launchops/sync-ad-creative-spend.ts src/lib/launchops/sync-ad-creative-spend.test.ts src/lib/launchops/sync-ad-creative-spend.integration.test.ts
git commit -m "feat(launchops): sync ad campaign/adset hierarchy alongside creative spend"
```

---

### Task 4: Full-suite check and lint

**Files:** none (verification only)

**Interfaces:** none — this task only runs the full test suite and linter across everything touched in Tasks 1–3.

- [ ] **Step 1: Run the full unit suite**

Run: `npm run test`
Expected: PASS, no regressions anywhere else in the codebase.

- [ ] **Step 2: Run the full integration suite**

Run: `npm run test:integration`
Expected: PASS, no regressions anywhere else in the codebase (this also re-confirms Tasks 1–3 pass together, not just individually).

- [ ] **Step 3: Run the linter**

Run: `npm run lint`
Expected: no errors on the files touched in this plan.

- [ ] **Step 4: Commit if the linter made no changes needed, otherwise fix and commit**

```bash
git status --short
```

If clean, nothing to commit — this task is verification-only. If the linter flagged something in a file this plan touched, fix it and:

```bash
git add -A
git commit -m "fix: address lint findings in launchops sync enrichment"
```
