# Sales Funnels Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn "Funil de Vendas" from one dashboard per client into a plural entity (`sales_funnels`) like tests already are, behind a new client hub page splitting "Funis de Teste" from "Funis de Venda", with the LaunchOps access credential stored per client instead of a global env var, and ad-spend attribution staying fully automatic (ad-identity match across all of a client's funnels, no manual link).

**Architecture:** New `sales_funnels` table owned by `client`, with the 4 existing funnel-data tables (`sales`, `ad_spend_daily`, `ad_creative_spend_daily`, `funnel_sync_state`) re-keyed from `client_id` to `sales_funnel_id`. The sync route and repo/sync-library functions are renamed from client-scoped to funnel-scoped. The dashboard route moves from `.../funnel` to `.../funis-venda/[funnelSlug]`. A new client hub page replaces the old combined tests-list page.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), Supabase Postgres (RLS, `security definer` RPCs), Vitest (unit + `*.integration.test.ts` against local Supabase via `npm run test:integration`).

**Spec:** `docs/superpowers/specs/2026-09-04-sales-funnels-hub-design.md`

## Global Constraints

- Every `security definer` SQL function needs `set search_path = public` and the existing `owner_id = auth.uid()` via `clients`/`tests` join ownership check.
- Every `drop function` + `create or replace function` must be followed by explicit `revoke all ... from public` + `grant execute ... to authenticated` for every signature left standing (Postgres resets ACLs to public-execute on `create or replace` after a `drop`).
- No data migration/backfill needed anywhere in this plan — verified 2026-09-04 that `clients.launchops_operacao_ids`/`launchops_produto_nomes` were never populated and all 4 funnel-data tables are empty in production.
- Integration tests load `.env.test` (local Supabase only) via `npm run test:integration` — never run this against production credentials manually.
- Ad-spend attribution stays 100% automatic via `fb_ad_id`/`utm_term` ad identity — no field, dropdown, or manual link between a test and a funnel, anywhere in this plan.
- Follow existing code style: no comments except non-obvious WHY, Tailwind utility classes matching the existing dark-theme tokens already used throughout (`#7C6FF0` purple, `#2DD4A8` green, `#8A90A6` muted, `#141829`/`#1B2036` backgrounds, `#E8EAF2` text, `'Space_Grotesk'`/`'JetBrains_Mono'` fonts).

---

### Task 1: Migration — `sales_funnels` table, credential columns, re-key the 4 funnel tables, fix `get_test_report_by_ad`

**Files:**
- Create: `supabase/migrations/0032_sales_funnels.sql`
- Create: `supabase/tests/sales_funnels.integration.test.ts`

**Interfaces:**
- Produces: table `sales_funnels(id, client_id, name, slug, launchops_operacao_ids, launchops_produto_nomes, is_active, created_at, updated_at)`; columns `clients.funnel_source_url`, `clients.funnel_source_service_role_key`; `sales.sales_funnel_id`, `ad_spend_daily.sales_funnel_id`, `ad_creative_spend_daily.sales_funnel_id`, `funnel_sync_state.sales_funnel_id` (all replacing `client_id`); updated `get_test_report_by_ad` RPC (same signature and return columns as before — `ad_spend`/`ad_impressions`/`ad_link_clicks` unchanged — only its internal join changes).
- Consumes: nothing new (this is the foundation task).

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/0032_sales_funnels.sql

-- Credencial de acesso à fonte de dados do funil, por cliente (substitui as variáveis de
-- ambiente globais LAUNCHOPS_SUPABASE_URL/LAUNCHOPS_SUPABASE_SERVICE_ROLE_KEY).
alter table clients add column funnel_source_url text;
alter table clients add column funnel_source_service_role_key text;

create table sales_funnels (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  slug text not null,
  launchops_operacao_ids uuid[],
  launchops_produto_nomes text[],
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, slug)
);

alter table sales_funnels enable row level security;
create policy "sales_funnels_via_client_owner" on sales_funnels
  for all using (exists (select 1 from clients c where c.id = sales_funnels.client_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from clients c where c.id = sales_funnels.client_id and c.owner_id = auth.uid()));

grant select, insert, update, delete on sales_funnels to authenticated;

-- sales: client_id -> sales_funnel_id
-- 0029 created an RLS policy referencing sales.client_id directly -- must drop it
-- before the column can be dropped, then recreate it (same name) through sales_funnels.
drop policy "sales_via_client_owner" on sales;
alter table sales drop constraint sales_client_id_source_external_id_key;
alter table sales drop column client_id;
alter table sales add column sales_funnel_id uuid not null references sales_funnels(id) on delete cascade;
alter table sales add constraint sales_funnel_source_external_id_key unique (sales_funnel_id, source, external_id);
create policy "sales_via_client_owner" on sales
  for select using (exists (
    select 1 from sales_funnels sf join clients c on c.id = sf.client_id
    where sf.id = sales.sales_funnel_id and c.owner_id = auth.uid()
  ));

-- ad_spend_daily: client_id -> sales_funnel_id (same RLS caveat as sales above)
drop policy "ad_spend_daily_via_client_owner" on ad_spend_daily;
alter table ad_spend_daily drop constraint ad_spend_daily_client_id_source_operacao_id_data_key;
alter table ad_spend_daily drop column client_id;
alter table ad_spend_daily add column sales_funnel_id uuid not null references sales_funnels(id) on delete cascade;
alter table ad_spend_daily add constraint ad_spend_daily_funnel_source_operacao_data_key
  unique (sales_funnel_id, source, operacao_id, data);
create policy "ad_spend_daily_via_client_owner" on ad_spend_daily
  for select using (exists (
    select 1 from sales_funnels sf join clients c on c.id = sf.client_id
    where sf.id = ad_spend_daily.sales_funnel_id and c.owner_id = auth.uid()
  ));

-- ad_creative_spend_daily: client_id -> sales_funnel_id (same RLS caveat as sales above)
drop policy "ad_creative_spend_daily_via_client_owner" on ad_creative_spend_daily;
alter table ad_creative_spend_daily drop constraint ad_creative_spend_daily_client_id_source_data_ad_id_ad_name_key;
alter table ad_creative_spend_daily drop column client_id;
alter table ad_creative_spend_daily add column sales_funnel_id uuid not null references sales_funnels(id) on delete cascade;
alter table ad_creative_spend_daily add constraint ad_creative_spend_daily_funnel_source_data_ad_key
  unique nulls not distinct (sales_funnel_id, source, data, ad_id, ad_name);
drop index if exists ad_creative_spend_daily_report_idx;
create index ad_creative_spend_daily_report_idx
  on ad_creative_spend_daily(sales_funnel_id, ad_id, ad_name, data);
create policy "ad_creative_spend_daily_via_client_owner" on ad_creative_spend_daily
  for select using (exists (
    select 1 from sales_funnels sf join clients c on c.id = sf.client_id
    where sf.id = ad_creative_spend_daily.sales_funnel_id and c.owner_id = auth.uid()
  ));

-- funnel_sync_state: client_id -> sales_funnel_id (new composite PK; same RLS caveat as sales above)
drop policy "funnel_sync_state_via_client_owner" on funnel_sync_state;
alter table funnel_sync_state drop constraint funnel_sync_state_pkey;
alter table funnel_sync_state drop column client_id;
alter table funnel_sync_state add column sales_funnel_id uuid not null references sales_funnels(id) on delete cascade;
alter table funnel_sync_state add primary key (sales_funnel_id, entity);
create policy "funnel_sync_state_via_client_owner" on funnel_sync_state
  for select using (exists (
    select 1 from sales_funnels sf join clients c on c.id = sf.client_id
    where sf.id = funnel_sync_state.sales_funnel_id and c.owner_id = auth.uid()
  ));

-- Campos antigos no client nunca foram preenchidos (confirmado 2026-09-04) -- remove sem backfill.
alter table clients drop column launchops_operacao_ids;
alter table clients drop column launchops_produto_nomes;

-- get_test_report_by_ad: ad_spend_agg agora soma o gasto de TODOS os sales_funnels do cliente
-- do teste (ad_creative_spend_daily não carrega mais client_id direto). Resto da função
-- (exclusão de bot, receita, contagem de clique/visitante, casamento por identidade do
-- anúncio) inalterado desde a 0031.
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
      coalesce(nullif(acsd.ad_id, ''), nullif(acsd.ad_name, '')) as ad_ref,
      sum(acsd.spend) as spend,
      sum(acsd.impressions) as impressions,
      sum(acsd.link_clicks) as link_clicks
    from ad_creative_spend_daily acsd
    join sales_funnels sf on sf.id = acsd.sales_funnel_id
    where sf.client_id = v_client_id
      and (p_since is null or acsd.data >= p_since::date)
      and (p_until is null or acsd.data < p_until::date)
    group by coalesce(nullif(acsd.ad_id, ''), nullif(acsd.ad_name, ''))
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
    max(asa.impressions)::bigint,
    max(asa.link_clicks)::bigint
  from variants v
  join tests t on t.id = v.test_id
  left join click_events ce on ce.variant_id = v.id
    and (p_since is null or ce.created_at >= p_since)
    and (p_until is null or ce.created_at < p_until)
  left join conversions cv on cv.click_event_id = ce.id and cv.source = t.conversion_method
  left join ad_spend_agg asa
    on asa.ad_ref = coalesce(nullif(ce.source_utms->>'fb_ad_id', ''), nullif(ce.source_utms->>'utm_term', ''))
  where v.test_id = p_test_id
  group by v.id, v.name, coalesce(nullif(ce.source_utms->>'fb_ad_id', ''), nullif(ce.source_utms->>'utm_term', ''), '(sem anúncio)')
  order by v.name, ad_name;
end;
$$;

revoke all on function get_test_report_by_ad(uuid, timestamptz, timestamptz) from public;
grant execute on function get_test_report_by_ad(uuid, timestamptz, timestamptz) to authenticated;
```

- [ ] **Step 2: Apply the migration**

Apply it the same way every migration in this repo has been applied to the real Supabase project (`gbltcutxgbjxujilgrfh`) — via the Supabase MCP `apply_migration` tool, or (if that call is blocked by the environment's safety classifier, as has happened before in this repo) escalate to your controller/session to apply it directly and confirm success before continuing.

- [ ] **Step 3: Write the integration test**

```typescript
// supabase/tests/sales_funnels.integration.test.ts
import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const admin = createClient(URL, SERVICE_ROLE_KEY)

