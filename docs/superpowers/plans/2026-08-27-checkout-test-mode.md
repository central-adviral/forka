# Checkout Test Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second test mode ("checkout") where a single campaign link always lands on one shared sales page, and the page's buy button routes each visitor to one of N weighted checkouts through a stable go-link owned by the tool.

**Architecture:** The draw stays exactly where it is — in `/r/[slug]`, at ad-click time, writing the same `click_events` row as today. A new `test_type` column decides only where `/r/` sends the visitor: the variant's own URL (mode `page`, unchanged) or the test's shared `sales_page_url` (mode `checkout`). A new read-only route `/c/[slug]` resolves the already-assigned variant from cookies and 302s to that variant's `destination_url` (which, in checkout mode, holds the `pay.hub.la` link) with `utm_content` attached. Because the unit of analysis is still `click_events.variant_id`, every report RPC, the significance math and the Hubla webhook are untouched.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (`@supabase/supabase-js`), Zod, Vitest.

**Spec:** [docs/superpowers/specs/2026-08-27-checkout-test-mode-design.md](../specs/2026-08-27-checkout-test-mode-design.md)

## Global Constraints

- `test_type` has exactly two values: `page` (default, all pre-existing tests) and `checkout`.
- `test_type` is **immutable after creation** — enforced by a database trigger, not just by omission in server actions.
- A `checkout` test must always have a non-null `sales_page_url`; a `page` test ignores that column.
- In `checkout` mode, `variants.destination_url` holds the checkout link (`https://pay.hub.la/...`). In `page` mode its meaning is unchanged.
- **The buy button must never break.** `/c/[slug]` deliberately ignores `tests.status`: a paused test keeps redirecting. An unknown visitor gets the control variant rather than an error.
- `/c/[slug]` performs **no writes** on the happy path — it is idempotent and safe to click repeatedly.
- The mode `page` behaviour must not regress. The existing test suite is the guard; it must stay green at every task boundary.
- Do not add the "sales page" node to the report canvas — explicitly deferred by the product owner (see spec, "Fora de escopo").

---

### Task 1: Migration — test type, sales page URL, immutability trigger, index

**Files:**
- Create: `supabase/migrations/0012_test_type_checkout.sql`

**Interfaces:**
- Produces: `tests.test_type text not null default 'page'`, `tests.sales_page_url text` — consumed by every task below.
- Produces: RPC `create_test_with_variants(p_client_id uuid, p_name text, p_slug text, p_fallback_url text, p_conversion_method text, p_test_type text, p_sales_page_url text, p_variants jsonb)` — consumed by Task 6.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0012_test_type_checkout.sql`:

```sql
alter table tests
  add column test_type text not null default 'page'
    check (test_type in ('page', 'checkout')),
  add column sales_page_url text;

alter table tests
  add constraint tests_checkout_requires_sales_page
    check (test_type <> 'checkout' or sales_page_url is not null);

-- test_type must never change after creation: mixing pre/post-switch click events
-- in one report produces silently wrong conversion numbers. The Data API exposes
-- UPDATE on tests to authenticated users, so omitting the field in the server
-- action is not enough.
create or replace function forbid_test_type_change() returns trigger
language plpgsql
as $$
begin
  if new.test_type is distinct from old.test_type then
    raise exception 'test_type is immutable';
  end if;
  return new;
end;
$$;

create trigger tests_test_type_immutable
  before update on tests
  for each row execute function forbid_test_type_change();

-- /c/[slug] looks up the most recent click event for (test, visitor) on every
-- buy-button click; the existing indexes only cover test_id and variant_id alone.
create index click_events_test_visitor_created_idx
  on click_events (test_id, visitor_id, created_at desc);

-- Parameter list changes, so "create or replace" would create a second overload
-- and leave the PostgREST call ambiguous. Drop the old signature first.
drop function if exists create_test_with_variants(uuid, text, text, text, text, jsonb);

