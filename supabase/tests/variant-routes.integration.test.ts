import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

async function signedIn(clientId: string | null, role?: 'cliente' | 'analista') {
  const email = `routes-${unique()}@example.com`
  const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  if (clientId && role) await admin.from('memberships').insert({ client_id: clientId, user_id: user!.user!.id, role })
  const db = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  await db.auth.signInWithPassword({ email, password: 'password123' })
  return { db, userId: user!.user!.id }
}

async function testWithVariants(clientId: string) {
  const { data: test } = await admin.from('tests').insert({ client_id: clientId, name: 'Casada', slug: `casada-${unique()}`, conversion_method: 'hubla_webhook' }).select().single()
  const { data: variants } = await admin
    .from('variants')
    .insert([
      { test_id: test!.id, name: 'A · genérica', weight_pct: 50, destination_url: 'https://example.com/a', is_control: true },
      { test_id: test!.id, name: 'B · casada', weight_pct: 50, destination_url: 'https://example.com/b', is_control: false },
    ])
    .select()
  const id = (name: string) => variants!.find((row) => row.name === name)!.id as string
  return { testId: test!.id as string, a: id('A · genérica'), b: id('B · casada') }
}

describe('0084: routing rules of a variant', () => {
  it('lets the owner write rules, keeps them inside their own test, and keeps the analista read-only', async () => {
    const owner = await signedIn(null)
    const { data: client } = await admin.from('clients').insert({ owner_id: owner.userId, name: 'Routes', slug: `routes-${unique()}` }).select().single()
    const first = await testWithVariants(client!.id)
    const second = await testWithVariants(client!.id)

    const rule = { test_id: first.testId, variant_id: first.b, position: 0, match_field: 'ad_name', match_value: '[dor]', destination_url: 'https://example.com/dor' }
    expect((await owner.db.from('variant_routes').insert(rule)).error).toBeNull()

    // A rule cannot name a variant of another test.
    expect((await owner.db.from('variant_routes').insert({ ...rule, variant_id: second.b })).error).not.toBeNull()
    // Device takes only the two known values.
    expect((await owner.db.from('variant_routes').insert({ ...rule, match_field: 'device', match_value: 'tablet' })).error).not.toBeNull()

    const analista = await signedIn(client!.id, 'analista')
    const { data: seen } = await analista.db.from('variant_routes').select('match_value').eq('test_id', first.testId)
    expect(seen).toEqual([{ match_value: '[dor]' }])
    const { data: written } = await analista.db.from('variant_routes').insert({ ...rule, match_value: '[ganho]' }).select('id')
    expect(written ?? []).toEqual([])
  })

  it('0085: splits each entry by its rule, ad, source and device, with the buyers', async () => {
    const owner = await signedIn(null)
    const { data: client } = await admin.from('clients').insert({ owner_id: owner.userId, name: 'Segments', slug: `segments-${unique()}` }).select().single()
    const { testId, a, b } = await testWithVariants(client!.id)
    const { data: route } = await admin
      .from('variant_routes')
      .insert({ test_id: testId, variant_id: b, match_field: 'ad_name', match_value: '[dor]', destination_url: 'https://example.com/dor' })
      .select('id')
      .single()
    const phone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'
    const click = async (variantId: string, visitorId: string, adName: string, routeId: string | null, at: string) =>
      (await admin
        .from('click_events')
        .insert({ test_id: testId, variant_id: variantId, visitor_id: visitorId, tracking_id: crypto.randomUUID(), route_id: routeId, user_agent: phone, source_utms: { utm_term: adName, utm_source: 'ig' }, created_at: at })
        .select('id')
        .single()).data!

    const buyer = await click(b, `s1-${unique()}`, 'UGC [dor]', route!.id, '2026-10-01T10:00:00Z')
    await click(b, `s2-${unique()}`, 'UGC [dor]', route!.id, '2026-10-01T10:05:00Z')
    await click(a, `s3-${unique()}`, 'UGC [dor]', null, '2026-10-01T10:10:00Z')
    await admin.from('conversions').insert({ click_event_id: buyer.id, source: 'hubla_webhook', external_event_id: `inv-${unique()}`, value_cents: 19700, created_at: '2026-10-01T11:00:00Z' })

    const { data, error } = await owner.db.rpc('get_test_report_by_segment', { p_test_id: testId })
    expect(error).toBeNull()
    const rows = (data as { variant_id: string; route_id: string | null; ad_name: string; utm_source: string; device: string; people: number; buyers: number; revenue_cents: number }[])
      .sort((x, y) => x.variant_id.localeCompare(y.variant_id))
    expect(rows.find((row) => row.variant_id === b)).toEqual({ variant_id: b, route_id: route!.id, ad_name: 'UGC [dor]', utm_source: 'ig', device: 'celular', people: 2, buyers: 1, revenue_cents: 19700 })
    expect(rows.find((row) => row.variant_id === a)).toMatchObject({ route_id: null, people: 1, buyers: 0, revenue_cents: 0 })

    const stranger = await signedIn(null)
    expect((await stranger.db.rpc('get_test_report_by_segment', { p_test_id: testId })).error).not.toBeNull()
  })
})
