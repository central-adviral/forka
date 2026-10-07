import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)

describe('the A/B report counts people, not clicks (0067)', () => {
  it('counts a visitor once, credits a sale made through another test of the client, ignores a sale from before the entry, and allows weight 0', async () => {
    const email = `ab-visitor-${Date.now()}@example.com`
    const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
    const owner = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    await owner.auth.signInWithPassword({ email, password: 'password123' })
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: user!.user!.id, name: 'AB Visitor', slug: `ab-visitor-${Date.now()}` })
      .select()
      .single()
    const newTest = async (slug: string) =>
      (await admin.from('tests').insert({ client_id: client!.id, name: slug, slug: `${slug}-${Date.now()}`, conversion_method: 'thank_you_page' }).select().single()).data!

    const headline = await newTest('headline')
    const checkout = await newTest('checkout')
    const { data: variants, error: variantsError } = await admin
      .from('variants')
      .insert([
        { test_id: headline.id, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a', is_control: true },
        // Weight 0: kept in the test, receives no new traffic.
        { test_id: headline.id, name: 'B', weight_pct: 0, destination_url: 'https://example.com/b', is_control: false },
      ])
      .select()
    expect(variantsError).toBeNull()
    const variantA = variants!.find((v) => v.name === 'A')!
    const { data: checkoutVariant } = await admin
      .from('variants')
      .insert({ test_id: checkout.id, name: 'A', weight_pct: 100, destination_url: 'https://example.com/c', is_control: true })
      .select()
      .single()

    const click = async (testId: string, variantId: string, visitorId: string, at: string) =>
      (await admin
        .from('click_events')
        .insert({ test_id: testId, variant_id: variantId, visitor_id: visitorId, tracking_id: crypto.randomUUID(), source_utms: {}, created_at: at })
        .select()
        .single()).data!

    // v1 clicks the headline test three times, then buys through the checkout test's link.
    await click(headline.id, variantA.id, 'v1', '2026-10-01T10:00:00Z')
    await click(headline.id, variantA.id, 'v1', '2026-10-01T11:00:00Z')
    await click(headline.id, variantA.id, 'v1', '2026-10-01T12:00:00Z')
    const v1Checkout = await click(checkout.id, checkoutVariant!.id, 'v1', '2026-10-01T13:00:00Z')
    await admin.from('conversions').insert({ click_event_id: v1Checkout.id, source: 'thank_you_page', created_at: '2026-10-01T13:05:00Z' })
    // v2 bought through the checkout test before ever entering the headline test.
    const v2Checkout = await click(checkout.id, checkoutVariant!.id, 'v2', '2026-09-30T09:00:00Z')
    await admin.from('conversions').insert({ click_event_id: v2Checkout.id, source: 'thank_you_page', created_at: '2026-09-30T09:05:00Z' })
    await click(headline.id, variantA.id, 'v2', '2026-10-01T14:00:00Z')
    // v3 visits and does not buy.
    await click(headline.id, variantA.id, 'v3', '2026-10-01T15:00:00Z')

    const { data, error } = await owner.rpc('get_test_report', { p_test_id: headline.id, p_since: null, p_until: null })
    expect(error).toBeNull()
    const byName = Object.fromEntries((data as { variant_name: string; visits: number; conversions: number; weight_pct: number }[]).map((row) => [row.variant_name, row]))
    expect(Number(byName.A.visits)).toBe(3)
    expect(Number(byName.A.conversions)).toBe(1)
    expect(Number(byName.B.visits)).toBe(0)
    expect(Number(byName.B.weight_pct)).toBe(0)
  })
})
