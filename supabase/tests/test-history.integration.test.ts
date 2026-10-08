import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function ownerWithTest() {
  const email = `history-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  const owner = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  await owner.auth.signInWithPassword({ email, password: 'password123' })
  const { data: client } = await admin.from('clients').insert({ owner_id: user!.user!.id, name: 'History', slug: `history-${Date.now()}` }).select().single()
  const { data: test } = await admin
    .from('tests')
    .insert({ client_id: client!.id, name: 'Histórico', slug: `historico-${Date.now()}-${Math.random().toString(36).slice(2)}`, conversion_method: 'thank_you_page' })
    .select()
    .single()
  const { data: variants } = await admin
    .from('variants')
    .insert([
      { test_id: test!.id, name: 'A', weight_pct: 70, destination_url: 'https://example.com/a', is_control: true },
      { test_id: test!.id, name: 'B', weight_pct: 30, destination_url: 'https://example.com/b', is_control: false },
    ])
    .select()
  return { owner, userId: user!.user!.id, test: test!, variants: variants! }
}

describe('0076: click flag, archive and change history', () => {
  it('logs a weight or URL change made on the owner session, and nothing when the value stays', async () => {
    const { owner, userId, test, variants } = await ownerWithTest()
    const a = variants.find((row) => row.name === 'A')!
    const b = variants.find((row) => row.name === 'B')!
    // The edit form upserts every variant; an unchanged value must not log a change.
    const { error } = await owner.from('variants').upsert([
      { id: a.id, test_id: test.id, name: 'A', weight_pct: 50, destination_url: 'https://example.com/a' },
      { id: b.id, test_id: test.id, name: 'B', weight_pct: 50, destination_url: 'https://example.com/b2' },
    ])
    expect(error).toBeNull()

    const { data: changes } = await owner.from('test_changes').select('variant_id, field, old_value, new_value, changed_by').eq('test_id', test.id)
    expect(changes).toHaveLength(3)
    expect(changes).toEqual(
      expect.arrayContaining([
        { variant_id: a.id, field: 'weight_pct', old_value: '70', new_value: '50', changed_by: userId },
        { variant_id: b.id, field: 'weight_pct', old_value: '30', new_value: '50', changed_by: userId },
        { variant_id: b.id, field: 'destination_url', old_value: 'https://example.com/b', new_value: 'https://example.com/b2', changed_by: userId },
      ])
    )
    // Nobody writes the log directly, not even the owner.
    const { error: insertError } = await owner.from('test_changes').insert({ test_id: test.id, field: 'weight_pct' })
    expect(insertError).not.toBeNull()
  })

  it('keeps an archived test paused and its clicks in place', async () => {
    const { owner, test, variants } = await ownerWithTest()
    await admin.from('click_events').insert({ test_id: test.id, variant_id: variants[0].id, visitor_id: crypto.randomUUID(), tracking_id: crypto.randomUUID(), source_utms: {}, rate_limited: true })

    const { error } = await owner.from('tests').update({ status: 'paused', archived_at: new Date().toISOString() }).eq('id', test.id)
    expect(error).toBeNull()
    const { error: reactivate } = await owner.from('tests').update({ status: 'active' }).eq('id', test.id)
    expect(reactivate?.message).toContain('tests_archived_is_paused')

    const { data: clicks } = await admin.from('click_events').select('rate_limited').eq('test_id', test.id)
    expect(clicks).toEqual([{ rate_limited: true }])
  })
})