async function createSignedInOwner() {
  const email = `sales-funnels-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const { data } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  const asOwner = createClient(URL, ANON_KEY)
  await asOwner.auth.signInWithPassword({ email, password: 'password123' })
  return { userId: data.user!.id, asOwner }
}

describe('sales_funnels', () => {
  it('lets the owner read and write their own funnel, and blocks a different owner from seeing it', async () => {
    const { userId, asOwner } = await createSignedInOwner()
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: userId, name: 'Sales Funnels RLS Test', slug: `sf-rls-${Date.now()}` })
      .select()
      .single()

    const { data: funnel, error: insertError } = await asOwner
      .from('sales_funnels')
      .insert({ client_id: client!.id, name: '1K LATAM', slug: '1k-latam' })
      .select()
      .single()
    expect(insertError).toBeNull()

    const { asOwner: asOther } = await createSignedInOwner()
    const { data: seenByOther } = await asOther.from('sales_funnels').select('id').eq('id', funnel!.id)
    expect(seenByOther).toEqual([])
  })

  it('rejects two funnels with the same slug for the same client', async () => {
    const { userId, asOwner } = await createSignedInOwner()
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: userId, name: 'Sales Funnels Slug Test', slug: `sf-slug-${Date.now()}` })
      .select()
      .single()

    await asOwner.from('sales_funnels').insert({ client_id: client!.id, name: 'Funil A', slug: 'meu-funil' })
    const { error } = await asOwner.from('sales_funnels').insert({ client_id: client!.id, name: 'Funil B', slug: 'meu-funil' })
    expect(error).not.toBeNull()
    expect(error!.code).toBe('23505')
  })

  it('sums ad_creative_spend_daily across every sales_funnel of the client when reporting by ad', async () => {
    const { userId, asOwner } = await createSignedInOwner()
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: userId, name: 'Multi Funnel Ad Spend Test', slug: `multi-funnel-${Date.now()}` })
      .select()
      .single()
    const { data: test } = await admin
      .from('tests')
      .insert({
        client_id: client!.id,
        name: 'Teste Multi Funil',
        slug: `teste-multi-funil-${Date.now()}`,
        conversion_method: 'hubla_webhook',
      })
      .select()
      .single()
    const { data: variant } = await admin
      .from('variants')
      .insert({ test_id: test!.id, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a' })
      .select()
      .single()
    const { data: funnelA } = await admin
      .from('sales_funnels')
      .insert({ client_id: client!.id, name: 'Funil A', slug: 'funil-a' })
      .select()
      .single()
    const { data: funnelB } = await admin
      .from('sales_funnels')
      .insert({ client_id: client!.id, name: 'Funil B', slug: 'funil-b' })
      .select()
      .single()

    await admin.from('ad_creative_spend_daily').insert([
      { sales_funnel_id: funnelA!.id, data: '2026-09-01', ad_id: 'ad-1', ad_name: 'Anúncio X', spend: 100, impressions: 1000, link_clicks: 50 },
      { sales_funnel_id: funnelB!.id, data: '2026-09-01', ad_id: 'ad-1', ad_name: 'Anúncio X', spend: 50, impressions: 500, link_clicks: 25 },
    ])

    await admin.from('click_events').insert({
      test_id: test!.id,
      variant_id: variant!.id,
      visitor_id: 'v1',
      tracking_id: crypto.randomUUID(),
      source_utms: { fb_ad_id: 'ad-1' },
    })

    const { data: byAd, error } = await asOwner.rpc('get_test_report_by_ad', { p_test_id: test!.id })
    expect(error).toBeNull()
    const row = byAd!.find((r: { ad_name: string }) => r.ad_name === 'ad-1')
    expect(row).toMatchObject({ ad_spend: 150, ad_impressions: 1500, ad_link_clicks: 75 })
  })

  it('never mixes up bot clicks with ad spend across multiple funnels', async () => {
    const { userId, asOwner } = await createSignedInOwner()
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: userId, name: 'Multi Funnel Bot Test', slug: `multi-funnel-bot-${Date.now()}` })
      .select()
      .single()
    const { data: test } = await admin
      .from('tests')
      .insert({
        client_id: client!.id,
        name: 'Teste Multi Funil Bot',
        slug: `teste-multi-funil-bot-${Date.now()}`,
        conversion_method: 'hubla_webhook',
      })
      .select()
      .single()
    const { data: variant } = await admin
      .from('variants')
      .insert({ test_id: test!.id, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a' })
      .select()
      .single()
    const { data: funnel } = await admin
      .from('sales_funnels')
      .insert({ client_id: client!.id, name: 'Funil A', slug: 'funil-a' })
      .select()
      .single()

    await admin.from('ad_creative_spend_daily').insert({
      sales_funnel_id: funnel!.id,
      data: '2026-09-01',
      ad_id: 'ad-bot',
      ad_name: 'Anúncio Bot',
      spend: 30,
      impressions: 300,
      link_clicks: 15,
    })
    await admin.from('click_events').insert({
      test_id: test!.id,
      variant_id: variant!.id,
      visitor_id: 'v-bot',
      tracking_id: crypto.randomUUID(),
      source_utms: { fb_ad_id: 'ad-bot' },
      is_bot: true,
    })

    const { data: byAd, error } = await asOwner.rpc('get_test_report_by_ad', { p_test_id: test!.id })
    expect(error).toBeNull()
    const row = byAd!.find((r: { ad_name: string }) => r.ad_name === 'ad-bot')
    expect(row).toMatchObject({ clicks: 0, bot_clicks: 1, ad_spend: 30 })
  })

  it('keeps a test report intact after one of the client sales_funnels is deleted', async () => {
    const { userId, asOwner } = await createSignedInOwner()
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: userId, name: 'Delete Funnel Test', slug: `delete-funnel-${Date.now()}` })
      .select()
      .single()
    const { data: test } = await admin
      .from('tests')
      .insert({
        client_id: client!.id,
        name: 'Teste Delete Funil',
        slug: `teste-delete-funil-${Date.now()}`,
        conversion_method: 'hubla_webhook',
      })
      .select()
      .single()
    const { data: variant } = await admin
      .from('variants')
      .insert({ test_id: test!.id, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a' })
      .select()
      .single()
    const { data: funnelToKeep } = await admin
      .from('sales_funnels')
      .insert({ client_id: client!.id, name: 'Fica', slug: 'fica' })
      .select()
      .single()
    const { data: funnelToDelete } = await admin
      .from('sales_funnels')
      .insert({ client_id: client!.id, name: 'Sai', slug: 'sai' })
      .select()
      .single()
    await admin.from('ad_creative_spend_daily').insert([
      { sales_funnel_id: funnelToKeep!.id, data: '2026-09-01', ad_id: 'ad-keep', ad_name: 'Anúncio Fica', spend: 20, impressions: 200, link_clicks: 10 },
      { sales_funnel_id: funnelToDelete!.id, data: '2026-09-01', ad_id: 'ad-keep', ad_name: 'Anúncio Fica', spend: 15, impressions: 150, link_clicks: 5 },
    ])
    await admin.from('click_events').insert({
      test_id: test!.id,
      variant_id: variant!.id,
      visitor_id: 'v-delete-funnel',
      tracking_id: crypto.randomUUID(),
      source_utms: { fb_ad_id: 'ad-keep' },
    })

    const beforeDelete = await asOwner.rpc('get_test_report_by_ad', { p_test_id: test!.id })
    expect(beforeDelete.error).toBeNull()
    expect(beforeDelete.data!.find((r: { ad_name: string }) => r.ad_name === 'ad-keep')).toMatchObject({ ad_spend: 35, clicks: 1 })

    await admin.from('sales_funnels').delete().eq('id', funnelToDelete!.id)

    const afterDelete = await asOwner.rpc('get_test_report_by_ad', { p_test_id: test!.id })
    expect(afterDelete.error).toBeNull()
    expect(afterDelete.data!.find((r: { ad_name: string }) => r.ad_name === 'ad-keep')).toMatchObject({ ad_spend: 20, clicks: 1 })
  })
})
```

- [ ] **Step 4: Run the integration test**

Run: `npm run test:integration -- sales_funnels`
Expected: all 4 tests PASS (requires `supabase start` running locally).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0032_sales_funnels.sql supabase/tests/sales_funnels.integration.test.ts
git commit -m "feat(db): add sales_funnels table, per-client funnel credentials, re-key funnel tables"
```

---

### Task 2: Rename the repo/sync layer from client-scoped to funnel-scoped

**Files:**
- Modify: `src/lib/launchops/client.ts`
- Modify: `src/lib/repo/funnel-repo.ts`
- Modify: `src/lib/repo/funnel-sync-state-repo.ts`
- Modify: `src/lib/launchops/sync-sales.ts`
- Modify: `src/lib/launchops/sync-ad-spend.ts`
- Modify: `src/lib/launchops/sync-ad-creative-spend.ts`
- Modify: `src/lib/repo/funnel-repo.integration.test.ts`
- Modify: `src/lib/repo/funnel-sync-state-repo.integration.test.ts`
- Modify: `src/lib/launchops/sync-sales.test.ts`
- Modify: `src/lib/launchops/sync-sales.integration.test.ts`
- Modify: `src/lib/launchops/sync-ad-spend.integration.test.ts`
- Modify: `src/lib/launchops/sync-ad-creative-spend.integration.test.ts`
- Modify: `supabase/migrations/0029_funnel_dashboard.integration.test.ts`
- Modify: `supabase/migrations/0030_report_ad_spend.integration.test.ts`
- Modify: `supabase/migrations/0031_report_ad_spend_fallback_fix.integration.test.ts`

**Interfaces:**
- Consumes: `sales_funnels`, and the re-keyed `sales`/`ad_spend_daily`/`ad_creative_spend_daily`/`funnel_sync_state` tables from Task 1.
- Produces: `createLaunchOpsClient(params: { url: string; serviceRoleKey: string }): SupabaseClient`; `getDailyFunnel(db, salesFunnelId, since, until)`; `getPaymentMethodBreakdown(db, salesFunnelId, since, until)`; `getFunnelSyncHealth(db, salesFunnelId)`; `getSyncCursor(db, salesFunnelId, entity)`; `recordSyncResult(db, { salesFunnelId, entity, result, message?, newCursor? })`; `syncSalesForFunnel(appDb, salesFunnelId, rows)`; `syncAdSpendForFunnel(appDb, salesFunnelId, rows)`; `syncAdCreativeSpendForFunnel(appDb, salesFunnelId, rows)`. Task 3 (the sync route) imports all of these.

- [ ] **Step 1: `src/lib/launchops/client.ts` — accept credentials as parameters**

```typescript
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fetchWithTimeout } from '@/lib/supabase/fetch-with-timeout'

export function createLaunchOpsClient(params: { url: string; serviceRoleKey: string }): SupabaseClient {
  return createClient(params.url, params.serviceRoleKey, {
    auth: { persistSession: false },
    global: { fetch: fetchWithTimeout },
  })
}
```

- [ ] **Step 2: `src/lib/repo/funnel-repo.ts` — rename `clientId` to `salesFunnelId` everywhere**

Replace every occurrence of the parameter name `clientId` with `salesFunnelId`, and every `.eq('client_id', clientId)` with `.eq('sales_funnel_id', salesFunnelId)`, in `getDailyFunnel`, `getPaymentMethodBreakdown`, and `getFunnelSyncHealth`. No other logic changes (the BRT-bucketing fix, the sales/ad_spend_daily joins-in-app-code, and the ROAS/CAC math are all unchanged).

- [ ] **Step 3: `src/lib/repo/funnel-sync-state-repo.ts` — rename to funnel-scoped**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

export type SyncEntity = 'sales' | 'ad_spend_daily' | 'ad_creative_spend_daily'

export async function getSyncCursor(db: SupabaseClient, salesFunnelId: string, entity: SyncEntity): Promise<string | null> {
  const { data, error } = await db
    .from('funnel_sync_state')
    .select('cursor_updated_at')
    .eq('sales_funnel_id', salesFunnelId)
    .eq('entity', entity)
    .maybeSingle()
  if (error) throw error
  const cursor = data?.cursor_updated_at as string | undefined
  return cursor ? new Date(cursor).toISOString() : null
}

export async function recordSyncResult(
  db: SupabaseClient,
  params: {
    salesFunnelId: string
    entity: SyncEntity
    result: 'ok' | 'error'
    message?: string
    newCursor?: string
  }
): Promise<void> {
  const update: Record<string, unknown> = {
    sales_funnel_id: params.salesFunnelId,
    entity: params.entity,
    last_run_at: new Date().toISOString(),
    last_result: params.result,
    last_message: params.message ?? null,
  }
  if (params.result === 'ok' && params.newCursor) {
    update.cursor_updated_at = params.newCursor
  } else {
    const existing = await getSyncCursor(db, params.salesFunnelId, params.entity)
    update.cursor_updated_at = existing
  }
  const { error } = await db.from('funnel_sync_state').upsert(update, { onConflict: 'sales_funnel_id,entity' })
  if (error) throw error
}
```

- [ ] **Step 4: `src/lib/launchops/sync-sales.ts` — rename function and payload field**

Rename `syncSalesForClient` to `syncSalesForFunnel`, its second parameter from `clientId: string` to `salesFunnelId: string`, and the payload's `client_id: clientId` to `sales_funnel_id: salesFunnelId`. The upsert's `onConflict` changes from `'client_id,source,external_id'` to `'sales_funnel_id,source,external_id'`. `fetchLaunchOpsSalesRows` is untouched (it never referenced `client_id`).

- [ ] **Step 5: `src/lib/launchops/sync-ad-spend.ts` — rename function and payload field**

