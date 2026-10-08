import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321', process.env.SUPABASE_SERVICE_ROLE_KEY!)
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

describe('0102: projeto por frentes', () => {
  let clientId: string
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

  beforeAll(async () => {
    const { data: user } = await admin.auth.admin.createUser({ email: `frentes-${unique()}@example.com`, password: 'password123', email_confirm: true })
    const { data: client } = await admin.from('clients').insert({ owner_id: user!.user!.id, name: 'Frentes', slug: `frentes-${unique()}` }).select().single()
    clientId = client!.id
  })

  const project = async (values: Record<string, unknown>) => {
    const { data, error } = await admin.from('sales_funnels').insert({ client_id: clientId, name: 'P', slug: `p-${unique()}`, ...values }).select().single()
    expect(error).toBeNull()
    return data!
  }
  const statusOf = async (id: string) => (await admin.from('sales_funnels').select('status, is_active').eq('id', id).single()).data

  it('keeps is_active derived from status, both ways', async () => {
    expect(await project({})).toMatchObject({ status: 'rodando', is_active: true })
    expect(await project({ is_active: false })).toMatchObject({ status: 'encerrado', is_active: false })
    const draft = await project({ status: 'rascunho' })
    expect(draft).toMatchObject({ status: 'rascunho', is_active: false })
    await admin.from('sales_funnels').update({ status: 'rodando' }).eq('id', draft.id)
    expect(await statusOf(draft.id)).toEqual({ status: 'rodando', is_active: true })
    await admin.from('sales_funnels').update({ is_active: false }).eq('id', draft.id)
    expect(await statusOf(draft.id)).toEqual({ status: 'encerrado', is_active: false })
    expect((await admin.from('sales_funnels').update({ status: 'pausado' }).eq('id', draft.id)).error).not.toBeNull()
  })

  it('watches only a running project', async () => {
    const draft = await project({ status: 'rascunho' })

    const { data: front } = await admin.from('project_fronts').insert({ sales_funnel_id: draft.id, code: 'CAP', name: 'Captação' }).select().single()
    await admin.from('naming_rules').insert({ front_id: front!.id, kind: 'include', value: `[${draft.id.slice(0, 8)}]` })
    await admin.from('campaign_daily').insert({
      client_id: clientId, data: yesterday, campaign_id: `c-${unique()}`, campaign_name: `[${draft.id.slice(0, 8)}] frio`, spend: 1000, leads: 10, impressions: 10000,
    })
    const { data: watcher } = await admin.from('watchers').insert({ client_id: clientId, sales_funnel_id: draft.id, metric: 'cpl', target: 50 }).select().single()
    const alertsOf = async () => (await admin.from('alerts').select('id').eq('watcher_id', watcher!.id)).data ?? []

    await admin.rpc('evaluate_watchers', { p_client_id: clientId })
    expect((await admin.from('watchers').select('last_status').eq('id', watcher!.id).single()).data!.last_status).toBeNull()
    expect(await alertsOf()).toHaveLength(0)

    await admin.from('sales_funnels').update({ status: 'rodando' }).eq('id', draft.id)
    await admin.rpc('evaluate_watchers', { p_client_id: clientId })
    expect((await admin.from('watchers').select('last_status, last_value').eq('id', watcher!.id).single()).data).toMatchObject({ last_status: 'crit', last_value: 100 })
    expect(await alertsOf()).toHaveLength(1)

    // Encerrado freezes: the watcher keeps its last reading and is not judged again.
    await admin.from('sales_funnels').update({ status: 'encerrado' }).eq('id', draft.id)
    await admin.from('watchers').update({ last_status: null }).eq('id', watcher!.id)
    await admin.rpc('evaluate_watchers', { p_client_id: clientId })
    expect((await admin.from('watchers').select('last_status').eq('id', watcher!.id).single()).data!.last_status).toBeNull()
  })

  it('gives a front with its own metrics a watcher per metric, and none when it follows the project', async () => {
    const owner = await project({})
    const { data: follows } = await admin.from('project_fronts').insert({ sales_funnel_id: owner.id, code: 'VND', name: 'Vendas' }).select().single()
    const { data: front, error } = await admin
      .from('project_fronts')
      .insert({ sales_funnel_id: owner.id, code: 'CAP', name: 'Captação', metrica_principal: 'compra', alvo_principal: 120, metrica_secundaria: 'lead', alvo_secundaria: 4 })
      .select()
      .single()
    expect(error).toBeNull()
    const watchersOf = async (frontId: string) =>
      (await admin.from('watchers').select('metric, target, plan_role').eq('front_id', frontId).order('plan_role')).data ?? []

    expect(await watchersOf(follows!.id)).toEqual([])
    expect(await watchersOf(front!.id)).toEqual([
      { metric: 'cpa_anuncio', target: 120, plan_role: 'principal' },
      { metric: 'cpl', target: 4, plan_role: 'secundaria' },
    ])

    await admin.from('project_fronts').update({ alvo_principal: 90, metrica_secundaria: null }).eq('id', front!.id)
    expect(await watchersOf(front!.id)).toEqual([{ metric: 'cpa_anuncio', target: 90, plan_role: 'principal' }])

    await admin.from('project_fronts').update({ metrica_principal: 'alcance', alvo_principal: 15 }).eq('id', front!.id)
    expect(await watchersOf(front!.id)).toEqual([{ metric: 'cpm', target: 15, plan_role: 'principal' }])

    expect((await admin.from('project_fronts').update({ metrica_secundaria: 'alcance', alvo_secundaria: 3 }).eq('id', front!.id)).error).not.toBeNull()
  })

  it('stores the project secondary metric next to the plan watcher, one per role', async () => {
    const owner = await project({ resultado: 'compra', metrica_secundaria: 'lead', modelo: 'pago' })
    expect(owner).toMatchObject({ metrica_secundaria: 'lead', modelo: 'pago' })
    expect((await admin.from('sales_funnels').update({ metrica_secundaria: 'compra' }).eq('id', owner.id)).error).not.toBeNull()

    const plan = await admin.from('watchers').insert({ client_id: clientId, sales_funnel_id: owner.id, metric: 'cpa_geral', target: 120, is_plan: true }).select().single()
    expect(plan.data).toMatchObject({ plan_role: 'principal' })
    const secondary = await admin.from('watchers').insert({ client_id: clientId, sales_funnel_id: owner.id, metric: 'cpl', target: 4, plan_role: 'secundaria' }).select().single()
    expect(secondary.error).toBeNull()
    expect((await admin.from('watchers').insert({ client_id: clientId, sales_funnel_id: owner.id, metric: 'cpm', target: 4, plan_role: 'secundaria' })).error).not.toBeNull()
  })
})
