import { describe, it, expect } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function signedIn(label: string): Promise<{ userId: string; db: SupabaseClient }> {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const { data } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  const db = createClient(URL, ANON_KEY)
  await db.auth.signInWithPassword({ email, password: 'password123' })
  return { userId: data.user!.id, db }
}

describe('test backlog (0068)', () => {
  it('shows a client member only published tests that run or were decided, keeps writes to the gestor and demands a learning to decide', async () => {
    const owner = await signedIn('backlog-owner')
    const cliente = await signedIn('backlog-cliente')
    const { data: client } = await admin.from('clients').insert({ owner_id: owner.userId, name: 'Backlog', slug: `backlog-${Date.now()}` }).select().single()
    await admin.from('memberships').insert({ client_id: client!.id, user_id: cliente.userId, role: 'cliente' })
    const { data: funnel } = await admin.from('sales_funnels').insert({ client_id: client!.id, name: '1K', slug: '1k' }).select().single()
    const item = (code: string, status: string, published: boolean, learning: string | null = null) => ({
      client_id: client!.id,
      sales_funnel_id: funnel!.id,
      code,
      title: code,
      stage: 'pagina',
      method: 'link',
      status,
      published,
      learning,
    })

    const { error } = await owner.db.from('backlog_items').insert([
      item('T1', 'queue', true),
      item('T2', 'running', true),
      item('T3', 'decided', false, 'Prova social na dobra subiu a conversão da página.'),
    ])
    expect(error).toBeNull()

    const { data: seen } = await cliente.db.from('backlog_items').select('code').order('code')
    expect(seen).toEqual([{ code: 'T2' }])
    const { data: seenByOwner } = await owner.db.from('backlog_items').select('code').order('code')
    expect(seenByOwner!.map((row) => row.code)).toEqual(['T1', 'T2', 'T3'])

    const { error: clienteWrite } = await cliente.db.from('backlog_items').insert(item('T4', 'queue', false))
    expect(clienteWrite).not.toBeNull()

    const { error: noLearning } = await owner.db.from('backlog_items').update({ status: 'decided' }).eq('sales_funnel_id', funnel!.id).eq('code', 'T2')
    expect(noLearning).not.toBeNull()

    const { data: defaults } = await admin.from('sales_funnels').select('test_rules').eq('id', funnel!.id).single()
    expect(defaults!.test_rules).toMatchObject({ teto: 55, min: 10, conf: 95 })
  })
})
