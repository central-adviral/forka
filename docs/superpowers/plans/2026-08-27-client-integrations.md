# Client Integrations (domain + Hubla) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator configure a redirect domain and a Hubla webhook token per client, through a new "Integrações" tab in the dashboard, instead of the single global `NEXT_PUBLIC_REDIRECT_DOMAIN`/`HUBLA_WEBHOOK_TOKEN` env vars.

**Architecture:** Three new columns on `clients` (`custom_domain`, `domain_status`, `hubla_webhook_token`). A pure `resolveRedirectDomain` function decides whether to use the client's domain (only once `domain_status = 'verified'`) or the existing default. DNS verification is a plain Node `dns.resolveCname` call server-side — no external API or credential. The Hubla webhook route moves from a single static path to `/api/webhooks/hubla/[clientSlug]`, looking up that client's token instead of a global env var.

**Tech Stack:** Same as the rest of the app — Next.js App Router, TypeScript, Supabase (`@supabase/supabase-js`), Zod, Vitest.

**Spec:** [docs/superpowers/specs/2026-08-27-client-integrations-design.md](../specs/2026-08-27-client-integrations-design.md)

## Global Constraints

- `domain_status` has exactly three values: `unconfigured` (default), `pending`, `verified`.
- The redirect domain shown anywhere (test link, webhook URL) uses the client's `custom_domain` **only** when `domain_status === 'verified'`; otherwise it falls back to `process.env.NEXT_PUBLIC_REDIRECT_DOMAIN`.
- The expected CNAME target is the literal string `cname.vercel-dns.com` (Vercel's fixed target for any subdomain) — this never varies per client.
- Registering the domain in the Vercel project itself stays a manual, out-of-band step (the operator runs `vercel domains add` when told a client's DNS is verified) — no Vercel API token is introduced by this plan.
- The old static route `/api/webhooks/hubla/route.ts` is removed and replaced by `/api/webhooks/hubla/[clientSlug]/route.ts` — there is no backwards-compatible redirect, since no real webhook is configured against the old path yet.

---

### Task 1: Migration — per-client domain and Hubla token columns

**Files:**
- Create: `supabase/migrations/0010_client_integrations.sql`

**Interfaces:**
- Adds columns to `clients`: `custom_domain text`, `domain_status text not null default 'unconfigured' check (...)`, `hubla_webhook_token text`. Consumed by every task below.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0010_client_integrations.sql`:

```sql
alter table clients
  add column custom_domain text,
  add column domain_status text not null default 'unconfigured'
    check (domain_status in ('unconfigured', 'pending', 'verified')),
  add column hubla_webhook_token text;
```

- [ ] **Step 2: Apply the migration**

```bash
npx supabase db push --db-url "$PRODUCTION_POSTGRES_URL_NON_POOLING"
```
(Use the same non-pooling connection string used for prior migrations in this project. If running against local Supabase instead, use `npx supabase db push --linked` or `db reset` per the project's existing convention.)

Expected: applies `0010_client_integrations.sql` with no errors; `select custom_domain, domain_status, hubla_webhook_token from clients limit 1;` returns the new columns.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0010_client_integrations.sql
git commit -m "feat: add per-client domain and Hubla token columns"
```

---

### Task 2: Domain — resolution and DNS-check pure functions

**Files:**
- Create: `src/lib/domain/redirect-domain.ts`
- Test: `src/lib/domain/redirect-domain.test.ts`

**Interfaces:**
- Produces: `resolveRedirectDomain(client: { customDomain: string | null; domainStatus: 'unconfigured' | 'pending' | 'verified' }, defaultDomain: string): string` — consumed by Task 4 (report page) and Task 6 (integrations page, for the webhook URL shown).
- Produces: `isCnameVerified(records: string[]): boolean` — consumed by Task 6's `verifyDomain` server action.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/domain/redirect-domain.test.ts
import { describe, it, expect } from 'vitest'
import { resolveRedirectDomain, isCnameVerified } from './redirect-domain'

describe('resolveRedirectDomain', () => {
  it('uses the default domain when unconfigured', () => {
    expect(resolveRedirectDomain({ customDomain: null, domainStatus: 'unconfigured' }, 'app.vercel.app')).toBe(
      'app.vercel.app'
    )
  })

  it('uses the default domain while pending, even if a custom domain is set', () => {
    expect(
      resolveRedirectDomain({ customDomain: 'ir.gustavovoe.com', domainStatus: 'pending' }, 'app.vercel.app')
    ).toBe('app.vercel.app')
  })

  it('uses the custom domain once verified', () => {
    expect(
      resolveRedirectDomain({ customDomain: 'ir.gustavovoe.com', domainStatus: 'verified' }, 'app.vercel.app')
    ).toBe('ir.gustavovoe.com')
  })

  it('falls back to the default if verified but the domain is somehow null', () => {
    expect(resolveRedirectDomain({ customDomain: null, domainStatus: 'verified' }, 'app.vercel.app')).toBe(
      'app.vercel.app'
    )
  })
})

describe('isCnameVerified', () => {
  it('matches the expected Vercel CNAME target exactly', () => {
    expect(isCnameVerified(['cname.vercel-dns.com'])).toBe(true)
  })

  it('matches case-insensitively and ignores a trailing dot', () => {
    expect(isCnameVerified(['CNAME.VERCEL-DNS.COM.'])).toBe(true)
  })

  it('returns false when no record matches', () => {
    expect(isCnameVerified(['some-other-target.example.com'])).toBe(false)
  })

  it('returns false for an empty record list', () => {
    expect(isCnameVerified([])).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/domain/redirect-domain.test.ts
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```ts
// src/lib/domain/redirect-domain.ts
export type DomainStatus = 'unconfigured' | 'pending' | 'verified'

export interface ClientDomainInfo {
  customDomain: string | null
  domainStatus: DomainStatus
}

export function resolveRedirectDomain(client: ClientDomainInfo, defaultDomain: string): string {
  if (client.domainStatus === 'verified' && client.customDomain) {
    return client.customDomain
  }
  return defaultDomain
}

const EXPECTED_CNAME_TARGET = 'cname.vercel-dns.com'

export function isCnameVerified(records: string[]): boolean {
  return records.some((record) => record.toLowerCase().replace(/\.$/, '') === EXPECTED_CNAME_TARGET)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/domain/redirect-domain.test.ts
```
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/redirect-domain.ts src/lib/domain/redirect-domain.test.ts
git commit -m "feat: add redirect-domain resolution and CNAME check helpers"
```

---

### Task 3: Repository — extend click-event lookup with the owning client

**Files:**
- Modify: `src/lib/repo/conversion-repo.ts`
- Modify: `src/lib/repo/conversion-repo.integration.test.ts`

**Interfaces:**
- Consumes: existing `click_events → tests` join, extended to also select `tests.client_id`.
- Produces: `getClickEventByTrackingId` now returns `{ id: string; testSlug: string; clientId: string } | null` (adds `clientId` — additive, non-breaking for existing callers that only read `.id`/`.testSlug`) — consumed by Task 5's per-client webhook route for the cross-client isolation check.

- [ ] **Step 1: Add a failing test for the new field**

Add this test inside the existing `describe('conversion-repo', ...)` block in `src/lib/repo/conversion-repo.integration.test.ts` (same file, same `beforeAll` setup already creates `trackingId` against a test belonging to a known client — capture that client's id in `beforeAll` as `clientId` if not already in scope, then assert against it):

```ts
  it('includes the owning client id, so per-client callers can verify ownership', async () => {
    const result = await getClickEventByTrackingId(db, trackingId)
    expect(result?.clientId).toBe(clientId)
  })
```

(If `clientId` isn't already captured in this file's `beforeAll`, add `let clientId: string` alongside the existing `let clickEventId: string` / `let trackingId: string` declarations, and set it from the `client` row already being inserted there, e.g. `clientId = client!.id`.)

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/repo/conversion-repo.integration.test.ts
```
Expected: FAIL — `result?.clientId` is `undefined`.

- [ ] **Step 3: Implement**

In `src/lib/repo/conversion-repo.ts`, replace `getClickEventByTrackingId`:

```ts
export async function getClickEventByTrackingId(
  db: SupabaseClient,
  trackingId: string
): Promise<{ id: string; testSlug: string; clientId: string } | null> {
  const { data, error } = await db
    .from('click_events')
    .select('id, tests(slug, client_id)')
    .eq('tracking_id', trackingId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const test = data.tests as unknown as { slug: string; client_id: string } | null
  return { id: data.id, testSlug: test?.slug ?? '', clientId: test?.client_id ?? '' }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/repo/conversion-repo.integration.test.ts
```
Expected: PASS (all tests, including the new one).

- [ ] **Step 5: Commit**

```bash
git add src/lib/repo/conversion-repo.ts src/lib/repo/conversion-repo.integration.test.ts
git commit -m "feat: include owning client id in click-event lookup"
```

---

### Task 4: Report page — use the client's verified domain

**Files:**
- Modify: `src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/page.tsx`

**Interfaces:**
- Consumes: `resolveRedirectDomain` (Task 2).

- [ ] **Step 1: Add the client's domain fields to the existing `tests` select**

Change:
```ts
    .select('id, name, slug, status, conversion_method, fallback_url')
```
to:
```ts
    .select('id, name, slug, status, conversion_method, fallback_url, client_id, clients(custom_domain, domain_status)')
```

- [ ] **Step 2: Use `resolveRedirectDomain` for the existing `redirectUrl`**

Add the import:
```ts
import { resolveRedirectDomain } from '@/lib/domain/redirect-domain'
```

Replace the existing line:
```ts
  const redirectUrl = `https://${process.env.NEXT_PUBLIC_REDIRECT_DOMAIN}/r/${test.slug}`
```
with:
```ts
  const clientDomain = test.clients as unknown as { custom_domain: string | null; domain_status: 'unconfigured' | 'pending' | 'verified' } | null
  const activeDomain = resolveRedirectDomain(
    { customDomain: clientDomain?.custom_domain ?? null, domainStatus: clientDomain?.domain_status ?? 'unconfigured' },
    process.env.NEXT_PUBLIC_REDIRECT_DOMAIN ?? ''
  )
  const redirectUrl = `https://${activeDomain}/r/${test.slug}`
```

- [ ] **Step 3: Apply the same substitution in the pixel-snippet section**

Find the existing pixel-snippet template string:
```ts
      img.src = 'https://${process.env.NEXT_PUBLIC_REDIRECT_DOMAIN}/ty/${test.slug}?tid=' + encodeURIComponent(tid);
```
and replace it with:
```ts
      img.src = 'https://${activeDomain}/ty/${test.slug}?tid=' + encodeURIComponent(tid);
```
(This is inside a template literal already interpolating `test.slug` the same way — `activeDomain` is in scope from Step 2, defined once near the top of the component.)

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
npm run build
```
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add "src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/page.tsx"
git commit -m "feat: use the client's verified domain for redirect and pixel links"
```

---

### Task 5: Hubla webhook route — per client

**Files:**
- Create: `src/app/api/webhooks/hubla/[clientSlug]/route.ts`
- Create: `src/app/api/webhooks/hubla/[clientSlug]/route.test.ts`
- Delete: `src/app/api/webhooks/hubla/route.ts`
- Delete: `src/app/api/webhooks/hubla/route.test.ts`

**Interfaces:**
- Consumes: `verifyHublaToken`, `parseHublaPaymentSucceeded`, `HublaIrrelevantEventError` (existing, unchanged), `getClickEventByTrackingId` (Task 3, now returns `clientId`), `insertConversionIfNew` (existing).

- [ ] **Step 1: Write the failing test**

Create `src/app/api/webhooks/hubla/[clientSlug]/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/domain/hubla', () => ({
  verifyHublaToken: vi.fn(),
  parseHublaPaymentSucceeded: vi.fn(),
  HublaIrrelevantEventError: class HublaIrrelevantEventError extends Error {},
}))
vi.mock('@/lib/repo/conversion-repo', () => ({
  getClickEventByTrackingId: vi.fn(),
  insertConversionIfNew: vi.fn(),
}))
vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: vi.fn(() => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: mockClientRow, error: null }),
        }),
      }),
    }),
  })),
}))

