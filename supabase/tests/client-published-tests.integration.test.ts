import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

async function member(clientId: string, role: 'cliente' | 'analista') {
  const email = `pub-${role}-${unique()}@example.com`
  const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  await admin.from('memberships').insert({ client_id: clientId, user_id: user!.user!.id, role })
  const db = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  await db.auth.signInWithPassword({ email, password: 'password123' })
  return db
}

async function abTest(clientId: string, name: string) {
  const { data: test } = await admin.from('tests').insert({ client_id: clientId, name, slug: `pub-${unique()}`, conversion_method: 'hubla_webhook' }).select().single()
  await admin.from('variants').insert([
    { test_id: test!.id, name: 'A', weight_pct: 50, destination_url: 'https://example.com/a', is_control: true },
    { test_id: test!.id, name: 'B', weight_pct: 50, destination_url: 'https://example.com/b', is_control: false },
  ])
  return test!.id as string
}

describe('0080: a client member reads only the A/B tests of published experiments', () => {
  it('hides an unpublished test from the client, report included, and keeps every test for the analista', async () => {
    const { data: owner } = await admin.auth.admin.createUser({ email: `pub-owner-${unique()}@example.com`, password: 'password123', email_confirm: true })
    const { data: client } = await admin.from('clients').insert({ owner_id: owner!.user!.id, name: 'Pub', slug: `pub-${unique()}` }).select().single()
    const { data: funnel } = await admin.from('sales_funnels').insert({ client_id: client!.id, name: 'P', slug: `p-${unique()}` }).select().single()
    const published = await abTest(client!.id, 'Publicado')
    const draft = await abTest(client!.id, 'Rascunho')
    await admin.from('backlog_items').insert([
      { client_id: client!.id, sales_funnel_id: funnel!.id, code: 'T1', title: 'Publicado', stage: 'pagina', method: 'link', status: 'running', started_at: new Date().toISOString(), published: true, ab_test_id: published },
      { client_id: client!.id, sales_funnel_id: funnel!.id, code: 'T2', title: 'Rascunho', stage: 'pagina', method: 'link', status: 'running', started_at: new Date().toISOString(), published: false, ab_test_id: draft },
    ])

    const cliente = await member(client!.id, 'cliente')
    const { data: clientTests } = await cliente.from('tests').select('name').eq('client_id', client!.id)
    expect(clientTests).toEqual([{ name: 'Publicado' }])
    const { data: clientVariants } = await cliente.from('variants').select('test_id').in('test_id', [published, draft])
    expect(new Set(clientVariants!.map((row) => row.test_id))).toEqual(new Set([published]))
    expect((await cliente.rpc('get_test_report', { p_test_id: published, p_since: null, p_until: null })).error).toBeNull()
    expect((await cliente.rpc('get_test_report', { p_test_id: draft, p_since: null, p_until: null })).error?.message).toContain('not found or access denied')

    const analista = await member(client!.id, 'analista')
    const { data: teamTests } = await analista.from('tests').select('name').eq('client_id', client!.id).order('name')
    expect(teamTests).toEqual([{ name: 'Publicado' }, { name: 'Rascunho' }])
    expect((await analista.rpc('get_test_report', { p_test_id: draft, p_since: null, p_until: null })).error).toBeNull()
  })
})
