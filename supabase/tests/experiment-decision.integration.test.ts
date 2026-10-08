import { describe, it, expect } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

async function signedIn() {
  const email = `decide-${unique()}@example.com`
  const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  const db = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  await db.auth.signInWithPassword({ email, password: 'password123' })
  return { db, userId: user!.user!.id }
}

// A running link card measured by a 50/50 A/B test, A the control.
async function runningExperiment() {
  const owner = await signedIn()
  const { data: client } = await admin.from('clients').insert({ owner_id: owner.userId, name: 'Decide', slug: `decide-${unique()}` }).select().single()
  const { data: funnel } = await admin.from('sales_funnels').insert({ client_id: client!.id, name: 'P', slug: `p-${unique()}` }).select().single()
  const { data: test } = await admin
    .from('tests')
    .insert({ client_id: client!.id, name: 'Decisão', slug: `decisao-${unique()}`, conversion_method: 'hubla_webhook' })
    .select()
    .single()
  const { data: variants } = await admin
    .from('variants')
    .insert([
      { test_id: test!.id, name: 'A · Controle', weight_pct: 50, destination_url: 'https://example.com/a', is_control: true },
      { test_id: test!.id, name: 'B · Selo', weight_pct: 50, destination_url: 'https://example.com/b', is_control: false },
    ])
    .select()
  const { data: item } = await admin
    .from('backlog_items')
    .insert({ client_id: client!.id, sales_funnel_id: funnel!.id, code: 'T1', title: 'Selo', stage: 'pagina', method: 'link', status: 'running', started_at: new Date().toISOString(), ab_test_id: test!.id })
    .select()
    .single()
  await admin.from('backlog_variants').insert([
    { item_id: item!.id, client_id: client!.id, key: 'A', name: 'Controle', position: 0 },
    { item_id: item!.id, client_id: client!.id, key: 'B', name: 'Selo', position: 1 },
  ])
  const winner = variants!.find((row) => row.name === 'B · Selo')!.id as string
  return { owner, clientId: client!.id as string, testId: test!.id as string, itemId: item!.id as string, winner }
}

const decide = (db: SupabaseClient, itemId: string, winner: string, winnerKey = 'B') =>
  db.rpc('decide_experiment', {
    p_item_id: itemId,
    p_winner_key: winnerKey,
    p_result: '+21% de conversão',
    p_learning: 'O selo acima do formulário tira a objeção de risco.',
    p_publish: true,
    p_winner_variant_id: winner,
    p_send_traffic: true,
    p_make_control: true,
  })

async function state(testId: string, itemId: string) {
  const [{ data: variants }, { data: item }, { data: cardVariants }] = await Promise.all([
    admin.from('variants').select('name, weight_pct, is_control').eq('test_id', testId).order('name'),
    admin.from('backlog_items').select('status, winner_key, published').eq('id', itemId).single(),
    admin.from('backlog_variants').select('key, status').eq('item_id', itemId).order('key'),
  ])
  return { variants, item, cardVariants }
}

describe('decide_experiment (0079): the A/B test and the card change together, or not at all', () => {
  it('sends all traffic to the winner, makes it the control and decides the card in one call', async () => {
    const { owner, testId, itemId, winner } = await runningExperiment()
    const { error } = await decide(owner.db, itemId, winner)
    expect(error).toBeNull()
    expect(await state(testId, itemId)).toEqual({
      variants: [
        { name: 'A · Controle', weight_pct: 0, is_control: false },
        { name: 'B · Selo', weight_pct: 100, is_control: true },
      ],
      item: { status: 'decided', winner_key: 'B', published: true },
      cardVariants: [
        { key: 'A', status: 'active' },
        { key: 'B', status: 'winner' },
      ],
    })
    // The weight change is in the history (0076), so the draw is checked from the decision on.
    const { data: changes } = await admin.from('test_changes').select('field').eq('test_id', testId).eq('field', 'weight_pct')
    expect(changes).toHaveLength(2)
  })

  it('leaves the traffic untouched when the card part fails', async () => {
    const { owner, testId, itemId, winner } = await runningExperiment()
    const before = await state(testId, itemId)
    // A key the card does not have fails after the traffic moved inside the call: all of it rolls back.
    const { error } = await decide(owner.db, itemId, winner, 'Z')
    expect(error).not.toBeNull()
    expect(await state(testId, itemId)).toEqual(before)
  })

  it('refuses the client role and changes nothing', async () => {
    const { clientId, testId, itemId, winner } = await runningExperiment()
    const cliente = await signedIn()
    await admin.from('memberships').insert({ client_id: clientId, user_id: cliente.userId, role: 'cliente' })
    const before = await state(testId, itemId)
    const { error } = await decide(cliente.db, itemId, winner)
    expect(error?.message).toContain('not allowed')
    expect(await state(testId, itemId)).toEqual(before)
  })
})
