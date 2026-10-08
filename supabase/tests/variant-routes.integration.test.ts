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
  return { testId: test!.id as string, b: variants!.find((row) => row.name === 'B · casada')!.id as string }
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
})
