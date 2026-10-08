import { describe, it, expect } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

async function setup() {
  const email = `layers-${unique()}@example.com`
  const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  const owner = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  await owner.auth.signInWithPassword({ email, password: 'password123' })
  const { data: client } = await admin.from('clients').insert({ owner_id: user!.user!.id, name: 'Layers', slug: `layers-${unique()}` }).select().single()
  const { data: funnels } = await admin
    .from('sales_funnels')
    .insert([
      { client_id: client!.id, name: 'F', slug: `f-${unique()}` },
      { client_id: client!.id, name: 'G', slug: `g-${unique()}` },
    ])
    .select()
  return { owner, clientId: client!.id as string, f: funnels![0].id as string, g: funnels![1].id as string }
}

async function createTest(db: SupabaseClient, clientId: string, testType: 'page' | 'checkout', funnelId: string | null) {
  const slug = `t-${unique()}`
  const { data: id, error } = await db.rpc('create_test_with_variants', {
    p_client_id: clientId,
    p_name: slug,
    p_slug: slug,
    p_fallback_url: null,
    p_conversion_method: 'hubla_webhook',
    p_test_type: testType,
    p_sales_page_url: testType === 'checkout' ? 'https://example.com/vendas' : null,
    p_variants: [
      { name: 'A', weight_pct: 50, destination_url: 'https://example.com/a' },
      { name: 'B', weight_pct: 50, destination_url: 'https://example.com/b' },
    ],
    ...(funnelId ? { p_sales_funnel_id: funnelId } : {}),
  })
  if (error) return { error }
  const { data: variants } = await admin.from('variants').select('id, name').eq('test_id', id).order('name')
  return { id: id as string, a: variants![0].id as string, error: null }
}

async function click(testId: string, variantId: string, visitorId: string, at: string) {
  const { data } = await admin
    .from('click_events')
    .insert({ test_id: testId, variant_id: variantId, visitor_id: visitorId, tracking_id: crypto.randomUUID(), source_utms: {}, created_at: at })
    .select()
    .single()
  return data!.id as string
}

async function sale(clickId: string, at: string) {
  await admin.from('conversions').insert({ click_event_id: clickId, source: 'hubla_webhook', external_event_id: `inv-${unique()}`, value_cents: 10000, created_at: at })
}

async function buyersOf(db: SupabaseClient, testId: string) {
  const { data } = await db.rpc('get_test_report', { p_test_id: testId, p_since: null, p_until: null })
  return (data as { conversions: number }[]).reduce((sum, row) => sum + Number(row.conversions), 0)
}

describe('0078/0087: tests in a project, credit inside the project', () => {
  it('runs several active tests of one type in a project (0087), a checkout test beside them, and still creates without a project', async () => {
    const { owner, clientId, f } = await setup()
    expect((await createTest(owner, clientId, 'page', f)).error).toBeNull()
    expect((await createTest(owner, clientId, 'page', f)).error).toBeNull()
    expect((await createTest(owner, clientId, 'checkout', f)).error).toBeNull()
    // A call without the project, as code deployed before 0078 makes it.
    expect((await createTest(owner, clientId, 'page', null)).error).toBeNull()
  })

  it('does not link a test to a project of another client', async () => {
    const { owner, clientId } = await setup()
    const other = await setup()
    const test = await createTest(owner, clientId, 'page', null)
    const { error } = await admin.from('tests').update({ sales_funnel_id: other.f }).eq('id', test.id!)
    expect(error?.message).toContain('tests_sales_funnel_fkey')
  })

  it('credits a sale inside the project only, and to both layers of a page + checkout journey', async () => {
    const { owner, clientId, f, g } = await setup()
    const page = await createTest(owner, clientId, 'page', f)
    const checkout = await createTest(owner, clientId, 'checkout', f)
    const otherProject = await createTest(owner, clientId, 'page', g)
    const ana = crypto.randomUUID()

    // Ana enters the page test, reaches the buy button (entered into the checkout test by /c) and buys.
    await click(page.id!, page.a!, ana, '2026-10-01T10:00:00Z')
    const checkoutClick = await click(checkout.id!, checkout.a!, ana, '2026-10-01T10:05:00Z')
    await sale(checkoutClick, '2026-10-01T10:10:00Z')
    // Ana also went through a test of another project, before the sale.
    await click(otherProject.id!, otherProject.a!, ana, '2026-10-01T09:00:00Z')

    expect(await buyersOf(owner, page.id!)).toBe(1)
    expect(await buyersOf(owner, checkout.id!)).toBe(1)
    expect(await buyersOf(owner, otherProject.id!)).toBe(0)
  })
})