Rename `syncAdSpendForClient` to `syncAdSpendForFunnel`, its second parameter from `clientId: string` to `salesFunnelId: string`, and the payload's `client_id: clientId` to `sales_funnel_id: salesFunnelId`. The upsert's `onConflict` changes from `'client_id,source,operacao_id,data'` to `'sales_funnel_id,source,operacao_id,data'`. `fetchLaunchOpsAdSpendRows`, `fetchAllPages`, `fetchLaunchOpsAdSpendRowsForDays`, `aggregateAdSpendByOperacaoDay` are untouched.

- [ ] **Step 6: `src/lib/launchops/sync-ad-creative-spend.ts` — rename function and payload field**

Rename `syncAdCreativeSpendForClient` to `syncAdCreativeSpendForFunnel`, its second parameter from `clientId: string` to `salesFunnelId: string`, and the payload's `client_id: clientId` to `sales_funnel_id: salesFunnelId`. The upsert's `onConflict` changes from `'client_id,source,data,ad_id,ad_name'` to `'sales_funnel_id,source,data,ad_id,ad_name'`. `fetchLaunchOpsAdCreatives`, `fetchLaunchOpsAdCreativeSpendRows`, `joinAdCreativeSpend` are untouched.

- [ ] **Step 7: Update `src/lib/repo/funnel-repo.integration.test.ts`**

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getDailyFunnel, getFunnelSyncHealth, getPaymentMethodBreakdown } from './funnel-repo'

const db = createServiceRoleClient()
let salesFunnelId: string
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
  const { data: funnel } = await db
    .from('sales_funnels')
    .insert({ client_id: client!.id, name: 'FunnelRepo Funnel', slug: 'funnel-repo-funnel' })
    .select()
    .single()
  salesFunnelId = funnel!.id

  await db.from('sales').insert([
    { sales_funnel_id: salesFunnelId, external_id: 's1', data_venda: '2026-09-01T10:00:00Z', status: 'aprovada', valor_bruto: 10, valor_liquido: 9, metodo_pagamento: 'pix' },
    { sales_funnel_id: salesFunnelId, external_id: 's2', data_venda: '2026-09-01T11:00:00Z', status: 'aprovada', valor_bruto: 20, valor_liquido: 18, metodo_pagamento: 'credit_card' },
    // 23:30 BRT on 09-01 is 02:30 UTC on 09-02 — must bucket under the BRT day, not the UTC day.
    { sales_funnel_id: salesFunnelId, external_id: 's3', data_venda: '2026-09-01T23:30:00-03:00', status: 'aprovada', valor_bruto: 40, valor_liquido: 36, metodo_pagamento: 'pix' },
  ])
  await db.from('ad_spend_daily').insert([
    { sales_funnel_id: salesFunnelId, operacao_id: operacaoIdA, data: '2026-09-01', spend: 5, impressions: 1000, clicks: 40 },
    { sales_funnel_id: salesFunnelId, operacao_id: operacaoIdB, data: '2026-09-01', spend: 7, impressions: 500, clicks: 20 },
  ])
  await db
    .from('funnel_sync_state')
    .upsert({ sales_funnel_id: salesFunnelId, entity: 'sales', last_run_at: '2026-09-01T12:00:00Z', last_result: 'ok' }, { onConflict: 'sales_funnel_id,entity' })
})

describe('funnel-repo', () => {
  it('aggregates sales across multiple sales rows for the same day, including a tight-range edge sale near BRT midnight', async () => {
    const rows = await getDailyFunnel(db, salesFunnelId, '2026-09-01', '2026-09-02')
    const day = rows.find((r) => r.data === '2026-09-01')
    expect(day?.vendas).toBe(3)
    expect(day?.receitaBruta).toBe(70)
    expect(day?.receitaLiquida).toBe(63)
  })

  it('sums ad_spend_daily across both operations for the same day', async () => {
    const rows = await getDailyFunnel(db, salesFunnelId, '2026-09-01', '2026-09-02')
    const day = rows.find((r) => r.data === '2026-09-01')
    expect(day?.spend).toBe(12)
    expect(day?.roas).toBeCloseTo(70 / 12)
  })

  it('reports sync health for a funnel', async () => {
    const health = await getFunnelSyncHealth(db, salesFunnelId)
    const sales = health.find((h) => h.entity === 'sales')
    expect(sales?.lastResult).toBe('ok')
  })

  it('buckets a late-evening BRT sale under the BRT day, not the UTC day', async () => {
    const rows = await getDailyFunnel(db, salesFunnelId, '2026-09-01', '2026-09-03')
    const day1 = rows.find((r) => r.data === '2026-09-01')
    const day2 = rows.find((r) => r.data === '2026-09-02')
    expect(day1?.vendas).toBe(3)
    expect(day1?.receitaBruta).toBe(70)
    expect(day2).toBeUndefined()
  })

  it('sums impressions and clicks across both operations for the same day', async () => {
    const rows = await getDailyFunnel(db, salesFunnelId, '2026-09-01', '2026-09-02')
    const day = rows.find((r) => r.data === '2026-09-01')
    expect(day?.impressions).toBe(1500)
    expect(day?.clicks).toBe(60)
  })

  it('groups revenue by payment method, including a tight-range edge sale near BRT midnight', async () => {
    const breakdown = await getPaymentMethodBreakdown(db, salesFunnelId, '2026-09-01', '2026-09-02')
    const pix = breakdown.find((b) => b.metodo === 'pix')
    const cartao = breakdown.find((b) => b.metodo === 'credit_card')
    expect(pix?.receita).toBe(50)
    expect(cartao?.receita).toBe(20)
  })
})
```

- [ ] **Step 8: Update `src/lib/repo/funnel-sync-state-repo.integration.test.ts`**

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getSyncCursor, recordSyncResult } from './funnel-sync-state-repo'

const db = createServiceRoleClient()
let salesFunnelId: string

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
  const { data: funnel } = await db
    .from('sales_funnels')
    .insert({ client_id: client!.id, name: 'SyncState Funnel', slug: 'sync-state-funnel' })
    .select()
    .single()
  salesFunnelId = funnel!.id
})

describe('funnel-sync-state-repo', () => {
  it('returns null cursor when the entity has never synced', async () => {
    const cursor = await getSyncCursor(db, salesFunnelId, 'sales')
    expect(cursor).toBeNull()
  })

  it('records a successful sync and advances the cursor', async () => {
    await recordSyncResult(db, { salesFunnelId, entity: 'sales', result: 'ok', newCursor: '2026-09-01T00:00:00Z' })
    const cursor = await getSyncCursor(db, salesFunnelId, 'sales')
    expect(cursor).toBe('2026-09-01T00:00:00.000Z')
  })

  it('does not advance the cursor on a failed sync', async () => {
    await recordSyncResult(db, { salesFunnelId, entity: 'sales', result: 'ok', newCursor: '2026-09-01T00:00:00Z' })
    await recordSyncResult(db, { salesFunnelId, entity: 'sales', result: 'error', message: 'LaunchOps timeout' })
    const cursor = await getSyncCursor(db, salesFunnelId, 'sales')
    expect(cursor).toBe('2026-09-01T00:00:00.000Z')
  })

  it('does not collide between two entities of the same funnel (composite key sales_funnel_id, entity)', async () => {
    await recordSyncResult(db, { salesFunnelId, entity: 'sales', result: 'ok', newCursor: '2026-09-01T00:00:00Z' })
    await recordSyncResult(db, { salesFunnelId, entity: 'ad_spend_daily', result: 'ok', newCursor: '2026-09-02T00:00:00Z' })
    expect(await getSyncCursor(db, salesFunnelId, 'sales')).toBe('2026-09-01T00:00:00.000Z')
    expect(await getSyncCursor(db, salesFunnelId, 'ad_spend_daily')).toBe('2026-09-02T00:00:00.000Z')
  })

  it('does not collide between the same entity on two different funnels', async () => {
    const { data: user } = await db.auth.admin.createUser({
      email: `sync-state-2-${Date.now()}@example.com`,
      password: 'password123',
      email_confirm: true,
    })
    const { data: client } = await db
      .from('clients')
      .insert({ owner_id: user!.user!.id, name: 'SyncState2', slug: `sync-state-2-${Date.now()}` })
      .select()
      .single()
    const { data: otherFunnel } = await db
      .from('sales_funnels')
      .insert({ client_id: client!.id, name: 'SyncState Other Funnel', slug: 'sync-state-other-funnel' })
      .select()
      .single()

    await recordSyncResult(db, { salesFunnelId, entity: 'sales', result: 'ok', newCursor: '2026-09-01T00:00:00Z' })
    await recordSyncResult(db, { salesFunnelId: otherFunnel!.id, entity: 'sales', result: 'ok', newCursor: '2026-09-03T00:00:00Z' })
    expect(await getSyncCursor(db, salesFunnelId, 'sales')).toBe('2026-09-01T00:00:00.000Z')
    expect(await getSyncCursor(db, otherFunnel!.id, 'sales')).toBe('2026-09-03T00:00:00.000Z')
  })
})
```

- [ ] **Step 9: Update `src/lib/launchops/sync-sales.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { syncSalesForFunnel } from './sync-sales'

describe('syncSalesForFunnel', () => {
  it('returns latestUpdatedAt as null for an empty batch, without touching the db', async () => {
    const result = await syncSalesForFunnel(createServiceRoleClient(), 'unused', [])
    expect(result).toEqual({ synced: 0, latestUpdatedAt: null })
  })
})
```

`sync-ad-spend.test.ts` and `sync-ad-creative-spend.test.ts` (the plain unit test files, not the `.integration.test.ts` ones below) need no changes — they only test the pure functions (`aggregateAdSpendByOperacaoDay`, `fetchAllPages`, `joinAdCreativeSpend`), none of which touch `clientId`/`salesFunnelId`.

- [ ] **Step 10: Update `src/lib/launchops/sync-sales.integration.test.ts`**

This file integration-tests `syncSalesForClient` directly against a real local Postgres — same rename as Step 9's unit test, but exercising the real upsert/dedup behavior against the `sales` table.

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { syncSalesForFunnel, type LaunchOpsSaleRow } from './sync-sales'

const db = createServiceRoleClient()
let salesFunnelId: string

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

describe('syncSalesForFunnel (integration)', () => {
  it('inserts a new sale and re-running with the same row does not duplicate it', async () => {
    const saleRow = row()
    await syncSalesForFunnel(db, salesFunnelId, [saleRow])
    await syncSalesForFunnel(db, salesFunnelId, [saleRow])

    const { data } = await db.from('sales').select('id').eq('sales_funnel_id', salesFunnelId).eq('external_id', saleRow.id)
    expect(data!.length).toBe(1)
  })

  it('updates an existing sale in place when the row is re-synced with new values', async () => {
    const saleRow = row({ valor_bruto: 10 })
    await syncSalesForFunnel(db, salesFunnelId, [saleRow])
    await syncSalesForFunnel(db, salesFunnelId, [{ ...saleRow, valor_bruto: 12 }])

    const { data } = await db
      .from('sales')
      .select('valor_bruto')
      .eq('sales_funnel_id', salesFunnelId)
      .eq('external_id', saleRow.id)
      .single()
    expect(data!.valor_bruto).toBe(12)
  })
})
```

- [ ] **Step 11: Update `src/lib/launchops/sync-ad-spend.integration.test.ts`**

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { syncAdSpendForFunnel, type AggregatedAdSpendRow } from './sync-ad-spend'

const db = createServiceRoleClient()
let salesFunnelId: string
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
  const { data: funnel } = await db
    .from('sales_funnels')
    .insert({ client_id: client!.id, name: 'SyncAdSpend Funnel', slug: 'sync-adspend-funnel' })
    .select()
    .single()
  salesFunnelId = funnel!.id
})

describe('syncAdSpendForFunnel (integration)', () => {
  it('keeps operation A untouched when only operation B is re-synced for the same day', async () => {
    const rowA: AggregatedAdSpendRow = { operacao_id: operacaoIdA, data: '2026-09-01', spend: 100, impressions: 1000, clicks: 10, leads: 2 }
    const rowB: AggregatedAdSpendRow = { operacao_id: operacaoIdB, data: '2026-09-01', spend: 40, impressions: 400, clicks: 4, leads: 1 }
    await syncAdSpendForFunnel(db, salesFunnelId, [rowA, rowB])

    await syncAdSpendForFunnel(db, salesFunnelId, [{ ...rowB, spend: 55 }])

    const { data } = await db
      .from('ad_spend_daily')
      .select('operacao_id, spend')
      .eq('sales_funnel_id', salesFunnelId)
      .eq('data', '2026-09-01')
      .order('operacao_id')

    const byOp = new Map(data!.map((r) => [r.operacao_id, r.spend]))
    expect(byOp.get(operacaoIdA)).toBe(100)
    expect(byOp.get(operacaoIdB)).toBe(55)
  })
})
```

