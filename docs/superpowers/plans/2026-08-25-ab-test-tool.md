# AB Test Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js + Supabase tool that splits traffic between full-URL variants (capture pages, sales pages, checkouts) by configurable weight, persists the assignment per visitor, and tracks real conversions (Hubla purchase webhook or thank-you-page pixel) per variant, isolated per client/project.

**Architecture:** Single Next.js (App Router, TypeScript) app deployed on Vercel. Supabase Postgres holds all data with Row Level Security scoping every table by client ownership. Public traffic-facing routes (`/r/[slug]`, `/ty/[slug]`, `/api/webhooks/hubla`) use a service-role Supabase client (bypasses RLS, never exposed to the browser); the authenticated dashboard uses a session-bound Supabase client so RLS enforces isolation.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Supabase (`@supabase/supabase-js`, `@supabase/ssr`), Vitest, Tailwind CSS, Zod.

**Spec:** [docs/superpowers/specs/2026-08-25-ab-test-tool-design.md](../specs/2026-08-25-ab-test-tool-design.md), amended by [2026-08-26-ab-test-tool-optimization-design.md](../specs/2026-08-26-ab-test-tool-optimization-design.md) (Tasks 16–21)

## Global Constraints

- Redirect route path: `/r/[slug]`. Thank-you pixel path: `/ty/[slug]`. Webhook path: `/api/webhooks/hubla`.
- Weight validation: variant `weight_pct` values for a test must sum to 100 (tolerance 0.01), enforced both client-side (fast feedback) and server-side in Postgres (authoritative).
- Idempotency: conversions are deduplicated by a unique constraint on `(click_event_id, source)`, and additionally by `external_event_id` when present (Hubla).
- Persistence cookie name: `ir_t_{testSlug}` (variant assignment), `ir_vid` (visitor id). Default max-age for assignment cookie: `COOKIE_MAX_AGE_DAYS` env var, default 30 days.
- Tracking id travels to the destination URL as the `utm_content` query parameter (confirmed against Hubla's webhook payload at `event.invoice.firstPaymentSession.utm.content`).
- Service-role Supabase key (`SUPABASE_SERVICE_ROLE_KEY`) is server-only, never sent to the browser, only used inside `/r`, `/ty`, and `/api/webhooks/hubla` route handlers.
- The redirect domain shown in the dashboard (e.g. for copying the test link) comes from `NEXT_PUBLIC_REDIRECT_DOMAIN`, never hardcoded.
- No automatic winner declaration, no non-Hubla checkout integration, no non-thank-you-page CRM webhook, no full test editing beyond a status toggle — out of scope per spec. (Tasks 16–21, added per the
  [2026-08-26 optimization addendum](../specs/2026-08-26-ab-test-tool-optimization-design.md), add
  bot filtering, a Bayesian confidence indicator, a source breakdown, a usage widget, a pause/activate
  toggle, and an auto-generated thank-you pixel snippet — none of those change this constraint.)
- Migration files are append-only and numbered sequentially: `0001_init.sql`, `0002_fix_report_conversion_method.sql` already exist; Task 18 adds `0003_report_by_source.sql`, Task 19 adds `0004_usage_stats.sql`. Never edit an already-applied migration file.

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.env.example`, `.gitignore` (via `create-next-app`, then hand-edited)
- Create: `src/lib/supabase/service-role.ts`

**Interfaces:**
- Produces: `createServiceRoleClient(): SupabaseClient` — used by every task that touches `/r`, `/ty`, `/api/webhooks/hubla`.

- [ ] **Step 1: Scaffold the Next.js app into the existing repo**

```bash
cd /Users/vitor/projetos/ab-test-tool
npx --yes create-next-app@latest .tmp-scaffold --typescript --tailwind --app --eslint --src-dir --import-alias "@/*" --use-npm
shopt -s dotglob
mv .tmp-scaffold/* .
shopt -u dotglob
rmdir .tmp-scaffold
```

- [ ] **Step 2: Install Supabase and test dependencies**

```bash
npm install @supabase/supabase-js @supabase/ssr zod
npm install -D vitest @vitejs/plugin-react vite-tsconfig-paths
```

- [ ] **Step 3: Configure Vitest**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'node',
  },
})
```

Edit `package.json` `scripts` to add:

```json
"test": "vitest run --passWithNoTests"
```

- [ ] **Step 4: Add environment template and service-role client**

Create `.env.example`:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
HUBLA_WEBHOOK_TOKEN=
COOKIE_MAX_AGE_DAYS=30
NEXT_PUBLIC_REDIRECT_DOMAIN=ir.seudominio.com
```

Create `src/lib/supabase/service-role.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export function createServiceRoleClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}
```

- [ ] **Step 5: Verify the scaffold**

Run:
```bash
npx tsc --noEmit
npm run test
npm run build
```
Expected: all three exit with code 0 (`test` reports "No test files found" and passes because of `--passWithNoTests`).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Supabase and Vitest"
```

---

### Task 2: Supabase schema, RLS, and report/creation RPCs

**Files:**
- Create: `supabase/config.toml` (via `supabase init`)
- Create: `supabase/migrations/0001_init.sql`
- Test: `supabase/tests/schema.integration.test.ts`

**Interfaces:**
- Produces tables: `clients`, `tests`, `variants`, `click_events`, `conversions`.
- Produces RPCs: `create_test_with_variants(p_client_id uuid, p_name text, p_slug text, p_fallback_url text, p_conversion_method text, p_variants jsonb) returns uuid`, `get_test_report(p_test_id uuid) returns table(variant_id uuid, variant_name text, weight_pct numeric, visits bigint, conversions bigint)`.

- [ ] **Step 1: Initialize local Supabase**

```bash
npx supabase init
npx supabase start
```
Expected: prints local `API URL`, `anon key`, `service_role key` — copy these into a local `.env.local` for later tasks (not committed).

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/0001_init.sql`:

```sql
create extension if not exists "pgcrypto";

create table clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table tests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active','paused')),
  fallback_url text,
  conversion_method text not null check (conversion_method in ('hubla_webhook','thank_you_page')),
  created_at timestamptz not null default now()
);

create table variants (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references tests(id) on delete cascade,
  name text not null,
  weight_pct numeric not null check (weight_pct > 0 and weight_pct <= 100),
  destination_url text not null,
  thank_you_url text,
  created_at timestamptz not null default now()
);

create table click_events (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references tests(id) on delete cascade,
  variant_id uuid not null references variants(id) on delete cascade,
  visitor_id text not null,
  tracking_id text not null unique,
  source_utms jsonb,
  created_at timestamptz not null default now()
);

create table conversions (
  id uuid primary key default gen_random_uuid(),
  click_event_id uuid not null references click_events(id) on delete cascade,
  source text not null check (source in ('hubla_webhook','thank_you_page')),
  external_event_id text,
  value_cents integer,
  created_at timestamptz not null default now(),
  unique (click_event_id, source)
);

create unique index conversions_external_event_id_idx
  on conversions(external_event_id) where external_event_id is not null;

alter table clients enable row level security;
alter table tests enable row level security;
alter table variants enable row level security;
alter table click_events enable row level security;
alter table conversions enable row level security;

create policy "clients_owner_all" on clients
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "tests_via_client_owner" on tests
  for all using (exists (select 1 from clients c where c.id = tests.client_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from clients c where c.id = tests.client_id and c.owner_id = auth.uid()));

create policy "variants_via_client_owner" on variants
  for all using (exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = variants.test_id and c.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = variants.test_id and c.owner_id = auth.uid()
  ));

create policy "click_events_select_via_client_owner" on click_events
  for select using (exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = click_events.test_id and c.owner_id = auth.uid()
  ));

create policy "conversions_select_via_client_owner" on conversions
  for select using (exists (
    select 1 from click_events ce
    join tests t on t.id = ce.test_id
    join clients c on c.id = t.client_id
    where ce.id = conversions.click_event_id and c.owner_id = auth.uid()
  ));

create or replace function create_test_with_variants(
  p_client_id uuid,
  p_name text,
  p_slug text,
  p_fallback_url text,
  p_conversion_method text,
  p_variants jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_test_id uuid;
  v_total numeric;
begin
  if not exists (select 1 from clients where id = p_client_id and owner_id = auth.uid()) then
    raise exception 'access denied';
  end if;

  select sum((v->>'weight_pct')::numeric) into v_total from jsonb_array_elements(p_variants) v;
  if v_total is null or abs(v_total - 100) > 0.01 then
    raise exception 'variant weights must sum to 100, got %', v_total;
  end if;

  insert into tests (client_id, name, slug, fallback_url, conversion_method)
  values (p_client_id, p_name, p_slug, p_fallback_url, p_conversion_method)
  returning id into v_test_id;

  insert into variants (test_id, name, weight_pct, destination_url, thank_you_url)
  select v_test_id, v->>'name', (v->>'weight_pct')::numeric, v->>'destination_url', v->>'thank_you_url'
  from jsonb_array_elements(p_variants) v;

  return v_test_id;
end;
$$;

revoke all on function create_test_with_variants(uuid, text, text, text, text, jsonb) from public;
grant execute on function create_test_with_variants(uuid, text, text, text, text, jsonb) to authenticated;

create or replace function get_test_report(p_test_id uuid)
returns table (
  variant_id uuid,
  variant_name text,
  weight_pct numeric,
  visits bigint,
  conversions bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and c.owner_id = auth.uid()
  ) then
    raise exception 'not found or access denied';
  end if;

  return query
  select v.id, v.name, v.weight_pct,
         count(distinct ce.id)::bigint,
         count(distinct cv.id)::bigint
  from variants v
  left join click_events ce on ce.variant_id = v.id
  left join conversions cv on cv.click_event_id = ce.id
  where v.test_id = p_test_id
  group by v.id, v.name, v.weight_pct
  order by v.name;
end;
$$;

revoke all on function get_test_report(uuid) from public;
grant execute on function get_test_report(uuid) to authenticated;
```

- [ ] **Step 3: Apply the migration locally**

```bash
npx supabase db reset
```
Expected: applies `0001_init.sql` with no errors.

- [ ] **Step 4: Write an integration test proving RLS isolation and the RPCs**

Create `supabase/tests/schema.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const admin = createClient(URL, SERVICE_ROLE_KEY)

async function createTestUser(email: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'password123',
    email_confirm: true,
  })
  if (error) throw error
  return data.user!
}

async function signIn(email: string) {
  const client = createClient(URL, ANON_KEY)
  const { error } = await client.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw error
  return client
}

describe('schema RLS isolation', () => {
  it('owner can see their client, another user cannot', async () => {
    const ownerEmail = `owner-${Date.now()}@example.com`
    const otherEmail = `other-${Date.now()}@example.com`
    const owner = await createTestUser(ownerEmail)
    await createTestUser(otherEmail)

    const { data: client, error } = await admin
      .from('clients')
      .insert({ owner_id: owner.id, name: 'Cliente Teste', slug: `cliente-${Date.now()}` })
      .select()
      .single()
    if (error) throw error

    const ownerClient = await signIn(ownerEmail)
    const { data: ownVisible } = await ownerClient.from('clients').select('id').eq('id', client.id)
    expect(ownVisible).toHaveLength(1)

    const otherClient = await signIn(otherEmail)
    const { data: otherVisible } = await otherClient.from('clients').select('id').eq('id', client.id)
    expect(otherVisible).toHaveLength(0)
  })

  it('create_test_with_variants rejects weights that do not sum to 100', async () => {
    const email = `owner2-${Date.now()}@example.com`
    const user = await createTestUser(email)
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: user.id, name: 'C2', slug: `c2-${Date.now()}` })
      .select()
      .single()

    const asOwner = await signIn(email)
    const { error } = await asOwner.rpc('create_test_with_variants', {
      p_client_id: client!.id,
      p_name: 'Teste X',
      p_slug: `teste-x-${Date.now()}`,
      p_fallback_url: null,
      p_conversion_method: 'thank_you_page',
      p_variants: [
        { name: 'A', weight_pct: 50, destination_url: 'https://example.com/a' },
        { name: 'B', weight_pct: 40, destination_url: 'https://example.com/b' },
      ],
    })
    expect(error).not.toBeNull()
    expect(error!.message).toContain('sum to 100')
  })
})
```

- [ ] **Step 5: Run the integration test**

```bash
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
export NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon key from supabase start>
export SUPABASE_SERVICE_ROLE_KEY=<local service role key from supabase start>
npx vitest run supabase/tests/schema.integration.test.ts
```
Expected: both tests PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase docs
git commit -m "feat: add Supabase schema, RLS policies, and reporting/creation RPCs"
```

---

### Task 3: Domain — weighted variant selection

**Files:**
- Create: `src/lib/domain/pick-variant.ts`
- Test: `src/lib/domain/pick-variant.test.ts`

**Interfaces:**
- Produces: `pickVariant(variants: { id: string; weightPct: number }[], rand?: () => number): string` — consumed by Task 6 (redirect route).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/domain/pick-variant.test.ts
import { describe, it, expect } from 'vitest'
import { pickVariant } from './pick-variant'

describe('pickVariant', () => {
  const variants = [
    { id: 'a', weightPct: 50 },
    { id: 'b', weightPct: 30 },
    { id: 'c', weightPct: 20 },
  ]

  it('picks the first variant when rand is near 0', () => {
    expect(pickVariant(variants, () => 0)).toBe('a')
  })

  it('picks the boundary correctly at 50%', () => {
    expect(pickVariant(variants, () => 0.49)).toBe('a')
    expect(pickVariant(variants, () => 0.51)).toBe('b')
  })

  it('picks the last variant when rand is near 1', () => {
    expect(pickVariant(variants, () => 0.99)).toBe('c')
  })

  it('throws on empty variant list', () => {
    expect(() => pickVariant([], () => 0.5)).toThrow()
  })

  it('distributes proportionally to weights over many samples', () => {
    function mulberry32(seed: number) {
      return () => {
        seed |= 0
        seed = (seed + 0x6d2b79f5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
    }
    const rand = mulberry32(42)
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 }
    for (let i = 0; i < 10000; i++) {
      counts[pickVariant(variants, rand)]++
    }
    expect(counts.a / 10000).toBeCloseTo(0.5, 1)
    expect(counts.b / 10000).toBeCloseTo(0.3, 1)
    expect(counts.c / 10000).toBeCloseTo(0.2, 1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/domain/pick-variant.test.ts
```
Expected: FAIL — `pick-variant.ts` does not exist.

- [ ] **Step 3: Implement**

```ts
// src/lib/domain/pick-variant.ts
export interface WeightedVariant {
  id: string
  weightPct: number
}

export function pickVariant(variants: WeightedVariant[], rand: () => number = Math.random): string {
  if (variants.length === 0) {
    throw new Error('pickVariant requires at least one variant')
  }
  const totalWeight = variants.reduce((sum, v) => sum + v.weightPct, 0)
  const target = rand() * totalWeight
  let cumulative = 0
  for (const variant of variants) {
    cumulative += variant.weightPct
    if (target < cumulative) {
      return variant.id
    }
  }
  return variants[variants.length - 1].id
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/domain/pick-variant.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/pick-variant.ts src/lib/domain/pick-variant.test.ts
git commit -m "feat: add weighted variant selection"
```

---

### Task 4: Domain — visitor and assignment cookies

**Files:**
- Create: `src/lib/domain/cookie-assignment.ts`
- Test: `src/lib/domain/cookie-assignment.test.ts`

**Interfaces:**
- Produces: `VISITOR_COOKIE: string`, `assignmentCookieName(testSlug: string): string`, `getOrCreateVisitorId(existing?: string): { visitorId: string; isNew: boolean }`, `readAssignedVariantId(cookies: Record<string, string | undefined>, testSlug: string): string | undefined` — consumed by Task 6.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/domain/cookie-assignment.test.ts
import { describe, it, expect } from 'vitest'
import {
  VISITOR_COOKIE,
  assignmentCookieName,
  getOrCreateVisitorId,
  readAssignedVariantId,
} from './cookie-assignment'

describe('cookie-assignment', () => {
  it('names the assignment cookie per test slug', () => {
    expect(assignmentCookieName('oferta-x')).toBe('ir_t_oferta-x')
  })

  it('exposes a stable visitor cookie name', () => {
    expect(VISITOR_COOKIE).toBe('ir_vid')
  })

  it('reuses an existing visitor id', () => {
    const result = getOrCreateVisitorId('existing-id')
    expect(result).toEqual({ visitorId: 'existing-id', isNew: false })
  })

  it('generates a new visitor id when missing', () => {
    const result = getOrCreateVisitorId(undefined)
    expect(result.isNew).toBe(true)
    expect(result.visitorId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('reads the assigned variant for a test slug', () => {
    const cookies = { 'ir_t_oferta-x': 'variant-b' }
    expect(readAssignedVariantId(cookies, 'oferta-x')).toBe('variant-b')
  })

  it('returns undefined when no assignment exists', () => {
    expect(readAssignedVariantId({}, 'oferta-x')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/domain/cookie-assignment.test.ts
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```ts
// src/lib/domain/cookie-assignment.ts
export const VISITOR_COOKIE = 'ir_vid'

export function assignmentCookieName(testSlug: string): string {
  return `ir_t_${testSlug}`
}

export function getOrCreateVisitorId(existing?: string): { visitorId: string; isNew: boolean } {
  if (existing) return { visitorId: existing, isNew: false }
  return { visitorId: crypto.randomUUID(), isNew: true }
}

export function readAssignedVariantId(
  cookies: Record<string, string | undefined>,
  testSlug: string
): string | undefined {
  return cookies[assignmentCookieName(testSlug)]
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/domain/cookie-assignment.test.ts
```
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/cookie-assignment.ts src/lib/domain/cookie-assignment.test.ts
git commit -m "feat: add visitor and assignment cookie helpers"
```

---

### Task 5: Repository — redirect data access

**Files:**
- Create: `src/lib/repo/redirect-repo.ts`
- Test: `src/lib/repo/redirect-repo.integration.test.ts`

**Interfaces:**
- Consumes: `createServiceRoleClient()` from Task 1; schema from Task 2.
- Produces: `getTestBySlug(db, slug): Promise<TestWithVariants | null>`, `insertClickEvent(db, params): Promise<void>` — consumed by Task 6.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/repo/redirect-repo.integration.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getTestBySlug, insertClickEvent } from './redirect-repo'

const db = createServiceRoleClient()
let clientId: string
let testSlug: string
let variantId: string

beforeAll(async () => {
  const { data: user } = await db.auth.admin.createUser({
    email: `redirect-repo-${Date.now()}@example.com`,
    password: 'password123',
    email_confirm: true,
  })
  const { data: client } = await db
    .from('clients')
    .insert({ owner_id: user.user!.id, name: 'RepoTest', slug: `repo-test-${Date.now()}` })
    .select()
    .single()
  clientId = client!.id
  testSlug = `slug-${Date.now()}`

  // Seeded via direct service-role inserts, not the create_test_with_variants RPC:
  // that RPC only grants EXECUTE to `authenticated` and checks owner_id = auth.uid(),
  // which is null under a service-role client. service_role bypasses RLS and has
  // the table-level GRANTs from Task 2, so direct inserts work with no auth context.
  const { data: test } = await db
    .from('tests')
    .insert({ client_id: clientId, name: 'Repo Test', slug: testSlug, conversion_method: 'thank_you_page' })
    .select()
    .single()
  const { data: variant } = await db
    .from('variants')
    .insert({ test_id: test!.id, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a' })
    .select()
    .single()
  variantId = variant!.id
})

describe('redirect-repo', () => {
  it('fetches an active test with its variants', async () => {
    const test = await getTestBySlug(db, testSlug)
    expect(test?.status).toBe('active')
    expect(test?.variants).toHaveLength(1)
    expect(test?.variants[0].destination_url).toBe('https://example.com/a')
  })

  it('returns null for an unknown slug', async () => {
    const test = await getTestBySlug(db, 'does-not-exist')
    expect(test).toBeNull()
  })

  it('inserts a click event', async () => {
    const trackingId = crypto.randomUUID()
    await insertClickEvent(db, {
      testId: (await getTestBySlug(db, testSlug))!.id,
      variantId,
      visitorId: 'visitor-1',
      trackingId,
      sourceUtms: { utm_source: 'meta' },
    })
    const { data } = await db.from('click_events').select('*').eq('tracking_id', trackingId).single()
    expect(data?.visitor_id).toBe('visitor-1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/repo/redirect-repo.integration.test.ts
```
Expected: FAIL — `redirect-repo.ts` does not exist. (Requires local Supabase running: `npx supabase start`, and env vars from Task 2 exported.)

- [ ] **Step 3: Implement**

```ts
// src/lib/repo/redirect-repo.ts
import type { SupabaseClient } from '@supabase/supabase-js'

export interface VariantRow {
  id: string
  name: string
  weight_pct: number
  destination_url: string
}

export interface TestWithVariants {
  id: string
  slug: string
  status: 'active' | 'paused'
  fallback_url: string | null
  variants: VariantRow[]
}

export async function getTestBySlug(db: SupabaseClient, slug: string): Promise<TestWithVariants | null> {
  const { data, error } = await db
    .from('tests')
    .select('id, slug, status, fallback_url, variants(id, name, weight_pct, destination_url)')
    .eq('slug', slug)
    .maybeSingle()

  if (error) throw error
  return data as TestWithVariants | null
}

export async function insertClickEvent(
  db: SupabaseClient,
  params: {
    testId: string
    variantId: string
    visitorId: string
    trackingId: string
    sourceUtms: Record<string, string>
  }
): Promise<void> {
  const { error } = await db.from('click_events').insert({
    test_id: params.testId,
    variant_id: params.variantId,
    visitor_id: params.visitorId,
    tracking_id: params.trackingId,
    source_utms: params.sourceUtms,
  })
  if (error) throw error
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/repo/redirect-repo.integration.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/repo/redirect-repo.ts src/lib/repo/redirect-repo.integration.test.ts
git commit -m "feat: add redirect repository layer"
```

---

### Task 6: Redirect route handler `/r/[slug]`

**Files:**
- Create: `src/app/r/[slug]/route.ts`
- Test: `src/app/r/[slug]/route.test.ts`

**Interfaces:**
- Consumes: `pickVariant` (Task 3), cookie helpers (Task 4), `getTestBySlug`/`insertClickEvent` (Task 5), `createServiceRoleClient` (Task 1).

- [ ] **Step 1: Write the failing test**

```ts
// src/app/r/[slug]/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/repo/redirect-repo', () => ({
  getTestBySlug: vi.fn(),
  insertClickEvent: vi.fn(),
}))
vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))

import { GET } from './route'
import { getTestBySlug, insertClickEvent } from '@/lib/repo/redirect-repo'

describe('GET /r/[slug]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('redirects to a variant and appends the tracking id', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      id: 'test-1',
      slug: 'oferta-x',
      status: 'active',
      fallback_url: null,
      variants: [{ id: 'v1', name: 'A', weight_pct: 100, destination_url: 'https://example.com/page' }],
    })

    const request = new NextRequest('https://ir.example.com/r/oferta-x')
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location')!)
    expect(location.origin + location.pathname).toBe('https://example.com/page')
    expect(location.searchParams.get('utm_content')).toBeTruthy()
    expect(insertClickEvent).toHaveBeenCalledOnce()
  })

  it('returns 404 when the test is missing and there is no fallback', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue(null)
    const request = new NextRequest('https://ir.example.com/r/missing')
    const response = await GET(request, { params: Promise.resolve({ slug: 'missing' }) })
    expect(response.status).toBe(404)
  })

  it('redirects to the fallback url when the test is paused', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      id: 'test-1',
      slug: 'oferta-x',
      status: 'paused',
      fallback_url: 'https://example.com/fallback',
      variants: [{ id: 'v1', name: 'A', weight_pct: 100, destination_url: 'https://example.com/page' }],
    })
    const request = new NextRequest('https://ir.example.com/r/oferta-x')
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://example.com/fallback')
  })

  it('reuses the previously assigned variant from the cookie', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      id: 'test-1',
      slug: 'oferta-x',
      status: 'active',
      fallback_url: null,
      variants: [
        { id: 'v1', name: 'A', weight_pct: 50, destination_url: 'https://example.com/a' },
        { id: 'v2', name: 'B', weight_pct: 50, destination_url: 'https://example.com/b' },
      ],
    })
    const request = new NextRequest('https://ir.example.com/r/oferta-x', {
      headers: { cookie: 'ir_t_oferta-x=v2' },
    })
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })
    const location = new URL(response.headers.get('location')!)
    expect(location.origin + location.pathname).toBe('https://example.com/b')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run "src/app/r/[slug]/route.test.ts"
```
Expected: FAIL — `route.ts` does not exist.

- [ ] **Step 3: Implement**

```ts
// src/app/r/[slug]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getTestBySlug, insertClickEvent } from '@/lib/repo/redirect-repo'
import { pickVariant } from '@/lib/domain/pick-variant'
import {
  VISITOR_COOKIE,
  assignmentCookieName,
  getOrCreateVisitorId,
  readAssignedVariantId,
} from '@/lib/domain/cookie-assignment'

const COOKIE_MAX_AGE_DAYS = Number(process.env.COOKIE_MAX_AGE_DAYS ?? '30')

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const db = createServiceRoleClient()
  const test = await getTestBySlug(db, slug)

  if (!test || test.status !== 'active' || test.variants.length === 0) {
    if (test?.fallback_url) {
      return NextResponse.redirect(test.fallback_url, 302)
    }
    return new NextResponse('Not found', { status: 404 })
  }

  const cookieHeader = Object.fromEntries(request.cookies.getAll().map((c) => [c.name, c.value]))
  const assignedVariantId = readAssignedVariantId(cookieHeader, test.slug)
  const chosenId =
    test.variants.find((v) => v.id === assignedVariantId)?.id ??
    pickVariant(test.variants.map((v) => ({ id: v.id, weightPct: v.weight_pct })))
  const variant = test.variants.find((v) => v.id === chosenId)!

  const { visitorId } = getOrCreateVisitorId(cookieHeader[VISITOR_COOKIE])
  const trackingId = crypto.randomUUID()

  const sourceUtms = Object.fromEntries(
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term'].map((key) => [
      key,
      request.nextUrl.searchParams.get(key) ?? '',
    ])
  )

  await insertClickEvent(db, {
    testId: test.id,
    variantId: variant.id,
    visitorId,
    trackingId,
    sourceUtms,
  })

  const destination = new URL(variant.destination_url)
  destination.searchParams.set('utm_content', trackingId)

  const response = NextResponse.redirect(destination, 302)
  response.cookies.set(VISITOR_COOKIE, visitorId, { maxAge: 60 * 60 * 24 * 365, httpOnly: true })
  response.cookies.set(assignmentCookieName(test.slug), variant.id, {
    maxAge: 60 * 60 * 24 * COOKIE_MAX_AGE_DAYS,
    httpOnly: true,
  })
  return response
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run "src/app/r/[slug]/route.test.ts"
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add "src/app/r/[slug]"
git commit -m "feat: add redirect route handler"
```

---

### Task 7: Domain — Hubla token verification and payload parsing

**Files:**
- Create: `src/lib/domain/hubla.ts`
- Test: `src/lib/domain/hubla.test.ts`

**Interfaces:**
- Produces: `verifyHublaToken(received: string | null, expected: string): boolean`, `parseHublaPaymentSucceeded(payload: unknown): { trackingId: string | null; externalEventId: string; valueCents: number | null }` — consumed by Task 9.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/domain/hubla.test.ts
import { describe, it, expect } from 'vitest'
import { verifyHublaToken, parseHublaPaymentSucceeded } from './hubla'

describe('verifyHublaToken', () => {
  it('returns true when tokens match', () => {
    expect(verifyHublaToken('secret', 'secret')).toBe(true)
  })
  it('returns false when tokens differ', () => {
    expect(verifyHublaToken('wrong', 'secret')).toBe(false)
  })
  it('returns false when token is missing', () => {
    expect(verifyHublaToken(null, 'secret')).toBe(false)
  })
  it('returns false when lengths differ', () => {
    expect(verifyHublaToken('short', 'a-much-longer-secret')).toBe(false)
  })
})

describe('parseHublaPaymentSucceeded', () => {
  it('extracts tracking id, external event id and value', () => {
    const payload = {
      event: {
        invoice: {
          id: 'inv_123',
          amount: { totalCents: 9700 },
          firstPaymentSession: { utm: { content: 'trk_abc' } },
        },
      },
    }
    expect(parseHublaPaymentSucceeded(payload)).toEqual({
      trackingId: 'trk_abc',
      externalEventId: 'inv_123',
      valueCents: 9700,
    })
  })

  it('returns null tracking id when utm is missing', () => {
    const payload = { event: { invoice: { id: 'inv_456', amount: { totalCents: 100 } } } }
    expect(parseHublaPaymentSucceeded(payload).trackingId).toBeNull()
  })

  it('throws when invoice id is missing', () => {
    const payload = { event: { invoice: {} } }
    expect(() => parseHublaPaymentSucceeded(payload)).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/domain/hubla.test.ts
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```ts
// src/lib/domain/hubla.ts
import { timingSafeEqual } from 'node:crypto'

export function verifyHublaToken(received: string | null, expected: string): boolean {
  if (!received) return false
  const receivedBuf = Buffer.from(received)
  const expectedBuf = Buffer.from(expected)
  if (receivedBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(receivedBuf, expectedBuf)
}

export interface ParsedHublaEvent {
  trackingId: string | null
  externalEventId: string
  valueCents: number | null
}

export function parseHublaPaymentSucceeded(payload: any): ParsedHublaEvent {
  const invoice = payload?.event?.invoice
  if (!invoice?.id) {
    throw new Error('Hubla payload missing event.invoice.id')
  }
  return {
    trackingId: invoice.firstPaymentSession?.utm?.content ?? null,
    externalEventId: invoice.id,
    valueCents: invoice.amount?.totalCents ?? null,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/domain/hubla.test.ts
```
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/hubla.ts src/lib/domain/hubla.test.ts
git commit -m "feat: add Hubla webhook token verification and payload parsing"
```

---

### Task 8: Repository — conversion data access

**Files:**
- Create: `src/lib/repo/conversion-repo.ts`
- Test: `src/lib/repo/conversion-repo.integration.test.ts`

**Interfaces:**
- Produces: `getClickEventByTrackingId(db, trackingId): Promise<{ id: string } | null>`, `insertConversionIfNew(db, params): Promise<'inserted' | 'duplicate'>` — consumed by Tasks 9 and 10.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/repo/conversion-repo.integration.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getClickEventByTrackingId, insertConversionIfNew } from './conversion-repo'

const db = createServiceRoleClient()
let clickEventId: string
let trackingId: string

beforeAll(async () => {
  const { data: user } = await db.auth.admin.createUser({
    email: `conv-repo-${Date.now()}@example.com`,
    password: 'password123',
    email_confirm: true,
  })
  const { data: client } = await db
    .from('clients')
    .insert({ owner_id: user.user!.id, name: 'ConvRepo', slug: `conv-repo-${Date.now()}` })
    .select()
    .single()

  // Seeded via direct service-role inserts, not the create_test_with_variants RPC —
  // same reasoning as Task 5: that RPC requires an authenticated-user auth.uid(),
  // which a service-role client does not have.
  const { data: test } = await db
    .from('tests')
    .insert({
      client_id: client!.id,
      name: 'Conv Test',
      slug: `conv-slug-${Date.now()}`,
      conversion_method: 'hubla_webhook',
    })
    .select()
    .single()
  const { data: variant } = await db
    .from('variants')
    .insert({ test_id: test!.id, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a' })
    .select()
    .single()
  trackingId = crypto.randomUUID()
  const { data: clickEvent } = await db
    .from('click_events')
    .insert({
      test_id: test!.id,
      variant_id: variant!.id,
      visitor_id: 'visitor-x',
      tracking_id: trackingId,
      source_utms: {},
    })
    .select()
    .single()
  clickEventId = clickEvent!.id
})

describe('conversion-repo', () => {
  it('finds a click event by tracking id', async () => {
    const result = await getClickEventByTrackingId(db, trackingId)
    expect(result?.id).toBe(clickEventId)
  })

  it('returns null for an unknown tracking id', async () => {
    const result = await getClickEventByTrackingId(db, 'does-not-exist')
    expect(result).toBeNull()
  })

  it('inserts a conversion and reports duplicate on retry', async () => {
    // Unique per run: conversions.external_event_id has a DB-wide unique index
    // (not scoped per click_event), so a fixed literal would falsely report
    // 'duplicate' on a fresh first insert when this suite reruns against the
    // same persistent local Supabase instance.
    const externalEventId = `inv_dup_${Date.now()}`
    const first = await insertConversionIfNew(db, {
      clickEventId,
      source: 'hubla_webhook',
      externalEventId,
      valueCents: 5000,
    })
    expect(first).toBe('inserted')

    const second = await insertConversionIfNew(db, {
      clickEventId,
      source: 'hubla_webhook',
      externalEventId,
      valueCents: 5000,
    })
    expect(second).toBe('duplicate')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/repo/conversion-repo.integration.test.ts
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```ts
// src/lib/repo/conversion-repo.ts
import type { SupabaseClient } from '@supabase/supabase-js'

export type ConversionSource = 'hubla_webhook' | 'thank_you_page'

export async function getClickEventByTrackingId(
  db: SupabaseClient,
  trackingId: string
): Promise<{ id: string } | null> {
  const { data, error } = await db
    .from('click_events')
    .select('id')
    .eq('tracking_id', trackingId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function insertConversionIfNew(
  db: SupabaseClient,
  params: {
    clickEventId: string
    source: ConversionSource
    externalEventId?: string
    valueCents?: number | null
  }
): Promise<'inserted' | 'duplicate'> {
  const { error } = await db.from('conversions').insert({
    click_event_id: params.clickEventId,
    source: params.source,
    external_event_id: params.externalEventId ?? null,
    value_cents: params.valueCents ?? null,
  })

  if (error) {
    if (error.code === '23505') return 'duplicate'
    throw error
  }
  return 'inserted'
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/repo/conversion-repo.integration.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/repo/conversion-repo.ts src/lib/repo/conversion-repo.integration.test.ts
git commit -m "feat: add conversion repository layer"
```

---

### Task 9: Hubla webhook route handler

**Files:**
- Create: `src/app/api/webhooks/hubla/route.ts`
- Test: `src/app/api/webhooks/hubla/route.test.ts`

**Interfaces:**
- Consumes: `verifyHublaToken`, `parseHublaPaymentSucceeded` (Task 7); `getClickEventByTrackingId`, `insertConversionIfNew` (Task 8).

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/webhooks/hubla/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/domain/hubla', () => ({
  verifyHublaToken: vi.fn(),
  parseHublaPaymentSucceeded: vi.fn(),
}))
vi.mock('@/lib/repo/conversion-repo', () => ({
  getClickEventByTrackingId: vi.fn(),
  insertConversionIfNew: vi.fn(),
}))
vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))

import { POST } from './route'
import { verifyHublaToken, parseHublaPaymentSucceeded } from '@/lib/domain/hubla'
import { getClickEventByTrackingId, insertConversionIfNew } from '@/lib/repo/conversion-repo'

function makeRequest(body: unknown, token = 'valid-token') {
  return new NextRequest('https://ir.example.com/api/webhooks/hubla', {
    method: 'POST',
    headers: { 'x-hubla-token': token, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/webhooks/hubla', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects an invalid token with 401', async () => {
    vi.mocked(verifyHublaToken).mockReturnValue(false)
    const response = await POST(makeRequest({}))
    expect(response.status).toBe(401)
  })

  it('returns attributed:false when tracking id is unknown', async () => {
    vi.mocked(verifyHublaToken).mockReturnValue(true)
    vi.mocked(parseHublaPaymentSucceeded).mockReturnValue({
      trackingId: 'trk_1',
      externalEventId: 'inv_1',
      valueCents: 1000,
    })
    vi.mocked(getClickEventByTrackingId).mockResolvedValue(null)

    const response = await POST(makeRequest({}))
    const json = await response.json()
    expect(json).toEqual({ ok: true, attributed: false })
  })

  it('records a conversion when tracking id matches a click event', async () => {
    vi.mocked(verifyHublaToken).mockReturnValue(true)
    vi.mocked(parseHublaPaymentSucceeded).mockReturnValue({
      trackingId: 'trk_1',
      externalEventId: 'inv_1',
      valueCents: 1000,
    })
    vi.mocked(getClickEventByTrackingId).mockResolvedValue({ id: 'click_1' })
    vi.mocked(insertConversionIfNew).mockResolvedValue('inserted')

    const response = await POST(makeRequest({}))
    const json = await response.json()
    expect(json).toEqual({ ok: true, attributed: true, result: 'inserted' })
    expect(insertConversionIfNew).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ clickEventId: 'click_1', source: 'hubla_webhook' })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/app/api/webhooks/hubla/route.test.ts
```
Expected: FAIL — `route.ts` does not exist.

- [ ] **Step 3: Implement**

```ts
// src/app/api/webhooks/hubla/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { verifyHublaToken, parseHublaPaymentSucceeded } from '@/lib/domain/hubla'
import { getClickEventByTrackingId, insertConversionIfNew } from '@/lib/repo/conversion-repo'

export async function POST(request: NextRequest) {
  const receivedToken = request.headers.get('x-hubla-token')
  if (!verifyHublaToken(receivedToken, process.env.HUBLA_WEBHOOK_TOKEN!)) {
    console.error('[hubla-webhook] rejected: invalid or missing x-hubla-token')
    return new NextResponse('Invalid token', { status: 401 })
  }

  const payload = await request.json()
  const parsed = parseHublaPaymentSucceeded(payload)

  if (!parsed.trackingId) {
    return NextResponse.json({ ok: true, attributed: false })
  }

  const db = createServiceRoleClient()
  const clickEvent = await getClickEventByTrackingId(db, parsed.trackingId)
  if (!clickEvent) {
    return NextResponse.json({ ok: true, attributed: false })
  }

  const result = await insertConversionIfNew(db, {
    clickEventId: clickEvent.id,
    source: 'hubla_webhook',
    externalEventId: parsed.externalEventId,
    valueCents: parsed.valueCents,
  })

  return NextResponse.json({ ok: true, attributed: true, result })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/app/api/webhooks/hubla/route.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/webhooks/hubla
git commit -m "feat: add Hubla webhook route handler"
```

---

### Task 10: Thank-you pixel route handler

**Files:**
- Create: `src/app/ty/[slug]/route.ts`
- Test: `src/app/ty/[slug]/route.test.ts`

**Interfaces:**
- Consumes: `getClickEventByTrackingId`, `insertConversionIfNew` (Task 8). The `[slug]` segment is accepted for URL readability only — the lookup key is the globally-unique `tracking_id` query param (`tid`).

- [ ] **Step 1: Write the failing test**

```ts
// src/app/ty/[slug]/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/repo/conversion-repo', () => ({
  getClickEventByTrackingId: vi.fn(),
  insertConversionIfNew: vi.fn(),
}))
vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))

import { GET } from './route'
import { getClickEventByTrackingId, insertConversionIfNew } from '@/lib/repo/conversion-repo'

describe('GET /ty/[slug]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('records a conversion when tid matches a click event', async () => {
    vi.mocked(getClickEventByTrackingId).mockResolvedValue({ id: 'click_1' })
    const request = new NextRequest('https://ir.example.com/ty/oferta-x?tid=trk_1')
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })
    expect(response.headers.get('content-type')).toBe('image/gif')
    expect(insertConversionIfNew).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ clickEventId: 'click_1', source: 'thank_you_page' })
    )
  })

  it('still returns the pixel when tid is missing', async () => {
    const request = new NextRequest('https://ir.example.com/ty/oferta-x')
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })
    expect(response.status).toBe(200)
    expect(insertConversionIfNew).not.toHaveBeenCalled()
  })

  it('still returns the pixel when tid matches no click event', async () => {
    vi.mocked(getClickEventByTrackingId).mockResolvedValue(null)
    const request = new NextRequest('https://ir.example.com/ty/oferta-x?tid=unknown')
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })
    expect(response.status).toBe(200)
    expect(insertConversionIfNew).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run "src/app/ty/[slug]/route.test.ts"
```
Expected: FAIL — `route.ts` does not exist.

- [ ] **Step 3: Implement**

```ts
// src/app/ty/[slug]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getClickEventByTrackingId, insertConversionIfNew } from '@/lib/repo/conversion-repo'

const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7', 'base64')

export async function GET(request: NextRequest, _context: { params: Promise<{ slug: string }> }) {
  const trackingId = request.nextUrl.searchParams.get('tid')

  if (trackingId) {
    const db = createServiceRoleClient()
    const clickEvent = await getClickEventByTrackingId(db, trackingId)
    if (clickEvent) {
      await insertConversionIfNew(db, { clickEventId: clickEvent.id, source: 'thank_you_page' })
    }
  }

  return new NextResponse(TRANSPARENT_GIF, {
    headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run "src/app/ty/[slug]/route.test.ts"
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add "src/app/ty"
git commit -m "feat: add thank-you page pixel route handler"
```

---

### Task 11: Auth wiring and dashboard shell

**Files:**
- Create: `src/lib/supabase/middleware.ts`, `src/middleware.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/browser.ts`
- Create: `src/app/login/page.tsx`, `src/app/dashboard/layout.tsx`, `src/app/dashboard/page.tsx`

**Interfaces:**
- Produces: `createServerSupabaseClient()`, `createBrowserSupabaseClient()` — consumed by Tasks 12–14.

- [ ] **Step 1: Session-refresh middleware**

Create `src/lib/supabase/middleware.ts`:

```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  if (!user && request.nextUrl.pathname.startsWith('/dashboard')) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return response
}
```

Create `src/middleware.ts` (this project uses `--src-dir`, so Next.js requires middleware to live inside `src/`, not at the project root):

```ts
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|r/|ty/|api/webhooks).*)'],
}
```

- [ ] **Step 2: Server and browser Supabase clients**

Create `src/lib/supabase/server.ts`:

```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createServerSupabaseClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        },
      },
    }
  )
}
```

Create `src/lib/supabase/browser.ts`:

```ts
import { createBrowserClient } from '@supabase/ssr'

export function createBrowserSupabaseClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 3: Login page**

Create `src/app/login/page.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase/browser'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    const supabase = createBrowserSupabaseClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      return
    }
    router.push('/dashboard')
  }

  return (
    <main className="mx-auto mt-24 max-w-sm">
      <h1 className="mb-6 text-xl font-semibold">Entrar</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="email"
          required
          placeholder="E-mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded border px-3 py-2"
        />
        <input
          type="password"
          required
          placeholder="Senha"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded border px-3 py-2"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="w-full rounded bg-black px-3 py-2 text-white">
          Entrar
        </button>
      </form>
    </main>
  )
}
```

- [ ] **Step 4: Dashboard layout and landing page**

Create `src/app/dashboard/layout.tsx`:

```tsx
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl p-6">
      <nav className="mb-6 flex items-center justify-between border-b pb-4">
        <a href="/dashboard" className="font-semibold">AB Test Tool</a>
      </nav>
      {children}
    </div>
  )
}
```

Create `src/app/dashboard/page.tsx`:

```tsx
import { createServerSupabaseClient } from '@/lib/supabase/server'

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient()
  const { data: clients } = await supabase.from('clients').select('id, name, slug').order('name')

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Clientes</h1>
      <ul className="space-y-2">
        {clients?.map((client) => (
          <li key={client.id}>
            <a href={`/dashboard/clients/${client.slug}`} className="text-blue-600 underline">
              {client.name}
            </a>
          </li>
        ))}
      </ul>
      <a href="/dashboard/clients/new" className="mt-4 inline-block text-sm text-blue-600 underline">
        + Novo cliente
      </a>
    </div>
  )
}
```

- [ ] **Step 5: Manual verification**

```bash
npm run dev
```
In the browser: visiting `http://localhost:3000/dashboard` while logged out redirects to `/login`. Create a test user via `npx supabase status` credentials or `supabase.auth.admin.createUser` in a one-off script; logging in redirects to `/dashboard` and lists zero clients.

- [ ] **Step 6: Commit**

```bash
git add src/middleware.ts src/lib/supabase/middleware.ts src/lib/supabase/server.ts src/lib/supabase/browser.ts src/app/login src/app/dashboard
git commit -m "feat: add Supabase auth wiring and dashboard shell"
```

---

### Task 12: Dashboard — clients CRUD

**Files:**
- Create: `src/app/dashboard/clients/actions.ts`
- Create: `src/app/dashboard/clients/new/page.tsx`

**Interfaces:**
- Consumes: `createServerSupabaseClient` (Task 11).
- Produces: server action `createClient(formData: FormData): Promise<void>` — pattern reused by Task 13.

- [ ] **Step 1: Server action**

Create `src/app/dashboard/clients/actions.ts`:

```ts
'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const createClientSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'use apenas letras minúsculas, números e hífen'),
})

export async function createClient(formData: FormData) {
  const parsed = createClientSchema.parse({
    name: formData.get('name'),
    slug: formData.get('slug'),
  })

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase.from('clients').insert({
    name: parsed.name,
    slug: parsed.slug,
    owner_id: user.id,
  })
  if (error) throw error

  revalidatePath('/dashboard')
  redirect('/dashboard')
}
```

- [ ] **Step 2: New client form**

Create `src/app/dashboard/clients/new/page.tsx`:

```tsx
import { createClient } from '../actions'

export default function NewClientPage() {
  return (
    <form action={createClient} className="max-w-md space-y-4">
      <h1 className="text-lg font-semibold">Novo cliente</h1>
      <input name="name" required placeholder="Nome" className="w-full rounded border px-3 py-2" />
      <input
        name="slug"
        required
        placeholder="slug (ex: nicho-fitness)"
        pattern="[a-z0-9-]+"
        className="w-full rounded border px-3 py-2"
      />
      <button type="submit" className="rounded bg-black px-3 py-2 text-white">
        Criar
      </button>
    </form>
  )
}
```

- [ ] **Step 3: Manual verification**

```bash
npm run dev
```
Logged in at `/dashboard/clients/new`, submit a name/slug and confirm redirect to `/dashboard` with the new client listed.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/clients
git commit -m "feat: add client creation flow"
```

---

### Task 13: Dashboard — tests and variants CRUD

**Files:**
- Create: `src/lib/domain/validate-weights.ts`
- Test: `src/lib/domain/validate-weights.test.ts`
- Create: `src/app/dashboard/clients/[clientSlug]/page.tsx`, `src/app/dashboard/clients/[clientSlug]/actions.ts`, `src/app/dashboard/clients/[clientSlug]/tests/new/page.tsx`

**Interfaces:**
- Consumes: `create_test_with_variants` RPC (Task 2).
- Produces: `weightsSumTo100(weights: number[]): boolean` — used for instant client-side feedback before submit.

- [ ] **Step 1: Write the failing test for weight validation**

```ts
// src/lib/domain/validate-weights.test.ts
import { describe, it, expect } from 'vitest'
import { weightsSumTo100 } from './validate-weights'

describe('weightsSumTo100', () => {
  it('accepts weights that sum to 100', () => {
    expect(weightsSumTo100([50, 30, 20])).toBe(true)
  })
  it('rejects weights that do not sum to 100', () => {
    expect(weightsSumTo100([50, 40])).toBe(false)
  })
  it('rejects an empty list', () => {
    expect(weightsSumTo100([])).toBe(false)
  })
  it('tolerates floating point rounding', () => {
    expect(weightsSumTo100([33.34, 33.33, 33.33])).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/domain/validate-weights.test.ts
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the validation function**

```ts
// src/lib/domain/validate-weights.ts
export function weightsSumTo100(weights: number[]): boolean {
  const total = weights.reduce((sum, w) => sum + w, 0)
  return Math.abs(total - 100) < 0.02
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/domain/validate-weights.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Client detail page (lists tests)**

Create `src/app/dashboard/clients/[clientSlug]/page.tsx`:

```tsx
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'

export default async function ClientPage({ params }: { params: Promise<{ clientSlug: string }> }) {
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
    .select('id, name, slug, status')
    .eq('client_id', client.id)
    .order('name')

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">{client.name}</h1>
      <ul className="space-y-2">
        {tests?.map((test) => (
          <li key={test.id}>
            <a href={`/dashboard/clients/${client.slug}/tests/${test.slug}`} className="text-blue-600 underline">
              {test.name} ({test.status})
            </a>
          </li>
        ))}
      </ul>
      <a href={`/dashboard/clients/${client.slug}/tests/new`} className="mt-4 inline-block text-sm text-blue-600 underline">
        + Novo teste
      </a>
    </div>
  )
}
```

- [ ] **Step 6: Server action to create a test with variants**

Create `src/app/dashboard/clients/[clientSlug]/actions.ts`:

```ts
'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const variantSchema = z.object({
  name: z.string().min(1),
  weight_pct: z.coerce.number().gt(0).lte(100),
  destination_url: z.string().url(),
  thank_you_url: z.string().url().optional().or(z.literal('')),
})

const createTestSchema = z.object({
  client_id: z.string().uuid(),
  client_slug: z.string(),
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  fallback_url: z.string().url().optional().or(z.literal('')),
  conversion_method: z.enum(['hubla_webhook', 'thank_you_page']),
  variants: z.array(variantSchema).min(2),
})

export async function createTest(input: z.infer<typeof createTestSchema>) {
  const parsed = createTestSchema.parse(input)
  const supabase = await createServerSupabaseClient()

  const { error } = await supabase.rpc('create_test_with_variants', {
    p_client_id: parsed.client_id,
    p_name: parsed.name,
    p_slug: parsed.slug,
    p_fallback_url: parsed.fallback_url || null,
    p_conversion_method: parsed.conversion_method,
    p_variants: parsed.variants.map((v) => ({
      name: v.name,
      weight_pct: v.weight_pct,
      destination_url: v.destination_url,
      thank_you_url: v.thank_you_url || null,
    })),
  })
  if (error) throw error

  redirect(`/dashboard/clients/${parsed.client_slug}`)
}
```

- [ ] **Step 7: New test form (client component, since variant rows are dynamic)**

Create `src/app/dashboard/clients/[clientSlug]/tests/new/page.tsx`:

```tsx
'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { createTest } from '../../actions'
import { weightsSumTo100 } from '@/lib/domain/validate-weights'
import { createBrowserSupabaseClient } from '@/lib/supabase/browser'

interface VariantForm {
  name: string
  weight_pct: string
  destination_url: string
  thank_you_url: string
}

export default function NewTestPage() {
  const params = useParams<{ clientSlug: string }>()
  const [clientId, setClientId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [fallbackUrl, setFallbackUrl] = useState('')
  const [conversionMethod, setConversionMethod] = useState<'hubla_webhook' | 'thank_you_page'>('hubla_webhook')
  const [variants, setVariants] = useState<VariantForm[]>([
    { name: 'A', weight_pct: '50', destination_url: '', thank_you_url: '' },
    { name: 'B', weight_pct: '50', destination_url: '', thank_you_url: '' },
  ])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createBrowserSupabaseClient()
    supabase
      .from('clients')
      .select('id')
      .eq('slug', params.clientSlug)
      .single()
      .then(({ data }) => setClientId(data?.id ?? null))
  }, [params.clientSlug])

  const weightsValid = weightsSumTo100(variants.map((v) => Number(v.weight_pct)))

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!clientId) return
    if (!weightsValid) {
      setError('Os pesos das variantes devem somar 100%')
      return
    }
    try {
      await createTest({
        client_id: clientId,
        client_slug: params.clientSlug,
        name,
        slug,
        fallback_url: fallbackUrl,
        conversion_method: conversionMethod,
        variants: variants.map((v) => ({
          name: v.name,
          weight_pct: Number(v.weight_pct),
          destination_url: v.destination_url,
          thank_you_url: v.thank_you_url,
        })),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar teste')
    }
  }

  function updateVariant(index: number, field: keyof VariantForm, value: string) {
    setVariants((prev) => prev.map((v, i) => (i === index ? { ...v, [field]: value } : v)))
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
      <h1 className="text-lg font-semibold">Novo teste</h1>
      <input required placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border px-3 py-2" />
      <input required placeholder="Slug (ex: oferta-x)" value={slug} onChange={(e) => setSlug(e.target.value)} className="w-full rounded border px-3 py-2" />
      <input placeholder="URL de fallback (opcional)" value={fallbackUrl} onChange={(e) => setFallbackUrl(e.target.value)} className="w-full rounded border px-3 py-2" />
      <select value={conversionMethod} onChange={(e) => setConversionMethod(e.target.value as typeof conversionMethod)} className="w-full rounded border px-3 py-2">
        <option value="hubla_webhook">Venda (webhook Hubla)</option>
        <option value="thank_you_page">Captura (thank-you page)</option>
      </select>

      {variants.map((variant, index) => (
        <fieldset key={index} className="space-y-2 rounded border p-3">
          <legend className="text-sm font-medium">Variante {variant.name}</legend>
          <input placeholder="Peso %" value={variant.weight_pct} onChange={(e) => updateVariant(index, 'weight_pct', e.target.value)} className="w-full rounded border px-3 py-2" />
          <input placeholder="URL de destino" value={variant.destination_url} onChange={(e) => updateVariant(index, 'destination_url', e.target.value)} className="w-full rounded border px-3 py-2" />
          {conversionMethod === 'thank_you_page' && (
            <input placeholder="URL de thank-you" value={variant.thank_you_url} onChange={(e) => updateVariant(index, 'thank_you_url', e.target.value)} className="w-full rounded border px-3 py-2" />
          )}
        </fieldset>
      ))}

      <button
        type="button"
        onClick={() => setVariants((prev) => [...prev, { name: String.fromCharCode(65 + prev.length), weight_pct: '0', destination_url: '', thank_you_url: '' }])}
        className="text-sm text-blue-600 underline"
      >
        + Adicionar variante
      </button>

      {!weightsValid && <p className="text-sm text-amber-600">Os pesos devem somar 100%.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <button type="submit" className="rounded bg-black px-3 py-2 text-white">
        Criar teste
      </button>
    </form>
  )
}
```

- [ ] **Step 8: Manual verification**

```bash
npm run dev
```
Create a test with two variants summing to 100%, confirm redirect to the client page and the new test listed; attempt weights that don't sum to 100% and confirm the inline warning blocks submission.

- [ ] **Step 9: Commit**

```bash
git add src/lib/domain/validate-weights.ts src/lib/domain/validate-weights.test.ts "src/app/dashboard/clients/[clientSlug]"
git commit -m "feat: add test and variant creation flow"
```

---

### Task 14: Dashboard — report view

**Files:**
- Create: `src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/page.tsx`

**Interfaces:**
- Consumes: `get_test_report` RPC (Task 2).

- [ ] **Step 1: Report page**

Create `src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/page.tsx`:

```tsx
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'

export default async function TestReportPage({
  params,
}: {
  params: Promise<{ clientSlug: string; testSlug: string }>
}) {
  const { testSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: test } = await supabase
    .from('tests')
    .select('id, name, slug, status')
    .eq('slug', testSlug)
    .maybeSingle()

  if (!test) notFound()

  const { data: report } = await supabase.rpc('get_test_report', { p_test_id: test.id })
  const redirectUrl = `https://${process.env.NEXT_PUBLIC_REDIRECT_DOMAIN}/r/${test.slug}`

  const rows = (report ?? []).map((row) => ({
    ...row,
    rate: row.visits > 0 ? ((row.conversions / row.visits) * 100).toFixed(1) : '0.0',
  }))
  const leaderId = rows.reduce(
    (best, row) => (Number(row.rate) > Number(best?.rate ?? -1) ? row : best),
    rows[0]
  )?.variant_id

  return (
    <div>
      <h1 className="mb-2 text-lg font-semibold">{test.name}</h1>
      <p className="mb-4 text-sm text-gray-600">
        Link: <code className="rounded bg-gray-100 px-1">{redirectUrl}</code>
      </p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">Variante</th>
            <th>Peso</th>
            <th>Visitas</th>
            <th>Conversões</th>
            <th>Taxa</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.variant_id} className={row.variant_id === leaderId ? 'bg-green-50' : ''}>
              <td className="py-2">{row.variant_name}</td>
              <td>{row.weight_pct}%</td>
              <td>{row.visits}</td>
              <td>{row.conversions}</td>
              <td>{row.rate}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Manual verification**

```bash
npm run dev
```
Hit `/r/<slug>` a few times from different "visitors" (clear cookies between hits), then open the test's report page and confirm visit counts per variant appear and the redirect link is shown.

- [ ] **Step 3: Commit**

```bash
git add "src/app/dashboard/clients/[clientSlug]/tests/[testSlug]"
git commit -m "feat: add per-variant conversion report"
```

---

### Task 15: Deployment and integration checklist

**Files:**
- Create: `README.md`

**Interfaces:** none — this task is operational, not code.

- [ ] **Step 1: Write the README with setup and embed instructions**

Create `README.md`:

```markdown
# AB Test Tool

## Deploy

1. Create a Supabase project (production), run `npx supabase link` and `npx supabase db push` to apply migrations.
2. Create a Vercel project pointed at this repo. Set env vars: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `HUBLA_WEBHOOK_TOKEN`, `COOKIE_MAX_AGE_DAYS`.
3. In Vercel, add the custom domain used for redirects (e.g. `ir.seudominio.com`) and create the CNAME
   record your DNS provider requests.
4. In Hubla's webhook settings, register `https://ir.seudominio.com/api/webhooks/hubla` for the
   "Pagamento da fatura realizado" (invoice.payment_succeeded) event, and set the webhook token to the
   same value as `HUBLA_WEBHOOK_TOKEN`.
5. Create your first login user via Supabase Studio (Authentication > Users > Add user).

## Thank-you page pixel (capture tests)

On any thank-you page whose test uses `conversion_method: thank_you_page`, add this snippet. It reads the
tracking id from the page's own URL query string — your funnel/page-builder must forward the original
query parameters through to this page (most tools have a "pass URL parameters on redirect" toggle):

​```html
<script>
  (function () {
    var params = new URLSearchParams(window.location.search);
    var tid = params.get('utm_content') || params.get('tid');
    if (tid) {
      var img = new Image();
      img.src = 'https://ir.seudominio.com/ty/PLACEHOLDER_TEST_SLUG?tid=' + encodeURIComponent(tid);
    }
  })();
</script>
​```

Replace `PLACEHOLDER_TEST_SLUG` with the test's slug shown on its report page.
```

- [ ] **Step 2: Manual end-to-end verification**

- Deploy to Vercel following the README.
- Create a real test in the dashboard with two variants.
- Hit the `ir.seudominio.com/r/<slug>` link from a real browser, confirm it lands on the correct variant and the destination URL carries `utm_content`.
- For a Hubla-backed test: complete a real (or Hubla sandbox) purchase through that link and confirm the report shows one conversion.
- For a thank-you-page-backed test: confirm the pixel fires (Network tab shows a request to `/ty/<slug>`) and the report shows one conversion.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add deployment and thank-you pixel integration instructions"
```

---

### Task 16: Domain — bot/crawler filtering on the redirect route

**Files:**
- Create: `src/lib/domain/bot-filter.ts`
- Test: `src/lib/domain/bot-filter.test.ts`
- Modify: `src/app/r/[slug]/route.ts` (Task 6), `src/app/r/[slug]/route.test.ts` (Task 6)

**Interfaces:**
- Produces: `isKnownBot(userAgent: string | null): boolean` — consumed by the modified `/r/[slug]`
  route handler.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/domain/bot-filter.test.ts
import { describe, it, expect } from 'vitest'
import { isKnownBot } from './bot-filter'

describe('isKnownBot', () => {
  it('flags common search/social crawlers', () => {
    expect(isKnownBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true)
    expect(isKnownBot('facebookexternalhit/1.1')).toBe(true)
    expect(isKnownBot('Mozilla/5.0 (compatible; bingbot/2.0)')).toBe(true)
    expect(isKnownBot('Slackbot-LinkExpanding 1.0')).toBe(true)
  })

  it('flags common scripting/monitoring clients', () => {
    expect(isKnownBot('curl/8.4.0')).toBe(true)
    expect(isKnownBot('python-requests/2.31.0')).toBe(true)
    expect(isKnownBot('Mozilla/5.0 (Windows NT 10.0) HeadlessChrome/120.0.0.0')).toBe(true)
    expect(isKnownBot('Pingdom.com_bot_version_1.4')).toBe(true)
    expect(isKnownBot('UptimeRobot/2.0')).toBe(true)
  })

  it('does not flag a real browser', () => {
    expect(
      isKnownBot(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
      )
    ).toBe(false)
  })

  it('treats a missing user-agent as not a known bot', () => {
    expect(isKnownBot(null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/domain/bot-filter.test.ts
```
Expected: FAIL — `bot-filter.ts` does not exist.

- [ ] **Step 3: Implement**

```ts
// src/lib/domain/bot-filter.ts
const BOT_UA_PATTERNS = [
  'bot',
  'crawler',
  'spider',
  'slurp',
  'facebookexternalhit',
  'bingpreview',
  'curl/',
  'python-requests',
  'wget/',
  'headlesschrome',
  'pingdom',
  'uptimerobot',
]

export function isKnownBot(userAgent: string | null): boolean {
  if (!userAgent) return false
  const ua = userAgent.toLowerCase()
  return BOT_UA_PATTERNS.some((pattern) => ua.includes(pattern))
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/domain/bot-filter.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Add a route-level test for bot traffic**

Add to `src/app/r/[slug]/route.test.ts` (inside the existing `describe('GET /r/[slug]')` block, same
mocks already declared at the top of that file):

```ts
  it('redirects a known bot without recording a click event or setting cookies', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      id: 'test-1',
      slug: 'oferta-x',
      status: 'active',
      fallback_url: null,
      variants: [{ id: 'v1', name: 'A', weight_pct: 100, destination_url: 'https://example.com/page' }],
    })
    const request = new NextRequest('https://ir.example.com/r/oferta-x', {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
    })
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location')!)
    expect(location.origin + location.pathname).toBe('https://example.com/page')
    expect(location.searchParams.get('utm_content')).toBeNull()
    expect(insertClickEvent).not.toHaveBeenCalled()
    expect(response.cookies.get('ir_vid')).toBeUndefined()
  })

  it('redirects a known bot to the fallback url when set', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      id: 'test-1',
      slug: 'oferta-x',
      status: 'active',
      fallback_url: 'https://example.com/fallback',
      variants: [{ id: 'v1', name: 'A', weight_pct: 100, destination_url: 'https://example.com/page' }],
    })
    const request = new NextRequest('https://ir.example.com/r/oferta-x', {
      headers: { 'user-agent': 'curl/8.4.0' },
    })
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })
    expect(response.headers.get('location')).toBe('https://example.com/fallback')
    expect(insertClickEvent).not.toHaveBeenCalled()
  })
```

- [ ] **Step 6: Run test to verify it fails**

```bash
npx vitest run "src/app/r/[slug]/route.test.ts"
```
Expected: FAIL — current handler always records a click event and sets cookies.

- [ ] **Step 7: Modify the route handler**

In `src/app/r/[slug]/route.ts`, add the import:

```ts
import { isKnownBot } from '@/lib/domain/bot-filter'
```

Insert this block right after the existing `if (!test || test.status !== 'active' ...)` block and
before the `const cookieHeader = ...` line:

```ts
  if (isKnownBot(request.headers.get('user-agent'))) {
    const destination = test.fallback_url ?? test.variants[0].destination_url
    return NextResponse.redirect(destination, 302)
  }
```

(Bots get a plain redirect: no `click_event`, no `tracking_id` appended, no cookies set.)

- [ ] **Step 8: Run test to verify it passes**

```bash
npx vitest run "src/app/r/[slug]/route.test.ts"
```
Expected: PASS (6 tests).

- [ ] **Step 9: Commit**

```bash
git add src/lib/domain/bot-filter.ts src/lib/domain/bot-filter.test.ts "src/app/r/[slug]"
git commit -m "feat: filter known bots out of redirect tracking"
```

---

### Task 17: Domain — Bayesian confidence indicator

**Files:**
- Create: `src/lib/domain/significance.ts`
- Test: `src/lib/domain/significance.test.ts`
- Modify: `src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/page.tsx` (Task 14)

**Interfaces:**
- Produces: `probabilityToBeatControl(control: { visits: number; conversions: number }, variant: { visits: number; conversions: number }, rand?: () => number, samples?: number): number` — returns an estimate in `[0, 1]` of the probability the variant's true conversion rate exceeds the control's, via Monte Carlo sampling from `Beta(conversions + 1, visits - conversions + 1)` (Beta(1,1) uniform prior). Consumed by the report page (Task 14).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/domain/significance.test.ts
import { describe, it, expect } from 'vitest'
import { probabilityToBeatControl } from './significance'

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('probabilityToBeatControl', () => {
  it('returns close to 0.5 when control and variant perform identically', () => {
    const rand = mulberry32(1)
    const p = probabilityToBeatControl({ visits: 500, conversions: 50 }, { visits: 500, conversions: 50 }, rand, 5000)
    expect(p).toBeGreaterThan(0.3)
    expect(p).toBeLessThan(0.7)
  })

  it('returns high confidence when the variant clearly outperforms', () => {
    const rand = mulberry32(2)
    const p = probabilityToBeatControl({ visits: 1000, conversions: 50 }, { visits: 1000, conversions: 150 }, rand, 5000)
    expect(p).toBeGreaterThan(0.9)
  })

  it('returns low confidence when the variant clearly underperforms', () => {
    const rand = mulberry32(3)
    const p = probabilityToBeatControl({ visits: 1000, conversions: 150 }, { visits: 1000, conversions: 50 }, rand, 5000)
    expect(p).toBeLessThan(0.1)
  })

  it('handles zero-visit variants without throwing', () => {
    const rand = mulberry32(4)
    const p = probabilityToBeatControl({ visits: 0, conversions: 0 }, { visits: 0, conversions: 0 }, rand, 1000)
    expect(p).toBeGreaterThanOrEqual(0)
    expect(p).toBeLessThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/domain/significance.test.ts
```
Expected: FAIL — `significance.ts` does not exist.

- [ ] **Step 3: Implement**

```ts
// src/lib/domain/significance.ts
function sampleGamma(shape: number, rand: () => number, normal: () => number): number {
  if (shape < 1) {
    const u = rand()
    return sampleGamma(shape + 1, rand, normal) * Math.pow(u, 1 / shape)
  }
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x: number
    let v: number
    do {
      x = normal()
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = rand()
    if (u < 1 - 0.0331 * x * x * x * x) return d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

function makeSeededNormal(rand: () => number): () => number {
  return () => {
    const u1 = Math.max(rand(), 1e-12)
    const u2 = rand()
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  }
}

function sampleBeta(alpha: number, beta: number, rand: () => number, normal: () => number): number {
  const x = sampleGamma(alpha, rand, normal)
  const y = sampleGamma(beta, rand, normal)
  return x / (x + y)
}

export function probabilityToBeatControl(
  control: { visits: number; conversions: number },
  variant: { visits: number; conversions: number },
  rand: () => number = Math.random,
  samples = 10000
): number {
  const normal = makeSeededNormal(rand)
  let wins = 0
  for (let i = 0; i < samples; i++) {
    const controlRate = sampleBeta(control.conversions + 1, control.visits - control.conversions + 1, rand, normal)
    const variantRate = sampleBeta(variant.conversions + 1, variant.visits - variant.conversions + 1, rand, normal)
    if (variantRate > controlRate) wins++
  }
  return wins / samples
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/domain/significance.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Show the confidence badge on the report page, and fix the all-zero-visits leader highlight**

In `src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/page.tsx`, add the import:

```ts
import { probabilityToBeatControl } from '@/lib/domain/significance'
```

Replace this exact block (the `rows`/`leaderId` computation, right after the `report` RPC call):

```tsx
  const rows = ((report as ReportRow[]) ?? []).map((row) => ({
    ...row,
    rate: row.visits > 0 ? ((row.conversions / row.visits) * 100).toFixed(1) : '0.0',
  }))
  const leaderId = rows.reduce(
    (best: (typeof rows)[number] | undefined, row: (typeof rows)[number]) => (Number(row.rate) > Number(best?.rate ?? -1) ? row : best),
    rows[0]
  )?.variant_id
```

with:

```tsx
  const baseRows = ((report as ReportRow[]) ?? []).map((row) => ({
    ...row,
    rate: row.visits > 0 ? ((row.conversions / row.visits) * 100).toFixed(1) : '0.0',
  }))
  const control = baseRows[0]
  const rows = baseRows.map((row) => ({
    ...row,
    confidencePct:
      control && row.variant_id !== control.variant_id
        ? Math.round(
            probabilityToBeatControl(
              { visits: control.visits, conversions: control.conversions },
              { visits: row.visits, conversions: row.conversions }
            ) * 100
          )
        : null,
  }))
  const totalVisits = rows.reduce((sum, row) => sum + row.visits, 0)
  const leaderId =
    totalVisits > 0
      ? rows.reduce(
          (best: (typeof rows)[number] | undefined, row: (typeof rows)[number]) =>
            Number(row.rate) > Number(best?.rate ?? -1) ? row : best,
          rows[0]
        )?.variant_id
      : undefined
```

(The `totalVisits > 0` guard fixes a known minor issue from the final review: a brand-new test
with zero visits everywhere no longer highlights the first variant in green.)

Add a "Confiança" column to the table (header and body):

```tsx
            <th>Confiança</th>
```

```tsx
              <td>
                {row.confidencePct === null
                  ? 'controle'
                  : `${row.confidencePct}% de ser melhor que o controle`}
              </td>
```

(`control` is the first row returned by `get_test_report`, which orders by `v.name` — this reads
as "controle = primeira variante em ordem alfabética".)

- [ ] **Step 6: Manual verification**

```bash
npm run dev
```
Open a test's report page with at least two variants that have visits; confirm the "Confiança"
column shows "controle" on the first row and a percentage on the others. Open a brand-new test
with zero visits and confirm no row is highlighted green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/domain/significance.ts src/lib/domain/significance.test.ts "src/app/dashboard/clients/[clientSlug]/tests/[testSlug]"
git commit -m "feat: add Bayesian confidence indicator to the report"
```

---

### Task 18: Report — conversion breakdown by traffic source

**Files:**
- Create: `supabase/migrations/0003_report_by_source.sql`
- Modify: `src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/page.tsx` (Task 14 / Task 17)
- Test: `supabase/tests/report-by-source.integration.test.ts`

**Interfaces:**
- Consumes: `variants`, `tests`, `click_events`, `conversions` tables (Task 2).
- Produces RPC: `get_test_report_by_source(p_test_id uuid) returns table(variant_id uuid, variant_name text, utm_source text, visits bigint, conversions bigint)` — consumed by the report page.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0003_report_by_source.sql`:

```sql
create or replace function get_test_report_by_source(p_test_id uuid)
returns table (
  variant_id uuid,
  variant_name text,
  utm_source text,
  visits bigint,
  conversions bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and c.owner_id = auth.uid()
  ) then
    raise exception 'not found or access denied';
  end if;

  return query
  select
    v.id,
    v.name,
    coalesce(nullif(ce.source_utms->>'utm_source', ''), '(direto)') as utm_source,
    count(distinct ce.id)::bigint,
    count(distinct cv.id)::bigint
  from variants v
  join tests t on t.id = v.test_id
  join click_events ce on ce.variant_id = v.id
  left join conversions cv on cv.click_event_id = ce.id and cv.source = t.conversion_method
  where v.test_id = p_test_id
  group by v.id, v.name, coalesce(nullif(ce.source_utms->>'utm_source', ''), '(direto)')
  order by v.name, utm_source;
end;
$$;

revoke all on function get_test_report_by_source(uuid) from public;
grant execute on function get_test_report_by_source(uuid) to authenticated;
```

(The `cv.source = t.conversion_method` filter mirrors the fix already applied to `get_test_report`
in `0002_fix_report_conversion_method.sql` — without it, a click holding conversions from more
than one source would double-count here too.)

- [ ] **Step 2: Apply the migration locally**

```bash
npx supabase db reset
```
Expected: applies `0001_init.sql`, `0002_fix_report_conversion_method.sql`, and
`0003_report_by_source.sql` with no errors.

- [ ] **Step 3: Write an integration test**

Create `supabase/tests/report-by-source.integration.test.ts` (same setup pattern as
`supabase/tests/schema.integration.test.ts` from Task 2 — a fresh user/client/test per test case):

```ts
import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const admin = createClient(URL, SERVICE_ROLE_KEY)

async function createSignedInOwner() {
  const email = `source-report-${Date.now()}@example.com`
  const { data } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  const asOwner = createClient(URL, ANON_KEY)
  await asOwner.auth.signInWithPassword({ email, password: 'password123' })
  return { userId: data.user!.id, asOwner }
}

describe('get_test_report_by_source', () => {
  it('groups visits and conversions by utm_source, defaulting missing ones to (direto)', async () => {
    const { userId, asOwner } = await createSignedInOwner()
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: userId, name: 'Source Test', slug: `source-test-${Date.now()}` })
      .select()
      .single()

    const { data: test } = await admin
      .from('tests')
      .insert({
        client_id: client!.id,
        name: 'Teste Origem',
        slug: `teste-origem-${Date.now()}`,
        conversion_method: 'thank_you_page',
      })
      .select()
      .single()
    const { data: variant } = await admin
      .from('variants')
      .insert({ test_id: test!.id, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a' })
      .select()
      .single()

    const { data: metaClick } = await admin
      .from('click_events')
      .insert({
        test_id: test!.id,
        variant_id: variant!.id,
        visitor_id: 'v1',
        tracking_id: crypto.randomUUID(),
        source_utms: { utm_source: 'meta' },
      })
      .select()
      .single()
    await admin.from('conversions').insert({ click_event_id: metaClick!.id, source: 'thank_you_page' })

    await admin.from('click_events').insert({
      test_id: test!.id,
      variant_id: variant!.id,
      visitor_id: 'v2',
      tracking_id: crypto.randomUUID(),
      source_utms: {},
    })

    const { data: report, error } = await asOwner.rpc('get_test_report_by_source', { p_test_id: test!.id })
    expect(error).toBeNull()
    const meta = report!.find((r: { utm_source: string }) => r.utm_source === 'meta')
    const direto = report!.find((r: { utm_source: string }) => r.utm_source === '(direto)')
    expect(meta).toMatchObject({ visits: 1, conversions: 1 })
    expect(direto).toMatchObject({ visits: 1, conversions: 0 })
  })
})
```

(Fixtures are seeded via direct service-role table inserts, not the `create_test_with_variants`
RPC, for the same reason established in Tasks 5/8: that RPC requires an authenticated user's
`auth.uid()`, which a service-role client doesn't have.)

- [ ] **Step 4: Run the integration test**

```bash
npx vitest run supabase/tests/report-by-source.integration.test.ts
```
Expected: PASS.

- [ ] **Step 5: Add the source breakdown to the report page**

In `src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/page.tsx`, add a second RPC call next
to the existing `get_test_report` call:

```ts
  const { data: sourceReport } = await supabase.rpc('get_test_report_by_source', { p_test_id: test.id })
```

Render it as a second table below the existing one:

```tsx
      <h2 className="mb-2 mt-8 text-lg font-semibold">Por origem (UTM)</h2>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">Variante</th>
            <th>Origem</th>
            <th>Visitas</th>
            <th>Conversões</th>
            <th>Taxa</th>
          </tr>
        </thead>
        <tbody>
          {(sourceReport ?? []).map((row) => (
            <tr key={`${row.variant_id}-${row.utm_source}`}>
              <td className="py-2">{row.variant_name}</td>
              <td>{row.utm_source}</td>
              <td>{row.visits}</td>
              <td>{row.conversions}</td>
              <td>{row.visits > 0 ? ((row.conversions / row.visits) * 100).toFixed(1) : '0.0'}%</td>
            </tr>
          ))}
        </tbody>
      </table>
```

- [ ] **Step 6: Manual verification**

```bash
npm run dev
```
Hit `/r/<slug>?utm_source=meta` and `/r/<slug>` (no UTM) a few times, then open the report page and
confirm the second table shows rows for `meta` and `(direto)`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0003_report_by_source.sql supabase/tests/report-by-source.integration.test.ts "src/app/dashboard/clients/[clientSlug]/tests/[testSlug]"
git commit -m "feat: add conversion report breakdown by traffic source"
```

---

### Task 19: Dashboard — usage awareness widget

**Files:**
- Create: `supabase/migrations/0004_usage_stats.sql`
- Modify: `src/app/dashboard/page.tsx` (Task 11)
- Test: `supabase/tests/usage-stats.integration.test.ts`

**Interfaces:**
- Produces RPC: `get_usage_stats() returns table(total_clients bigint, total_tests bigint, total_click_events bigint)` — consumed by the dashboard home page.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0004_usage_stats.sql`:

```sql
create or replace function get_usage_stats()
returns table (
  total_clients bigint,
  total_tests bigint,
  total_click_events bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    (select count(*) from clients where owner_id = auth.uid())::bigint,
    (select count(*) from tests t join clients c on c.id = t.client_id where c.owner_id = auth.uid())::bigint,
    (select count(*)
       from click_events ce
       join tests t on t.id = ce.test_id
       join clients c on c.id = t.client_id
       where c.owner_id = auth.uid())::bigint;
end;
$$;

revoke all on function get_usage_stats() from public;
grant execute on function get_usage_stats() to authenticated;
```

- [ ] **Step 2: Apply the migration locally**

```bash
npx supabase db reset
```
Expected: applies all four migrations with no errors.

- [ ] **Step 3: Write an integration test**

Create `supabase/tests/usage-stats.integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const admin = createClient(URL, SERVICE_ROLE_KEY)

describe('get_usage_stats', () => {
  it('counts only rows owned by the calling user', async () => {
    const email = `usage-stats-${Date.now()}@example.com`
    const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
    const asOwner = createClient(URL, ANON_KEY)
    await asOwner.auth.signInWithPassword({ email, password: 'password123' })

    await admin.from('clients').insert({ owner_id: user!.user.id, name: 'Usage Test', slug: `usage-${Date.now()}` })

    const { data, error } = await asOwner.rpc('get_usage_stats')
    expect(error).toBeNull()
    expect(data![0].total_clients).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 4: Run the integration test**

```bash
npx vitest run supabase/tests/usage-stats.integration.test.ts
```
Expected: PASS.

- [ ] **Step 5: Show the widget on the dashboard home page**

In `src/app/dashboard/page.tsx`, add the RPC call next to the existing `clients` query:

```ts
  const { data: usage } = await supabase.rpc('get_usage_stats').single()
```

Render it above the client list:

```tsx
      {usage && (
        <p className="mb-4 text-xs text-gray-500">
          {usage.total_clients} clientes · {usage.total_tests} testes · {usage.total_click_events} cliques
          registrados (Supabase free tier: 500MB de banco — fique de olho se isso crescer muito rápido)
        </p>
      )}
```

- [ ] **Step 6: Manual verification**

```bash
npm run dev
```
Open `/dashboard` and confirm the counts line appears above the client list and matches what's in
the database.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0004_usage_stats.sql supabase/tests/usage-stats.integration.test.ts src/app/dashboard/page.tsx
git commit -m "feat: add usage awareness widget to dashboard home"
```

---

### Task 20: Dashboard — pause/activate a test

**Files:**
- Create: `src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/actions.ts`
- Modify: `src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/page.tsx` (Task 14 / Task 17 / Task 18)

**Interfaces:**
- Produces: server action `toggleTestStatus(input: { test_id: string; next_status: 'active' | 'paused'; client_slug: string; test_slug: string })` — bound at render time from the report page.

- [ ] **Step 1: Server action**

Create `src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/actions.ts`:

```ts
'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const toggleSchema = z.object({
  test_id: z.string().uuid(),
  next_status: z.enum(['active', 'paused']),
  client_slug: z.string(),
  test_slug: z.string(),
})

export async function toggleTestStatus(input: z.infer<typeof toggleSchema>) {
  const parsed = toggleSchema.parse(input)
  const supabase = await createServerSupabaseClient()

  const { error } = await supabase.from('tests').update({ status: parsed.next_status }).eq('id', parsed.test_id)
  if (error) throw error

  revalidatePath(`/dashboard/clients/${parsed.client_slug}/tests/${parsed.test_slug}`)
}
```

(No extra ownership check needed: `tests_via_client_owner` is a `FOR ALL` RLS policy, so this
`UPDATE` is already scoped to tests the authenticated user's clients own — a mismatched `test_id`
simply matches zero rows, same protection pattern already approved for `createClient`/`createTest`
in Tasks 12–13.)

- [ ] **Step 2: Wire the toggle into the report page**

In `src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/page.tsx`:

Add the import:

```ts
import { toggleTestStatus } from './actions'
```

Change the params destructuring to also capture `clientSlug` (currently only `testSlug` is used):

```tsx
  const { clientSlug, testSlug } = await params
```

The existing `tests` select already includes `status` (`'id, name, slug, status'`) — no change
needed to that query.

Add this block right after the `<h1>` showing `test.name`:

```tsx
      <p className="mb-2 text-sm text-gray-600">
        Status: <strong>{test.status === 'active' ? 'ativo' : 'pausado'}</strong>
      </p>
      <form
        action={toggleTestStatus.bind(null, {
          test_id: test.id,
          next_status: test.status === 'active' ? 'paused' : 'active',
          client_slug: clientSlug,
          test_slug: test.slug,
        })}
        className="mb-4"
      >
        <button type="submit" className="rounded border px-3 py-1 text-sm">
          {test.status === 'active' ? 'Pausar teste' : 'Ativar teste'}
        </button>
      </form>
```

- [ ] **Step 3: Manual verification**

```bash
npm run dev
```
Open a test's report page, click "Pausar teste", confirm the status label and button flip to
"pausado" / "Ativar teste" and the page re-renders with the new state. Confirm `/r/<slug>` for that
test now falls through to the paused/fallback branch from Task 6.

- [ ] **Step 4: Commit**

```bash
git add "src/app/dashboard/clients/[clientSlug]/tests/[testSlug]"
git commit -m "feat: add pause/activate toggle for a test"
```

---

### Task 21: Dashboard — auto-generated thank-you pixel snippet

**Files:**
- Modify: `src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/page.tsx` (Task 14 / Task 17 / Task 18 / Task 20)

**Interfaces:** none new exported — reads the already-stored `variants.thank_you_url` column and
renders a ready-to-paste snippet using `NEXT_PUBLIC_REDIRECT_DOMAIN` and the test's own slug.

- [ ] **Step 1: Fetch variants with their thank-you URL, only for thank-you-page tests**

Add `conversion_method` to the existing `tests` select:

```tsx
    .select('id, name, slug, status, conversion_method')
```

Add this query right after the existing `test` lookup (before the `get_test_report` RPC call):

```ts
  const { data: pixelVariants } =
    test.conversion_method === 'thank_you_page'
      ? await supabase.from('variants').select('id, name, thank_you_url').eq('test_id', test.id)
      : { data: null }
```

- [ ] **Step 2: Render the snippet per variant**

Add this block at the end of the page, after the existing tables:

```tsx
      {pixelVariants && pixelVariants.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-2 text-lg font-semibold">Pixel de conversão (thank-you page)</h2>
          {pixelVariants.map((variant) => (
            <div key={variant.id} className="mb-4 rounded border p-3">
              <p className="mb-2 text-sm text-gray-600">
                Variante {variant.name}
                {variant.thank_you_url ? (
                  <>
                    {' '}
                    — cole na página:{' '}
                    <a className="text-blue-600 underline" href={variant.thank_you_url}>
                      {variant.thank_you_url}
                    </a>
                  </>
                ) : (
                  <> — nenhuma URL de thank-you configurada para esta variante</>
                )}
              </p>
              <pre className="overflow-x-auto rounded bg-gray-100 p-2 text-xs">
                <code>{`<script>
  (function () {
    var params = new URLSearchParams(window.location.search);
    var tid = params.get('utm_content') || params.get('tid');
    if (tid) {
      var img = new Image();
      img.src = 'https://${process.env.NEXT_PUBLIC_REDIRECT_DOMAIN}/ty/${test.slug}?tid=' + encodeURIComponent(tid);
    }
  })();
</script>`}</code>
              </pre>
            </div>
          ))}
        </div>
      )}
```

(The snippet is identical in mechanism to the README's manual version — same pixel, same `/ty/[slug]`
endpoint from Task 10 — just pre-filled with this test's real domain and slug, so there is nothing
left to substitute by hand.)

- [ ] **Step 3: Manual verification**

```bash
npm run dev
```
Open the report page of a `thank_you_page`-conversion test with at least one variant that has a
`thank_you_url` set; confirm the snippet section appears with the correct domain/slug baked in and
the configured URL shown as a link. Open a `hubla_webhook`-conversion test and confirm the section
does not appear at all.

- [ ] **Step 4: Commit**

```bash
git add "src/app/dashboard/clients/[clientSlug]/tests/[testSlug]"
git commit -m "feat: auto-generate thank-you pixel snippet from stored variant data"
```

---

## Visual design addendum (2026-08-26)

> Adds Tasks 22–26, per
> [docs/superpowers/specs/2026-08-26-ab-test-tool-visual-design.md](../specs/2026-08-26-ab-test-tool-visual-design.md).
> Do these now, on top of the fully implemented Tasks 1–21. Every task below is a **restyle**:
> it must preserve 100% of the existing data-fetching, validation, and business logic in the
> touched files (including the pause/activate toggle from Task 20, the auto-generated pixel
> snippet with its URL-safety check from Task 21, and the three-way confidence label from
> Task 17's bugfix) and change only markup/classNames/structure. A mockup of the approved
> direction is at https://claude.ai/code/artifact/8b156469-0fe3-42ed-9d18-f80b7604b485
> (source: `design/*.dc.html` — copy those files from the `main` branch of this repo into this
> worktree if you want to view them locally; they are not required to implement this addendum,
> the code below is self-contained).

### Task 22: Design tokens — dark theme colors and fonts

**Files:**
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: CSS custom properties (`--surface`, `--surface-2`, `--border-token`, `--text-dim`,
  `--violet`, `--blue`, `--teal`, `--amber`, `--rose`) plus a permanently-dark `--background`/
  `--foreground`, consumed via Tailwind arbitrary-value classes (e.g. `bg-[#141829]`,
  `font-['Space_Grotesk']`) by every task below.

- [ ] **Step 1: Replace the full contents of `src/app/globals.css`**

```css
@import "tailwindcss";
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  --background: #0b0e1a;
  --foreground: #e8eaf2;
  --surface: #141829;
  --surface-2: #1b2036;
  --border-token: rgba(255, 255, 255, 0.08);
  --text-dim: #8a90a6;
  --violet: #7c6ff0;
  --blue: #4f8ef7;
  --teal: #2dd4a8;
  --amber: #f5b94d;
  --rose: #f76c6c;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: 'Inter', system-ui, sans-serif;
}
```

(This removes the old light/dark `prefers-color-scheme` split — the product is dark-only per
the spec — and drops the unused Geist import reference from `layout.tsx` if present; leave
`layout.tsx`'s font setup alone if it still compiles, this task only touches `globals.css`.)

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
npm run build
```
Expected: both exit 0. Then `npm run dev` and open `/login` — background should be dark navy.

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: add dark theme tokens and font stack"
```

---

### Task 23: Login, dashboard shell, and dashboard home restyle

**Files:**
- Modify: `src/app/login/page.tsx` (unchanged logic — restyle only)
- Modify: `src/app/dashboard/layout.tsx`
- Modify: `src/app/dashboard/page.tsx` (preserve the existing `UsageStats` fetch/display and
  client list — restyle only)
- Create: `src/components/dashboard-shell.tsx`

- [ ] **Step 1: Restyle the login page**

Replace the full contents of `src/app/login/page.tsx` (same `handleSubmit`/state logic as
today, restyled):

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase/browser'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    const supabase = createBrowserSupabaseClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      return
    }
    router.push('/dashboard')
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0B0E1A]">
      <div className="w-[400px] rounded-2xl border border-white/[0.08] bg-[#141829] p-10">
        <h1 className="mb-2 font-['Space_Grotesk'] text-2xl font-semibold text-[#E8EAF2]">Entrar</h1>
        <p className="mb-7 text-sm leading-relaxed text-[#8A90A6]">
          Acesse seus clientes, testes e relatórios de conversão.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-[13px] font-medium text-[#8A90A6]">E-mail</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 rounded-[10px] border border-white/[0.08] bg-[#1B2036] px-3.5 text-sm text-[#E8EAF2] outline-none focus:border-[#7C6FF0]"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-[13px] font-medium text-[#8A90A6]">Senha</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 rounded-[10px] border border-white/[0.08] bg-[#1B2036] px-3.5 text-sm text-[#E8EAF2] outline-none focus:border-[#7C6FF0]"
            />
          </div>
          {error && <p className="text-sm text-[#F76C6C]">{error}</p>}
          <button
            type="submit"
            className="mt-1.5 h-[46px] rounded-[10px] bg-[#7C6FF0] text-sm font-semibold text-[#0B0E1A]"
          >
            Entrar
          </button>
        </form>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Create the dashboard shell (sidebar)**

Create `src/components/dashboard-shell.tsx`:

```tsx
'use client'

import { usePathname } from 'next/navigation'

interface Client {
  id: string
  name: string
  slug: string
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('')
}

export function DashboardShell({
  clients,
  userEmail,
  children,
}: {
  clients: Client[]
  userEmail: string
  children: React.ReactNode
}) {
  const pathname = usePathname()

  return (
    <div className="flex h-screen bg-[#0B0E1A] text-[#E8EAF2]">
      <aside className="flex w-[248px] flex-shrink-0 flex-col border-r border-white/[0.08] bg-[#141829] py-6">
        <div className="mb-6 flex items-center gap-2.5 px-5">
          <span className="font-['Space_Grotesk'] text-[15px] font-semibold">Testes A/B</span>
        </div>

        <div className="mb-2.5 px-5 font-['JetBrains_Mono'] text-[11px] uppercase tracking-widest text-[#8A90A6]">
          Clientes
        </div>

        <nav className="flex flex-col gap-0.5 px-3">
          {clients.map((client) => {
            const active = pathname.startsWith(`/dashboard/clients/${client.slug}`)
            return (
              <a
                key={client.id}
                href={`/dashboard/clients/${client.slug}`}
                className={`flex items-center gap-2.5 rounded-lg px-2 py-2.5 ${active ? 'bg-[#7C6FF0]/[0.14]' : ''}`}
              >
                <span
                  className={`flex h-[26px] w-[26px] items-center justify-center rounded-[7px] font-['Space_Grotesk'] text-xs font-bold ${
                    active ? 'bg-[#7C6FF0] text-[#0B0E1A]' : 'bg-[#1B2036] text-[#8A90A6]'
                  }`}
                >
                  {initials(client.name)}
                </span>
                <span className={`text-[13.5px] ${active ? 'font-semibold' : 'text-[#8A90A6]'}`}>{client.name}</span>
              </a>
            )
          })}
        </nav>

        <div className="px-5 pt-2">
          <a href="/dashboard/clients/new" className="text-[13px] font-medium text-[#7C6FF0] hover:text-[#9C90F5]">
            + Novo cliente
          </a>
        </div>

        <div className="mt-auto border-t border-white/[0.08] px-5 pt-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1B2036] text-xs font-semibold text-[#8A90A6]">
              {userEmail[0]?.toUpperCase() ?? '?'}
            </span>
            <span className="font-['JetBrains_Mono'] text-[11.5px] text-[#8A90A6]">{userEmail}</span>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto">{children}</main>
    </div>
  )
}
```

- [ ] **Step 3: Wire the shell into the dashboard layout**

Replace the full contents of `src/app/dashboard/layout.tsx`:

```tsx
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { DashboardShell } from '@/components/dashboard-shell'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: clients } = await supabase.from('clients').select('id, name, slug').order('name')

  return (
    <DashboardShell clients={clients ?? []} userEmail={user?.email ?? ''}>
      {children}
    </DashboardShell>
  )
}
```

- [ ] **Step 4: Restyle the dashboard home page, preserving the usage widget**

Replace the full contents of `src/app/dashboard/page.tsx` — this keeps the exact same
`UsageStats` fetch and free-tier caveat text that already ships, restyled:

```tsx
import { createServerSupabaseClient } from '@/lib/supabase/server'

interface UsageStats {
  total_clients: number
  total_tests: number
  total_click_events: number
}

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient()
  const { data: clients } = await supabase.from('clients').select('id, name, slug').order('name')
  const { data: usage } = (await supabase.rpc('get_usage_stats').single()) as { data: UsageStats | null }

  return (
    <div className="p-8">
      <h1 className="mb-1 font-['Space_Grotesk'] text-xl font-semibold">Clientes</h1>
      <p className="mb-3 text-sm text-[#8A90A6]">Escolha um cliente na barra lateral para ver os testes.</p>
      {usage && (
        <p className="mb-6 font-['JetBrains_Mono'] text-xs text-[#8A90A6]">
          {usage.total_clients} clientes · {usage.total_tests} testes · {usage.total_click_events} cliques
          registrados (Supabase free tier: 500MB de banco — fique de olho se isso crescer muito rápido)
        </p>
      )}
      {(!clients || clients.length === 0) && (
        <a href="/dashboard/clients/new" className="text-sm font-medium text-[#7C6FF0] hover:text-[#9C90F5]">
          + Criar seu primeiro cliente
        </a>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Manual verification**

```bash
npm run dev
```
`/login` renders the dark card. Logging in lands on `/dashboard` with a dark sidebar; the usage
line still shows real counts; navigating into a client highlights it in the sidebar.

- [ ] **Step 6: Commit**

```bash
git add src/app/login/page.tsx src/app/dashboard/layout.tsx src/app/dashboard/page.tsx src/components/dashboard-shell.tsx
git commit -m "feat: restyle login, dashboard shell, and dashboard home"
```

---

### Task 24: Restyle client and test creation forms

**Files:**
- Modify: `src/app/dashboard/clients/new/page.tsx`
- Modify: `src/app/dashboard/clients/[clientSlug]/tests/new/page.tsx`

This must preserve **every** existing behavior in the new-test form: the `useRouter` +
`router.push` client-side navigation after `createTest` (not a server-side `redirect()`), the
`clientLoading` state and its "Carregando..." message, the fetch-error message on the client
lookup, and `disabled={!clientId}` on the submit button. Only classNames and wrapper structure
change.

- [ ] **Step 1: Restyle the new-client form**

Replace the full contents of `src/app/dashboard/clients/new/page.tsx`:

```tsx
import { createClient } from '../actions'

export default function NewClientPage() {
  return (
    <div className="p-8">
      <form action={createClient} className="max-w-md space-y-4">
        <h1 className="mb-2 font-['Space_Grotesk'] text-lg font-semibold">Novo cliente</h1>
        <input
          name="name"
          required
          placeholder="Nome"
          className="w-full rounded-[10px] border border-white/[0.08] bg-[#1B2036] px-3.5 py-2.5 text-sm text-[#E8EAF2] outline-none focus:border-[#7C6FF0]"
        />
        <input
          name="slug"
          required
          placeholder="slug (ex: nicho-fitness)"
          pattern="[a-z0-9-]+"
          className="w-full rounded-[10px] border border-white/[0.08] bg-[#1B2036] px-3.5 py-2.5 text-sm text-[#E8EAF2] outline-none focus:border-[#7C6FF0]"
        />
        <button type="submit" className="rounded-[10px] bg-[#7C6FF0] px-4 py-2.5 text-sm font-semibold text-[#0B0E1A]">
          Criar
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Restyle the new-test form**

Replace the full contents of `src/app/dashboard/clients/[clientSlug]/tests/new/page.tsx`:

```tsx
'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createTest } from '../../actions'
import { weightsSumTo100 } from '@/lib/domain/validate-weights'
import { createBrowserSupabaseClient } from '@/lib/supabase/browser'

interface VariantForm {
  name: string
  weight_pct: string
  destination_url: string
  thank_you_url: string
}

const inputClass =
  'w-full rounded-[10px] border border-white/[0.08] bg-[#1B2036] px-3.5 py-2.5 text-sm text-[#E8EAF2] outline-none focus:border-[#7C6FF0]'

export default function NewTestPage() {
  const params = useParams<{ clientSlug: string }>()
  const router = useRouter()
  const [clientId, setClientId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [fallbackUrl, setFallbackUrl] = useState('')
  const [conversionMethod, setConversionMethod] = useState<'hubla_webhook' | 'thank_you_page'>('hubla_webhook')
  const [variants, setVariants] = useState<VariantForm[]>([
    { name: 'A', weight_pct: '50', destination_url: '', thank_you_url: '' },
    { name: 'B', weight_pct: '50', destination_url: '', thank_you_url: '' },
  ])
  const [error, setError] = useState<string | null>(null)
  const [clientLoading, setClientLoading] = useState(true)

  useEffect(() => {
    const supabase = createBrowserSupabaseClient()
    supabase
      .from('clients')
      .select('id')
      .eq('slug', params.clientSlug)
      .single()
      .then(({ data, error }) => {
        if (error) {
          setError('Não foi possível carregar o cliente. Recarregue a página.')
        } else {
          setClientId(data?.id ?? null)
        }
        setClientLoading(false)
      })
  }, [params.clientSlug])

  const weightsValid = weightsSumTo100(variants.map((v) => Number(v.weight_pct)))

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!clientId) return
    if (!weightsValid) {
      setError('Os pesos das variantes devem somar 100%')
      return
    }
    try {
      await createTest({
        client_id: clientId,
        name,
        slug,
        fallback_url: fallbackUrl,
        conversion_method: conversionMethod,
        variants: variants.map((v) => ({
          name: v.name,
          weight_pct: Number(v.weight_pct),
          destination_url: v.destination_url,
          thank_you_url: v.thank_you_url,
        })),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar teste')
      return
    }
    router.push(`/dashboard/clients/${params.clientSlug}`)
  }

  function updateVariant(index: number, field: keyof VariantForm, value: string) {
    setVariants((prev) => prev.map((v, i) => (i === index ? { ...v, [field]: value } : v)))
  }

  return (
    <div className="p-8">
      <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
        <h1 className="font-['Space_Grotesk'] text-lg font-semibold">Novo teste</h1>
        <input required placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        <input
          required
          placeholder="Slug (ex: oferta-x)"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          className={inputClass}
        />
        <input
          placeholder="URL de fallback (opcional)"
          value={fallbackUrl}
          onChange={(e) => setFallbackUrl(e.target.value)}
          className={inputClass}
        />
        <select
          value={conversionMethod}
          onChange={(e) => setConversionMethod(e.target.value as typeof conversionMethod)}
          className={inputClass}
        >
          <option value="hubla_webhook">Venda (webhook Hubla)</option>
          <option value="thank_you_page">Captura (thank-you page)</option>
        </select>

        {variants.map((variant, index) => (
          <fieldset key={index} className="space-y-2 rounded-[10px] border border-white/[0.08] p-3">
            <legend className="px-1 text-sm font-medium text-[#8A90A6]">Variante {variant.name}</legend>
            <input
              placeholder="Peso %"
              value={variant.weight_pct}
              onChange={(e) => updateVariant(index, 'weight_pct', e.target.value)}
              className={inputClass}
            />
            <input
              placeholder="URL de destino"
              value={variant.destination_url}
              onChange={(e) => updateVariant(index, 'destination_url', e.target.value)}
              className={inputClass}
            />
            {conversionMethod === 'thank_you_page' && (
              <input
                placeholder="URL de thank-you"
                value={variant.thank_you_url}
                onChange={(e) => updateVariant(index, 'thank_you_url', e.target.value)}
                className={inputClass}
              />
            )}
          </fieldset>
        ))}

        <button
          type="button"
          onClick={() =>
            setVariants((prev) => [...prev, { name: String.fromCharCode(65 + prev.length), weight_pct: '0', destination_url: '', thank_you_url: '' }])
          }
          className="text-sm font-medium text-[#7C6FF0] hover:text-[#9C90F5]"
        >
          + Adicionar variante
        </button>

        {!weightsValid && <p className="text-sm text-[#F5B94D]">Os pesos devem somar 100%.</p>}
        {clientLoading && <p className="text-sm text-[#8A90A6]">Carregando...</p>}
        {error && <p className="text-sm text-[#F76C6C]">{error}</p>}

        <button
          type="submit"
          disabled={!clientId}
          className="rounded-[10px] bg-[#7C6FF0] px-4 py-2.5 text-sm font-semibold text-[#0B0E1A] disabled:opacity-50"
        >
          Criar teste
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 3: Manual verification**

```bash
npm run dev
```
`/dashboard/clients/new` and `/dashboard/clients/<slug>/tests/new` render with the dark theme;
the weight-sum warning, the "Carregando..." state, the disabled submit while `clientId` is
loading, and the post-submit client-side navigation all still behave exactly as before.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/clients/new/page.tsx "src/app/dashboard/clients/[clientSlug]/tests/new/page.tsx"
git commit -m "feat: restyle client and test creation forms"
```

---

### Task 25: Report page — node canvas

**Files:**
- Create: `src/lib/domain/report-layout.ts`
- Test: `src/lib/domain/report-layout.test.ts`
- Modify: `src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/page.tsx`

**Interfaces:**
- Consumes: `get_test_report` RPC, `get_test_report_by_source` RPC, `probabilityToBeatControl`,
  `toggleTestStatus` (Task 20), `variants` table — all already wired in the current file.
- Produces: `computeReportLayout(variants, fallbackConfigured): ReportLayout` — a pure function
  from variant data to node/edge coordinates.

This task **must preserve, unchanged**: the `params: Promise<{...}>` await pattern, the
`toggleTestStatus.bind(...)` form wiring and its active/paused label swap, the conditional
`pixelVariants` query and its `isSafeUrl` regex check and warning copy, and the three-way
confidence label (`'controle'` for the control row / `'dados insuficientes'` when either side
has zero visits / `` `${pct}% de ser melhor que o controle}` `` otherwise). Only the layout —
how the per-variant report table becomes a node canvas — changes.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/domain/report-layout.test.ts
import { describe, it, expect } from 'vitest'
import { computeReportLayout } from './report-layout'

const variants = [
  { id: 'a', name: 'A', weightPct: 50, visits: 1706, conversions: 58, destinationUrl: 'https://example.com/a' },
  { id: 'b', name: 'B', weightPct: 30, visits: 1024, conversions: 61, destinationUrl: 'https://example.com/b' },
  { id: 'c', name: 'C', weightPct: 20, visits: 682, conversions: 14, destinationUrl: 'https://example.com/c' },
]

describe('computeReportLayout', () => {
  it('lays out one node column per variant, stacked without overlap', () => {
    const layout = computeReportLayout(variants, false)
    expect(layout.variants).toHaveLength(3)
    for (let i = 1; i < layout.variants.length; i++) {
      const prevBottom = layout.variants[i - 1].node.y + layout.variants[i - 1].node.h
      expect(layout.variants[i].node.y).toBeGreaterThanOrEqual(prevBottom)
    }
  })

  it('marks the variant with the highest conversion rate as leader', () => {
    const layout = computeReportLayout(variants, false)
    const leaders = layout.variants.filter((v) => v.isLeader)
    expect(leaders).toHaveLength(1)
    expect(leaders[0].id).toBe('b')
  })

  it('colors the leader conversion edge amber and others teal', () => {
    const layout = computeReportLayout(variants, false)
    const leader = layout.variants.find((v) => v.id === 'b')!
    const other = layout.variants.find((v) => v.id === 'a')!
    expect(leader.conversionEdge.color).toBe('#F5B94D')
    expect(other.conversionEdge.color).toBe('#2DD4A8')
  })

  it('gives thicker traffic edges to variants with more visits', () => {
    const layout = computeReportLayout(variants, false)
    const a = layout.variants.find((v) => v.id === 'a')!
    const c = layout.variants.find((v) => v.id === 'c')!
    expect(a.trafficEdge.strokeWidth).toBeGreaterThan(c.trafficEdge.strokeWidth)
  })

  it('declares no leader when no variant has any visits', () => {
    const noVisits = variants.map((v) => ({ ...v, visits: 0, conversions: 0 }))
    const layout = computeReportLayout(noVisits, false)
    expect(layout.variants.every((v) => !v.isLeader)).toBe(true)
  })

  it('omits the fallback node when not configured', () => {
    expect(computeReportLayout(variants, false).fallback).toBeNull()
  })

  it('includes a fallback node when configured', () => {
    expect(computeReportLayout(variants, true).fallback).not.toBeNull()
  })

  it('throws on an empty variant list', () => {
    expect(() => computeReportLayout([], false)).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/domain/report-layout.test.ts
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```ts
// src/lib/domain/report-layout.ts
export interface ReportVariantInput {
  id: string
  name: string
  weightPct: number
  visits: number
  conversions: number
  destinationUrl: string
}

export interface ReportNode {
  x: number
  y: number
  w: number
  h: number
}

export interface ReportVariantLayout {
  id: string
  name: string
  weightPct: number
  visits: number
  conversions: number
  ratePct: number
  destinationUrl: string
  isLeader: boolean
  node: ReportNode
  trafficEdge: { path: string; strokeWidth: number }
  conversionNode: ReportNode
  conversionEdge: { path: string; strokeWidth: number; color: string }
}

export interface ReportLayout {
  canvasWidth: number
  canvasHeight: number
  entryNode: ReportNode
  variants: ReportVariantLayout[]
  fallback: { node: ReportNode; edge: { path: string } } | null
}

const CANVAS_WIDTH = 1360
const CANVAS_HEIGHT = 732
const ENTRY = { x: 40, w: 240, h: 150 }
const VARIANT = { x: 360, w: 300, h: 170, gap: 26 }
const CONVERSION = { x: 760, w: 220, h: 110 }

function bezier(fromX: number, fromY: number, toX: number, toY: number): string {
  const midX = (fromX + toX) / 2
  return `M${fromX},${fromY} C${midX},${fromY} ${midX},${toY} ${toX},${toY}`
}

export function computeReportLayout(variants: ReportVariantInput[], fallbackConfigured: boolean): ReportLayout {
  if (variants.length === 0) {
    throw new Error('computeReportLayout requires at least one variant')
  }

  const totalVariantHeight = variants.length * VARIANT.h + (variants.length - 1) * VARIANT.gap
  const variantStartY = (CANVAS_HEIGHT - totalVariantHeight) / 2
  const entryNode: ReportNode = { x: ENTRY.x, y: (CANVAS_HEIGHT - ENTRY.h) / 2, w: ENTRY.w, h: ENTRY.h }
  const entryCenterY = entryNode.y + entryNode.h / 2
  const entryRightX = entryNode.x + entryNode.w

  const maxVisits = Math.max(1, ...variants.map((v) => v.visits))
  const rates = variants.map((v) => (v.visits > 0 ? v.conversions / v.visits : -1))
  const bestRate = Math.max(...rates)
  const leaderIndex = bestRate > 0 ? rates.indexOf(bestRate) : -1

  const variantLayouts: ReportVariantLayout[] = variants.map((variant, index) => {
    const node: ReportNode = {
      x: VARIANT.x,
      y: variantStartY + index * (VARIANT.h + VARIANT.gap),
      w: VARIANT.w,
      h: VARIANT.h,
    }
    const centerY = node.y + node.h / 2
    const isLeader = index === leaderIndex

    const conversionNode: ReportNode = {
      x: CONVERSION.x,
      y: centerY - CONVERSION.h / 2,
      w: CONVERSION.w,
      h: CONVERSION.h,
    }

    return {
      id: variant.id,
      name: variant.name,
      weightPct: variant.weightPct,
      visits: variant.visits,
      conversions: variant.conversions,
      ratePct: variant.visits > 0 ? (variant.conversions / variant.visits) * 100 : 0,
      destinationUrl: variant.destinationUrl,
      isLeader,
      node,
      trafficEdge: {
        path: bezier(entryRightX, entryCenterY, node.x, centerY),
        strokeWidth: 2.5 + (variant.visits / maxVisits) * 4.5,
      },
      conversionNode,
      conversionEdge: {
        path: bezier(node.x + node.w, centerY, conversionNode.x, centerY),
        strokeWidth: isLeader ? 5 : 3.5,
        color: isLeader ? '#F5B94D' : '#2DD4A8',
      },
    }
  })

  const fallback = fallbackConfigured
    ? {
        node: { x: entryNode.x + 160, y: entryNode.y + entryNode.h + 60, w: 230, h: 60 },
        edge: {
          path: `M${entryNode.x + 120},${entryNode.y + entryNode.h} L${entryNode.x + 120},${entryNode.y + entryNode.h + 90}`,
        },
      }
    : null

  return { canvasWidth: CANVAS_WIDTH, canvasHeight: CANVAS_HEIGHT, entryNode, variants: variantLayouts, fallback }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/domain/report-layout.test.ts
```
Expected: PASS (8 tests).

- [ ] **Step 5: Add `fallback_url` to the existing `tests` select and fetch variant destination URLs**

In `src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/page.tsx`, change the existing
`tests` select from:

```ts
    .select('id, name, slug, status, conversion_method')
```

to:

```ts
    .select('id, name, slug, status, conversion_method, fallback_url')
```

Add this query right after the existing `pixelVariants` query (which only fetches
`thank_you_url` conditionally) — this new one is unconditional and only fetches
`destination_url`, needed for every variant regardless of conversion method:

```ts
  const { data: variantRows } = await supabase.from('variants').select('id, destination_url').eq('test_id', test.id)
  const destinationById = new Map((variantRows ?? []).map((v) => [v.id, v.destination_url as string]))
```

- [ ] **Step 6: Build the layout and the three-way confidence labels from the existing `rows`**

Keep the existing `baseRows`/`control`/`rows` computation exactly as it is today (do not touch
the confidence math). Immediately after the existing `rows` computation, add:

```ts
  const layout = computeReportLayout(
    rows.map((row) => ({
      id: row.variant_id,
      name: row.variant_name,
      weightPct: row.weight_pct,
      visits: row.visits,
      conversions: row.conversions,
      destinationUrl: destinationById.get(row.variant_id) ?? '',
    })),
    Boolean(test.fallback_url)
  )

  const confidenceLabelById = new Map(
    rows.map((row) => [
      row.variant_id,
      row.variant_id === control?.variant_id
        ? 'controle'
        : row.confidencePct !== null
          ? `${row.confidencePct}% de ser melhor que o controle`
          : 'dados insuficientes',
    ])
  )
```

- [ ] **Step 7: Replace the page's JSX**

Replace everything from the opening `return (` through the closing `<table>` for the main
report (i.e. everything up to, but not including, the `<h2>Por origem (UTM)</h2>` section) with:

```tsx
  return (
    <div className="flex h-screen flex-col">
      <div className="flex h-[88px] flex-shrink-0 items-center justify-between border-b border-white/[0.08] px-8">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-['Space_Grotesk'] text-[19px] font-semibold">{test.name}</h1>
            <span
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium ${
                test.status === 'active' ? 'border-[#2DD4A8]/35 text-[#2DD4A8]' : 'border-[#F76C6C]/35 text-[#F76C6C]'
              }`}
            >
              {test.status === 'active' ? 'Ativo' : 'Pausado'}
            </span>
          </div>
          <p className="mt-1 font-['JetBrains_Mono'] text-xs text-[#8A90A6]">{redirectUrl}</p>
        </div>
        <div className="flex items-center gap-5">
          <div className="flex flex-col items-end">
            <span className="font-['JetBrains_Mono'] text-[17px] font-medium">{totalVisits}</span>
            <span className="text-[11px] text-[#8A90A6]">acessos</span>
          </div>
          <form
            action={toggleTestStatus.bind(null, {
              test_id: test.id,
              next_status: test.status === 'active' ? 'paused' : 'active',
              client_slug: clientSlug,
              test_slug: test.slug,
            })}
          >
            <button
              type="submit"
              className="h-9 rounded-[9px] border border-white/[0.08] bg-transparent px-4 text-[13px] font-medium text-[#8A90A6]"
            >
              {test.status === 'active' ? 'Pausar teste' : 'Ativar teste'}
            </button>
          </form>
        </div>
      </div>

      <div className="relative m-6 flex-1 overflow-auto rounded-2xl border border-white/[0.08]">
        <svg
          width={layout.canvasWidth}
          height={layout.canvasHeight}
          viewBox={`0 0 ${layout.canvasWidth} ${layout.canvasHeight}`}
          className="absolute left-5 top-5"
          fill="none"
        >
          {layout.variants.map((variant) => (
            <path
              key={`traffic-${variant.id}`}
              d={variant.trafficEdge.path}
              stroke="#4F8EF7"
              strokeWidth={variant.trafficEdge.strokeWidth}
              strokeLinecap="round"
              opacity={0.55}
            />
          ))}
          {layout.variants.map((variant) => (
            <path
              key={`conversion-${variant.id}`}
              d={variant.conversionEdge.path}
              stroke={variant.conversionEdge.color}
              strokeWidth={variant.conversionEdge.strokeWidth}
              strokeLinecap="round"
              opacity={0.8}
            />
          ))}
          {layout.fallback && (
            <path
              d={layout.fallback.edge.path}
              stroke="#F76C6C"
              strokeWidth={2}
              strokeDasharray="5 5"
              strokeLinecap="round"
              opacity={0.5}
            />
          )}
        </svg>

        <div
          className="absolute rounded-xl border border-white/[0.08] bg-[#141829] p-[18px]"
          style={{ left: layout.entryNode.x + 20, top: layout.entryNode.y + 20, width: layout.entryNode.w, height: layout.entryNode.h }}
        >
          <div className="mb-2.5 font-['JetBrains_Mono'] text-[10.5px] uppercase tracking-widest text-[#8A90A6]">
            Link do teste
          </div>
          <div className="mb-4 break-all font-['JetBrains_Mono'] text-[12.5px] text-[#4F8EF7]">{redirectUrl}</div>
          <div className="font-['Space_Grotesk'] text-[22px] font-semibold">{totalVisits}</div>
          <div className="text-[11.5px] text-[#8A90A6]">acessos totais</div>
        </div>

        {layout.fallback && (
          <div
            className="absolute rounded-[10px] border border-[#F76C6C]/30 bg-[#141829] px-3.5 py-2.5 opacity-85"
            style={{ left: layout.fallback.node.x + 20, top: layout.fallback.node.y + 20, width: layout.fallback.node.w }}
          >
            <div className="mb-0.5 text-[10.5px] uppercase tracking-wide text-[#F76C6C]">Fallback</div>
            <div className="font-['JetBrains_Mono'] text-[11.5px] text-[#8A90A6]">{test.fallback_url}</div>
          </div>
        )}

        {layout.variants.map((variant) => (
          <div key={variant.id}>
            <div
              className={`absolute rounded-xl border bg-[#141829] p-[18px_20px] ${
                variant.isLeader
                  ? 'border-[#F5B94D] shadow-[0_0_0_3px_rgba(245,185,77,0.14),0_0_32px_rgba(245,185,77,0.18)]'
                  : 'border-white/[0.08]'
              }`}
              style={{ left: variant.node.x + 20, top: variant.node.y + 20, width: variant.node.w, height: variant.node.h }}
            >
              <div className="mb-3.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-[3px] bg-[#4F8EF7]" />
                  <span className="font-['Space_Grotesk'] text-[15px] font-semibold">Variante {variant.name}</span>
                  {variant.isLeader && (
                    <span className="rounded-full bg-[#F5B94D]/15 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#F5B94D]">
                      Líder
                    </span>
                  )}
                </div>
                <span className="rounded-full bg-[#1B2036] px-2.5 py-0.5 font-['JetBrains_Mono'] text-[11.5px] text-[#8A90A6]">
                  alvo {variant.weightPct}%
                </span>
              </div>
              <div className="mb-3.5 flex gap-7">
                <div>
                  <div className="font-['JetBrains_Mono'] text-base font-medium">{variant.visits}</div>
                  <div className="text-[11px] text-[#8A90A6]">acessos</div>
                </div>
                <div>
                  <div className="font-['JetBrains_Mono'] text-base font-medium">{variant.conversions}</div>
                  <div className="text-[11px] text-[#8A90A6]">conversões</div>
                </div>
              </div>
              <div className="truncate border-t border-white/[0.08] pt-3 font-['JetBrains_Mono'] text-xs text-[#8A90A6]">
                {variant.destinationUrl}
              </div>
            </div>

            <div
              className={`absolute flex flex-col justify-center rounded-xl border bg-[#141829] p-4 ${
                variant.isLeader ? 'border-[#F5B94D] shadow-[0_0_24px_rgba(245,185,77,0.14)]' : 'border-white/[0.08]'
              }`}
              style={{
                left: variant.conversionNode.x + 20,
                top: variant.conversionNode.y + 20,
                width: variant.conversionNode.w,
                height: variant.conversionNode.h,
              }}
            >
              <div className="mb-2 text-[10.5px] uppercase tracking-wide text-[#8A90A6]">Conversão</div>
              <div
                className="font-['JetBrains_Mono'] text-[26px] font-semibold leading-none"
                style={{ color: variant.isLeader ? '#F5B94D' : '#2DD4A8' }}
              >
                {variant.ratePct.toFixed(1)}%
              </div>
              <div className="mt-1 text-[11.5px] text-[#8A90A6]">
                {variant.conversions} vendas · {confidenceLabelById.get(variant.id)}
              </div>
            </div>
          </div>
        ))}
      </div>
```

(Leave the existing `<h2>Por origem (UTM)</h2>` table and the pixel-snippet section exactly
where they were, right after this block — do not touch their JSX or logic. Only restyle their
Tailwind classes to the dark tokens: `text-gray-600`→`text-[#8A90A6]`, `border-b`→
`border-b border-white/[0.08]`, `bg-gray-100`→`bg-[#1B2036]`, `text-blue-600`→`text-[#4F8EF7]`,
`text-lg font-semibold`→`font-['Space_Grotesk'] text-lg font-semibold`, wrapping both sections
in `mx-6 mb-6` spacing to match the canvas's margins. Keep the `isSafeUrl` check and the
"seu construtor de página/funil precisa..." warning text verbatim.)

- [ ] **Step 8: Manual verification**

```bash
npm run dev
```
Open a test's report page with 2–3 variants and some traffic. Confirm: three columns connected
by curved lines; the highest-converting variant has an amber border/glow, "Líder" badge, and
amber conversion number/line; the confidence caption reads "controle" on the control variant,
a percentage on the others (once both sides have visits), or "dados insuficientes" otherwise;
clicking "Pausar teste"/"Ativar teste" still flips the status pill and button label; setting a
`fallback_url` on the test shows the dashed rose line and Fallback chip; the UTM breakdown table
and the pixel-snippet section (with its URL-safety warning) still render below the canvas
exactly as before, just restyled.

- [ ] **Step 9: Commit**

```bash
git add src/lib/domain/report-layout.ts src/lib/domain/report-layout.test.ts "src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/page.tsx"
git commit -m "feat: rebuild the test report as a node canvas"
```

---

### Task 26: Restyle the test list

**Files:**
- Modify: `src/app/dashboard/clients/[clientSlug]/page.tsx`

- [ ] **Step 1: Restyle the test list**

Replace the full contents of `src/app/dashboard/clients/[clientSlug]/page.tsx`:

```tsx
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'

export default async function ClientPage({ params }: { params: Promise<{ clientSlug: string }> }) {
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
    .select('id, name, slug, status')
    .eq('client_id', client.id)
    .order('name')

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-['Space_Grotesk'] text-xl font-semibold">Testes — {client.name}</h1>
        <a
          href={`/dashboard/clients/${client.slug}/tests/new`}
          className="rounded-[9px] bg-[#7C6FF0] px-4 py-2.5 text-[13.5px] font-semibold text-[#0B0E1A]"
        >
          Novo teste
        </a>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/[0.08]">
        {(tests ?? []).map((test, index) => (
          <a
            key={test.id}
            href={`/dashboard/clients/${client.slug}/tests/${test.slug}`}
            className={`flex items-center gap-5 bg-[#141829] px-6 py-5 hover:bg-[#1B2036] ${
              index < (tests?.length ?? 0) - 1 ? 'border-b border-white/[0.08]' : ''
            } ${test.status === 'paused' ? 'opacity-70' : ''}`}
          >
            <div className="min-w-0 flex-1">
              <div className="font-['Space_Grotesk'] text-[15px] font-semibold">{test.name}</div>
              <div className="font-['JetBrains_Mono'] text-xs text-[#8A90A6]">/{test.slug}</div>
            </div>
            <span
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                test.status === 'active' ? 'border-[#2DD4A8]/35 text-[#2DD4A8]' : 'border-[#F76C6C]/35 text-[#F76C6C]'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${test.status === 'active' ? 'bg-[#2DD4A8]' : 'bg-[#F76C6C]'}`} />
              {test.status === 'active' ? 'Ativo' : 'Pausado'}
            </span>
          </a>
        ))}
        {(tests ?? []).length === 0 && <div className="px-6 py-8 text-sm text-[#8A90A6]">Nenhum teste ainda.</div>}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Manual verification**

```bash
npm run dev
```
`/dashboard/clients/<slug>` shows the test list as dark row-cards with status pills, matching
the sidebar and report page's visual language.

- [ ] **Step 3: Commit**

```bash
git add "src/app/dashboard/clients/[clientSlug]/page.tsx"
git commit -m "feat: restyle test list"
```
