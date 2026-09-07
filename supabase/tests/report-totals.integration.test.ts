import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const admin = createClient(URL, SERVICE_ROLE_KEY)

async function createSignedInOwner() {
  const email = `totals-report-${Date.now()}@example.com`
  const { data } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  const asOwner = createClient(URL, ANON_KEY)
  await asOwner.auth.signInWithPassword({ email, password: 'password123' })
  return { userId: data.user!.id, asOwner }
}

describe('get_test_report_totals', () => {
  it('never counts a bot-flagged click or its conversion, on any column', async () => {
    const { userId, asOwner } = await createSignedInOwner()
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: userId, name: 'Totals Test', slug: `totals-test-${Date.now()}` })
      .select()
      .single()

    const { data: test } = await admin
      .from('tests')
      .insert({
        client_id: client!.id,
        name: 'Teste Totais',
        slug: `teste-totais-${Date.now()}`,
        conversion_method: 'thank_you_page',
      })
      .select()
      .single()
    const { data: variant } = await admin
      .from('variants')
      .insert({ test_id: test!.id, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a', is_control: true })
      .select()
      .single()

    const { data: realClick } = await admin
      .from('click_events')
      .insert({
        test_id: test!.id,
        variant_id: variant!.id,
        visitor_id: 'v-real',
        tracking_id: crypto.randomUUID(),
        source_utms: {},
      })
      .select()
      .single()
    await admin
      .from('conversions')
      .insert({ click_event_id: realClick!.id, source: 'thank_you_page', value_cents: 1000 })

    // A bot-flagged click that somehow also picked up a conversion (e.g. a crawler that
    // happened to also hit the thank-you pixel) must never leak into totals.
    const { data: botClick } = await admin
      .from('click_events')
      .insert({
        test_id: test!.id,
        variant_id: variant!.id,
        visitor_id: 'v-bot',
        tracking_id: crypto.randomUUID(),
        source_utms: {},
        is_bot: true,
      })
      .select()
      .single()
    await admin
      .from('conversions')
      .insert({ click_event_id: botClick!.id, source: 'thank_you_page', value_cents: 5000 })

    const { data: totals, error } = await asOwner.rpc('get_test_report_totals', { p_test_id: test!.id })
    expect(error).toBeNull()
    const row = totals!.find((r: { variant_id: string }) => r.variant_id === variant!.id)
    expect(row).toMatchObject({ clicks: 1, visitors: 1, conversions: 1, revenue_cents: 1000 })
  })
})