- [ ] **Step 12: Update `src/lib/launchops/sync-ad-creative-spend.integration.test.ts`**

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { syncAdCreativeSpendForFunnel, type JoinedAdCreativeSpendRow } from './sync-ad-creative-spend'

const db = createServiceRoleClient()
let salesFunnelId: string

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
  const { data: funnel } = await db
    .from('sales_funnels')
    .insert({ client_id: client!.id, name: 'SyncAdCreative Funnel', slug: 'sync-adcreative-funnel' })
    .select()
    .single()
  salesFunnelId = funnel!.id
})

describe('syncAdCreativeSpendForFunnel (integration)', () => {
  it('does not duplicate a row when ad_id is null and the same batch is synced twice', async () => {
    const row: JoinedAdCreativeSpendRow = { ad_id: null, ad_name: 'Criativo Sem ID', data: '2026-09-01', spend: 10, impressions: 100, link_clicks: 2 }
    await syncAdCreativeSpendForFunnel(db, salesFunnelId, [row])
    await syncAdCreativeSpendForFunnel(db, salesFunnelId, [row])

    const { data } = await db
      .from('ad_creative_spend_daily')
      .select('id')
      .eq('sales_funnel_id', salesFunnelId)
      .eq('data', '2026-09-01')
      .is('ad_id', null)
      .eq('ad_name', 'Criativo Sem ID')
    expect(data!.length).toBe(1)
  })
})
```

- [ ] **Step 13: Update `supabase/migrations/0029_funnel_dashboard.integration.test.ts`**

This file predates `sales_funnels` and tested RLS on `sales` directly via `client_id`. Update it to create a `sales_funnels` row and use `sales_funnel_id`, keeping the same 3 assertions (service role can select, authenticated owner can select via RLS, authenticated role is blocked from inserting).

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

const serviceDb = createServiceRoleClient()
const ownerPassword = 'password123'
let salesFunnelId: string
let authedDb: SupabaseClient

beforeAll(async () => {
  const ownerEmail = `funnel-owner-${Date.now()}@example.com`
  const { data: user } = await serviceDb.auth.admin.createUser({
    email: ownerEmail,
    password: ownerPassword,
    email_confirm: true,
  })
  const { data: client } = await serviceDb
    .from('clients')
    .insert({ owner_id: user!.user!.id, name: 'Funnel RLS', slug: `funnel-rls-${Date.now()}` })
    .select()
    .single()
  const { data: funnel } = await serviceDb
    .from('sales_funnels')
    .insert({ client_id: client!.id, name: 'Funnel RLS Funnel', slug: 'funnel-rls-funnel' })
    .select()
    .single()
  salesFunnelId = funnel!.id

  await serviceDb.from('sales').insert({
    sales_funnel_id: salesFunnelId,
    external_id: `sale-${Date.now()}`,
    data_venda: new Date().toISOString(),
    status: 'aprovada',
    valor_bruto: 10,
  })

  const anonDb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  })
  const { data: signIn, error: signInError } = await anonDb.auth.signInWithPassword({
    email: ownerEmail,
    password: ownerPassword,
  })
  if (signInError) throw signInError
  authedDb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${signIn.session!.access_token}` } },
  })
})

describe('funnel tables RLS', () => {
  it('lets the service role select the seeded sale', async () => {
    const { data, error } = await serviceDb.from('sales').select('id').eq('sales_funnel_id', salesFunnelId)
    expect(error).toBeNull()
    expect(data!.length).toBe(1)
  })

  it('lets the authenticated owner select their own sale via RLS', async () => {
    const { data, error } = await authedDb.from('sales').select('id').eq('sales_funnel_id', salesFunnelId)
    expect(error).toBeNull()
    expect(data!.length).toBe(1)
  })

  it('rejects insert from the authenticated role — grants are select-only', async () => {
    const { error } = await authedDb.from('sales').insert({
      sales_funnel_id: salesFunnelId,
      external_id: `blocked-${Date.now()}`,
      data_venda: new Date().toISOString(),
      status: 'aprovada',
    })
    expect(error).not.toBeNull()
  })
})
```

- [ ] **Step 14: Update `supabase/migrations/0030_report_ad_spend.integration.test.ts`**

Regression test for a real historical bug (a non-pre-aggregated join multiplying spend by click count) — must keep testing that exact scenario, just sourced from a `sales_funnel` instead of `client_id` directly.

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const db = createServiceRoleClient()
let testId: string
let asOwner: SupabaseClient

beforeAll(async () => {
  const email = `report-ad-spend-${Date.now()}@example.com`
  const password = 'password123'
  const { data: user } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  asOwner = createClient(URL, ANON_KEY)
  await asOwner.auth.signInWithPassword({ email, password })
  const { data: client } = await db
    .from('clients')
    .insert({ owner_id: user!.user!.id, name: 'ReportAdSpend', slug: `report-ad-spend-${Date.now()}` })
    .select()
    .single()
  const clientId = client!.id
  const { data: funnel } = await db
    .from('sales_funnels')
    .insert({ client_id: clientId, name: 'ReportAdSpend Funnel', slug: 'report-ad-spend-funnel' })
    .select()
    .single()
  const salesFunnelId = funnel!.id
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
    sales_funnel_id: salesFunnelId,
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
    const { data, error } = await asOwner.rpc('get_test_report_by_ad', { p_test_id: testId, p_since: null, p_until: null })
    expect(error).toBeNull()
    const row = (data as { ad_name: string; clicks: number; ad_spend: number }[]).find((r) => r.ad_name === 'ad-123')
    expect(row?.clicks).toBe(3)
    expect(row?.ad_spend).toBe(50)
  })
})
```

- [ ] **Step 15: Update `supabase/migrations/0031_report_ad_spend_fallback_fix.integration.test.ts`**

Regression test for the `utm_term` fallback when `fb_ad_id` is an empty string rather than null — same schema swap as Step 14.

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const db = createServiceRoleClient()
let testId: string
let asOwner: SupabaseClient

beforeAll(async () => {
  const email = `report-fallback-fix-${Date.now()}@example.com`
  const password = 'password123'
  const { data: user } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  asOwner = createClient(URL, ANON_KEY)
  await asOwner.auth.signInWithPassword({ email, password })
  const { data: client } = await db
    .from('clients')
    .insert({ owner_id: user!.user!.id, name: 'ReportFallbackFix', slug: `report-fallback-fix-${Date.now()}` })
    .select()
    .single()
  const clientId = client!.id
  const { data: funnel } = await db
    .from('sales_funnels')
    .insert({ client_id: clientId, name: 'ReportFallbackFix Funnel', slug: 'report-fallback-fix-funnel' })
    .select()
    .single()
  const salesFunnelId = funnel!.id
  const { data: test } = await db
    .from('tests')
    .insert({ client_id: clientId, name: 'T', slug: `report-fallback-fix-t-${Date.now()}`, conversion_method: 'hubla_webhook' })
    .select()
    .single()
  testId = test!.id
  const { data: variant } = await db
    .from('variants')
    .insert({ test_id: testId, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a' })
    .select()
    .single()
  const variantId = variant!.id

  // click has no fb_ad_id (the redirect route writes '' for it, not null) but a real utm_term.
  // LaunchOps only reports ad_name for this ad (ad_id is null), matching the realistic case where
  // the CTE key correctly falls through to ad_name — but a broken join predicate on the click side
  // (coalesce('', utm_term) never falls through to utm_term) would still leave ad_spend null.
  await db.from('click_events').insert({
    test_id: testId,
    variant_id: variantId,
    visitor_id: 'visitor-1',
    tracking_id: crypto.randomUUID(),
    source_utms: { fb_ad_id: '', utm_term: 'Criativo Y' },
  })
  await db.from('ad_creative_spend_daily').insert({
    sales_funnel_id: salesFunnelId,
    source: 'launchops_sync',
    data: '2026-09-01',
    ad_id: null,
    ad_name: 'Criativo Y',
    spend: 25,
    impressions: 200,
    link_clicks: 4,
  })
})

describe('get_test_report_by_ad — utm_term fallback with empty-string fb_ad_id', () => {
  it('matches spend via utm_term when fb_ad_id is an empty string, not null', async () => {
    const { data, error } = await asOwner.rpc('get_test_report_by_ad', { p_test_id: testId, p_since: null, p_until: null })
    expect(error).toBeNull()
    const row = (data as { ad_name: string; clicks: number; ad_spend: number | null }[]).find((r) => r.ad_name === 'Criativo Y')
    expect(row?.clicks).toBe(1)
    expect(row?.ad_spend).toBe(25)
  })
})
```

- [ ] **Step 16: Run the tests**

Run: `npx tsc --noEmit && npm run test`
Expected: TypeScript clean, all unit tests PASS (these are unit tests; the `.integration.test.ts` files require `npm run test:integration` with `supabase start` running locally — run that too, expect the full suite PASS now that Steps 10-15 fixed every file broken by Task 1's re-key).

- [ ] **Step 17: Commit**

```bash
git add src/lib/launchops/client.ts src/lib/repo/funnel-repo.ts src/lib/repo/funnel-sync-state-repo.ts src/lib/launchops/sync-sales.ts src/lib/launchops/sync-ad-spend.ts src/lib/launchops/sync-ad-creative-spend.ts src/lib/repo/funnel-repo.integration.test.ts src/lib/repo/funnel-sync-state-repo.integration.test.ts src/lib/launchops/sync-sales.test.ts src/lib/launchops/sync-sales.integration.test.ts src/lib/launchops/sync-ad-spend.integration.test.ts src/lib/launchops/sync-ad-creative-spend.integration.test.ts supabase/migrations/0029_funnel_dashboard.integration.test.ts supabase/migrations/0030_report_ad_spend.integration.test.ts supabase/migrations/0031_report_ad_spend_fallback_fix.integration.test.ts
git commit -m "refactor(funnel): rename client-scoped repo/sync functions to be funnel-scoped"
```

---

### Task 3: Rewrite the sync route to iterate `sales_funnels` with per-client credentials

**Files:**
- Modify: `src/app/api/internal/sync-funnel/route.ts`
- Modify: `src/app/api/internal/sync-funnel/route.test.ts`

**Interfaces:**
- Consumes: `createLaunchOpsClient({ url, serviceRoleKey })`, `getSyncCursor`/`recordSyncResult` (both `salesFunnelId`-based), `syncSalesForFunnel`/`syncAdSpendForFunnel`/`syncAdCreativeSpendForFunnel` from Task 2.
- Produces: same route contract (`GET`, same `CRON_SECRET` auth, same JSON response shape except `clientsProcessed` renamed to `funnelsProcessed`).

- [ ] **Step 1: Rewrite `src/app/api/internal/sync-funnel/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createLaunchOpsClient } from '@/lib/launchops/client'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getSyncCursor, recordSyncResult } from '@/lib/repo/funnel-sync-state-repo'
import { fetchLaunchOpsSalesRows, syncSalesForFunnel } from '@/lib/launchops/sync-sales'
import {
  fetchLaunchOpsAdSpendRows,
  fetchLaunchOpsAdSpendRowsForDays,
  aggregateAdSpendByOperacaoDay,
  syncAdSpendForFunnel,
} from '@/lib/launchops/sync-ad-spend'
import {
  fetchLaunchOpsAdCreatives,
  fetchLaunchOpsAdCreativeSpendRows,
  joinAdCreativeSpend,
  syncAdCreativeSpendForFunnel,
} from '@/lib/launchops/sync-ad-creative-spend'

