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

    await admin.from('click_events').insert({
      test_id: test!.id,
      variant_id: variant!.id,
      visitor_id: 'v3-bot',
      tracking_id: crypto.randomUUID(),
      source_utms: { utm_source: 'meta' },
      is_bot: true,
    })

    const { data: report, error } = await asOwner.rpc('get_test_report_by_source', { p_test_id: test!.id })
    expect(error).toBeNull()
    const meta = report!.find((r: { utm_source: string }) => r.utm_source === 'meta')
    const direto = report!.find((r: { utm_source: string }) => r.utm_source === '(direto)')
    expect(meta).toMatchObject({ visits: 1, conversions: 1, bot_clicks: 1 })
    expect(direto).toMatchObject({ visits: 1, conversions: 0, bot_clicks: 0 })
  })
})