create or replace function create_test_with_variants(
  p_client_id uuid,
  p_name text,
  p_slug text,
  p_fallback_url text,
  p_conversion_method text,
  p_test_type text,
  p_sales_page_url text,
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

  if p_test_type not in ('page', 'checkout') then
    raise exception 'invalid test_type: %', p_test_type;
  end if;

  if p_test_type = 'checkout' and (p_sales_page_url is null or p_sales_page_url = '') then
    raise exception 'checkout tests require a sales page url';
  end if;

  select sum((v->>'weight_pct')::numeric) into v_total from jsonb_array_elements(p_variants) v;
  if v_total is null or abs(v_total - 100) > 0.01 then
    raise exception 'variant weights must sum to 100, got %', v_total;
  end if;

  insert into tests (client_id, name, slug, fallback_url, conversion_method, test_type, sales_page_url)
  values (p_client_id, p_name, p_slug, p_fallback_url, p_conversion_method, p_test_type,
          nullif(p_sales_page_url, ''))
  returning id into v_test_id;

  insert into variants (test_id, name, weight_pct, destination_url, thank_you_url)
  select v_test_id, v->>'name', (v->>'weight_pct')::numeric, v->>'destination_url', v->>'thank_you_url'
  from jsonb_array_elements(p_variants) v;

  return v_test_id;
end;
$$;

revoke all on function create_test_with_variants(uuid, text, text, text, text, text, text, jsonb) from public;
grant execute on function create_test_with_variants(uuid, text, text, text, text, text, text, jsonb) to authenticated;
```

- [ ] **Step 2: Apply the migration**

```bash
npx supabase db push --db-url "$PRODUCTION_POSTGRES_URL_NON_POOLING"
```
(Same non-pooling connection string used for prior migrations in this project. Against local Supabase, use the project's existing convention instead.)

Expected: applies with no errors. Verify:
```sql
select test_type, sales_page_url from tests limit 1;
```
returns the new columns, and every pre-existing row shows `page`.

- [ ] **Step 3: Verify the immutability trigger fires**

```sql
update tests set test_type = 'checkout' where id = (select id from tests limit 1);
```
Expected: `ERROR: test_type is immutable`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0012_test_type_checkout.sql
git commit -m "feat: add test_type and sales_page_url with immutability trigger"
```

---

### Task 2: Pure destination helpers

**Files:**
- Create: `src/lib/domain/test-destination.ts`
- Test: `src/lib/domain/test-destination.test.ts`

**Interfaces:**
- Produces: `resolveEntryDestination(input: { testType: 'page' | 'checkout'; salesPageUrl: string | null; variantDestinationUrl: string }): string` — consumed by Task 4 (`/r/` route).
- Produces: `withTrackingId(url: string, trackingId: string | null): string` — consumed by Task 4 (`/r/`) and Task 5 (`/c/`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/domain/test-destination.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveEntryDestination, withTrackingId } from './test-destination'

describe('resolveEntryDestination', () => {
  it('uses the variant destination in page mode', () => {
    expect(
      resolveEntryDestination({
        testType: 'page',
        salesPageUrl: null,
        variantDestinationUrl: 'https://example.com/page-a',
      })
    ).toBe('https://example.com/page-a')
  })

  it('ignores a sales page url in page mode', () => {
    expect(
      resolveEntryDestination({
        testType: 'page',
        salesPageUrl: 'https://example.com/shared',
        variantDestinationUrl: 'https://example.com/page-a',
      })
    ).toBe('https://example.com/page-a')
  })

  it('uses the shared sales page in checkout mode', () => {
    expect(
      resolveEntryDestination({
        testType: 'checkout',
        salesPageUrl: 'https://example.com/vendas',
        variantDestinationUrl: 'https://pay.hub.la/abc',
      })
    ).toBe('https://example.com/vendas')
  })

  it('falls back to the variant destination if a checkout test somehow has no sales page', () => {
    expect(
      resolveEntryDestination({
        testType: 'checkout',
        salesPageUrl: null,
        variantDestinationUrl: 'https://pay.hub.la/abc',
      })
    ).toBe('https://pay.hub.la/abc')
  })
})

describe('withTrackingId', () => {
  it('appends utm_content', () => {
    const result = new URL(withTrackingId('https://pay.hub.la/abc', 'trk_1'))
    expect(result.searchParams.get('utm_content')).toBe('trk_1')
  })

  it('preserves query params already present on the checkout link', () => {
    const result = new URL(withTrackingId('https://pay.hub.la/abc?offer=annual', 'trk_1'))
    expect(result.searchParams.get('offer')).toBe('annual')
    expect(result.searchParams.get('utm_content')).toBe('trk_1')
  })

  it('overwrites an existing utm_content rather than duplicating it', () => {
    const result = new URL(withTrackingId('https://pay.hub.la/abc?utm_content=stale', 'trk_1'))
    expect(result.searchParams.getAll('utm_content')).toEqual(['trk_1'])
  })

  it('returns the url untouched when there is no tracking id', () => {
    expect(withTrackingId('https://pay.hub.la/abc', null)).toBe('https://pay.hub.la/abc')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/domain/test-destination.test.ts
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/lib/domain/test-destination.ts`:

```ts
export type TestType = 'page' | 'checkout'

export interface EntryDestinationInput {
  testType: TestType
  salesPageUrl: string | null
  variantDestinationUrl: string
}

export function resolveEntryDestination(input: EntryDestinationInput): string {
  if (input.testType === 'checkout' && input.salesPageUrl) {
    return input.salesPageUrl
  }
  return input.variantDestinationUrl
}

export function withTrackingId(url: string, trackingId: string | null): string {
  if (!trackingId) return url
  const parsed = new URL(url)
  parsed.searchParams.set('utm_content', trackingId)
  return parsed.toString()
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/domain/test-destination.test.ts
```
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/test-destination.ts src/lib/domain/test-destination.test.ts
git commit -m "feat: add pure destination helpers for page and checkout modes"
```

---

### Task 3: Repository — expose test type, control flag, assignment and tracking lookups

**Files:**
- Modify: `src/lib/repo/redirect-repo.ts`
- Modify: `src/lib/repo/redirect-repo.integration.test.ts`
- Modify: `src/app/r/[slug]/route.test.ts` (type ripple — mocks must satisfy the widened `TestWithVariants`)

**Interfaces:**
- Consumes: `tests.test_type`, `tests.sales_page_url`, `variants.is_control` (Task 1 and existing migration `0006`).
- Produces: `TestWithVariants` gains `test_type: 'page' | 'checkout'` and `sales_page_url: string | null`; `VariantRow` gains `is_control: boolean` — consumed by Tasks 4 and 5.
- Produces: `getAssignedVariantId(db: SupabaseClient, params: { testId: string; visitorId: string }): Promise<string | null>` — consumed by Task 5.
- Produces: `getLatestTrackingId(db: SupabaseClient, params: { testId: string; visitorId: string }): Promise<string | null>` — consumed by Task 5.

- [ ] **Step 1: Write the failing integration tests**

Add to `src/lib/repo/redirect-repo.integration.test.ts`, inside the existing `describe('redirect-repo', ...)` block. It already has `db`, `testId` and `variantId` in module scope from its `beforeAll`, and already imports `getOrAssignVariant` and `insertClickEvent` — the visitor ids below are fresh literals, so nothing else needs to be set up:

```ts
  it('returns null when the visitor has no assignment for this test', async () => {
    expect(await getAssignedVariantId(db, { testId, visitorId: 'visitor-never-seen' })).toBeNull()
  })

  it('returns the assigned variant id for a known visitor', async () => {
    await getOrAssignVariant(db, { testId, visitorId: 'visitor-assign-1', candidateVariantId: variantId })
    expect(await getAssignedVariantId(db, { testId, visitorId: 'visitor-assign-1' })).toBe(variantId)
  })

  it('returns null when the visitor has no click event for this test', async () => {
    expect(await getLatestTrackingId(db, { testId, visitorId: 'visitor-never-seen' })).toBeNull()
  })

  it('returns the most recent tracking id when the visitor clicked more than once', async () => {
    await insertClickEvent(db, {
      testId,
      variantId,
      visitorId: 'visitor-multi',
      trackingId: 'trk-older',
      sourceUtms: {},
      ip: null,
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    await insertClickEvent(db, {
      testId,
      variantId,
      visitorId: 'visitor-multi',
      trackingId: 'trk-newer',
      sourceUtms: {},
      ip: null,
    })

    expect(await getLatestTrackingId(db, { testId, visitorId: 'visitor-multi' })).toBe('trk-newer')
  })

  it('refuses to change test_type after creation', async () => {
    const { error } = await db.from('tests').update({ test_type: 'checkout' }).eq('id', testId)
    expect(error?.message).toContain('test_type is immutable')
  })
```

The immutability test uses the service-role client, which bypasses RLS — that is deliberate: the trigger must hold for **every** role, so proving it against the most privileged one is the stronger assertion.

Extend the file's existing import from `./redirect-repo` to also include `getAssignedVariantId` and `getLatestTrackingId`.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/repo/redirect-repo.integration.test.ts
```
Expected: FAIL — `getAssignedVariantId` / `getLatestTrackingId` are not exported.

- [ ] **Step 3: Implement the repo changes**

In `src/lib/repo/redirect-repo.ts`, widen the two interfaces and the select, then append the two new functions:

```ts
export interface VariantRow {
  id: string
  name: string
  weight_pct: number
  destination_url: string
  is_control: boolean
}

export interface TestWithVariants {
  id: string
  slug: string
  status: 'active' | 'paused'
  fallback_url: string | null
  test_type: 'page' | 'checkout'
  sales_page_url: string | null
  variants: VariantRow[]
}
```

Replace the `.select(...)` call inside `getTestBySlug` with:

```ts
    .select(
      'id, slug, status, fallback_url, test_type, sales_page_url, variants(id, name, weight_pct, destination_url, is_control)'
    )
```

Append at the end of the file:

```ts
export async function getAssignedVariantId(
  db: SupabaseClient,
  params: { testId: string; visitorId: string }
): Promise<string | null> {
  const { data, error } = await db
    .from('variant_assignments')
    .select('variant_id')
    .eq('test_id', params.testId)
    .eq('visitor_id', params.visitorId)
    .maybeSingle()
  if (error) throw error
  return (data?.variant_id as string | undefined) ?? null
}

export async function getLatestTrackingId(
  db: SupabaseClient,
  params: { testId: string; visitorId: string }
): Promise<string | null> {
  const { data, error } = await db
    .from('click_events')
    .select('tracking_id')
    .eq('test_id', params.testId)
    .eq('visitor_id', params.visitorId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data?.tracking_id as string | undefined) ?? null
}
```

- [ ] **Step 4: Fix the type ripple in the existing route tests**

Widening `TestWithVariants` breaks every existing `getTestBySlug` mock. In `src/app/r/[slug]/route.test.ts`, add to **each** of the 6 `vi.mocked(getTestBySlug).mockResolvedValue({ ... })` object literals (the 7th call passes `null` and needs no change):

```ts
      test_type: 'page',
      sales_page_url: null,
```

and add `is_control: false,` to **every** variant object in that file — 7 in total: one each in the tests for the basic redirect, the paused fallback, the rate limit, the bot redirect and the bot fallback, plus two in the "reuses the previously assigned variant" test.

Do not change any assertion — these tests are the regression guard for page mode and must keep passing unmodified.

- [ ] **Step 5: Run the full suite and typecheck**

```bash
npx tsc --noEmit
npm run test
```
Expected: PASS, including the 7 pre-existing `/r/` tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/repo/redirect-repo.ts src/lib/repo/redirect-repo.integration.test.ts "src/app/r/[slug]/route.test.ts"
git commit -m "feat: expose test type, control flag and visitor lookups in redirect repo"
```

---

### Task 4: `/r/[slug]` — route the entry destination by test type

**Files:**
- Modify: `src/app/r/[slug]/route.ts`
- Modify: `src/app/r/[slug]/route.test.ts`

**Interfaces:**
- Consumes: `resolveEntryDestination`, `withTrackingId` (Task 2); widened `TestWithVariants` (Task 3).

- [ ] **Step 1: Write the failing tests**

Add to `src/app/r/[slug]/route.test.ts`, inside the existing `describe('GET /r/[slug]', ...)`:

```ts
  it('sends a checkout test to the shared sales page, not to the variant checkout link', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      id: 'test-1',
      slug: 'oferta-x',
      status: 'active',
      fallback_url: null,
      test_type: 'checkout',
      sales_page_url: 'https://example.com/vendas',
      variants: [
        { id: 'v1', name: 'A', weight_pct: 100, destination_url: 'https://pay.hub.la/abc', is_control: true },
      ],
    })
    vi.mocked(getOrAssignVariant).mockResolvedValue('v1')

    const request = new NextRequest('https://ir.example.com/r/oferta-x')
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })

    const location = new URL(response.headers.get('location')!)
    expect(location.origin + location.pathname).toBe('https://example.com/vendas')
    expect(location.searchParams.get('utm_content')).toBeTruthy()
    expect(insertClickEvent).toHaveBeenCalledOnce()
  })

  it('sends a bot on a checkout test to the sales page, never to the checkout link', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      id: 'test-1',
      slug: 'oferta-x',
      status: 'active',
      fallback_url: null,
      test_type: 'checkout',
      sales_page_url: 'https://example.com/vendas',
      variants: [
        { id: 'v1', name: 'A', weight_pct: 100, destination_url: 'https://pay.hub.la/abc', is_control: true },
      ],
    })

    const request = new NextRequest('https://ir.example.com/r/oferta-x', {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
    })
    const response = await GET(request, { params: Promise.resolve({ slug: 'oferta-x' }) })

    expect(response.headers.get('location')).toBe('https://example.com/vendas')
    expect(insertClickEvent).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run "src/app/r/[slug]/route.test.ts"
```
Expected: FAIL — both new tests get `https://pay.hub.la/abc` as the location.

- [ ] **Step 3: Implement**

In `src/app/r/[slug]/route.ts`, add the import:

```ts
import { resolveEntryDestination, withTrackingId } from '@/lib/domain/test-destination'
```

Replace the bot branch:

```ts
  if (isKnownBot(request.headers.get('user-agent'))) {
    const destination = test.fallback_url ?? test.variants[0].destination_url
    return NextResponse.redirect(destination, 302)
  }
```

with:

```ts
  if (isKnownBot(request.headers.get('user-agent'))) {
    const destination =
      test.fallback_url ??
      resolveEntryDestination({
        testType: test.test_type,
        salesPageUrl: test.sales_page_url,
        variantDestinationUrl: test.variants[0].destination_url,
      })
    return NextResponse.redirect(destination, 302)
  }
```

Replace the destination construction:

```ts
  const destination = new URL(variant.destination_url)
  destination.searchParams.set('utm_content', trackingId)

  const response = NextResponse.redirect(destination, 302)
```

with:

```ts
  const destination = withTrackingId(
    resolveEntryDestination({
      testType: test.test_type,
      salesPageUrl: test.sales_page_url,
      variantDestinationUrl: variant.destination_url,
    }),
    trackingId
  )

  const response = NextResponse.redirect(destination, 302)
```

Add `sameSite: 'lax'` to both cookie writes — `/c/[slug]` depends on these cookies surviving a top-level navigation from the client's domain, so make it explicit rather than relying on the browser default:

```ts
  response.cookies.set(VISITOR_COOKIE, visitorId, {
    maxAge: 60 * 60 * 24 * 365,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  })
  response.cookies.set(assignmentCookieName(test.slug), variant.id, {
    maxAge: 60 * 60 * 24 * COOKIE_MAX_AGE_DAYS,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  })
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run "src/app/r/[slug]/route.test.ts"
```
Expected: PASS (9 tests — the 7 originals unchanged plus the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add "src/app/r/[slug]/route.ts" "src/app/r/[slug]/route.test.ts"
git commit -m "feat: route the entry redirect by test type"
```

---

### Task 5: `/c/[slug]` — the buy-button go-link

**Files:**
- Create: `src/app/c/[slug]/route.ts`
- Create: `src/app/c/[slug]/route.test.ts`

**Interfaces:**
- Consumes: `getTestBySlug`, `getAssignedVariantId`, `getLatestTrackingId` (Task 3); `withTrackingId` (Task 2); `VISITOR_COOKIE`, `readAssignedVariantId` (existing `@/lib/domain/cookie-assignment`).

- [ ] **Step 1: Write the failing tests**

Create `src/app/c/[slug]/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/repo/redirect-repo', () => ({
  getTestBySlug: vi.fn(),
  getAssignedVariantId: vi.fn(),
  getLatestTrackingId: vi.fn(),
}))
vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))

import { GET } from './route'
import { getTestBySlug, getAssignedVariantId, getLatestTrackingId } from '@/lib/repo/redirect-repo'

const CHECKOUT_TEST = {
  id: 'test-1',
  slug: 'oferta-x',
  status: 'active' as const,
  fallback_url: null,
  test_type: 'checkout' as const,
  sales_page_url: 'https://example.com/vendas',
  variants: [
    { id: 'v1', name: 'A', weight_pct: 50, destination_url: 'https://pay.hub.la/aaa', is_control: true },
    { id: 'v2', name: 'B', weight_pct: 50, destination_url: 'https://pay.hub.la/bbb', is_control: false },
  ],
}

function request(cookie?: string) {
  return new NextRequest('https://ir.example.com/c/oferta-x', cookie ? { headers: { cookie } } : undefined)
}

const params = { params: Promise.resolve({ slug: 'oferta-x' }) }

describe('GET /c/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTestBySlug).mockResolvedValue(CHECKOUT_TEST)
    vi.mocked(getAssignedVariantId).mockResolvedValue(null)
    vi.mocked(getLatestTrackingId).mockResolvedValue(null)
  })

  it('sends an assigned visitor to their own checkout with the tracking id', async () => {
    vi.mocked(getLatestTrackingId).mockResolvedValue('trk_1')

    const response = await GET(request('ir_vid=visitor-1; ir_t_oferta-x=v2'), params)

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location')!)
    expect(location.origin + location.pathname).toBe('https://pay.hub.la/bbb')
    expect(location.searchParams.get('utm_content')).toBe('trk_1')
  })

  it('falls back to the stored assignment when only the visitor cookie survives', async () => {
    vi.mocked(getAssignedVariantId).mockResolvedValue('v2')
    vi.mocked(getLatestTrackingId).mockResolvedValue('trk_1')

    const response = await GET(request('ir_vid=visitor-1'), params)

    const location = new URL(response.headers.get('location')!)
    expect(location.origin + location.pathname).toBe('https://pay.hub.la/bbb')
    expect(location.searchParams.get('utm_content')).toBe('trk_1')
  })

  it('sends an organic visitor with no cookie to the control checkout, untracked', async () => {
    const response = await GET(request(), params)

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://pay.hub.la/aaa')
    expect(getLatestTrackingId).not.toHaveBeenCalled()
  })

  it('sends a visitor whose assigned variant was removed to the control checkout', async () => {
    const response = await GET(request('ir_vid=visitor-1; ir_t_oferta-x=deleted-variant'), params)

    expect(response.headers.get('location')).toBe('https://pay.hub.la/aaa')
  })

  it('keeps redirecting when the test is paused', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({ ...CHECKOUT_TEST, status: 'paused' })
    vi.mocked(getLatestTrackingId).mockResolvedValue('trk_1')

    const response = await GET(request('ir_vid=visitor-1; ir_t_oferta-x=v2'), params)

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location')!)
    expect(location.origin + location.pathname).toBe('https://pay.hub.la/bbb')
  })

  it('redirects without a tracking id when the click event was never recorded', async () => {
    vi.mocked(getLatestTrackingId).mockResolvedValue(null)

    const response = await GET(request('ir_vid=visitor-1; ir_t_oferta-x=v2'), params)

    expect(response.headers.get('location')).toBe('https://pay.hub.la/bbb')
  })

  it('returns 404 for a test that does not exist', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue(null)
    const response = await GET(request(), params)
    expect(response.status).toBe(404)
  })

  it('returns 404 for a page-mode test', async () => {
    vi.mocked(getTestBySlug).mockResolvedValue({
      ...CHECKOUT_TEST,
      test_type: 'page' as const,
      sales_page_url: null,
    })
    const response = await GET(request(), params)
    expect(response.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run "src/app/c/[slug]/route.test.ts"
```
Expected: FAIL — `./route` does not exist.

- [ ] **Step 3: Implement**

Create `src/app/c/[slug]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getAssignedVariantId, getLatestTrackingId, getTestBySlug } from '@/lib/repo/redirect-repo'
import { VISITOR_COOKIE, readAssignedVariantId } from '@/lib/domain/cookie-assignment'
import { withTrackingId } from '@/lib/domain/test-destination'

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const db = createServiceRoleClient()
  const test = await getTestBySlug(db, slug)

  // tests.status is deliberately not checked: pausing a test must never break a
  // buy button that is live on the client's sales page.
  if (!test || test.test_type !== 'checkout' || test.variants.length === 0) {
    return new NextResponse('Not found', { status: 404 })
  }

  const cookies = Object.fromEntries(request.cookies.getAll().map((c) => [c.name, c.value]))
  const visitorId = cookies[VISITOR_COOKIE]

  const cookieVariantId = readAssignedVariantId(cookies, test.slug)
  let variant = test.variants.find((v) => v.id === cookieVariantId)

  if (!variant && visitorId) {
    const assignedId = await getAssignedVariantId(db, { testId: test.id, visitorId })
    variant = test.variants.find((v) => v.id === assignedId)
  }

  const isKnownVisitor = Boolean(variant)
  const resolved = variant ?? test.variants.find((v) => v.is_control) ?? test.variants[0]

  const trackingId =
    isKnownVisitor && visitorId ? await getLatestTrackingId(db, { testId: test.id, visitorId }) : null

  return NextResponse.redirect(withTrackingId(resolved.destination_url, trackingId), 302)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run "src/app/c/[slug]/route.test.ts"
```
Expected: PASS (8 tests).

- [ ] **Step 5: Verify the full suite**

```bash
npx tsc --noEmit
npm run test
npm run build
```
Expected: all pass; the build's route list shows `ƒ /c/[slug]`.

- [ ] **Step 6: Commit**

```bash
git add "src/app/c/[slug]"
git commit -m "feat: add the buy-button go-link route"
```

---

### Task 6: Server actions — create and update with test type

**Files:**
- Modify: `src/app/dashboard/clients/[clientSlug]/actions.ts`
- Modify: `src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/actions.ts`

**Interfaces:**
- Consumes: the 8-parameter `create_test_with_variants` RPC (Task 1).
- Produces: `createTest` input gains `test_type: 'page' | 'checkout'` and `sales_page_url?: string`; `updateTest` input gains `test_type: 'page' | 'checkout'` (read-only, used for validation) and `sales_page_url?: string` — consumed by Task 7.

- [ ] **Step 1: Extend `createTest`**

In `src/app/dashboard/clients/[clientSlug]/actions.ts`, replace `createTestSchema` and the RPC call:

```ts
const createTestSchema = z
  .object({
    client_id: z.string().uuid(),
    name: z.string().min(1),
    slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
    fallback_url: httpUrl.optional().or(z.literal('')),
    conversion_method: z.enum(['hubla_webhook', 'thank_you_page']),
    test_type: z.enum(['page', 'checkout']),
    sales_page_url: httpUrl.optional().or(z.literal('')),
    variants: z.array(variantSchema).min(2),
  })
  .refine((data) => data.test_type !== 'checkout' || Boolean(data.sales_page_url), {
    message: 'Testes de checkout exigem a URL da página de vendas',
    path: ['sales_page_url'],
  })
```

and inside `createTest`, the RPC call becomes:

```ts
  const { error } = await supabase.rpc('create_test_with_variants', {
    p_client_id: parsed.client_id,
    p_name: parsed.name,
    p_slug: parsed.slug,
    p_fallback_url: parsed.fallback_url || null,
    p_conversion_method: parsed.conversion_method,
    p_test_type: parsed.test_type,
    p_sales_page_url: parsed.sales_page_url || null,
    p_variants: parsed.variants.map((v) => ({
      name: v.name,
      weight_pct: v.weight_pct,
      destination_url: v.destination_url,
      thank_you_url: v.thank_you_url || null,
    })),
  })
```

- [ ] **Step 2: Extend `updateTest`**

In `src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/actions.ts`, add the two fields to `updateTestSchema` (note `test_type` is only carried so the action can validate — it is never written):

```ts
const updateTestSchema = z.object({
  test_id: z.string().uuid(),
  client_slug: z.string(),
  test_slug: z.string(),
  test_type: z.enum(['page', 'checkout']),
  fallback_url: httpUrl.optional().or(z.literal('')),
  sales_page_url: httpUrl.optional().or(z.literal('')),
  variants: z
    .array(
      z.object({
        id: z.string().uuid(),
        weight_pct: z.coerce.number().gt(0).lte(100),
        destination_url: httpUrl,
        thank_you_url: httpUrl.optional().or(z.literal('')),
      })
    )
    .min(2),
})
```

Immediately after the existing weights check inside `updateTest`, add:

```ts
  // Catch this here so the operator gets a Portuguese message instead of the raw
  // tests_checkout_requires_sales_page constraint error from Postgres.
  if (parsed.test_type === 'checkout' && !parsed.sales_page_url) {
    throw new Error('Testes de checkout exigem a URL da página de vendas')
  }
```

and replace the `tests` update with:

```ts
  const { error: testError } = await supabase
    .from('tests')
    .update({
      fallback_url: parsed.fallback_url || null,
      sales_page_url: parsed.sales_page_url || null,
    })
    .eq('id', parsed.test_id)
  if (testError) throw testError
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
```
Expected: errors **only** in the two form components that call these actions without the new fields — those are fixed in Task 7. If any other file errors, stop and investigate.

- [ ] **Step 4: Commit**

```bash
git add "src/app/dashboard/clients/[clientSlug]/actions.ts" "src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/actions.ts"
git commit -m "feat: carry test type and sales page url through the test server actions"
```

---

### Task 7: Forms — test type selector and conditional fields

**Files:**
- Modify: `src/app/dashboard/clients/[clientSlug]/tests/new/page.tsx`
- Modify: `src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/edit/edit-test-form.tsx`
- Modify: `src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/edit/page.tsx`

**Interfaces:**
- Consumes: `createTest`, `updateTest` (Task 6).

- [ ] **Step 1: New-test form — state and selector**

In `src/app/dashboard/clients/[clientSlug]/tests/new/page.tsx`, add state next to the existing `conversionMethod` state:

```tsx
  const [testType, setTestType] = useState<'page' | 'checkout'>('page')
  const [salesPageUrl, setSalesPageUrl] = useState('')
```

Add the selector and the conditional field immediately **before** the existing `conversionMethod` `<select>`:

```tsx
        <select
          value={testType}
          onChange={(e) => setTestType(e.target.value as 'page' | 'checkout')}
          className={inputClass}
        >
          <option value="page">Teste de página</option>
          <option value="checkout">Teste de checkout</option>
        </select>

        {testType === 'checkout' && (
          <input
            placeholder="URL da página de vendas (única para todas as variantes)"
            value={salesPageUrl}
            onChange={(e) => setSalesPageUrl(e.target.value)}
            className={inputClass}
          />
        )}
```

Change the variant URL input's placeholder (inside the `variants.map`) from the fixed string to:

```tsx
              placeholder={testType === 'checkout' ? 'Link do checkout (https://pay.hub.la/...)' : 'URL de destino'}
```

- [ ] **Step 2: New-test form — validation and submit**

In `handleSubmit`, add right after the existing weights check:

```tsx
    if (testType === 'checkout' && !/^https?:\/\//i.test(salesPageUrl)) {
      setError('A URL da página de vendas deve começar com http:// ou https://')
      return
    }
```

Change the existing invalid-URL message so it names the right field:

```tsx
    const invalidUrlField = variants.find((v) => !/^https?:\/\//i.test(v.destination_url))
    if (invalidUrlField) {
      setError(
        testType === 'checkout'
          ? `O link do checkout da variante ${invalidUrlField.name} deve começar com http:// ou https://`
          : `A URL de destino da variante ${invalidUrlField.name} deve começar com http:// ou https://`
      )
      return
    }
```

And add the two fields to the `createTest` call, after `conversion_method`:

```tsx
        test_type: testType,
        sales_page_url: testType === 'checkout' ? salesPageUrl : '',
```

- [ ] **Step 3: Edit form — accept and render the new fields**

In `src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/edit/edit-test-form.tsx`, widen the `test` prop type:

```tsx
  test: {
    id: string
    name: string
    slug: string
    fallback_url: string | null
    test_type: 'page' | 'checkout'
    sales_page_url: string | null
  }
```

Add state next to `fallbackUrl`:

```tsx
  const [salesPageUrl, setSalesPageUrl] = useState(test.sales_page_url ?? '')
```

Insert this block immediately after the fallback-URL `<div>`, rendering the immutable type and the editable sales page:

```tsx
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-[#8A90A6]">Tipo de teste</label>
          <p className="rounded-[10px] border border-white/[0.08] bg-[#1B2036] px-3.5 py-2.5 text-sm text-[#8A90A6]">
            {test.test_type === 'checkout' ? 'Teste de checkout' : 'Teste de página'} — não pode ser alterado
            depois de criado
          </p>
        </div>

        {test.test_type === 'checkout' && (
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-[#8A90A6]">URL da página de vendas</label>
            <input
              placeholder="URL da página de vendas"
              value={salesPageUrl}
              onChange={(e) => setSalesPageUrl(e.target.value)}
              className={inputClass}
            />
          </div>
        )}
```

Change the variant URL input's placeholder to:

```tsx
              placeholder={test.test_type === 'checkout' ? 'Link do checkout' : 'URL de destino'}
```

And add the two fields to the `updateTest` call, after `fallback_url`:

```tsx
        test_type: test.test_type,
        sales_page_url: salesPageUrl,
```

- [ ] **Step 4: Edit page — pass the new fields through**

In `src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/edit/page.tsx`, add `test_type, sales_page_url` to the `.select(...)` string of the `tests` query, so the object handed to `<EditTestForm test={...} />` carries them. No other change in this file.

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit
npm run test
npm run build
```
Expected: all pass, with no remaining errors from Task 6.

- [ ] **Step 6: Commit**

```bash
git add "src/app/dashboard/clients/[clientSlug]/tests/new/page.tsx" "src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/edit"
git commit -m "feat: add test type selector and sales page field to the test forms"
```

---

### Task 8: Report page, test list badge, and delete warning

**Files:**
- Modify: `src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/page.tsx`
- Modify: `src/app/dashboard/clients/[clientSlug]/page.tsx`
- Modify: `src/components/confirm-delete-button.tsx`

**Interfaces:**
- Consumes: `tests.test_type` (Task 1); existing `CopyButton` and `activeDomain` already in scope on the report page.
- Produces: `ConfirmDeleteButton` gains an optional `warning?: string` prop — used by the client test list.

- [ ] **Step 1: Report page — select the test type and show the go-link**

In `src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/page.tsx`, add `test_type` to the existing `tests` select:

```ts
    .select('id, name, slug, status, conversion_method, fallback_url, test_type, client_id, clients(custom_domain, domain_status)')
```

Add the checkout link next to the existing `redirectUrl` definition:

```ts
  const checkoutLinkUrl = `https://${activeDomain}/c/${test.slug}`
```

Insert this block immediately **before** the `{pixelVariants && pixelVariants.length > 0 && (` block:

```tsx
      {test.test_type === 'checkout' && (
        <div className="mx-6 mb-6">
          <h2 className="mb-2 font-['Space_Grotesk'] text-lg font-semibold">Link do botão de comprar</h2>
          <div className="rounded-[10px] border border-white/[0.08] p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <p className="break-all font-['JetBrains_Mono'] text-xs text-[#4F8EF7]">{checkoutLinkUrl}</p>
              <CopyButton text={checkoutLinkUrl} />
            </div>
            <p className="text-xs text-[#8A90A6]">
              Cole este endereço no botão de comprar da página de vendas. Se a página tiver vários botões de
              compra, todos recebem o mesmo endereço. Trocar os checkouts ou os pesos depois não exige mexer na
              página de novo.
            </p>
          </div>
        </div>
      )}
```

- [ ] **Step 2: `ConfirmDeleteButton` — optional warning**

In `src/components/confirm-delete-button.tsx`, add the prop and render it in the confirming state:

```tsx
export function ConfirmDeleteButton({
  action,
  label = 'Excluir',
  warning,
}: {
  action: () => Promise<void>
  label?: string
  warning?: string
}) {
```

and replace the confirming-state `return` with:

```tsx
  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-[#F76C6C]">{warning ?? 'Confirmar?'}</span>
      <form action={action}>
        <button type="submit" className="text-xs font-semibold text-[#F76C6C] underline">
          Sim
        </button>
      </form>
      <button type="button" onClick={() => setConfirming(false)} className="text-xs text-[#8A90A6]">
        Não
      </button>
    </span>
  )
```

- [ ] **Step 3: Client test list — badge and delete warning**

In `src/app/dashboard/clients/[clientSlug]/page.tsx`, add `test_type` to the `tests` select:

```ts
    .select('id, name, slug, status, test_type')
```

Add the badge immediately after the existing status `<span>` (still inside the `<a>`):

```tsx
              <span className="rounded-full border border-white/[0.08] px-2.5 py-1 text-xs font-medium text-[#8A90A6]">
                {test.test_type === 'checkout' ? 'Checkout' : 'Página'}
              </span>
```

Replace the existing `<ConfirmDeleteButton action={deleteTest.bind(null, test.id, client.slug)} />` with:

```tsx
            <ConfirmDeleteButton
              action={deleteTest.bind(null, test.id, client.slug)}
              warning={
                test.test_type === 'checkout'
                  ? 'Isso vai quebrar o botão de comprar da página de vendas. Confirmar?'
                  : undefined
              }
            />
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
npm run test
npm run build
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add "src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/page.tsx" "src/app/dashboard/clients/[clientSlug]/page.tsx" src/components/confirm-delete-button.tsx
git commit -m "feat: show the buy-button link, test type badge and delete warning"
```

---

### Task 9: Deploy and manual verification

**Files:** none — operational task.

- [ ] **Step 1: Confirm the migration is applied to production**

```bash
npx supabase db push --db-url "$PRODUCTION_POSTGRES_URL_NON_POOLING"
```
Expected: no pending migrations (Task 1 already applied it), or `0012` applies cleanly.

- [ ] **Step 2: Deploy**

```bash
npx vercel deploy --prod
```

- [ ] **Step 3: Confirm page mode did not regress**

Open an existing page-mode test in the dashboard. Confirm it shows the badge "Página", that its report numbers and the redirect link are unchanged, and that no "Link do botão de comprar" block appears. Click its redirect link and confirm it still lands on a variant page with `utm_content` in the URL.

- [ ] **Step 4: Create a rehearsal checkout test**

Create a test with type "Checkout", the client's real sales page URL, and two variants at 50/50 pointing at the two real `pay.hub.la` links. Copy the "Link do botão de comprar" and set it as the `href` of every buy button on the sales page.

- [ ] **Step 5: Walk the happy path**

Open the campaign link. Confirm it lands on the sales page with `utm_content` present. Click buy. Confirm it lands on a `pay.hub.la` checkout with the same `utm_content` value carried over.

- [ ] **Step 6: Confirm the draw splits**

Repeat step 5 in fresh private windows until both checkout links have been observed.

- [ ] **Step 7: Confirm the organic path**

Open the sales page directly, without going through the campaign link, in a private window. Click buy. Confirm it lands on the **control** variant's checkout and that the URL has no `utm_content`.

- [ ] **Step 8: Confirm end-to-end attribution — mandatory, no substitute**

Complete a real purchase (low value or a 100% coupon) through the flow in step 5. Confirm the sale appears in the test report under the correct variant. No automated test reaches Hubla; this is the only step that proves the button-to-attributed-sale path.

- [ ] **Step 9: Confirm pausing does not break the button**

Pause the rehearsal test. Click the buy button on the sales page again and confirm it still redirects to a checkout.

- [ ] **Step 10: Go live**

Point one small campaign at the checkout test first. Verify attribution on the first real sales before scaling spend.
