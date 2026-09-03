import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

const serviceDb = createServiceRoleClient()
const ownerPassword = 'password123'
let clientId: string
let authedDb: SupabaseClient

beforeAll(async () => {
  const ownerEmail = `funnel-owner-${Date.now()}@example.com`
  const { data: user } = await serviceDb.auth.admin.createUser({
    email: ownerEmail,
    password: ownerPassword,
    email_confirm: true,
  })
  const { data: client } = await serviceDb
    .from('clients')
    .insert({ owner_id: user!.user!.id, name: 'Funnel RLS', slug: `funnel-rls-${Date.now()}` })
    .select()
    .single()
  clientId = client!.id

  await serviceDb.from('sales').insert({
    client_id: clientId,
    external_id: `sale-${Date.now()}`,
    data_venda: new Date().toISOString(),
    status: 'aprovada',
    valor_bruto: 10,
  })

  const anonDb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  })
  const { data: signIn, error: signInError } = await anonDb.auth.signInWithPassword({
    email: ownerEmail,
    password: ownerPassword,
  })
  if (signInError) throw signInError
  authedDb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${signIn.session!.access_token}` } },
  })
})

describe('funnel tables RLS', () => {
  it('lets the service role select the seeded sale', async () => {
    const { data, error } = await serviceDb.from('sales').select('id').eq('client_id', clientId)
    expect(error).toBeNull()
    expect(data!.length).toBe(1)
  })

  it('lets the authenticated owner select their own sale via RLS', async () => {
    const { data, error } = await authedDb.from('sales').select('id').eq('client_id', clientId)
    expect(error).toBeNull()
    expect(data!.length).toBe(1)
  })

  it('rejects insert from the authenticated role — grants are select-only', async () => {
    const { error } = await authedDb.from('sales').insert({
      client_id: clientId,
      external_id: `blocked-${Date.now()}`,
      data_venda: new Date().toISOString(),
      status: 'aprovada',
    })
    expect(error).not.toBeNull()
  })
})