let mockClientRow: { id: string; hubla_webhook_token: string | null } | null

import { POST } from './route'
import { verifyHublaToken, parseHublaPaymentSucceeded } from '@/lib/domain/hubla'
import { getClickEventByTrackingId, insertConversionIfNew } from '@/lib/repo/conversion-repo'

function makeRequest(body: unknown, token = 'valid-token') {
  return new NextRequest('https://ir.example.com/api/webhooks/hubla/gustavo-voe', {
    method: 'POST',
    headers: { 'x-hubla-token': token, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/webhooks/hubla/[clientSlug]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClientRow = { id: 'client-1', hubla_webhook_token: 'valid-token' }
  })

  it('returns 404 when the client slug does not exist', async () => {
    mockClientRow = null
    const response = await POST(makeRequest({}), { params: Promise.resolve({ clientSlug: 'unknown' }) })
    expect(response.status).toBe(404)
  })

  it('returns 404 when the client has no Hubla token configured', async () => {
    mockClientRow = { id: 'client-1', hubla_webhook_token: null }
    const response = await POST(makeRequest({}), { params: Promise.resolve({ clientSlug: 'gustavo-voe' }) })
    expect(response.status).toBe(404)
  })

  it('rejects an invalid token with 401', async () => {
    vi.mocked(verifyHublaToken).mockReturnValue(false)
    const response = await POST(makeRequest({}, 'wrong-token'), { params: Promise.resolve({ clientSlug: 'gustavo-voe' }) })
    expect(response.status).toBe(401)
  })

  it('does not attribute a click event belonging to a different client', async () => {
    vi.mocked(verifyHublaToken).mockReturnValue(true)
    vi.mocked(parseHublaPaymentSucceeded).mockReturnValue({ trackingId: 'trk_1', externalEventId: 'inv_1', valueCents: 1000 })
    vi.mocked(getClickEventByTrackingId).mockResolvedValue({ id: 'click_1', testSlug: 'oferta-x', clientId: 'other-client' })

    const response = await POST(makeRequest({}), { params: Promise.resolve({ clientSlug: 'gustavo-voe' }) })
    const json = await response.json()
    expect(json).toEqual({ ok: true, attributed: false })
    expect(insertConversionIfNew).not.toHaveBeenCalled()
  })

  it('records a conversion when the click event belongs to this client', async () => {
    vi.mocked(verifyHublaToken).mockReturnValue(true)
    vi.mocked(parseHublaPaymentSucceeded).mockReturnValue({ trackingId: 'trk_1', externalEventId: 'inv_1', valueCents: 1000 })
    vi.mocked(getClickEventByTrackingId).mockResolvedValue({ id: 'click_1', testSlug: 'oferta-x', clientId: 'client-1' })
    vi.mocked(insertConversionIfNew).mockResolvedValue('inserted')

    const response = await POST(makeRequest({}), { params: Promise.resolve({ clientSlug: 'gustavo-voe' }) })
    const json = await response.json()
    expect(json).toEqual({ ok: true, attributed: true, result: 'inserted' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run "src/app/api/webhooks/hubla/[clientSlug]/route.test.ts"
```
Expected: FAIL — `route.ts` does not exist.

- [ ] **Step 3: Implement**

Create `src/app/api/webhooks/hubla/[clientSlug]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { HublaIrrelevantEventError, verifyHublaToken, parseHublaPaymentSucceeded } from '@/lib/domain/hubla'
import { getClickEventByTrackingId, insertConversionIfNew } from '@/lib/repo/conversion-repo'

export async function POST(request: NextRequest, { params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params
  const db = createServiceRoleClient()

  const { data: client } = await db
    .from('clients')
    .select('id, hubla_webhook_token')
    .eq('slug', clientSlug)
    .maybeSingle()

  if (!client || !client.hubla_webhook_token) {
    return new NextResponse('Not found', { status: 404 })
  }

  const receivedToken = request.headers.get('x-hubla-token')
  if (!verifyHublaToken(receivedToken, client.hubla_webhook_token)) {
    console.error(`[hubla-webhook] rejected: invalid or missing x-hubla-token for client ${clientSlug}`)
    return new NextResponse('Invalid token', { status: 401 })
  }

  let parsed
  try {
    const payload = await request.json()
    parsed = parseHublaPaymentSucceeded(payload)
  } catch (err) {
    if (err instanceof HublaIrrelevantEventError) {
      return NextResponse.json({ ok: true, attributed: false })
    }
    console.error('[hubla-webhook] rejected malformed payload', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ ok: false, attributed: false }, { status: 422 })
  }

  if (!parsed.trackingId) {
    return NextResponse.json({ ok: true, attributed: false })
  }

  const clickEvent = await getClickEventByTrackingId(db, parsed.trackingId)
  if (!clickEvent || clickEvent.clientId !== client.id) {
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

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run "src/app/api/webhooks/hubla/[clientSlug]/route.test.ts"
```
Expected: PASS (5 tests).

- [ ] **Step 5: Delete the old static route and its test**

```bash
git rm src/app/api/webhooks/hubla/route.ts src/app/api/webhooks/hubla/route.test.ts
```

- [ ] **Step 6: Verify the full suite and build**

```bash
npx tsc --noEmit
npm run test
npm run build
```
Expected: all pass; the build's route list should show `ƒ /api/webhooks/hubla/[clientSlug]` and no longer show the old static `/api/webhooks/hubla`.

- [ ] **Step 7: Commit**

```bash
git add "src/app/api/webhooks/hubla/[clientSlug]"
git commit -m "feat: move Hubla webhook to a per-client route"
```

---

### Task 6: Integrations page — domain and Hubla token UI

**Files:**
- Create: `src/app/dashboard/clients/[clientSlug]/integrations/actions.ts`
- Create: `src/app/dashboard/clients/[clientSlug]/integrations/page.tsx`
- Modify: `src/app/dashboard/clients/[clientSlug]/page.tsx` (add a link to the new tab)

**Interfaces:**
- Consumes: `resolveRedirectDomain`, `isCnameVerified` (Task 2).
- Produces: server actions `saveDomain`, `verifyDomain`, `saveHublaToken` — used only by this page.

- [ ] **Step 1: Server actions**

Create `src/app/dashboard/clients/[clientSlug]/integrations/actions.ts`:

```ts
'use server'

import { z } from 'zod'
import { promises as dns } from 'node:dns'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { isCnameVerified } from '@/lib/domain/redirect-domain'

const domainSchema = z.object({
  client_id: z.string().uuid(),
  client_slug: z.string(),
  custom_domain: z
    .string()
    .min(1, 'informe um domínio')
    .regex(/^[a-z0-9.-]+$/i, 'domínio inválido — use apenas letras, números, pontos e hífen'),
})

export async function saveDomain(context: { client_id: string; client_slug: string }, formData: FormData) {
  const result = domainSchema.safeParse({
    client_id: context.client_id,
    client_slug: context.client_slug,
    custom_domain: formData.get('custom_domain'),
  })
  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => issue.message).join('; '))
  }
  const parsed = result.data
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from('clients')
    .update({ custom_domain: parsed.custom_domain, domain_status: 'pending' })
    .eq('id', parsed.client_id)
  if (error) throw error
  revalidatePath(`/dashboard/clients/${parsed.client_slug}/integrations`)
}

export async function verifyDomain(context: { client_id: string; client_slug: string; custom_domain: string }) {
  const supabase = await createServerSupabaseClient()
  let verified = false
  try {
    const records = await dns.resolveCname(context.custom_domain)
    verified = isCnameVerified(records)
  } catch {
    verified = false
  }
  const { error } = await supabase
    .from('clients')
    .update({ domain_status: verified ? 'verified' : 'pending' })
    .eq('id', context.client_id)
  if (error) throw error
  revalidatePath(`/dashboard/clients/${context.client_slug}/integrations`)
}

const hublaTokenSchema = z.object({
  client_id: z.string().uuid(),
  client_slug: z.string(),
  hubla_webhook_token: z.string().min(1, 'informe um token'),
})

export async function saveHublaToken(context: { client_id: string; client_slug: string }, formData: FormData) {
  const result = hublaTokenSchema.safeParse({
    client_id: context.client_id,
    client_slug: context.client_slug,
    hubla_webhook_token: formData.get('hubla_webhook_token'),
  })
  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => issue.message).join('; '))
  }
  const parsed = result.data
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from('clients')
    .update({ hubla_webhook_token: parsed.hubla_webhook_token })
    .eq('id', parsed.client_id)
  if (error) throw error
  revalidatePath(`/dashboard/clients/${parsed.client_slug}/integrations`)
}
```

- [ ] **Step 2: Integrations page**

Create `src/app/dashboard/clients/[clientSlug]/integrations/page.tsx`:

```tsx
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { resolveRedirectDomain } from '@/lib/domain/redirect-domain'
import { saveDomain, verifyDomain, saveHublaToken } from './actions'

const STATUS_LABEL: Record<string, string> = {
  unconfigured: 'Não configurado',
  pending: 'Aguardando DNS',
  verified: 'Verificado',
}

const STATUS_COLOR: Record<string, string> = {
  unconfigured: '#8A90A6',
  pending: '#F5B94D',
  verified: '#2DD4A8',
}

export default async function IntegrationsPage({ params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase
    .from('clients')
    .select('id, slug, custom_domain, domain_status, hubla_webhook_token')
    .eq('slug', clientSlug)
    .maybeSingle()

  if (!client) notFound()

  const defaultDomain = process.env.NEXT_PUBLIC_REDIRECT_DOMAIN ?? ''
  const activeDomain = resolveRedirectDomain(
    { customDomain: client.custom_domain, domainStatus: client.domain_status as 'unconfigured' | 'pending' | 'verified' },
    defaultDomain
  )
  const webhookUrl = `https://${activeDomain}/api/webhooks/hubla/${client.slug}`

  return (
    <div className="max-w-xl space-y-8 p-8">
      <h1 className="font-['Space_Grotesk'] text-xl font-semibold">Integrações</h1>

      <section className="space-y-4 rounded-2xl border border-white/[0.08] p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-['Space_Grotesk'] text-base font-semibold">Domínio</h2>
          <span
            className="rounded-full px-2.5 py-1 text-xs font-medium"
            style={{ color: STATUS_COLOR[client.domain_status], border: `1px solid ${STATUS_COLOR[client.domain_status]}55` }}
          >
            {STATUS_LABEL[client.domain_status]}
          </span>
        </div>

        <form action={saveDomain.bind(null, { client_id: client.id, client_slug: client.slug })} className="flex gap-2">
          <input
            name="custom_domain"
            placeholder="ir.seudominio.com"
            defaultValue={client.custom_domain ?? ''}
            className="flex-1 rounded-[10px] border border-white/[0.08] bg-[#1B2036] px-3.5 py-2.5 text-sm text-[#E8EAF2] placeholder:text-[#8A90A6] outline-none focus:border-[#7C6FF0]"
          />
          <button
            type="submit"
            className="rounded-[10px] bg-[#7C6FF0] px-4 py-2.5 text-sm font-semibold text-[#0B0E1A]"
          >
            Salvar
          </button>
        </form>

        {client.custom_domain && (
          <>
            <div className="rounded-[10px] border border-white/[0.08] bg-[#1B2036] p-3 font-['JetBrains_Mono'] text-xs text-[#8A90A6]">
              Tipo: CNAME
              <br />
              Nome: {client.custom_domain.split('.')[0]}
              <br />
              Valor: cname.vercel-dns.com
            </div>

            <form action={verifyDomain.bind(null, { client_id: client.id, client_slug: client.slug, custom_domain: client.custom_domain })}>
              <button
                type="submit"
                className="rounded-[10px] border border-white/[0.08] px-4 py-2.5 text-sm font-medium text-[#8A90A6]"
              >
                Verificar
              </button>
            </form>

            <p className="text-xs text-[#8A90A6]">
              Depois que o DNS estiver verificado, avise o responsável técnico para finalizar o registro do
              domínio — esse último passo ainda é manual.
            </p>
          </>
        )}
      </section>

      <section className="space-y-4 rounded-2xl border border-white/[0.08] p-5">
        <h2 className="font-['Space_Grotesk'] text-base font-semibold">Hubla</h2>

        <form action={saveHublaToken.bind(null, { client_id: client.id, client_slug: client.slug })} className="flex gap-2">
          <input
            name="hubla_webhook_token"
            placeholder="Token do webhook"
            defaultValue={client.hubla_webhook_token ?? ''}
            className="flex-1 rounded-[10px] border border-white/[0.08] bg-[#1B2036] px-3.5 py-2.5 text-sm text-[#E8EAF2] placeholder:text-[#8A90A6] outline-none focus:border-[#7C6FF0]"
          />
          <button
            type="submit"
            className="rounded-[10px] bg-[#7C6FF0] px-4 py-2.5 text-sm font-semibold text-[#0B0E1A]"
          >
            Salvar
          </button>
        </form>

        <div>
          <p className="mb-1 text-xs text-[#8A90A6]">Cole esta URL no painel da Hubla:</p>
          <p className="break-all rounded-[10px] border border-white/[0.08] bg-[#1B2036] p-3 font-['JetBrains_Mono'] text-xs text-[#4F8EF7]">
            {webhookUrl}
          </p>
        </div>
      </section>
    </div>
  )
}
```

- [ ] **Step 3: Link to the new tab from the client's test list**

In `src/app/dashboard/clients/[clientSlug]/page.tsx`, find the header block:

```tsx
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-['Space_Grotesk'] text-xl font-semibold">Testes — {client.name}</h1>
        <a
```

Replace it with (wrapping the existing "Novo teste" link in a flex group alongside a new "Integrações" link — keep the existing `<a>`'s attributes exactly as they are today, only add a sibling before it):

```tsx
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-['Space_Grotesk'] text-xl font-semibold">Testes — {client.name}</h1>
        <div className="flex items-center gap-3">
          <a
            href={`/dashboard/clients/${client.slug}/integrations`}
            className="rounded-[9px] border border-white/[0.08] px-4 py-2.5 text-[13.5px] font-medium text-[#8A90A6]"
          >
            Integrações
          </a>
          <a
```

(Close the new wrapping `</div>` right after the existing "Novo teste" `</a>`, before the outer header `</div>`.)

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
npm run test
npm run build
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add "src/app/dashboard/clients/[clientSlug]/integrations" "src/app/dashboard/clients/[clientSlug]/page.tsx"
git commit -m "feat: add per-client integrations tab for domain and Hubla token"
```

---

### Task 7: Deploy

**Files:** none — operational task.

- [ ] **Step 1: Push the migration to production** (if not already done in Task 1's Step 2 against the production database directly)

```bash
npx supabase db push --db-url "$PRODUCTION_POSTGRES_URL_NON_POOLING"
```

- [ ] **Step 2: Deploy to Vercel**

```bash
npx vercel deploy --prod
```

- [ ] **Step 3: Manual verification**

Open a client's new "Integrações" tab in the deployed app. Save a domain, confirm the CNAME instructions and status pill render; click "Verificar" on a domain with no real DNS yet and confirm it stays "Aguardando DNS" without crashing. Save a Hubla token and confirm the webhook URL shown uses the right client slug. Open that client's test report page and confirm the link/pixel snippet still render correctly (using the default Vercel domain, since no real custom domain is verified yet).
