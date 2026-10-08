import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function createSignedInUser(label: string): Promise<{ userId: string; db: SupabaseClient }> {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const { data } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  const db = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  await db.auth.signInWithPassword({ email, password: 'password123' })
  return { userId: data.user!.id, db }
}

interface CampaignRow {
  campaign_id: string
  front_ids: string[]
  assignment: string | null
}

describe('archive instead of delete for projects and fronts (0100)', () => {
  let clientId: string
  let projectId: string
  let frontId: string
  let otherFrontId: string
  let otherProjectId: string
  let owner: Awaited<ReturnType<typeof createSignedInUser>>
  let cliente: Awaited<ReturnType<typeof createSignedInUser>>
  const today = new Date().toISOString().slice(0, 10)

  beforeAll(async () => {
    owner = await createSignedInUser('arch-owner')
    cliente = await createSignedInUser('arch-cliente')
    const { data: client } = await admin.from('clients').insert({ owner_id: owner.userId, name: 'Archive', slug: `archive-${Date.now()}` }).select().single()
    clientId = client!.id
    await admin.from('memberships').insert({ client_id: clientId, user_id: cliente.userId, role: 'cliente' })
    const { data: project } = await admin.from('sales_funnels').insert({ client_id: clientId, name: 'T20', slug: 't20' }).select().single()
    projectId = project!.id
    const { data: other } = await admin.from('sales_funnels').insert({ client_id: clientId, name: 'Perpétuo', slug: 'perpetuo' }).select().single()
    const { data: front } = await admin.from('project_fronts').insert({ sales_funnel_id: projectId, code: 'GER', name: 'Gratuita' }).select().single()
    frontId = front!.id
    otherProjectId = other!.id
    const { data: otherFront } = await admin.from('project_fronts').insert({ sales_funnel_id: otherProjectId, code: 'PERP', name: 'Perpétuo' }).select().single()
    otherFrontId = otherFront!.id
    await admin.from('naming_rules').insert({ front_id: frontId, kind: 'include', value: '[ARQ-GER]' })
    await admin.from('campaign_daily').insert({ client_id: clientId, data: today, campaign_id: 'c-old', campaign_name: '[ARQ-GER] old', spend: 100 })
    await admin.from('project_products').insert({ sales_funnel_id: projectId, produto_nome: '1K', papel: 'entrada' })
  })

  async function campaigns(): Promise<Map<string, CampaignRow>> {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    const { data, error } = await owner.db.rpc('get_client_campaigns', { p_client_id: clientId, p_since: today, p_until: tomorrow })
    expect(error).toBeNull()
    return new Map((data as CampaignRow[]).map((row) => [row.campaign_id, row]))
  }

  const sale = (id: string) => ({
    sales_funnel_id: projectId,
    external_id: id,
    data_venda: `${today}T15:00:00Z`,
    status: 'aprovada',
    produto: '1K',
    utm_campaign: null,
  })

  async function saleOwner(id: string) {
    const { data } = await admin.from('sales').select('sales_funnel_id, motivo').eq('client_id', clientId).eq('external_id', id).single()
    return [data!.sales_funnel_id, data!.motivo]
  }

  it('only lets a gestor archive', async () => {
    const { error } = await cliente.db.rpc('set_front_archived', { p_front_id: frontId, p_archived: true })
    expect(error).not.toBeNull()
    const { data } = await admin.from('project_fronts').select('archived_at').eq('id', frontId).single()
    expect(data!.archived_at).toBeNull()
  })

  it('an archived front keeps the campaigns it owned and claims no new one', async () => {
    expect((await campaigns()).get('c-old')).toMatchObject({ front_ids: [frontId], assignment: 'nome' })

    const { error } = await owner.db.rpc('set_front_archived', { p_front_id: frontId, p_archived: true })
    expect(error).toBeNull()
    // Its name claim was fixed before it stopped claiming, so its past keeps the campaign.
    expect((await campaigns()).get('c-old')).toMatchObject({ front_ids: [frontId], assignment: 'auto' })

    await admin.from('campaign_daily').insert({ client_id: clientId, data: today, campaign_id: 'c-new', campaign_name: '[ARQ-GER] new', spend: 50 })
    expect((await campaigns()).get('c-new')).toMatchObject({ front_ids: [], assignment: null })

    const { error: pinError } = await owner.db
      .from('campaign_fronts')
      .insert({ client_id: clientId, campaign_id: 'c-new', front_id: frontId, source: 'manual' })
    expect(pinError).not.toBeNull()

    // A rule elsewhere that also names the old campaign does not take it from the archived front.
    await admin.from('naming_rules').insert({ front_id: otherFrontId, kind: 'include', value: 'old' })
    expect((await campaigns()).get('c-old')).toMatchObject({ front_ids: [frontId], assignment: 'auto' })
  })

  it('restoring the front lets it claim by name again', async () => {
    const { error } = await owner.db.rpc('set_front_archived', { p_front_id: frontId, p_archived: false })
    expect(error).toBeNull()
    expect((await campaigns()).get('c-new')).toMatchObject({ front_ids: [frontId], assignment: 'nome' })
  })

  it('an archived project keeps its sales, is no candidate for new ones, and its watchers stop', async () => {
    await admin.from('sales').insert(sale('before'))
    expect(await saleOwner('before')).toEqual([projectId, 'produto_exclusivo'])
    await admin.from('watchers').insert({ client_id: clientId, sales_funnel_id: projectId, metric: 'cpl', target: 50, warn_pct: 20, crit_pct: 40 })
    const { data: evaluatedBefore } = await admin.rpc('evaluate_watchers', { p_client_id: clientId })
    expect(evaluatedBefore).toBe(1)

    const { error } = await owner.db.rpc('set_project_archived', { p_sales_funnel_id: projectId, p_archived: true })
    expect(error).toBeNull()
    const { data: listed } = await owner.db.from('sales_funnels').select('id, archived_at').eq('id', projectId).single()
    expect(listed!.archived_at).not.toBeNull()

    await admin.from('sales').insert(sale('after'))
    expect(await saleOwner('after')).toEqual([null, 'produto_fora_de_projeto'])
    // A resync of a sale it already had, or a product change that re-attributes, leaves it there.
    await admin.from('sales').update({ produto: '1K' }).eq('client_id', clientId).eq('external_id', 'before')
    expect(await saleOwner('before')).toEqual([projectId, 'produto_exclusivo'])
    await admin.from('project_products').insert({ sales_funnel_id: otherProjectId, produto_nome: '1K', papel: 'entrada' })
    expect(await saleOwner('before')).toEqual([projectId, 'produto_exclusivo'])

    const { data: evaluatedAfter } = await admin.rpc('evaluate_watchers', { p_client_id: clientId })
    expect(evaluatedAfter).toBe(0)
  })

  it('restoring the project makes it a candidate again', async () => {
    const { error } = await owner.db.rpc('set_project_archived', { p_sales_funnel_id: projectId, p_archived: false })
    expect(error).toBeNull()
    await admin.from('project_products').delete().eq('sales_funnel_id', otherProjectId)
    await admin.from('sales').insert(sale('restored'))
    expect(await saleOwner('restored')).toEqual([projectId, 'produto_exclusivo'])
    const { data: evaluated } = await admin.rpc('evaluate_watchers', { p_client_id: clientId })
    expect(evaluated).toBe(1)
  })
})