interface FunnelRow {
  id: string
  launchops_operacao_ids: string[] | null
  launchops_produto_nomes: string[] | null
  clients: { funnel_source_url: string | null; funnel_source_service_role_key: string | null } | null
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return new NextResponse('Server misconfigured', { status: 500 })
  }
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const appDb = createServiceRoleClient()

  const { data: funnels, error: funnelsError } = await appDb
    .from('sales_funnels')
    .select('id, launchops_operacao_ids, launchops_produto_nomes, clients(funnel_source_url, funnel_source_service_role_key)')
    .eq('is_active', true)
  if (funnelsError) {
    console.error('[sync-funnel-funnels-failed]', funnelsError)
    return NextResponse.json({ ok: false, error: 'failed to list funnels' }, { status: 500 })
  }

  let funnelsProcessed = 0
  for (const funnel of (funnels ?? []) as unknown as FunnelRow[]) {
    const source = funnel.clients
    if (!source?.funnel_source_url || !source?.funnel_source_service_role_key) continue
    const launchopsDb = createLaunchOpsClient({ url: source.funnel_source_url, serviceRoleKey: source.funnel_source_service_role_key })
    await syncSalesEntity(appDb, launchopsDb, funnel)
    await syncAdSpendEntity(appDb, launchopsDb, funnel)
    await syncAdCreativeSpendEntity(appDb, launchopsDb, funnel)
    funnelsProcessed++
  }

  return NextResponse.json({ ok: true, funnelsProcessed })
}

async function syncSalesEntity(appDb: SupabaseClient, launchopsDb: SupabaseClient, funnel: FunnelRow) {
  if (!funnel.launchops_produto_nomes?.length) return
  try {
    const cursor = await getSyncCursor(appDb, funnel.id, 'sales')
    const rows = await fetchLaunchOpsSalesRows(launchopsDb, { produtoNomes: funnel.launchops_produto_nomes, since: cursor })
    const { latestUpdatedAt } = await syncSalesForFunnel(appDb, funnel.id, rows)
    await recordSyncResult(appDb, { salesFunnelId: funnel.id, entity: 'sales', result: 'ok', newCursor: latestUpdatedAt ?? undefined })
  } catch (err) {
    console.error('[sync-funnel-sales-failed]', { salesFunnelId: funnel.id }, err)
    try {
      await recordSyncResult(appDb, { salesFunnelId: funnel.id, entity: 'sales', result: 'error', message: err instanceof Error ? err.message : String(err) })
    } catch (recordErr) {
      console.error('[sync-funnel-sales-record-failed]', { salesFunnelId: funnel.id }, recordErr)
    }
  }
}

async function syncAdSpendEntity(appDb: SupabaseClient, launchopsDb: SupabaseClient, funnel: FunnelRow) {
  if (!funnel.launchops_operacao_ids?.length) return
  try {
    const cursor = await getSyncCursor(appDb, funnel.id, 'ad_spend_daily')
    const rawRows = await fetchLaunchOpsAdSpendRows(launchopsDb, { operacaoIds: funnel.launchops_operacao_ids, since: cursor })
    if (rawRows.length > 0) {
      const days = [...new Set(rawRows.map((row) => row.data_referencia))]
      const fullDayRows = await fetchLaunchOpsAdSpendRowsForDays(launchopsDb, {
        operacaoIds: funnel.launchops_operacao_ids,
        days,
      })
      const aggregated = aggregateAdSpendByOperacaoDay(fullDayRows)
      await syncAdSpendForFunnel(appDb, funnel.id, aggregated)
    }
    const latestUpdatedAt = rawRows.length > 0 ? rawRows[rawRows.length - 1].updated_at : undefined
    await recordSyncResult(appDb, { salesFunnelId: funnel.id, entity: 'ad_spend_daily', result: 'ok', newCursor: latestUpdatedAt })
  } catch (err) {
    console.error('[sync-funnel-ad-spend-failed]', { salesFunnelId: funnel.id }, err)
    try {
      await recordSyncResult(appDb, { salesFunnelId: funnel.id, entity: 'ad_spend_daily', result: 'error', message: err instanceof Error ? err.message : String(err) })
    } catch (recordErr) {
      console.error('[sync-funnel-ad-spend-record-failed]', { salesFunnelId: funnel.id }, recordErr)
    }
  }
}

async function syncAdCreativeSpendEntity(appDb: SupabaseClient, launchopsDb: SupabaseClient, funnel: FunnelRow) {
  if (!funnel.launchops_operacao_ids?.length) return
  try {
    const cursor = await getSyncCursor(appDb, funnel.id, 'ad_creative_spend_daily')
    const creatives = await fetchLaunchOpsAdCreatives(launchopsDb, funnel.launchops_operacao_ids)
    const spendRows = await fetchLaunchOpsAdCreativeSpendRows(launchopsDb, { anuncioIds: creatives.map((c) => c.id), since: cursor })
    const joined = joinAdCreativeSpend(creatives, spendRows)
    await syncAdCreativeSpendForFunnel(appDb, funnel.id, joined)
    const latestUpdatedAt = spendRows.length > 0 ? spendRows[spendRows.length - 1].updated_at : undefined
    await recordSyncResult(appDb, { salesFunnelId: funnel.id, entity: 'ad_creative_spend_daily', result: 'ok', newCursor: latestUpdatedAt })
  } catch (err) {
    console.error('[sync-funnel-ad-creative-spend-failed]', { salesFunnelId: funnel.id }, err)
    try {
      await recordSyncResult(appDb, { salesFunnelId: funnel.id, entity: 'ad_creative_spend_daily', result: 'error', message: err instanceof Error ? err.message : String(err) })
    } catch (recordErr) {
      console.error('[sync-funnel-ad-creative-spend-record-failed]', { salesFunnelId: funnel.id }, recordErr)
    }
  }
}
```

- [ ] **Step 2: Rewrite `src/app/api/internal/sync-funnel/route.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/launchops/client', () => ({ createLaunchOpsClient: vi.fn(() => ({})) }))

const listMock = vi.fn()
vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: vi.fn(() => ({
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: listMock(), error: null }) }) }),
  })),
}))
vi.mock('@/lib/repo/funnel-sync-state-repo', () => ({
  getSyncCursor: vi.fn(async () => null),
  recordSyncResult: vi.fn(async () => undefined),
}))
vi.mock('@/lib/launchops/sync-sales', () => ({
  fetchLaunchOpsSalesRows: vi.fn(async () => []),
  syncSalesForFunnel: vi.fn(async () => ({ synced: 0, latestUpdatedAt: null })),
}))
vi.mock('@/lib/launchops/sync-ad-spend', () => ({
  fetchLaunchOpsAdSpendRows: vi.fn(async () => []),
  fetchLaunchOpsAdSpendRowsForDays: vi.fn(async () => []),
  aggregateAdSpendByOperacaoDay: vi.fn(() => []),
  syncAdSpendForFunnel: vi.fn(async () => ({ synced: 0 })),
}))
vi.mock('@/lib/launchops/sync-ad-creative-spend', () => ({
  fetchLaunchOpsAdCreatives: vi.fn(async () => []),
  fetchLaunchOpsAdCreativeSpendRows: vi.fn(async () => []),
  joinAdCreativeSpend: vi.fn(() => []),
  syncAdCreativeSpendForFunnel: vi.fn(async () => ({ synced: 0 })),
}))

import { GET } from './route'
import { createLaunchOpsClient } from '@/lib/launchops/client'
import {
  fetchLaunchOpsAdSpendRows,
  fetchLaunchOpsAdSpendRowsForDays,
  aggregateAdSpendByOperacaoDay,
  syncAdSpendForFunnel,
} from '@/lib/launchops/sync-ad-spend'

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

  it('fails closed with 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET
    const request = new NextRequest('https://app.example.com/api/internal/sync-funnel', {
      headers: { authorization: 'Bearer undefined' },
    })
    const response = await GET(request)
    expect(response.status).toBe(500)
    process.env.CRON_SECRET = 'test-secret'
  })

  it('skips a funnel whose client has no data-source credential configured', async () => {
    listMock.mockReturnValue([
      {
        id: 'funnel-1',
        launchops_operacao_ids: ['op-1'],
        launchops_produto_nomes: null,
        clients: { funnel_source_url: null, funnel_source_service_role_key: null },
      },
    ])
    const request = new NextRequest('https://app.example.com/api/internal/sync-funnel', {
      headers: { authorization: 'Bearer test-secret' },
    })
    const response = await GET(request)
    const body = await response.json()
    expect(body).toEqual({ ok: true, funnelsProcessed: 0 })
  })

  it('re-fetches and syncs the full day (not just the incrementally-fetched rows) when ad spend rows change', async () => {
    listMock.mockReturnValue([
      {
        id: 'funnel-1',
        launchops_operacao_ids: ['op-1'],
        launchops_produto_nomes: null,
        clients: { funnel_source_url: 'https://launchops.example.com', funnel_source_service_role_key: 'key' },
      },
    ])
    const partialRow = {
      operacao_id: 'op-1',
      data_referencia: '2026-09-01',
      spend: 50,
      impressions: 500,
      clicks: 5,
      leads_periodo: 1,
      updated_at: '2026-09-01T12:00:00Z',
    }
    const fullDayRows = [
      partialRow,
      { operacao_id: 'op-1', data_referencia: '2026-09-01', spend: 30, impressions: 300, clicks: 3, leads_periodo: 0, updated_at: '2026-09-01T08:00:00Z' },
    ]
    const fullDayAggregated = [{ operacao_id: 'op-1', data: '2026-09-01', spend: 80, impressions: 800, clicks: 8, leads: 1 }]

    vi.mocked(fetchLaunchOpsAdSpendRows).mockResolvedValueOnce([partialRow])
    vi.mocked(fetchLaunchOpsAdSpendRowsForDays).mockResolvedValueOnce(fullDayRows)
    vi.mocked(aggregateAdSpendByOperacaoDay).mockReturnValueOnce(fullDayAggregated)

    const request = new NextRequest('https://app.example.com/api/internal/sync-funnel', {
      headers: { authorization: 'Bearer test-secret' },
    })
    await GET(request)

    expect(fetchLaunchOpsAdSpendRowsForDays).toHaveBeenCalledWith(expect.anything(), {
      operacaoIds: ['op-1'],
      days: ['2026-09-01'],
    })
    expect(aggregateAdSpendByOperacaoDay).toHaveBeenCalledWith(fullDayRows)
    expect(syncAdSpendForFunnel).toHaveBeenCalledWith(expect.anything(), 'funnel-1', fullDayAggregated)
  })

  it('builds a separate LaunchOps client per funnel using that funnel own client credential, never mixing them up', async () => {
    listMock.mockReturnValue([
      {
        id: 'funnel-a',
        launchops_operacao_ids: null,
        launchops_produto_nomes: null,
        clients: { funnel_source_url: 'https://client-a.example.com', funnel_source_service_role_key: 'key-a' },
      },
      {
        id: 'funnel-b',
        launchops_operacao_ids: null,
        launchops_produto_nomes: null,
        clients: { funnel_source_url: 'https://client-b.example.com', funnel_source_service_role_key: 'key-b' },
      },
    ])
    const request = new NextRequest('https://app.example.com/api/internal/sync-funnel', {
      headers: { authorization: 'Bearer test-secret' },
    })
    const response = await GET(request)
    const body = await response.json()

    expect(body).toEqual({ ok: true, funnelsProcessed: 2 })
    expect(createLaunchOpsClient).toHaveBeenNthCalledWith(1, { url: 'https://client-a.example.com', serviceRoleKey: 'key-a' })
    expect(createLaunchOpsClient).toHaveBeenNthCalledWith(2, { url: 'https://client-b.example.com', serviceRoleKey: 'key-b' })
  })
})
```

- [ ] **Step 3: Run the tests**

Run: `npx tsc --noEmit && npm run test`
Expected: TypeScript clean, all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/internal/sync-funnel/route.ts src/app/api/internal/sync-funnel/route.test.ts
git commit -m "feat(funnel): sync route iterates sales_funnels with per-client credentials"
```

