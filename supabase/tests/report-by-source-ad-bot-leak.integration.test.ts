import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const admin = createClient(URL, SERVICE_ROLE_KEY)

async function createSignedInOwner() {
  const email = `by-source-ad-bot-leak-${Date.now()}@example.com`
  const { data } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  const asOwner = createClient(URL, ANON_KEY)
  await asOwner.auth.signInWithPassword({ email, password: 'password123' })
  return { userId: data.user!.id, asOwner }
}

describe('get_test_report_by_source and get_test_report_by_ad', () => {
  it('never count a bot-flagged click conversion/revenue, even though bot_clicks still tracks the bot volume', async () => {
    const { userId, asOwner } = await createSignedInOwner()
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: userId, name: 'By Source Ad Bot Leak Test', slug: `by-source-ad-bot-leak-${Date.now()}` })
      .select()
      .single()

    const { data: test } = await admin
      .from('tests')
      .insert({
        client_id: client!.id,
        name: 'Teste Bot Leak',
        slug: `teste-bot-leak-${Date.now()}`,
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
        source_utms: { utm_source: 'facebookads', utm_term: 'Anúncio Real' },
      })
      .select()
      .single()
    await admin.from('conversions').insert({ click_event_id: realClick!.id, source: 'thank_you_page', value_cents: 1000 })

    // Same origin and ad name as the real click, but bot-flagged with its own conversion --
    // this must never leak into conversions/revenue_cents on either RPC.
    const { data: botClick } = await admin
      .from('click_events')
      .insert({
        test_id: test!.id,
        variant_id: variant!.id,
        visitor_id: 'v-bot',
        tracking_id: crypto.randomUUID(),
        source_utms: { utm_source: 'facebookads', utm_term: 'Anúncio Real' },
        is_bot: true,
      })
      .select()
      .single()
    await admin.from('conversions').insert({ click_event_id: botClick!.id, source: 'thank_you_page', value_cents: 5000 })

    const { data: bySource, error: bySourceError } = await asOwner.rpc('get_test_report_by_source', {
      p_test_id: test!.id,
    })
    expect(bySourceError).toBeNull()
    const sourceRow = bySource!.find((r: { utm_source: string }) => r.utm_source === 'facebookads')
    expect(sourceRow).toMatchObject({ clicks: 1, visitors: 1, conversions: 1, revenue_cents: 1000, bot_clicks: 1 })

    const { data: byAd, error: byAdError } = await asOwner.rpc('get_test_report_by_ad', { p_test_id: test!.id })
    expect(byAdError).toBeNull()
    const adRow = byAd!.find((r: { ad_name: string }) => r.ad_name === 'Anúncio Real')
    expect(adRow).toMatchObject({ clicks: 1, visitors: 1, conversions: 1, revenue_cents: 1000, bot_clicks: 1 })
  })
})
