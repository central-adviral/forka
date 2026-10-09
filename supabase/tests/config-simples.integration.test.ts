import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`
const spDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
let campaignSeq = 0

describe('0107: etiqueta do funil e resultado pelas etapas', () => {
  let clientId: string
  let owner: SupabaseClient

  beforeAll(async () => {
    const email = `config-${unique()}@example.com`
    const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
    owner = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    await owner.auth.signInWithPassword({ email, password: 'password123' })
    const { data: client } = await admin.from('clients').insert({ owner_id: user!.user!.id, name: 'Config', slug: `config-${unique()}` }).select().single()
    clientId = client!.id
  })

  const insert = async <T = { id: string }>(table: string, values: Record<string, unknown>): Promise<T> => {
    const { data, error } = await admin.from(table).insert(values).select().single()
    expect(error).toBeNull()
    return data as T
  }
  const funnel = (values: Record<string, unknown> = {}) => insert('sales_funnels', { client_id: clientId, name: 'F', slug: `f-${unique()}`, ...values })
  const stage = (values: Record<string, unknown>) => insert('funnel_stages', { name: 'Etapa', measure: 'compra', ...values })
  const front = (values: Record<string, unknown>) => insert('project_fronts', { code: `F${unique().slice(-6)}`, name: 'F', ...values })
  const rule = async (frontId: string, value: string) => expect((await admin.from('naming_rules').insert({ front_id: frontId, kind: 'include', value })).error).toBeNull()
  const campaign = async (name: string, day: string) => {
    const id = `${Date.now()}${campaignSeq++}`
    expect((await admin.from('campaign_daily').insert({ client_id: clientId, data: day, campaign_id: id, campaign_name: name, spend: 100 })).error).toBeNull()
    return id
  }
  const campaigns = async (since: string) =>
    (await admin.rpc('get_client_campaigns', { p_client_id: clientId, p_since: since, p_until: spDay(1) })).data as {
      campaign_id: string
      front_ids: string[]
      suggested_front_ids: string[]
      assignment: string | null
    }[]
  const resultadoOf = async (id: string) => (await admin.from('sales_funnels').select('resultado, metrica_secundaria').eq('id', id).single()).data!
  const history = async (id: string) =>
    (await admin.from('sales_funnels_resultado_history').select('resultado, valid_from, valid_until').eq('sales_funnel_id', id).order('valid_from')).data

  it('takes a campaign only when the name also carries the funnel tag; mirrors still follow their owner', async () => {
    const day = spDay(-2)
    const tagged = await funnel({ tag: `M${unique().slice(-5)}` })
    const vendas = await stage({ sales_funnel_id: tagged.id, name: 'Vendas', tag: 'VND' })
    const own = await front({ sales_funnel_id: tagged.id, stage_id: vendas.id })
    const mark = `[T${unique().slice(-5)}]`
    await rule(own.id, mark)
    const reader = await funnel()
    const mirror = await front({ sales_funnel_id: reader.id, source_sales_funnel_id: tagged.id })
    const { tag } = (await admin.from('sales_funnels').select('tag').eq('id', tagged.id).single()).data!

    const withTag = await campaign(`${tag.toLowerCase()} | VND | ${mark} | criativo`, day)
    const withoutFunnelTag = await campaign(`VND | ${mark} | criativo`, day)
    const rows = await campaigns(day)
    expect(rows.find((row) => row.campaign_id === withTag)!.front_ids).toEqual([own.id, mirror.id])
    expect(rows.find((row) => row.campaign_id === withoutFunnelTag)!.front_ids).toEqual([])

    // The rule preview judges the same way: only the campaign with the funnel tag is one the rule would take.
    const { data: preview, error } = await owner.rpc('preview_naming_rule', { p_front_id: own.id, p_kind: 'include', p_value: 'criativo' })
    expect(error).toBeNull()
    expect(Number((preview as { campaigns: number }[])[0].campaigns)).toBe(0)
  })

  it('two funnels with the same front tag but different funnel tags do not dispute a campaign', async () => {
    const day = spDay(-2)
    const mark = `[D${unique().slice(-5)}]`
    const [tagA, tagB] = [`A${unique().slice(-5)}`, `B${unique().slice(-5)}`]
    const a = await funnel({ tag: tagA })
    const b = await funnel({ tag: tagB })
    const frontA = await front({ sales_funnel_id: a.id, stage_id: (await stage({ sales_funnel_id: a.id })).id })
    const frontB = await front({ sales_funnel_id: b.id, stage_id: (await stage({ sales_funnel_id: b.id })).id })
    await rule(frontA.id, mark)
    await rule(frontB.id, mark)

    const forA = await campaign(`${tagA} ${mark} frio`, day)
    const forB = await campaign(`${tagB} ${mark} frio`, day)
    const rows = await campaigns(day)
    expect(rows.find((row) => row.campaign_id === forA)).toMatchObject({ front_ids: [frontA.id], suggested_front_ids: [frontA.id], assignment: 'nome' })
    expect(rows.find((row) => row.campaign_id === forB)).toMatchObject({ front_ids: [frontB.id], suggested_front_ids: [frontB.id], assignment: 'nome' })

    // Without the funnel tags the same names would be disputed.
    const c = await funnel()
    const d = await funnel()
    const mark2 = `[E${unique().slice(-5)}]`
    const frontC = await front({ sales_funnel_id: c.id, stage_id: (await stage({ sales_funnel_id: c.id })).id })
    const frontD = await front({ sales_funnel_id: d.id, stage_id: (await stage({ sales_funnel_id: d.id })).id })
    await rule(frontC.id, mark2)
    await rule(frontD.id, mark2)
    const disputed = await campaign(`${mark2} frio`, day)
    expect((await campaigns(day)).find((row) => row.campaign_id === disputed)!.front_ids).toEqual([])
  })

  it('freezes the current owners before the funnel tag changes', async () => {
    const day = spDay(-2)
    const f = await funnel()
    const own = await front({ sales_funnel_id: f.id, stage_id: (await stage({ sales_funnel_id: f.id })).id })
    const mark = `[Z${unique().slice(-5)}]`
    await rule(own.id, mark)
    const before = await campaign(`${mark} antiga`, day)
    expect((await campaigns(day)).find((row) => row.campaign_id === before)!.assignment).toBe('nome')

    expect((await owner.from('sales_funnels').update({ tag: `N${unique().slice(-5)}` }).eq('id', f.id).select('id')).data).toHaveLength(1)
    const kept = (await campaigns(day)).find((row) => row.campaign_id === before)!
    expect([kept.front_ids, kept.assignment]).toEqual([[own.id], 'auto'])
    const after = await campaign(`${mark} nova sem etiqueta do funil`, day)
    expect((await campaigns(day)).find((row) => row.campaign_id === after)!.front_ids).toEqual([])
  })

  it('keeps the funnel tag unique per client among open funnels, ignoring case', async () => {
    const tag = `U${unique().slice(-5)}`
    const first = await funnel({ tag })
    const clash = await admin.from('sales_funnels').insert({ client_id: clientId, name: 'G', slug: `g-${unique()}`, tag: tag.toLowerCase() })
    expect(clash.error?.code).toBe('23505')
    expect((await admin.from('sales_funnels').insert({ client_id: clientId, name: 'G', slug: `g-${unique()}`, tag: ' ' })).error?.code).toBe('23514')
    await admin.from('sales_funnels').update({ archived_at: new Date().toISOString() }).eq('id', first.id)
    expect((await admin.from('sales_funnels').insert({ client_id: clientId, name: 'G', slug: `g-${unique()}`, tag })).error).toBeNull()
  })

  it('derives resultado from the last sequence stage, from today on, and moves the result watcher with it', async () => {
    const today = spDay(0)
    const f = await funnel({ resultado: 'compra', metrica_secundaria: 'lead' })
    // One insert: the result is derived once, from both stages.
    const { data: rows, error } = await admin
      .from('funnel_stages')
      .insert([
        { sales_funnel_id: f.id, name: 'Captação', measure: 'lead', position: 0, meta: 6 },
        { sales_funnel_id: f.id, name: 'Vendas', measure: 'compra', position: 1, meta: 55 },
      ])
      .select('id, name')
    expect(error).toBeNull()
    const [cap, vnd] = ['Captação', 'Vendas'].map((name) => rows!.find((row) => row.name === name)!)
    const plan = await insert('watchers', { client_id: clientId, sales_funnel_id: f.id, metric: 'cpa_geral', target: 40, is_plan: true, plan_role: 'principal' })
    await insert('watchers', { client_id: clientId, sales_funnel_id: f.id, metric: 'cpl', is_plan: false, plan_role: 'secundaria' })
    await insert('alerts', { watcher_id: plan.id, client_id: clientId, severity: 'warn', value: 60, day: spDay(-1) })
    expect(await resultadoOf(f.id)).toEqual({ resultado: 'compra', metrica_secundaria: 'lead' })

    // Parallel, archived and ascensão stages are never the result.
    await stage({ sales_funnel_id: f.id, name: 'Reconhecimento', measure: 'alcance', position: 5, parallel: true })
    await stage({ sales_funnel_id: f.id, name: 'Ascensão', measure: 'ascensao', position: 6 })
    await stage({ sales_funnel_id: f.id, name: 'Antiga', measure: 'visita', position: 7, archived_at: new Date().toISOString() })
    expect((await resultadoOf(f.id)).resultado).toBe('compra')
    expect(await history(f.id)).toEqual([{ resultado: 'compra', valid_from: '-infinity', valid_until: 'infinity' }])

    // Captação after Vendas: the funnel's result is now leads.
    expect((await owner.rpc('reorder_funnel_stages', { p_funnel_id: f.id, p_stage_ids: [vnd.id, cap.id] })).error).toBeNull()
    expect(await resultadoOf(f.id)).toEqual({ resultado: 'lead', metrica_secundaria: null })
    expect(await history(f.id)).toEqual([
      { resultado: 'compra', valid_from: '-infinity', valid_until: today },
      { resultado: 'lead', valid_from: today, valid_until: 'infinity' },
    ])
    const watchers = (await admin.from('watchers').select('id, metric, target, plan_role').eq('sales_funnel_id', f.id)).data!
    expect(watchers).toEqual([{ id: plan.id, metric: 'cpl', target: null, plan_role: 'principal' }])
    expect((await admin.from('alerts').select('closed_at').eq('watcher_id', plan.id).single()).data!.closed_at).not.toBeNull()

    // Back to a compra result stage the same day: the day holds compra again.
    expect((await owner.from('funnel_stages').update({ archived_at: new Date().toISOString() }).eq('id', cap.id).select('id')).data).toHaveLength(1)
    expect((await resultadoOf(f.id)).resultado).toBe('compra')
    expect((await history(f.id))!.at(-1)).toEqual({ resultado: 'compra', valid_from: today, valid_until: 'infinity' })
    expect((await admin.from('watchers').select('metric').eq('id', plan.id).single()).data!.metric).toBe('cpa_geral')
  })

  it('keeps ROAS and checkout while the result stage is compra, and the current result with no stage that can be it', async () => {
    const roas = await funnel({ resultado: 'roas' })
    await stage({ sales_funnel_id: roas.id, name: 'Vendas', measure: 'compra', position: 0, meta_roas: 2 })
    await stage({ sales_funnel_id: roas.id, name: 'Ascensão', measure: 'ascensao', position: 1 })
    expect((await resultadoOf(roas.id)).resultado).toBe('roas')

    const reach = await funnel({ resultado: 'lead' })
    await stage({ sales_funnel_id: reach.id, name: 'Reconhecimento', measure: 'alcance', parallel: true })
    expect((await resultadoOf(reach.id)).resultado).toBe('lead')
    const lemb = await stage({ sales_funnel_id: reach.id, name: 'Lembrete', measure: 'alcance', position: 1 })
    expect((await resultadoOf(reach.id)).resultado).toBe('alcance')
    // Deleting the stage leaves no result stage: the funnel keeps the last one.
    expect((await admin.from('funnel_stages').delete().eq('id', lemb.id)).error).toBeNull()
    expect((await resultadoOf(reach.id)).resultado).toBe('alcance')
  })

  it('leaves the legacy placement by resultado alone: a front without stage still lands by the funnel result', async () => {
    const f = await funnel({ resultado: 'compra' })
    const cap = await front({ sales_funnel_id: f.id, metrica_principal: 'lead' })
    const vnd = await front({ sales_funnel_id: f.id })
    const stages = (await admin.from('funnel_stages').select('id, measure').eq('sales_funnel_id', f.id).order('position')).data!
    expect(stages.map((row) => row.measure)).toEqual(['lead', 'compra'])
    expect((await admin.from('project_fronts').select('stage_id').eq('id', cap.id).single()).data!.stage_id).toBe(stages[0].id)
    expect((await admin.from('project_fronts').select('stage_id').eq('id', vnd.id).single()).data!.stage_id).toBe(stages[1].id)
    expect((await resultadoOf(f.id)).resultado).toBe('compra')
  })

  it('changes no report number when the stages keep the same result', async () => {
    const day = spDay(-1)
    const f = await funnel({ resultado: 'compra' })
    const vnd = await stage({ sales_funnel_id: f.id, name: 'Vendas', measure: 'compra', position: 0 })
    const own = await front({ sales_funnel_id: f.id, stage_id: vnd.id })
    const mark = `[R${unique().slice(-5)}]`
    await rule(own.id, mark)
    await campaign(`${mark} vendas`, day)
    const read = async () => {
      const { data, error } = await admin.rpc('get_client_daily', { p_client_id: clientId, p_since: day, p_until: spDay(1) })
      expect(error).toBeNull()
      return data
    }
    const before = await read()
    await stage({ sales_funnel_id: f.id, name: 'Reconhecimento', measure: 'alcance', parallel: true })
    await stage({ sales_funnel_id: f.id, name: 'Ascensão', measure: 'ascensao', position: 2 })
    expect(await read()).toEqual(before)
    expect(await history(f.id)).toEqual([{ resultado: 'compra', valid_from: '-infinity', valid_until: 'infinity' }])
  })
})