---

### Task 4: Client hub page + move the test list to `tests/page.tsx`

**Files:**
- Modify: `src/app/dashboard/clients/[clientSlug]/page.tsx` (becomes the hub)
- Create: `src/app/dashboard/clients/[clientSlug]/tests/page.tsx`
- Modify: `src/app/dashboard/clients/[clientSlug]/actions.ts`
- Modify: `src/app/dashboard/clients/[clientSlug]/tests/new/page.tsx`
- Modify: `src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/page.tsx`

**Interfaces:**
- Consumes: `get_client_test_access_counts` RPC (unchanged), `deleteTest`/`toggleTestStatus` actions (Step 3 below), `TestStatusToggle` component (unchanged, just imported from one level up now).
- Produces: hub at `/dashboard/clients/[clientSlug]`, test list moved to `/dashboard/clients/[clientSlug]/tests`.

- [ ] **Step 1: Replace `src/app/dashboard/clients/[clientSlug]/page.tsx` with the hub**

```typescript
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { ConfirmDeleteButton } from '@/components/confirm-delete-button'
import { deleteClient } from '../actions'

export default async function ClientHubPage({ params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, name, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()

  const [testsResult, funnelsResult] = await Promise.all([
    supabase.from('tests').select('id', { count: 'exact', head: true }).eq('client_id', client.id),
    supabase.from('sales_funnels').select('id', { count: 'exact', head: true }).eq('client_id', client.id),
  ])
  if (testsResult.error) console.error('[client-hub-tests-count-failed]', { clientId: client.id }, testsResult.error)
  if (funnelsResult.error) console.error('[client-hub-funnels-count-failed]', { clientId: client.id }, funnelsResult.error)
  const testsCount = testsResult.count ?? 0
  const funnelsCount = funnelsResult.count ?? 0

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <div className="text-xs text-[#8A90A6]">CLIENTE</div>
          <h1 className="font-['Space_Grotesk'] text-xl font-semibold">{client.name}</h1>
        </div>
        <div className="flex items-center gap-4">
          <ConfirmDeleteButton action={deleteClient.bind(null, client.id)} label="Excluir cliente" />
          <a
            href={`/dashboard/clients/${client.slug}/integrations`}
            className="rounded-[9px] border border-white/[0.08] px-4 py-2.5 text-[13.5px] font-medium text-[#8A90A6]"
          >
            Integrações
          </a>
        </div>
      </div>

      <div className="flex gap-5">
        <a
          href={`/dashboard/clients/${client.slug}/tests`}
          className="flex-1 rounded-[14px] border border-white/[0.08] bg-[#141829] p-7 hover:border-[#7C6FF0]/40"
        >
          <div className="mb-4 flex h-[52px] w-[52px] items-center justify-center rounded-xl bg-[#7C6FF0]/15">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#7C6FF0" strokeWidth="2">
              <path d="M4 12h6M14 12h6M10 6l4 6-4 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="mb-1.5 font-['Space_Grotesk'] text-[17px] font-semibold">Funis de Teste</div>
          <p className="text-[13px] leading-relaxed text-[#8A90A6]">
            Testes A/B de página e checkout — clique, variante, conversão.
          </p>
          <div className="mt-4 font-['JetBrains_Mono'] text-xs text-[#8A90A6]">{testsCount} funis ativos</div>
        </a>

        <a
          href={`/dashboard/clients/${client.slug}/funis-venda`}
          className="flex-1 rounded-[14px] border border-white/[0.08] bg-[#141829] p-7 hover:border-[#2DD4A8]/40"
        >
          <div className="mb-4 flex h-[52px] w-[52px] items-center justify-center rounded-xl bg-[#2DD4A8]/15">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#2DD4A8" strokeWidth="2">
              <path d="M4 4h16l-6 8v6l-4 2v-8L4 4z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="mb-1.5 font-['Space_Grotesk'] text-[17px] font-semibold">Funis de Venda</div>
          <p className="text-[13px] leading-relaxed text-[#8A90A6]">
            Receita, gasto de anúncio, ROAS e CAC por operação/produto.
          </p>
          <div className="mt-4 font-['JetBrains_Mono'] text-xs text-[#8A90A6]">{funnelsCount} funis configurados</div>
        </a>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `src/app/dashboard/clients/[clientSlug]/tests/page.tsx`**

```typescript
import { Suspense } from 'react'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { SuccessBanner } from '@/components/success-banner'
import { ConfirmDeleteButton } from '@/components/confirm-delete-button'
import { deleteTest } from '../actions'
import { TestStatusToggle } from '../test-status-toggle'

