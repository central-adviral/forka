import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { decisionRows, type TestVariantRow } from '@/lib/domain/experiment-decision'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)

describe('deciding a link experiment on the A/B test', () => {
  it('sends all traffic to the winner and makes it the control in one upsert, past the one-control index and the integrity trigger', async () => {
    const email = `decide-${Date.now()}@example.com`
    const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
    const owner = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    await owner.auth.signInWithPassword({ email, password: 'password123' })
    const { data: client } = await admin.from('clients').insert({ owner_id: user!.user!.id, name: 'Decide', slug: `decide-${Date.now()}` }).select().single()
    const { data: test } = await admin
      .from('tests')
      .insert({ client_id: client!.id, name: 'Decisão', slug: `decisao-${Date.now()}`, conversion_method: 'hubla_webhook' })
      .select()
      .single()
    await admin.from('variants').insert([
      { test_id: test!.id, name: 'A', weight_pct: 50, destination_url: 'https://example.com/a', is_control: true },
      { test_id: test!.id, name: 'B', weight_pct: 50, destination_url: 'https://example.com/b', is_control: false },
    ])
    const { data: variants } = await owner.from('variants').select('id, name, weight_pct, destination_url, thank_you_url, is_control').eq('test_id', test!.id)
    const winner = variants!.find((row) => row.name === 'B')!

    const rows = decisionRows(variants as TestVariantRow[], winner.id, { sendAllTraffic: true, makeControl: true })
    const { error } = await owner.from('variants').upsert(rows.map((row) => ({ ...row, test_id: test!.id })))
    expect(error).toBeNull()

    const { data: after } = await admin.from('variants').select('name, weight_pct, is_control').eq('test_id', test!.id).order('name')
    expect(after).toEqual([
      { name: 'A', weight_pct: 0, is_control: false },
      { name: 'B', weight_pct: 100, is_control: true },
    ])
    // The weight change is in the history (0076), so the draw is checked from the decision on.
    const { data: changes } = await admin.from('test_changes').select('field').eq('test_id', test!.id)
    expect(changes!.filter((change) => change.field === 'weight_pct')).toHaveLength(2)
  })
})
