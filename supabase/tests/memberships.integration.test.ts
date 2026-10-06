import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const admin = createClient(URL, SERVICE_ROLE_KEY)

async function createSignedInUser(label: string): Promise<{ userId: string; db: SupabaseClient }> {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const { data } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  const db = createClient(URL, ANON_KEY)
  await db.auth.signInWithPassword({ email, password: 'password123' })
  return { userId: data.user!.id, db }
}

async function hasRole(db: SupabaseClient, clientId: string, role: string): Promise<boolean> {
  const { data, error } = await db.rpc('has_client_role', { p_client_id: clientId, p_min_role: role })
  expect(error).toBeNull()
  return data as boolean
}

describe('memberships and roles (0051)', () => {
  let clientId: string
  let owner: Awaited<ReturnType<typeof createSignedInUser>>
  let gestor: Awaited<ReturnType<typeof createSignedInUser>>
  let cliente: Awaited<ReturnType<typeof createSignedInUser>>
  let stranger: Awaited<ReturnType<typeof createSignedInUser>>

  beforeAll(async () => {
    owner = await createSignedInUser('m-owner')
    gestor = await createSignedInUser('m-gestor')
    cliente = await createSignedInUser('m-cliente')
    stranger = await createSignedInUser('m-stranger')
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: owner.userId, name: 'Memberships Test', slug: `memberships-${Date.now()}` })
      .select()
      .single()
    clientId = client!.id
    const { error } = await owner.db.from('memberships').insert([
      { client_id: clientId, user_id: gestor.userId, role: 'gestor' },
      { client_id: clientId, user_id: cliente.userId, role: 'cliente' },
    ])
    expect(error).toBeNull()
  })

  it('makes the creator of a client its owner member', async () => {
    const { data } = await owner.db.from('memberships').select('role').eq('user_id', owner.userId).eq('client_id', clientId)
    expect(data).toEqual([{ role: 'owner' }])
    expect(await hasRole(owner.db, clientId, 'owner')).toBe(true)
  })

  it('lets a cliente member read the client and its funnels but not write them', async () => {
    await admin.from('sales_funnels').insert({ client_id: clientId, name: 'Funil', slug: `funil-${Date.now()}` })

    const { data: clients } = await cliente.db.from('clients').select('id').eq('id', clientId)
    expect(clients).toHaveLength(1)
    const { data: funnels } = await cliente.db.from('sales_funnels').select('id').eq('client_id', clientId)
    expect(funnels!.length).toBeGreaterThanOrEqual(1)

    const { error: insertError } = await cliente.db
      .from('sales_funnels')
      .insert({ client_id: clientId, name: 'Nope', slug: `nope-${Date.now()}` })
    expect(insertError).not.toBeNull()
    expect(await hasRole(cliente.db, clientId, 'gestor')).toBe(false)
  })

  it('lets a gestor write funnels but not change the client or its members', async () => {
    const { error: insertError } = await gestor.db
      .from('sales_funnels')
      .insert({ client_id: clientId, name: 'Do gestor', slug: `gestor-${Date.now()}` })
    expect(insertError).toBeNull()

    const { data: updated } = await gestor.db.from('clients').update({ name: 'hack' }).eq('id', clientId).select('id')
    expect(updated).toEqual([])

    const { error: memberError } = await gestor.db
      .from('memberships')
      .insert({ client_id: clientId, user_id: stranger.userId, role: 'owner' })
    expect(memberError).not.toBeNull()
  })

  it('shows a cliente only their own membership, and the owner every one', async () => {
    const { data: seenByCliente } = await cliente.db.from('memberships').select('user_id').eq('client_id', clientId)
    expect(seenByCliente).toEqual([{ user_id: cliente.userId }])
    const { data: seenByOwner } = await owner.db.from('memberships').select('user_id').eq('client_id', clientId)
    expect(seenByOwner).toHaveLength(3)
  })

  it('refuses to leave a client without an owner', async () => {
    const { error } = await owner.db.from('memberships').delete().eq('client_id', clientId).eq('user_id', owner.userId)
    expect(error).not.toBeNull()
    expect(await hasRole(owner.db, clientId, 'owner')).toBe(true)
  })

  it('keeps a user with no membership out entirely', async () => {
    const { data } = await stranger.db.from('clients').select('id').eq('id', clientId)
    expect(data).toEqual([])
    expect(await hasRole(stranger.db, clientId, 'cliente')).toBe(false)
  })

  it('lists members with e-mail to the owner only (0052)', async () => {
    const { data: seenByOwner, error } = await owner.db.rpc('list_client_members', { p_client_id: clientId })
    expect(error).toBeNull()
    expect((seenByOwner as { role: string }[]).map((member) => member.role)).toContain('owner')
    const { error: gestorError } = await gestor.db.rpc('list_client_members', { p_client_id: clientId })
    expect(gestorError).not.toBeNull()
  })

  it('keeps the e-mail lookup away from signed-in users (0052)', async () => {
    const { error } = await owner.db.rpc('user_id_by_email', { p_email: 'anyone@example.com' })
    expect(error).not.toBeNull()
  })

  it('summarises only the clients the caller can see (0052)', async () => {
    const { data: forCliente } = await cliente.db.rpc('get_portfolio_summary', { p_since: '2020-01-01' })
    expect((forCliente as { client_id: string }[]).map((row) => row.client_id)).toEqual([clientId])
    const { data: forStranger } = await stranger.db.rpc('get_portfolio_summary', { p_since: '2020-01-01' })
    expect(forStranger).toEqual([])
  })

  it('lets a staff admin into every client', async () => {
    const staffer = await createSignedInUser('m-staff')
    await admin.from('staff').insert({ user_id: staffer.userId, role: 'admin' })
    const { data } = await staffer.db.from('clients').select('id').eq('id', clientId)
    expect(data).toHaveLength(1)
    expect(await hasRole(staffer.db, clientId, 'owner')).toBe(true)
  })
})