export default async function TestsListPage({ params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase
    .from('clients')
    .select('id, name, slug')
    .eq('slug', clientSlug)
    .maybeSingle()

  if (!client) notFound()

  const { data: tests } = await supabase
    .from('tests')
    .select('id, name, slug, status, test_type')
    .eq('client_id', client.id)
    .order('name')

  const { data: accessCounts, error: accessCountsError } = await supabase.rpc('get_client_test_access_counts', {
    p_client_id: client.id,
  })
  if (accessCountsError) {
    console.error('[client-access-counts-failed]', { clientId: client.id }, accessCountsError)
  }
  const accessesByTestId = new Map(
    ((accessCounts as { test_id: string; total_accesses: number }[]) ?? []).map((row) => [
      row.test_id,
      row.total_accesses,
    ])
  )

  return (
    <div className="p-8">
      <Suspense fallback={null}>
        <SuccessBanner param="created" message="Teste criado com sucesso." />
      </Suspense>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <a
            href={`/dashboard/clients/${client.slug}`}
            className="mb-1 flex items-center gap-1 text-xs text-[#8A90A6] hover:text-[#E8EAF2]"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M6.5 2L3 5L6.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {client.name}
          </a>
          <h1 className="font-['Space_Grotesk'] text-xl font-semibold">Funis de Teste</h1>
        </div>
        <a
          href={`/dashboard/clients/${client.slug}/tests/new`}
          className="rounded-[9px] bg-[#7C6FF0] px-4 py-2.5 text-[13.5px] font-semibold text-[#0B0E1A]"
        >
          Novo teste
        </a>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/[0.08]">
        {(tests ?? []).map((test, index) => (
          <div
            key={test.id}
            className={`flex items-center gap-5 bg-[#141829] px-6 py-5 hover:bg-[#1B2036] ${
              index < (tests?.length ?? 0) - 1 ? 'border-b border-white/[0.08]' : ''
            } ${test.status === 'paused' ? 'opacity-70' : ''}`}
          >
            <a href={`/dashboard/clients/${client.slug}/tests/${test.slug}`} className="flex min-w-0 flex-1 items-center gap-5">
              <div className="min-w-0 flex-1">
                <div className="font-['Space_Grotesk'] text-[15px] font-semibold">{test.name}</div>
                <div className="font-['JetBrains_Mono'] text-xs text-[#8A90A6]">/{test.slug}</div>
              </div>
              <div className="flex flex-col items-end">
                <span className="font-['JetBrains_Mono'] text-[15px] font-medium">
                  {accessCountsError ? '—' : (accessesByTestId.get(test.id) ?? 0)}
                </span>
                <span className="text-[11px] text-[#8A90A6]">acessos totais</span>
              </div>
              <span className="rounded-full border border-white/[0.08] px-2.5 py-1 text-xs font-medium text-[#8A90A6]">
                {test.test_type === 'checkout' ? 'Checkout' : 'Página'}
              </span>
            </a>
            <TestStatusToggle testId={test.id} clientSlug={client.slug} status={test.status} />
            <ConfirmDeleteButton
              action={deleteTest.bind(null, test.id, client.slug)}
              warning={
                test.test_type === 'checkout'
                  ? 'Isso vai quebrar o botão de comprar da página de vendas. Confirmar?'
                  : undefined
              }
            />
          </div>
        ))}
        {(tests ?? []).length === 0 && <div className="px-6 py-8 text-sm text-[#8A90A6]">Nenhum teste ainda.</div>}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Update `src/app/dashboard/clients/[clientSlug]/actions.ts` revalidatePath targets**

In `deleteTest`, change `revalidatePath(\`/dashboard/clients/${clientSlug}\`)` to `revalidatePath(\`/dashboard/clients/${clientSlug}/tests\`)`.
In `toggleTestStatus`, change `revalidatePath(\`/dashboard/clients/${parsed.client_slug}\`)` to `revalidatePath(\`/dashboard/clients/${parsed.client_slug}/tests\`)`.

- [ ] **Step 4: Update `src/app/dashboard/clients/[clientSlug]/tests/new/page.tsx` redirect target**

Change `router.push(\`/dashboard/clients/${params.clientSlug}?created=1\`)` to `router.push(\`/dashboard/clients/${params.clientSlug}/tests?created=1\`)`.

- [ ] **Step 5: Update `src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/page.tsx` back-link**

Change the "back to Testes" link's `href={\`/dashboard/clients/${clientSlug}\`}` to `href={\`/dashboard/clients/${clientSlug}/tests\`}` (the link text, "Testes", stays as-is — still accurate).

- [ ] **Step 6: Verify manually**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: all clean/passing. There is no automated test for these specific page/redirect changes (they are Server/Client Components without existing test coverage in this area) — this is consistent with the rest of this app's dashboard pages, which also have no page-level tests, only the RPCs/repo functions they call are tested.

- [ ] **Step 7: Commit**

```bash
git add "src/app/dashboard/clients/[clientSlug]/page.tsx" "src/app/dashboard/clients/[clientSlug]/tests/page.tsx" "src/app/dashboard/clients/[clientSlug]/actions.ts" "src/app/dashboard/clients/[clientSlug]/tests/new/page.tsx" "src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/page.tsx"
git commit -m "feat(hub): split client page into a hub plus a dedicated tests list"
```

---

### Task 5: `sales_funnels` list page, actions, status toggle, and create form

**Files:**
- Create: `src/app/dashboard/clients/[clientSlug]/funis-venda/page.tsx`
- Create: `src/app/dashboard/clients/[clientSlug]/funis-venda/actions.ts`
- Create: `src/app/dashboard/clients/[clientSlug]/funis-venda/sales-funnel-status-toggle.tsx`
- Create: `src/app/dashboard/clients/[clientSlug]/funis-venda/new/page.tsx`

**Interfaces:**
- Consumes: `getDailyFunnel`/`getFunnelSyncHealth` (Task 2, `salesFunnelId`-based), `ConfirmDeleteButton` (existing shared component).
- Produces: `createSalesFunnel`, `deleteSalesFunnel`, `toggleSalesFunnelStatus`, `editSalesFunnel` server actions (Task 6 imports `editSalesFunnel`); `SalesFunnelStatusToggle` component.

- [ ] **Step 1: Create `src/app/dashboard/clients/[clientSlug]/funis-venda/actions.ts`**

```typescript
'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const createSalesFunnelSchema = z.object({
  client_id: z.string().uuid(),
  client_slug: z.string(),
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  launchops_operacao_ids: z.string(),
  launchops_produto_nomes: z.string(),
})

export async function createSalesFunnel(context: { client_id: string; client_slug: string }, formData: FormData) {
  const result = createSalesFunnelSchema.safeParse({
    client_id: context.client_id,
    client_slug: context.client_slug,
    name: formData.get('name'),
    slug: formData.get('slug'),
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
  const { error } = await supabase.from('sales_funnels').insert({
    client_id: parsed.client_id,
    name: parsed.name,
    slug: parsed.slug,
    launchops_operacao_ids: operacaoIds,
    launchops_produto_nomes: produtoNomes,
  })
  if (error) throw error
  revalidatePath(`/dashboard/clients/${parsed.client_slug}/funis-venda`)
  redirect(`/dashboard/clients/${parsed.client_slug}/funis-venda`)
}

export async function deleteSalesFunnel(salesFunnelId: string, clientSlug: string) {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from('sales_funnels').delete().eq('id', salesFunnelId)
  if (error) throw error
  revalidatePath(`/dashboard/clients/${clientSlug}/funis-venda`)
}

const toggleSalesFunnelStatusSchema = z.object({
  sales_funnel_id: z.string().uuid(),
  is_active: z.boolean(),
  client_slug: z.string(),
})

export async function toggleSalesFunnelStatus(input: z.infer<typeof toggleSalesFunnelStatusSchema>) {
  const parsed = toggleSalesFunnelStatusSchema.parse(input)
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('sales_funnels')
    .update({ is_active: parsed.is_active })
    .eq('id', parsed.sales_funnel_id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Sales funnel not found or not authorized to update')

  revalidatePath(`/dashboard/clients/${parsed.client_slug}/funis-venda`)
}

const editSalesFunnelSchema = z.object({
  sales_funnel_id: z.string().uuid(),
  client_slug: z.string(),
  funnel_slug: z.string(),
  name: z.string().min(1),
  launchops_operacao_ids: z.string(),
  launchops_produto_nomes: z.string(),
})

export async function editSalesFunnel(
  context: { sales_funnel_id: string; client_slug: string; funnel_slug: string },
  formData: FormData
) {
  const result = editSalesFunnelSchema.safeParse({
    sales_funnel_id: context.sales_funnel_id,
    client_slug: context.client_slug,
    funnel_slug: context.funnel_slug,
    name: formData.get('name'),
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
    .from('sales_funnels')
    .update({ name: parsed.name, launchops_operacao_ids: operacaoIds, launchops_produto_nomes: produtoNomes })
    .eq('id', parsed.sales_funnel_id)
  if (error) throw error
  revalidatePath(`/dashboard/clients/${parsed.client_slug}/funis-venda/${parsed.funnel_slug}`)
  redirect(`/dashboard/clients/${parsed.client_slug}/funis-venda/${parsed.funnel_slug}`)
}
```

- [ ] **Step 2: Create `src/app/dashboard/clients/[clientSlug]/funis-venda/sales-funnel-status-toggle.tsx`**

```typescript
'use client'

import { useState, useTransition } from 'react'
import { toggleSalesFunnelStatus } from './actions'

export function SalesFunnelStatusToggle({
  salesFunnelId,
  clientSlug,
  isActive,
}: {
  salesFunnelId: string
  clientSlug: string
  isActive: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleToggle() {
    setError(null)
    startTransition(async () => {
      try {
        await toggleSalesFunnelStatus({ sales_funnel_id: salesFunnelId, is_active: !isActive, client_slug: clientSlug })
      } catch {
        setError('Não foi possível atualizar. Tente de novo.')
      }
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleToggle}
        disabled={isPending}
        aria-pressed={isActive}
        aria-label={isActive ? 'Pausar funil' : 'Ativar funil'}
        className={`relative box-border h-6 w-11 flex-shrink-0 rounded-full border-0 p-0 transition-colors disabled:opacity-60 ${
          isActive ? 'bg-[#2DD4A8]' : 'bg-white/[0.12]'
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            isActive ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
      {error && <span className="text-[11px] text-[#F76C6C]">{error}</span>}
    </div>
  )
}
```

- [ ] **Step 3: Create `src/app/dashboard/clients/[clientSlug]/funis-venda/page.tsx`**

```typescript
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { ConfirmDeleteButton } from '@/components/confirm-delete-button'
import { deleteSalesFunnel } from './actions'
import { SalesFunnelStatusToggle } from './sales-funnel-status-toggle'
import { getDailyFunnel, getFunnelSyncHealth } from '@/lib/repo/funnel-repo'

function last7Days() {
  const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return { since, until }
}

export default async function SalesFunnelsListPage({ params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, name, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()

  const { data: funnels } = await supabase
    .from('sales_funnels')
    .select('id, name, slug, is_active, launchops_operacao_ids, launchops_produto_nomes')
    .eq('client_id', client.id)
    .order('name')

  const { since, until } = last7Days()
  const currency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  const summaries = await Promise.all(
    (funnels ?? []).map(async (funnel) => {
      const [rows, health] = await Promise.all([
        getDailyFunnel(supabase, funnel.id, since, until),
        getFunnelSyncHealth(supabase, funnel.id),
      ])
      const totals = rows.reduce(
        (acc, row) => ({ receita: acc.receita + row.receitaBruta, spend: acc.spend + row.spend }),
        { receita: 0, spend: 0 }
      )
      const lastSync = health.find((h) => h.lastRunAt)?.lastRunAt ?? null
      return {
        ...funnel,
        receita: totals.receita,
        roas: totals.spend > 0 ? totals.receita / totals.spend : null,
        lastSync,
      }
    })
  )

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <a
            href={`/dashboard/clients/${client.slug}`}
            className="mb-1 flex items-center gap-1 text-xs text-[#8A90A6] hover:text-[#E8EAF2]"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M6.5 2L3 5L6.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {client.name}
          </a>
          <h1 className="font-['Space_Grotesk'] text-xl font-semibold">Funis de Venda</h1>
        </div>
        <a
          href={`/dashboard/clients/${client.slug}/funis-venda/new`}
          className="rounded-[9px] bg-[#2DD4A8] px-4 py-2.5 text-[13.5px] font-semibold text-[#0B0E1A]"
        >
          + Novo funil
        </a>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/[0.08]">
        {summaries.map((funnel, index) => (
          <div
            key={funnel.id}
            className={`flex items-center gap-5 bg-[#141829] px-6 py-5 hover:bg-[#1B2036] ${
              index < summaries.length - 1 ? 'border-b border-white/[0.08]' : ''
            } ${!funnel.is_active ? 'opacity-70' : ''}`}
          >
            <a
              href={`/dashboard/clients/${client.slug}/funis-venda/${funnel.slug}`}
              className="flex min-w-0 flex-1 items-center gap-5"
            >
              <div className="min-w-0 flex-1">
                <div className="font-['Space_Grotesk'] text-[15px] font-semibold">{funnel.name}</div>
                <div className="font-['JetBrains_Mono'] text-xs text-[#8A90A6]">
                  {(funnel.launchops_operacao_ids ?? []).length} operações, {(funnel.launchops_produto_nomes ?? []).length} produtos
                </div>
              </div>
              <div className="flex flex-col items-end">
                <span className="font-['JetBrains_Mono'] text-[15px] font-medium">{currency(funnel.receita)}</span>
                <span className="text-[11px] text-[#8A90A6]">receita (7d)</span>
              </div>
              <div className="flex flex-col items-end">
                <span className="font-['JetBrains_Mono'] text-[15px] font-medium">
                  {funnel.roas !== null ? `${funnel.roas.toFixed(1)}x` : '—'}
                </span>
                <span className="text-[11px] text-[#8A90A6]">ROAS</span>
              </div>
              <span className="text-[11px] text-[#8A90A6]">
                {funnel.lastSync ? `sincronizado ${new Date(funnel.lastSync).toLocaleString('pt-BR')}` : 'nunca sincronizou'}
              </span>
            </a>
            <SalesFunnelStatusToggle salesFunnelId={funnel.id} clientSlug={client.slug} isActive={funnel.is_active} />
            <ConfirmDeleteButton action={deleteSalesFunnel.bind(null, funnel.id, client.slug)} />
          </div>
        ))}
        {summaries.length === 0 && <div className="px-6 py-8 text-sm text-[#8A90A6]">Nenhum funil de venda ainda.</div>}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create `src/app/dashboard/clients/[clientSlug]/funis-venda/new/page.tsx`**

```typescript
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { createSalesFunnel } from '../actions'

const inputClass =
  'w-full rounded-[10px] border border-white/[0.08] bg-[#1B2036] px-3.5 py-2.5 text-sm text-[#E8EAF2] placeholder:text-[#8A90A6] outline-none focus:border-[#7C6FF0]'

export default async function NewSalesFunnelPage({ params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()

  return (
    <div className="p-8">
      <form
        action={createSalesFunnel.bind(null, { client_id: client.id, client_slug: client.slug })}
        className="max-w-xl space-y-4"
      >
        <h1 className="font-['Space_Grotesk'] text-lg font-semibold">Novo funil de venda</h1>
        <input required name="name" placeholder="Nome (ex: 1K LATAM)" className={inputClass} />
        <input required name="slug" placeholder="Slug (ex: 1k-latam)" className={inputClass} />
        <p className="-mt-2 text-xs text-[#8A90A6]">
          Vira parte da URL interna do funil — use letras minúsculas e hífen
        </p>
        <div>
          <label className="mb-1 block text-xs text-[#8A90A6]">IDs de operação (separados por vírgula)</label>
          <input
            name="launchops_operacao_ids"
            placeholder="09066a9d-419c-..., 15e25205-230b-..."
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-[#8A90A6]">Nomes de produto na Hubla (separados por vírgula)</label>
          <input name="launchops_produto_nomes" placeholder="1K Por Dia Latam" className={inputClass} />
        </div>
        <button type="submit" className="rounded-[10px] bg-[#2DD4A8] px-4 py-2.5 text-sm font-semibold text-[#0B0E1A]">
          Criar funil
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean (no automated test coverage for these pages, consistent with the rest of the dashboard's page-level code).

- [ ] **Step 6: Commit**

```bash
git add "src/app/dashboard/clients/[clientSlug]/funis-venda/page.tsx" "src/app/dashboard/clients/[clientSlug]/funis-venda/actions.ts" "src/app/dashboard/clients/[clientSlug]/funis-venda/sales-funnel-status-toggle.tsx" "src/app/dashboard/clients/[clientSlug]/funis-venda/new/page.tsx"
git commit -m "feat(funis-venda): add sales funnel list, create form, and status toggle"
```

---

### Task 6: Move the funnel dashboard to `funis-venda/[funnelSlug]`, add the edit page

**Files:**
- Create: `src/app/dashboard/clients/[clientSlug]/funis-venda/[funnelSlug]/page.tsx`
- Create: `src/app/dashboard/clients/[clientSlug]/funis-venda/[funnelSlug]/funnel-cone.tsx` (copy, unchanged)
- Create: `src/app/dashboard/clients/[clientSlug]/funis-venda/[funnelSlug]/funnel-kpi-cards.tsx` (copy, unchanged)
- Create: `src/app/dashboard/clients/[clientSlug]/funis-venda/[funnelSlug]/funnel-payment-pie.tsx` (copy, unchanged)
- Create: `src/app/dashboard/clients/[clientSlug]/funis-venda/[funnelSlug]/edit/page.tsx`
- Delete: `src/app/dashboard/clients/[clientSlug]/funnel/page.tsx`
- Delete: `src/app/dashboard/clients/[clientSlug]/funnel/funnel-cone.tsx`
- Delete: `src/app/dashboard/clients/[clientSlug]/funnel/funnel-kpi-cards.tsx`
- Delete: `src/app/dashboard/clients/[clientSlug]/funnel/funnel-payment-pie.tsx`

**Interfaces:**
- Consumes: `getDailyFunnel`/`getFunnelSyncHealth`/`getPaymentMethodBreakdown` (Task 2, `salesFunnelId`-based), `editSalesFunnel` action (Task 5).

- [ ] **Step 1: Copy the 3 presentational components unchanged**

```bash
mkdir -p "src/app/dashboard/clients/[clientSlug]/funis-venda/[funnelSlug]"
git mv "src/app/dashboard/clients/[clientSlug]/funnel/funnel-cone.tsx" "src/app/dashboard/clients/[clientSlug]/funis-venda/[funnelSlug]/funnel-cone.tsx"
git mv "src/app/dashboard/clients/[clientSlug]/funnel/funnel-kpi-cards.tsx" "src/app/dashboard/clients/[clientSlug]/funis-venda/[funnelSlug]/funnel-kpi-cards.tsx"
git mv "src/app/dashboard/clients/[clientSlug]/funnel/funnel-payment-pie.tsx" "src/app/dashboard/clients/[clientSlug]/funis-venda/[funnelSlug]/funnel-payment-pie.tsx"
```

These 3 files need no content changes — they take pure data props (`days`, `totals`/`currency`, `breakdown`/`currency`), never a client or funnel id directly.

- [ ] **Step 2: Create `src/app/dashboard/clients/[clientSlug]/funis-venda/[funnelSlug]/page.tsx`**

```typescript
import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getDailyFunnel, getFunnelSyncHealth, getPaymentMethodBreakdown } from '@/lib/repo/funnel-repo'
import { FunnelCone } from './funnel-cone'
import { FunnelKpiCards } from './funnel-kpi-cards'
import { FunnelPaymentPie } from './funnel-payment-pie'

function defaultDateRange() {
  // `until` is an exclusive upper bound in funnel-repo's query, so it must be tomorrow
  // to include all of today's data.
  const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return { since, until }
}

export default async function SalesFunnelPage({
  params,
}: {
  params: Promise<{ clientSlug: string; funnelSlug: string }>
}) {
  const { clientSlug, funnelSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, name, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()

  const { data: funnel } = await supabase
    .from('sales_funnels')
    .select('id, name, slug')
    .eq('client_id', client.id)
    .eq('slug', funnelSlug)
    .maybeSingle()
  if (!funnel) notFound()

  const { since, until } = defaultDateRange()
  const [rows, health, paymentBreakdown] = await Promise.all([
    getDailyFunnel(supabase, funnel.id, since, until),
    getFunnelSyncHealth(supabase, funnel.id),
    getPaymentMethodBreakdown(supabase, funnel.id, since, until),
  ])

  const currency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  const totals = rows.reduce(
    (acc, row) => ({
      investimento: acc.investimento + row.spend,
      receitaBruta: acc.receitaBruta + row.receitaBruta,
      vendas: acc.vendas + row.vendas,
    }),
    { investimento: 0, receitaBruta: 0, vendas: 0 }
  )
  const kpiTotals = {
    investimento: totals.investimento,
    receitaBruta: totals.receitaBruta,
    resultado: totals.receitaBruta - totals.investimento,
    roas: totals.investimento > 0 ? totals.receitaBruta / totals.investimento : null,
    ticketMedio: totals.vendas > 0 ? totals.receitaBruta / totals.vendas : null,
  }

  return (
    <div className="p-8">
      <a
        href={`/dashboard/clients/${client.slug}/funis-venda`}
        className="mb-1 flex items-center gap-1 text-xs text-[#8A90A6] hover:text-[#E8EAF2]"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M6.5 2L3 5L6.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Funis de Venda
      </a>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-['Space_Grotesk'] text-xl font-semibold">{funnel.name}</h1>
        <a
          href={`/dashboard/clients/${client.slug}/funis-venda/${funnel.slug}/edit`}
          className="rounded-[9px] border border-white/[0.08] px-4 py-2.5 text-[13.5px] font-medium text-[#8A90A6]"
        >
          Editar
        </a>
      </div>

      <div className="mb-6 rounded-2xl border border-white/[0.08] p-4 text-[13.5px] text-[#8A90A6]">
        Spend pode estar subestimado — parte do gasto do Meta Ads ainda não está atribuída a esta operação na fonte.
        {health.map((h) => (
          <div key={h.entity}>
            {h.entity}: {h.lastResult === 'error' ? `erro na última sincronização (${h.lastMessage ?? 'sem detalhes'})` : `ok, última execução ${h.lastRunAt ?? 'nunca'}`}
          </div>
        ))}
      </div>

      <FunnelKpiCards totals={kpiTotals} currency={currency} />

      <FunnelCone days={rows} />

      <FunnelPaymentPie breakdown={paymentBreakdown} currency={currency} />

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

- [ ] **Step 3: Create `src/app/dashboard/clients/[clientSlug]/funis-venda/[funnelSlug]/edit/page.tsx`**

```typescript
import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { editSalesFunnel } from '../../actions'

const inputClass =
  'w-full rounded-[10px] border border-white/[0.08] bg-[#1B2036] px-3.5 py-2.5 text-sm text-[#E8EAF2] placeholder:text-[#8A90A6] outline-none focus:border-[#7C6FF0]'

export default async function EditSalesFunnelPage({
  params,
}: {
  params: Promise<{ clientSlug: string; funnelSlug: string }>
}) {
  const { clientSlug, funnelSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()

  const { data: funnel } = await supabase
    .from('sales_funnels')
    .select('id, name, slug, launchops_operacao_ids, launchops_produto_nomes')
    .eq('client_id', client.id)
    .eq('slug', funnelSlug)
    .maybeSingle()
  if (!funnel) notFound()

  return (
    <div className="p-8">
      <a
        href={`/dashboard/clients/${client.slug}/funis-venda/${funnel.slug}`}
        className="mb-4 flex items-center gap-1 text-xs text-[#8A90A6] hover:text-[#E8EAF2]"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M6.5 2L3 5L6.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {funnel.name}
      </a>
      <form
        action={editSalesFunnel.bind(null, {
          sales_funnel_id: funnel.id,
          client_slug: client.slug,
          funnel_slug: funnel.slug,
        })}
        className="max-w-xl space-y-4"
      >
        <h1 className="font-['Space_Grotesk'] text-lg font-semibold">Editar funil — {funnel.name}</h1>
        <input required name="name" defaultValue={funnel.name} className={inputClass} />
        <div>
          <label className="mb-1 block text-xs text-[#8A90A6]">IDs de operação (separados por vírgula)</label>
          <input
            name="launchops_operacao_ids"
            defaultValue={(funnel.launchops_operacao_ids ?? []).join(', ')}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-[#8A90A6]">Nomes de produto na Hubla (separados por vírgula)</label>
          <input
            name="launchops_produto_nomes"
            defaultValue={(funnel.launchops_produto_nomes ?? []).join(', ')}
            className={inputClass}
          />
        </div>
        <button type="submit" className="rounded-[10px] bg-[#7C6FF0] px-4 py-2.5 text-sm font-semibold text-[#0B0E1A]">
          Salvar alterações
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 4: Delete the old folder**

```bash
git rm "src/app/dashboard/clients/[clientSlug]/funnel/page.tsx"
```

(The 3 component files were already moved via `git mv` in Step 1, so the `funnel/` folder is now empty and disappears on its own.)

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add "src/app/dashboard/clients/[clientSlug]/funis-venda/[funnelSlug]"
git commit -m "feat(funis-venda): move the funnel dashboard under [funnelSlug], add edit page"
```

---

### Task 7: Integrações — replace the LaunchOps mapping section with the data-source credential

**Files:**
- Modify: `src/app/dashboard/clients/[clientSlug]/integrations/page.tsx`
- Modify: `src/app/dashboard/clients/[clientSlug]/integrations/actions.ts`

**Interfaces:**
- Consumes: `clients.funnel_source_url`/`funnel_source_service_role_key` (Task 1).
- Produces: `saveFunnelDataSource` server action (replaces `saveLaunchOpsMapping`, which is deleted).

- [ ] **Step 1: Update the query and section in `integrations/page.tsx`**

Change the `select(...)` at the top from:

```typescript
.select('id, slug, custom_domain, domain_status, hubla_webhook_token, launchops_operacao_ids, launchops_produto_nomes')
```

to:

```typescript
.select('id, slug, custom_domain, domain_status, hubla_webhook_token, funnel_source_url, funnel_source_service_role_key')
```

Change the import from `saveLaunchOpsMapping` to `saveFunnelDataSource`:

```typescript
import { saveDomain, verifyDomain, saveHublaToken, saveFunnelDataSource } from './actions'
```

Replace the entire "LaunchOps" `<section>` (the one with the `saveLaunchOpsMapping` form and the two comma-separated-list inputs) with:

```typescript
      <section className="space-y-4 rounded-2xl border border-white/[0.08] p-5">
        <h2 className="font-['Space_Grotesk'] text-base font-semibold">Fonte de dados do Funil de Vendas</h2>

        <form action={saveFunnelDataSource.bind(null, { client_id: client.id, client_slug: client.slug })} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-[#8A90A6]">URL</label>
            <input
              name="funnel_source_url"
              placeholder="https://xxxxx.supabase.co"
              defaultValue={client.funnel_source_url ?? ''}
              className="w-full rounded-[10px] border border-white/[0.08] bg-[#1B2036] px-3.5 py-2.5 text-sm text-[#E8EAF2] placeholder:text-[#8A90A6] outline-none focus:border-[#7C6FF0]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[#8A90A6]">Chave de acesso</label>
            <input
              name="funnel_source_service_role_key"
              placeholder="chave de acesso"
              defaultValue={client.funnel_source_service_role_key ?? ''}
              className="w-full rounded-[10px] border border-white/[0.08] bg-[#1B2036] px-3.5 py-2.5 text-sm text-[#E8EAF2] placeholder:text-[#8A90A6] outline-none focus:border-[#7C6FF0]"
            />
          </div>
          <button
            type="submit"
            className="rounded-[10px] bg-[#7C6FF0] px-4 py-2.5 text-sm font-semibold text-[#0B0E1A]"
          >
            Salvar
          </button>
        </form>
        <p className="-mt-2 text-xs text-[#8A90A6]">
          Usada pela sincronização automática de vendas e gasto de mídia dos funis deste cliente. Cada funil de
          venda tem seu próprio mapeamento de operação/produto, configurado na tela do funil.
        </p>
      </section>
```

- [ ] **Step 2: Replace `saveLaunchOpsMapping` with `saveFunnelDataSource` in `integrations/actions.ts`**

Delete the `launchopsMappingSchema` object and the `saveLaunchOpsMapping` function. Add in their place:

```typescript
const funnelDataSourceSchema = z.object({
  client_id: z.string().uuid(),
  client_slug: z.string(),
  funnel_source_url: z.string().url('informe uma URL válida').optional().or(z.literal('')),
  funnel_source_service_role_key: z.string().optional().or(z.literal('')),
})

export async function saveFunnelDataSource(context: { client_id: string; client_slug: string }, formData: FormData) {
  const result = funnelDataSourceSchema.safeParse({
    client_id: context.client_id,
    client_slug: context.client_slug,
    funnel_source_url: formData.get('funnel_source_url'),
    funnel_source_service_role_key: formData.get('funnel_source_service_role_key'),
  })
  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => issue.message).join('; '))
  }
  const parsed = result.data
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from('clients')
    .update({
      funnel_source_url: parsed.funnel_source_url || null,
      funnel_source_service_role_key: parsed.funnel_source_service_role_key || null,
    })
    .eq('id', parsed.client_id)
  if (error) throw error
  revalidatePath(`/dashboard/clients/${parsed.client_slug}/integrations`)
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "src/app/dashboard/clients/[clientSlug]/integrations/page.tsx" "src/app/dashboard/clients/[clientSlug]/integrations/actions.ts"
git commit -m "feat(integrations): replace LaunchOps mapping with a per-client data-source credential"
```

---

### Final verification (whole branch)

After Task 7, run the full pipeline once more end to end:

```bash
npx tsc --noEmit
npm run lint
npm run test
npm run test:integration   # requires `supabase start` running locally
npm run build
```

Expected: everything clean. `npm run build`'s route list should show `/dashboard/clients/[clientSlug]`, `/dashboard/clients/[clientSlug]/tests`, `/dashboard/clients/[clientSlug]/funis-venda`, `/dashboard/clients/[clientSlug]/funis-venda/new`, `/dashboard/clients/[clientSlug]/funis-venda/[funnelSlug]`, `/dashboard/clients/[clientSlug]/funis-venda/[funnelSlug]/edit`, and no more `/dashboard/clients/[clientSlug]/funnel`.

Apply the Task 1 migration to production (if not already applied during Task 1) before deploying, then `npx vercel deploy --prod`.
