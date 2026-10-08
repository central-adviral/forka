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

describe('page probe diagnosis (0089)', () => {
  it('links a page to a project of the same client only, lets the gestor set what to watch and the cliente read it', async () => {
    const owner = await signedIn('diag-owner')
    const gestor = await signedIn('diag-gestor')
    const cliente = await signedIn('diag-cliente')
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const { data: client } = await admin.from('clients').insert({ owner_id: owner.userId, name: 'Diag', slug: `diag-${stamp}` }).select().single()
    const { data: other } = await admin.from('clients').insert({ owner_id: owner.userId, name: 'Outro', slug: `diag-outro-${stamp}` }).select().single()
    await admin.from('memberships').insert([
      { client_id: client!.id, user_id: gestor.userId, role: 'gestor' },
      { client_id: client!.id, user_id: cliente.userId, role: 'cliente' },
    ])
    const { data: project } = await admin.from('sales_funnels').insert({ client_id: client!.id, name: '1K', slug: `1k-${stamp}` }).select().single()
    const { data: foreign } = await admin.from('sales_funnels').insert({ client_id: other!.id, name: 'Outro', slug: `outro-${stamp}` }).select().single()

    const { data: page, error } = await gestor.db
      .from('pages')
      .insert({ client_id: client!.id, label: 'Vendas', url: 'https://www.exemplo.com.br/oferta', sales_funnel_id: project!.id, watch_pixel: true, watch_checkout: true, required_text: 'R$ 497' })
      .select()
      .single()
    expect(error).toBeNull()
    const { error: foreignError } = await gestor.db.from('pages').update({ sales_funnel_id: foreign!.id }).eq('id', page!.id)
    expect(foreignError?.code).toBe('23503')
    const { error: blankText } = await gestor.db.from('pages').update({ required_text: '  ' }).eq('id', page!.id)
    expect(blankText).not.toBeNull()

    const { data: silenced } = await cliente.db.from('pages').update({ silenced_until: new Date(Date.now() + 3_600_000).toISOString() }).eq('id', page!.id).select('id')
    expect(silenced).toEqual([])

    const first = await admin.from('page_checks').insert({ page_id: page!.id, client_id: client!.id, ok: false, checked_at: new Date(Date.now() - 600_000).toISOString(), error: 'HTTP 502' })
    const second = await admin.from('page_checks').insert({ page_id: page!.id, client_id: client!.id, ok: false, redirects: 1, final_url: 'https://www.exemplo.com.br/fim', error: 'HTTP 404', cert_expires_at: '2027-01-01T00:00:00Z' })
    expect([first.error, second.error]).toEqual([null, null])
    const { data: seen } = await cliente.db.from('pages').select('sales_funnel_id, watch_pixel, watch_checkout, required_text').eq('id', page!.id).single()
    expect(seen).toEqual({ sales_funnel_id: project!.id, watch_pixel: true, watch_checkout: true, required_text: 'R$ 497' })
    const { data: now } = await cliente.db.rpc('get_pages_now')
    expect(now).toEqual([
      { page_id: page!.id, client_id: client!.id, url: 'https://www.exemplo.com.br/oferta', silenced: false, last_ok: false, last_redirects: 1, prev_ok: false },
    ])

    // Deleting the project unlinks the page; the page and its history stay.
    await admin.from('sales_funnels').delete().eq('id', project!.id)
    const { data: unlinked } = await admin.from('pages').select('sales_funnel_id, client_id').eq('id', page!.id).single()
    expect(unlinked).toEqual({ sales_funnel_id: null, client_id: client!.id })
  })
})

describe('page per front (0093)', () => {
  it('takes only an own front of the page project, unlinks on delete, and keeps RLS', async () => {
    const owner = await signedIn('front-owner')
    const gestor = await signedIn('front-gestor')
    const cliente = await signedIn('front-cliente')
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const { data: client } = await admin.from('clients').insert({ owner_id: owner.userId, name: 'Frentes', slug: `frentes-${stamp}` }).select().single()
    await admin.from('memberships').insert([
      { client_id: client!.id, user_id: gestor.userId, role: 'gestor' },
      { client_id: client!.id, user_id: cliente.userId, role: 'cliente' },
    ])
    const { data: project } = await admin.from('sales_funnels').insert({ client_id: client!.id, name: '1K', slug: `1k-${stamp}` }).select().single()
    const { data: otherProject } = await admin.from('sales_funnels').insert({ client_id: client!.id, name: 'Perpétuo', slug: `perpetuo-${stamp}` }).select().single()
    const { data: front } = await admin.from('project_fronts').insert({ sales_funnel_id: project!.id, code: 'F1', name: 'Frio' }).select().single()
    const { data: foreignFront } = await admin.from('project_fronts').insert({ sales_funnel_id: otherProject!.id, code: 'P1', name: 'Perpétuo frio' }).select().single()
    const { data: mirror } = await admin
      .from('project_fronts')
      .insert({ sales_funnel_id: project!.id, code: 'ESP', name: 'Espelho', source_sales_funnel_id: otherProject!.id })
      .select()
      .single()

    const { data: page, error } = await gestor.db
      .from('pages')
      .insert({ client_id: client!.id, label: 'Vendas', url: `https://www.exemplo.com.br/${stamp}`, sales_funnel_id: project!.id, front_id: front!.id })
      .select()
      .single()
    expect(error).toBeNull()

    const { error: otherProjectError } = await gestor.db.from('pages').update({ front_id: foreignFront!.id }).eq('id', page!.id)
    expect(otherProjectError?.code).toBe('23514')
    const { error: mirrorError } = await gestor.db.from('pages').update({ front_id: mirror!.id }).eq('id', page!.id)
    expect(mirrorError?.code).toBe('23514')
    const { error: noProjectError } = await gestor.db
      .from('pages')
      .insert({ client_id: client!.id, label: 'Solta', url: `https://www.exemplo.com.br/solta-${stamp}`, front_id: front!.id })
    expect(noProjectError?.code).toBe('23514')

    const { data: clienteWrite } = await cliente.db.from('pages').update({ front_id: null }).eq('id', page!.id).select('id')
    expect(clienteWrite).toEqual([])
    const { data: seen } = await cliente.db.from('pages').select('sales_funnel_id, front_id').eq('id', page!.id).single()
    expect(seen).toEqual({ sales_funnel_id: project!.id, front_id: front!.id })

    // Deleting the front unlinks the page; the page and its project stay.
    await admin.from('project_fronts').delete().eq('id', front!.id)
    const { data: unlinked } = await admin.from('pages').select('sales_funnel_id, front_id').eq('id', page!.id).single()
    expect(unlinked).toEqual({ sales_funnel_id: project!.id, front_id: null })

    // Deleting the project takes its fronts and unlinks both.
    const { data: second } = await admin.from('project_fronts').insert({ sales_funnel_id: project!.id, code: 'F2', name: 'Quente' }).select().single()
    const { error: moveError } = await gestor.db.from('pages').update({ front_id: second!.id }).eq('id', page!.id)
    expect(moveError).toBeNull()
    await admin.from('sales_funnels').delete().eq('id', project!.id)
    const { data: orphan } = await admin.from('pages').select('sales_funnel_id, front_id').eq('id', page!.id).single()
    expect(orphan).toEqual({ sales_funnel_id: null, front_id: null })
  })
})
