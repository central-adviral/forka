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

interface ApplyRow {
  sales_changed: number
  sales_in: number
  revenue_in: number
  sales_out: number
  revenue_out: number
  role_changed: number
  campaigns_changed: number
  spend_in: number
  spend_out: number
}

describe('config changes apply from now on; the past only moves through "aplicar desde" (0101)', () => {
  let clientId: string
  let projectId: string
  let otherProjectId: string
  let frontId: string
  let owner: Awaited<ReturnType<typeof createSignedInUser>>
  let cliente: Awaited<ReturnType<typeof createSignedInUser>>

  beforeAll(async () => {
    owner = await createSignedInUser('vap-owner')
    cliente = await createSignedInUser('vap-cliente')
    const { data: client } = await admin.from('clients').insert({ owner_id: owner.userId, name: 'Vale', slug: `vale-${Date.now()}` }).select().single()
    clientId = client!.id
    await admin.from('memberships').insert({ client_id: clientId, user_id: cliente.userId, role: 'cliente' })
    const { data: project } = await admin.from('sales_funnels').insert({ client_id: clientId, name: 'P', slug: 'p' }).select().single()
    const { data: other } = await admin.from('sales_funnels').insert({ client_id: clientId, name: 'Q', slug: 'q' }).select().single()
    projectId = project!.id
    otherProjectId = other!.id
    const { data: front } = await admin.from('project_fronts').insert({ sales_funnel_id: projectId, code: 'VAP', name: 'P' }).select().single()
    frontId = front!.id
    await admin.from('naming_rules').insert({ front_id: frontId, kind: 'include', value: '[VAP]' })
    await admin.from('campaign_daily').insert([
      { client_id: clientId, data: '2026-09-10', campaign_id: 'c-old', campaign_name: '[VAP] lancamento velha', spend: 100 },
      { client_id: clientId, data: '2026-10-02', campaign_id: 'c-recent', campaign_name: '[VAP] lancamento recente', spend: 40 },
    ])
    await admin.from('project_products').insert([
      { sales_funnel_id: projectId, produto_nome: 'Curso', papel: 'entrada' },
      { sales_funnel_id: projectId, produto_nome: 'Bump', papel: 'order_bump' },
      { sales_funnel_id: otherProjectId, produto_nome: 'Livro', papel: 'entrada' },
    ])
    const sale = (id: string, funnel: string, produto: string, day: string, valor: number) => ({
      sales_funnel_id: funnel,
      external_id: id,
      data_venda: day.includes('T') ? day : `${day}T15:00:00Z`,
      status: 'aprovada',
      produto,
      valor_bruto: valor,
      valor_liquido: valor,
    })
    const { error } = await admin.from('sales').insert([
      sale('curso-old', projectId, 'Curso', '2026-09-10', 100),
      sale('bump-old', projectId, 'Bump', '2026-09-10', 20),
      sale('bump-recent', projectId, 'Bump', '2026-10-02', 20),
      sale('livro-old', otherProjectId, 'Livro', '2026-09-10', 50),
    ])
    expect(error).toBeNull()
  })

  async function saleRow(id: string) {
    const { data } = await admin.from('sales').select('sales_funnel_id, papel').eq('client_id', clientId).eq('external_id', id).single()
    return [data!.sales_funnel_id, data!.papel]
  }

  async function campaignOwners() {
    const { data, error } = await owner.db.rpc('get_client_campaigns', { p_client_id: clientId, p_since: '2000-01-01', p_until: '2100-01-01' })
    expect(error).toBeNull()
    return Object.fromEntries((data as { campaign_id: string; front_ids: string[]; assignment: string | null }[]).map((c) => [c.campaign_id, [c.front_ids[0] ?? null, c.assignment]]))
  }

  it('a role change leaves past sales as they were; a new sale takes the new role', async () => {
    expect(await saleRow('bump-old')).toEqual([projectId, 'order_bump'])
    await owner.db.from('project_products').update({ papel: 'upsell' }).eq('sales_funnel_id', projectId).eq('produto_nome', 'Bump')

    expect(await saleRow('bump-old')).toEqual([projectId, 'order_bump'])
    expect(await saleRow('bump-recent')).toEqual([projectId, 'order_bump'])
    // A resync of the old sale decides it with the role of its date.
    await admin.from('sales').update({ produto: 'Bump' }).eq('client_id', clientId).eq('external_id', 'bump-old')
    expect(await saleRow('bump-old')).toEqual([projectId, 'order_bump'])

    const { error } = await admin.from('sales').insert({
      sales_funnel_id: projectId,
      external_id: 'bump-new',
      data_venda: new Date(Date.now() + 60_000).toISOString(),
      status: 'aprovada',
      produto: 'Bump',
      valor_liquido: 20,
    })
    expect(error).toBeNull()
    expect(await saleRow('bump-new')).toEqual([projectId, 'upsell'])
  })

  it('a product another project already sold enters from now on, without taking its past', async () => {
    await owner.db.from('project_products').insert({ sales_funnel_id: projectId, produto_nome: 'Livro', papel: 'entrada' })
    expect(await saleRow('livro-old')).toEqual([otherProjectId, 'entrada'])
    await admin.from('sales').update({ produto: 'Livro' }).eq('client_id', clientId).eq('external_id', 'livro-old')
    expect(await saleRow('livro-old')).toEqual([otherProjectId, 'entrada'])
  })

  it('a rule change keeps the owner of campaigns that already spent; a new campaign follows the new rules', async () => {
    expect(await campaignOwners()).toMatchObject({ 'c-old': [frontId, 'nome'], 'c-recent': [frontId, 'nome'] })
    const { error } = await owner.db.from('naming_rules').insert({ front_id: frontId, kind: 'exclude', value: 'lancamento' })
    expect(error).toBeNull()
    expect(await campaignOwners()).toMatchObject({ 'c-old': [frontId, 'auto'], 'c-recent': [frontId, 'auto'] })

    await admin.from('campaign_daily').insert([
      { client_id: clientId, data: '2026-10-05', campaign_id: 'c-new-excluded', campaign_name: '[VAP] lancamento nova', spend: 10 },
      { client_id: clientId, data: '2026-10-05', campaign_id: 'c-new', campaign_name: '[VAP] perpetuo', spend: 10 },
    ])
    expect(await campaignOwners()).toMatchObject({ 'c-new-excluded': [null, null], 'c-new': [frontId, 'nome'] })
  })

  it('refuses the preview and the apply to a non-gestor', async () => {
    const preview = await cliente.db.rpc('preview_apply_since', { p_sales_funnel_id: projectId, p_since: '2026-10-01' })
    expect(preview.error).not.toBeNull()
    const apply = await cliente.db.rpc('apply_config_since', { p_sales_funnel_id: projectId, p_since: '2026-10-01' })
    expect(apply.error).not.toBeNull()
    expect(await saleRow('bump-recent')).toEqual([projectId, 'order_bump'])
  })

  it('previews exactly what applying does, and applying since D changes only sales and campaigns since D', async () => {
    const { data: preview, error } = await owner.db.rpc('preview_apply_since', { p_sales_funnel_id: projectId, p_since: '2026-10-01' })
    expect(error).toBeNull()
    const previewed = (preview as ApplyRow[])[0]
    expect(Number(previewed.role_changed)).toBe(1)
    expect(Number(previewed.campaigns_changed)).toBe(1)
    expect(Number(previewed.spend_out)).toBe(40)
    // The preview rolled itself back.
    expect(await saleRow('bump-recent')).toEqual([projectId, 'order_bump'])
    expect((await campaignOwners())['c-recent']).toEqual([frontId, 'auto'])

    const { data: applied, error: applyError } = await owner.db.rpc('apply_config_since', { p_sales_funnel_id: projectId, p_since: '2026-10-01' })
    expect(applyError).toBeNull()
    expect((applied as ApplyRow[])[0]).toEqual(previewed)

    expect(await saleRow('bump-recent')).toEqual([projectId, 'upsell'])
    expect(await saleRow('bump-old')).toEqual([projectId, 'order_bump'])
    expect(await saleRow('livro-old')).toEqual([otherProjectId, 'entrada'])
    const owners = await campaignOwners()
    expect(owners['c-recent']).toEqual([null, null])
    expect(owners['c-old']).toEqual([frontId, 'auto'])

    // Deterministic afterwards: a resync of the recent sale keeps the role it was applied.
    await admin.from('sales').update({ produto: 'Bump' }).eq('client_id', clientId).eq('external_id', 'bump-recent')
    expect(await saleRow('bump-recent')).toEqual([projectId, 'upsell'])
  })
})
