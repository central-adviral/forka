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

describe('page probe tables (0066)', () => {
  it('lets the owner register pages, keeps the checks to the server and shows both to a client member', async () => {
    const owner = await signedIn('pages-owner')
    const cliente = await signedIn('pages-cliente')
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: owner.userId, name: 'Pages', slug: `pages-${Date.now()}` })
      .select()
      .single()
    await admin.from('memberships').insert({ client_id: client!.id, user_id: cliente.userId, role: 'cliente' })

    const { data: page, error } = await owner.db
      .from('pages')
      .insert({ client_id: client!.id, label: 'Vendas', url: 'https://www.exemplo.com.br/oferta' })
      .select()
      .single()
    expect(error).toBeNull()
    const { error: httpError } = await owner.db.from('pages').insert({ client_id: client!.id, label: 'Sem TLS', url: 'http://www.exemplo.com.br' })
    expect(httpError).not.toBeNull()

    const { error: clienteError } = await cliente.db.from('pages').insert({ client_id: client!.id, label: 'X', url: 'https://x.exemplo.com.br' })
    expect(clienteError).not.toBeNull()
    const { error: ownerCheckError } = await owner.db.from('page_checks').insert({ page_id: page!.id, client_id: client!.id, ok: true })
    expect(ownerCheckError).not.toBeNull()

    await admin.from('page_checks').insert({ page_id: page!.id, client_id: client!.id, ok: false, error: 'HTTP 502', status_code: 502 })
    const { data: seen } = await cliente.db.from('page_checks').select('ok, status_code').eq('page_id', page!.id)
    expect(seen).toEqual([{ ok: false, status_code: 502 }])
  })
})
