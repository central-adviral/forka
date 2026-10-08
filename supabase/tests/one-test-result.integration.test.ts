import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)

describe('get_test_report returns one count for the whole report (0077)', () => {
  it('puts people, buyers, clicks, sales and revenue side by side, an upsell being a second sale of one buyer', async () => {
    const email = `one-result-${Date.now()}@example.com`
    const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
    const owner = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    await owner.auth.signInWithPassword({ email, password: 'password123' })
    const { data: client } = await admin.from('clients').insert({ owner_id: user!.user!.id, name: 'One', slug: `one-${Date.now()}` }).select().single()
    const { data: test } = await admin
      .from('tests')
      .insert({ client_id: client!.id, name: 'Um número', slug: `um-numero-${Date.now()}`, conversion_method: 'hubla_webhook' })
      .select()
      .single()
    const { data: variants } = await admin
      .from('variants')
      .insert([
        { test_id: test!.id, name: 'A', weight_pct: 50, destination_url: 'https://example.com/a', is_control: true },
        { test_id: test!.id, name: 'B', weight_pct: 50, destination_url: 'https://example.com/b', is_control: false },
      ])
      .select()
    const a = variants!.find((row) => row.name === 'A')!.id
    const b = variants!.find((row) => row.name === 'B')!.id

    const click = async (variantId: string, visitorId: string, at: string, isBot = false) => {
      const { data } = await admin
        .from('click_events')
        .insert({ test_id: test!.id, variant_id: variantId, visitor_id: visitorId, tracking_id: crypto.randomUUID(), source_utms: {}, is_bot: isBot, created_at: at })
        .select()
        .single()
      return data!.id as string
    }
    const ana = crypto.randomUUID()
    const bia = crypto.randomUUID()
    // Ana clicks twice in A and buys the product and the upsell: 1 person, 2 clicks, 1 buyer, 2 sales.
    const anaFirst = await click(a, ana, '2026-10-01T10:00:00Z')
    await click(a, ana, '2026-10-01T10:30:00Z')
    await admin.from('conversions').insert([
      { click_event_id: anaFirst, source: 'hubla_webhook', external_event_id: `inv-${anaFirst}-1`, value_cents: 19700, created_at: '2026-10-01T10:10:00Z' },
      { click_event_id: anaFirst, source: 'hubla_webhook', external_event_id: `inv-${anaFirst}-2`, value_cents: 3700, created_at: '2026-10-01T10:12:00Z' },
    ])
    // Bia enters B and does not buy; a bot click in B counts for nothing.
    await click(b, bia, '2026-10-01T11:00:00Z')
    await click(b, crypto.randomUUID(), '2026-10-01T11:05:00Z', true)

    const { data: report, error } = await owner.rpc('get_test_report', { p_test_id: test!.id, p_since: null, p_until: null })
    expect(error).toBeNull()
    const row = (id: string) => report!.find((r: { variant_id: string }) => r.variant_id === id)
    expect(row(a)).toMatchObject({ visits: 1, conversions: 1, clicks: 2, sales: 2, revenue_cents: 23400 })
    expect(row(b)).toMatchObject({ visits: 1, conversions: 0, clicks: 1, sales: 0, revenue_cents: 0 })
  })
})
