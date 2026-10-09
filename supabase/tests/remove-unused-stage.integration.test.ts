import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { deleteFront, deleteStage, getRemovalFacts } from '@/lib/repo/funnel-stages-repo'
import { frontInUse, isLastOpenStage, stageInUse } from '@/lib/domain/stage-removal'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

describe('Remover etapa / frente sem dados', () => {
  let clientId: string
  let owner: SupabaseClient
  let stranger: SupabaseClient

  const signIn = async (prefix: string) => {
    const email = `${prefix}-${unique()}@example.com`
    const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
    const session = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    await session.auth.signInWithPassword({ email, password: 'password123' })
    return { id: user!.user!.id, session }
  }

  beforeAll(async () => {
    const user = await signIn('remover')
    owner = user.session
    stranger = (await signIn('remover-outro')).session
    const { data: client } = await admin.from('clients').insert({ owner_id: user.id, name: 'Remover', slug: `remover-${unique()}` }).select().single()
    clientId = client!.id
  })

  const insert = async (table: string, values: Record<string, unknown>) => {
    const { data, error } = await admin.from(table).insert(values).select().single()
    expect(error).toBeNull()
    return data as { id: string }
  }
  const funnel = () => insert('sales_funnels', { client_id: clientId, name: 'F', slug: `f-${unique()}` })
  const stage = (funnelId: string, values: Record<string, unknown> = {}) => insert('funnel_stages', { sales_funnel_id: funnelId, name: 'Etapa', measure: 'compra', ...values })
  const front = (funnelId: string, stageId: string) => insert('project_fronts', { sales_funnel_id: funnelId, stage_id: stageId, code: `F${unique().slice(-6)}`, name: 'F' })
  const exists = async (table: string, id: string) => ((await admin.from(table).select('id').eq('id', id)).data ?? []).length === 1

  it('deletes an unused stage with its empty front and derives the resultado again', async () => {
    const f = await funnel()
    const captacao = await stage(f.id, { name: 'Captação', measure: 'lead', position: 0 })
    const vendas = await stage(f.id, { name: 'Vendas', measure: 'compra', position: 1 })
    const empty = await front(f.id, vendas.id)
    expect((await admin.from('sales_funnels').select('resultado').eq('id', f.id).single()).data!.resultado).toBe('compra')

    const facts = await getRemovalFacts(owner, f.id)
    expect(stageInUse(vendas.id, facts)).toBeNull()
    await deleteStage(owner, f.id, vendas.id)
    expect(await exists('funnel_stages', vendas.id)).toBe(false)
    expect(await exists('project_fronts', empty.id)).toBe(false)
    expect(await exists('funnel_stages', captacao.id)).toBe(true)
    expect((await admin.from('sales_funnels').select('resultado').eq('id', f.id).single()).data!.resultado).toBe('lead')
    expect(isLastOpenStage(captacao.id, await getRemovalFacts(owner, f.id))).toBe(true)
  })

  it('reports a stage as used by its fronts campaigns, pages, rules, watchers, tests and combos', async () => {
    const f = await funnel()
    const [a, b, c, d, e] = await Promise.all([1, 2, 3, 4, 5].map((position) => stage(f.id, { name: `E${position}`, position })))
    const withCampaign = await front(f.id, a.id)
    const withPage = await front(f.id, b.id)
    const withRule = await front(f.id, b.id)
    expect((await admin.from('campaign_fronts').insert({ client_id: clientId, campaign_id: `c-${unique()}`, front_id: withCampaign.id, source: 'manual' })).error).toBeNull()
    await insert('pages', { client_id: clientId, sales_funnel_id: f.id, front_id: withPage.id, label: 'Oferta', url: `https://exemplo.com/${unique()}`, tipo: 'vendas' })
    expect((await admin.from('naming_rules').insert({ front_id: withRule.id, kind: 'include', value: '[X]' })).error).toBeNull()
    await insert('watchers', { client_id: clientId, sales_funnel_id: f.id, stage_id: c.id, metric: 'cpa_geral', target: 100 })
    await insert('backlog_items', { client_id: clientId, sales_funnel_id: f.id, funnel_stage_id: d.id, code: 'T1', title: 'Teste', stage: 'anuncio', method: 'meta' })
    await insert('funnel_cost_combos', { sales_funnel_id: f.id, name: 'CPA', stage_ids: [a.id], over: 'stage', over_stage_id: e.id })

    const facts = await getRemovalFacts(owner, f.id)
    expect(stageInUse(a.id, facts)).toBe('Tem 1 frente com campanhas, custo combinado')
    expect(stageInUse(b.id, facts)).toBe('Tem 2 frentes com etiquetas, páginas ou vigias')
    expect(stageInUse(c.id, facts)).toBe('Tem vigia da etapa')
    expect(stageInUse(d.id, facts)).toBe('Tem 1 teste')
    expect(stageInUse(e.id, facts)).toBe('Tem custo combinado')
    expect(frontInUse(withCampaign.id, facts)).toBe('Tem 1 campanha')
    expect(frontInUse(withPage.id, facts)).toBe('Tem 1 página')
    expect(frontInUse(withRule.id, facts)).toBe('Tem etiquetas')
  })

  it('deletes an unused front only for the gestor or owner', async () => {
    const f = await funnel()
    const s = await stage(f.id)
    const empty = await front(f.id, s.id)
    expect(frontInUse(empty.id, await getRemovalFacts(owner, f.id))).toBeNull()
    await expect(deleteFront(stranger, f.id, empty.id)).rejects.toThrow('Só gestor ou owner')
    await expect(deleteStage(stranger, f.id, s.id)).rejects.toThrow('Só gestor ou owner')
    expect(await exists('project_fronts', empty.id)).toBe(true)
    await deleteFront(owner, f.id, empty.id)
    expect(await exists('project_fronts', empty.id)).toBe(false)
  })
})
