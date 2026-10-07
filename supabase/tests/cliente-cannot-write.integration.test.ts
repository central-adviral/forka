import { describe, it, expect } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function signedIn(label: string): Promise<{ userId: string; db: SupabaseClient }> {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const { data } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  const db = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  await db.auth.signInWithPassword({ email, password: 'password123' })
  return { userId: data.user!.id, db }
}

// The server actions of backlog, painel and metas write on the user's own session, so these
// policies are what stops a client member: every write below must be refused or touch no row.
describe('a cliente member cannot change what the server actions change', () => {
  it('is refused on backlog, pages, watchers, products and the rules of the game', async () => {
    const owner = await signedIn('ro-owner')
    const cliente = await signedIn('ro-cliente')
    const { data: client } = await admin.from('clients').insert({ owner_id: owner.userId, name: 'RO', slug: `ro-${Date.now()}` }).select().single()
    await admin.from('memberships').insert({ client_id: client!.id, user_id: cliente.userId, role: 'cliente' })
    const { data: funnel } = await admin.from('sales_funnels').insert({ client_id: client!.id, name: 'P', slug: 'p' }).select().single()
    const { data: item } = await admin
      .from('backlog_items')
      .insert({ client_id: client!.id, sales_funnel_id: funnel!.id, code: 'T1', title: 'T1', stage: 'pagina', method: 'link', status: 'running', published: true })
      .select()
      .single()
    const { data: gate } = await admin.from('backlog_gates').insert({ item_id: item!.id, client_id: client!.id, label: 'Link /r criado' }).select().single()
    const { data: page } = await admin.from('pages').insert({ client_id: client!.id, label: 'Oferta', url: `https://exemplo-${Date.now()}.com.br` }).select().single()
    const db = cliente.db

    const touched = async (query: PromiseLike<{ data: unknown[] | null; error: unknown }>) => {
      const { data, error } = await query
      return error === null && (data?.length ?? 0) > 0
    }

    expect(await touched(db.from('backlog_items').insert({ client_id: client!.id, sales_funnel_id: funnel!.id, code: 'T2', title: 'x', stage: 'pagina', method: 'link' }).select('id'))).toBe(false)
    expect(await touched(db.from('backlog_items').update({ status: 'queue' }).eq('id', item!.id).select('id'))).toBe(false)
    expect(await touched(db.from('backlog_items').delete().eq('id', item!.id).select('id'))).toBe(false)
    expect(await touched(db.from('backlog_gates').update({ done_at: new Date().toISOString() }).eq('id', gate!.id).select('id'))).toBe(false)
    expect(await touched(db.from('pages').insert({ client_id: client!.id, label: 'x', url: 'https://outra.exemplo.com.br' }).select('id'))).toBe(false)
    expect(await touched(db.from('pages').delete().eq('id', page!.id).select('id'))).toBe(false)
    expect(await touched(db.from('watchers').insert({ client_id: client!.id, sales_funnel_id: funnel!.id, metric: 'cpm', target: 10 }).select('id'))).toBe(false)
    expect(await touched(db.from('project_products').insert({ sales_funnel_id: funnel!.id, produto_nome: 'x', papel: 'entrada' }).select('sales_funnel_id'))).toBe(false)
    expect(await touched(db.from('sales_funnels').update({ test_rules: { teto: 1 } }).eq('id', funnel!.id).select('id'))).toBe(false)

    // What the client member may do: read the published, running test.
    const { data: seen } = await db.from('backlog_items').select('code')
    expect(seen).toEqual([{ code: 'T1' }])
  })
})
