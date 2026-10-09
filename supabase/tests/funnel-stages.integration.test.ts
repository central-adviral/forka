import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { copyStages, getCostCombos, getFunnelStages, getStageDaily, getStageOrigin, moveFrontToStage, setStageArchived } from '@/lib/repo/funnel-stages-repo'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`
const spDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
const noon = (day: string) => `${day}T15:00:00Z`
let campaignSeq = 0

describe('0105: etapas no funil', () => {
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
    const user = await signIn('etapas')
    owner = user.session
    stranger = (await signIn('etapas-outro')).session
    const { data: client } = await admin.from('clients').insert({ owner_id: user.id, name: 'Etapas', slug: `etapas-${unique()}` }).select().single()
    clientId = client!.id
  })

  const project = async (values: Record<string, unknown> = {}) => {
    const { data, error } = await admin.from('sales_funnels').insert({ client_id: clientId, name: 'P', slug: `p-${unique()}`, ...values }).select().single()
    expect(error).toBeNull()
    return data!
  }
  const front = async (values: Record<string, unknown>) => {
    const { data, error } = await admin.from('project_fronts').insert({ code: `F${unique().slice(-6)}`, name: 'F', ...values }).select().single()
    expect(error).toBeNull()
    return data!
  }
  const stage = async (values: Record<string, unknown>) => {
    const { data, error } = await admin.from('funnel_stages').insert({ name: 'Etapa', measure: 'compra', ...values }).select().single()
    expect(error).toBeNull()
    return data!
  }
  const rule = async (frontId: string, value: string) => {
    expect((await admin.from('naming_rules').insert({ front_id: frontId, kind: 'include', value })).error).toBeNull()
  }
  const campaign = async (name: string, days: string[], values: Record<string, unknown> = {}) => {
    const id = `${Date.now()}${campaignSeq++}`
    expect((await admin.from('campaign_daily').insert(days.map((data) => ({ client_id: clientId, data, campaign_id: id, campaign_name: name, spend: 100, ...values })))).error).toBeNull()
    return id
  }
  const sale = async (values: Record<string, unknown>) => {
    const row = { source: 'launchops_sync', external_id: `s-${unique()}`, status: 'aprovada', valor_bruto: 100, valor_liquido: 90, is_upsell: false, ...values }
    expect((await admin.from('sales').insert(row)).error).toBeNull()
    return row
  }
  const campaigns = async (since: string) =>
    (await admin.rpc('get_client_campaigns', { p_client_id: clientId, p_since: since, p_until: spDay(1) })).data as { campaign_id: string; front_ids: string[]; assignment: string | null }[]
  const stagesOf = async (funnelId: string) =>
    ((await admin.from('funnel_stages').select('id, name, tag, measure, position, janela_inicio, janela_fim, meta, meta_roas, archived_at').eq('sales_funnel_id', funnelId).order('position')).data ?? []) as {
      id: string; name: string; tag: string | null; measure: string; position: number; janela_inicio: string | null; janela_fim: string | null; meta: number | null; meta_roas: number | null; archived_at: string | null
    }[]
  const stageOfFront = async (frontId: string) => (await admin.from('project_fronts').select('stage_id').eq('id', frontId).single()).data!.stage_id as string

  it('backfills one stage per measure, with targets, windows, the old CPA combo and the tests', async () => {
    const funnel = await project({ resultado: 'compra' })
    const plan = await admin.from('watchers').insert([
      { client_id: clientId, sales_funnel_id: funnel.id, metric: 'cpa_geral', target: 100, is_plan: true, plan_role: 'principal' },
      { client_id: clientId, sales_funnel_id: funnel.id, metric: 'roas', target: 2, is_plan: false, plan_role: 'secundaria' },
    ])
    expect(plan.error).toBeNull()
    const cap = await front({ sales_funnel_id: funnel.id, position: 0, metrica_principal: 'lead', alvo_principal: 5 })
    const vnd = await front({ sales_funnel_id: funnel.id, position: 1 })
    const source = await project()
    const mirror = await front({ sales_funnel_id: funnel.id, position: 2, source_sales_funnel_id: source.id, janela_inicio: spDay(-9), janela_fim: spDay(-5) })
    const aqc = await front({ sales_funnel_id: funnel.id, position: 3, metrica_principal: 'alcance', alvo_principal: 12, archived_at: new Date().toISOString() })
    const { data: item } = await admin.from('backlog_items').insert({ client_id: clientId, sales_funnel_id: funnel.id, code: 'T1', title: 'Teste', stage: 'anuncio', method: 'meta' }).select('id').single()

    expect((await admin.rpc('backfill_funnel_stages', { p_sales_funnel_id: funnel.id })).error).toBeNull()
    const stages = await stagesOf(funnel.id)
    expect(stages.map((row) => [row.name, row.measure, row.position, row.tag])).toEqual([
      ['Captação', 'lead', 0, null],
      ['Vendas', 'compra', 1, null],
      ['Reconhecimento', 'alcance', 2, null],
    ])
    const [captacao, vendas, reconhecimento] = stages
    expect(Number(captacao.meta)).toBe(5)
    expect([Number(vendas.meta), Number(vendas.meta_roas)]).toEqual([100, 2])
    // Vendas mixes a front without a window and a windowed mirror: no window. Every front of
    // Reconhecimento is archived, so the stage is too.
    expect([vendas.janela_inicio, vendas.janela_fim]).toEqual([null, null])
    expect(reconhecimento.archived_at).not.toBeNull()
    expect(captacao.archived_at).toBeNull()
    expect(await stageOfFront(cap.id)).toBe(captacao.id)
    expect(await stageOfFront(vnd.id)).toBe(vendas.id)
    expect(await stageOfFront(mirror.id)).toBe(vendas.id)
    expect(await stageOfFront(aqc.id)).toBe(reconhecimento.id)

    const combos = await getCostCombos(admin, funnel.id)
    expect(combos.map((combo) => [combo.name, combo.stageIds, combo.over, combo.overStageId, combo.enabled])).toEqual([
      ['CPA geral (antigo)', [captacao.id, vendas.id, reconhecimento.id], 'stage', vendas.id, true],
    ])
    expect((await admin.from('backlog_items').select('funnel_stage_id').eq('id', item!.id).single()).data!.funnel_stage_id).toBe(vendas.id)

    // A group of windowed mirrors only keeps the span of their windows.
    const mirrors = await project({ resultado: 'compra' })
    await front({ sales_funnel_id: mirrors.id, source_sales_funnel_id: source.id, janela_inicio: spDay(-9), janela_fim: spDay(-7) })
    await front({ sales_funnel_id: mirrors.id, source_sales_funnel_id: source.id, janela_inicio: spDay(-6), janela_fim: spDay(-2) })
    await admin.rpc('backfill_funnel_stages', { p_sales_funnel_id: mirrors.id })
    const [windowed] = await stagesOf(mirrors.id)
    expect([windowed.janela_inicio, windowed.janela_fim]).toEqual([spDay(-9), spDay(-2)])
    expect(await getCostCombos(admin, mirrors.id)).toEqual([])

    // A project with no front gets the stage of its resultado.
    const empty = await project({ resultado: 'lead' })
    await admin.rpc('backfill_funnel_stages', { p_sales_funnel_id: empty.id })
    expect((await stagesOf(empty.id)).map((row) => [row.name, row.measure])).toEqual([['Captação', 'lead']])
  })

  it('puts a front written without a stage in its measure stage, creating it when missing', async () => {
    const funnel = await project({ resultado: 'compra' })
    const cap = await front({ sales_funnel_id: funnel.id, position: 0, metrica_principal: 'lead' })
    const vnd = await front({ sales_funnel_id: funnel.id, position: 1 })
    const rmkt = await front({ sales_funnel_id: funnel.id, position: 2, metrica_principal: 'roas', alvo_principal: 3 })
    const stages = await stagesOf(funnel.id)
    expect(stages.map((row) => [row.name, row.measure, row.position])).toEqual([
      ['Captação', 'lead', 0],
      ['Vendas', 'compra', 1],
    ])
    expect(await stageOfFront(cap.id)).toBe(stages[0].id)
    expect(await stageOfFront(vnd.id)).toBe(stages[1].id)
    expect(await stageOfFront(rmkt.id)).toBe(stages[1].id)
  })

  it('takes a campaign only when it also carries the stage tag, and leaves mirrors alone', async () => {
    const day = spDay(-2)
    const funnel = await project()
    const tagged = await stage({ sales_funnel_id: funnel.id, name: 'Vendas', tag: 'VND' })
    const own = await front({ sales_funnel_id: funnel.id, stage_id: tagged.id })
    const mark = `[T${unique().slice(-5)}]`
    await rule(own.id, mark)
    const reader = await project()
    const mirror = await front({ sales_funnel_id: reader.id, source_sales_funnel_id: funnel.id })

    const withTag = await campaign(`${mark} vnd frio`, [day])
    const withoutTag = await campaign(`${mark} cap frio`, [day])
    const rows = await campaigns(day)
    expect(rows.find((row) => row.campaign_id === withTag)!.front_ids).toEqual([own.id, mirror.id])
    expect(rows.find((row) => row.campaign_id === withoutTag)!.front_ids).toEqual([])

    // The rule preview judges the same way.
    const { data: preview, error } = await owner.rpc('preview_naming_rule', { p_front_id: own.id, p_kind: 'include', p_value: 'frio' })
    expect(error).toBeNull()
    // Without the stage tag, the untagged campaign would be one the rule takes.
    expect(Number((preview as { campaigns: number }[])[0].campaigns)).toBe(0)
  })

  it('freezes the current owners before a tag change or a move to a stage of another tag', async () => {
    const day = spDay(-2)
    const funnel = await project()
    const open = await stage({ sales_funnel_id: funnel.id, name: 'Vendas' })
    const own = await front({ sales_funnel_id: funnel.id, stage_id: open.id })
    const mark = `[Z${unique().slice(-5)}]`
    await rule(own.id, mark)
    const before = await campaign(`${mark} antiga`, [day])
    expect((await campaigns(day)).find((row) => row.campaign_id === before)!.assignment).toBe('nome')

    expect((await owner.from('funnel_stages').update({ tag: 'VND' }).eq('id', open.id)).error).toBeNull()
    const kept = (await campaigns(day)).find((row) => row.campaign_id === before)!
    expect([kept.front_ids, kept.assignment]).toEqual([[own.id], 'auto'])
    const after = await campaign(`${mark} nova`, [day])
    expect((await campaigns(day)).find((row) => row.campaign_id === after)!.front_ids).toEqual([])

    // Moving the front to a stage with another tag freezes too.
    const other = await stage({ sales_funnel_id: funnel.id, name: 'Remarketing', tag: 'RMK' })
    const second = await front({ sales_funnel_id: funnel.id, stage_id: open.id })
    const mark2 = `[W${unique().slice(-5)}]`
    await rule(second.id, mark2)
    const named = await campaign(`${mark2} vnd`, [day])
    expect((await campaigns(day)).find((row) => row.campaign_id === named)!.assignment).toBe('nome')
    await moveFrontToStage(owner, second.id, other.id)
    const moved = (await campaigns(day)).find((row) => row.campaign_id === named)!
    expect([moved.front_ids, moved.assignment]).toEqual([[second.id], 'auto'])
  })

  it('splits entry sales between two compra stages by campaign, counts ascension apart and reports the origin', async () => {
    const day = spDay(-2)
    const funnel = await project({ resultado: 'compra' })
    const entry = `Curso ${unique()}`
    const upgrade = `Mentoria ${unique()}`
    await admin.from('project_products').insert([
      { sales_funnel_id: funnel.id, produto_nome: entry, papel: 'entrada' },
      { sales_funnel_id: funnel.id, produto_nome: upgrade, papel: 'ascensao' },
    ])
    const captacao = await stage({ sales_funnel_id: funnel.id, name: 'Captação', measure: 'lead', position: 0 })
    const vendas = await stage({ sales_funnel_id: funnel.id, name: 'Vendas', position: 1 })
    const carrinho = await stage({ sales_funnel_id: funnel.id, name: 'Remarketing de carrinho', position: 2 })
    const ascensao = await stage({ sales_funnel_id: funnel.id, name: 'Ascensão', measure: 'ascensao', position: 3 })
    const fronts = {
      cap: await front({ sales_funnel_id: funnel.id, stage_id: captacao.id }),
      vnd: await front({ sales_funnel_id: funnel.id, stage_id: vendas.id }),
      rcar: await front({ sales_funnel_id: funnel.id, stage_id: carrinho.id }),
    }
    const mark = unique().slice(-5)
    await rule(fronts.cap.id, `[C${mark}]`)
    await rule(fronts.vnd.id, `[V${mark}]`)
    await rule(fronts.rcar.id, `[R${mark}]`)
    const ids = {
      cap: await campaign(`[C${mark}] lead`, [day], { leads: 20, impressions: 4000 }),
      vnd: await campaign(`[V${mark}] venda`, [day], { spend: 300 }),
      rcar: await campaign(`[R${mark}] carrinho`, [day], { spend: 50 }),
    }
    const bought = (campaignId: string | null, values: Record<string, unknown> = {}) =>
      sale({ sales_funnel_id: funnel.id, produto: entry, data_venda: noon(day), ...(campaignId ? { utm_source: 'facebookads', utm_campaign: `c ${campaignId}` } : {}), ...values })
    await bought(ids.rcar)
    await bought(ids.vnd)
    await bought(null)
    await bought(ids.cap)
    await bought(ids.cap, { reembolsado_em: noon(spDay(-1)) })
    await sale({ sales_funnel_id: funnel.id, produto: upgrade, data_venda: noon(day), valor_liquido: 900 })

    const rows = await getStageDaily(owner, funnel.id, day, spDay(0))
    const at = (stageId: string) => rows.filter((row) => row.stageId === stageId)
    const total = (stageId: string, key: 'vendas' | 'reembolsos' | 'spend' | 'leads' | 'receitaLiquida') => at(stageId).reduce((sum, row) => sum + row[key], 0)
    expect(total(carrinho.id, 'vendas')).toBe(1)
    // Vendas takes its own campaign's sale, the one with no campaign and the two from Captação.
    expect(total(vendas.id, 'vendas')).toBe(4)
    expect(total(vendas.id, 'reembolsos')).toBe(1)
    expect(total(vendas.id, 'receitaLiquida')).toBe(4 * 90 - 90)
    expect(total(captacao.id, 'vendas')).toBe(0)
    expect([total(captacao.id, 'spend'), total(captacao.id, 'leads')]).toEqual([100, 20])
    expect([total(vendas.id, 'spend'), total(carrinho.id, 'spend')]).toEqual([300, 50])
    expect([total(ascensao.id, 'vendas'), total(ascensao.id, 'receitaLiquida')]).toEqual([1, 900])

    // The refunded sale (refunded before the end of the range) is out of the origin.
    const origin = await getStageOrigin(owner, funnel.id, day, spDay(0))
    const count = (stageId: string, originId: string | null) => origin.find((row) => row.stageId === stageId && row.originStageId === originId)?.vendas ?? 0
    expect(count(vendas.id, captacao.id)).toBe(1)
    expect(count(vendas.id, vendas.id)).toBe(1)
    expect(count(vendas.id, null)).toBe(1)
    expect(count(carrinho.id, carrinho.id)).toBe(1)
    expect(origin.reduce((sum, row) => sum + row.vendas, 0)).toBe(4)
  })

  it('counts spend and sales of a windowed stage only inside its window', async () => {
    const [d1, d2, d3] = [spDay(-4), spDay(-3), spDay(-2)]
    const funnel = await project({ resultado: 'compra' })
    const entry = `Ebook ${unique()}`
    await admin.from('project_products').insert({ sales_funnel_id: funnel.id, produto_nome: entry, papel: 'entrada' })
    const windowed = await stage({ sales_funnel_id: funnel.id, name: 'Carrinho', position: 0, janela_inicio: d2, janela_fim: d2 })
    const open = await stage({ sales_funnel_id: funnel.id, name: 'Vendas', position: 1 })
    const own = await front({ sales_funnel_id: funnel.id, stage_id: windowed.id })
    const mark = `[J${unique().slice(-5)}]`
    await rule(own.id, mark)
    const id = await campaign(`${mark} carrinho`, [d1, d2, d3])
    for (const day of [d1, d2, d3]) await sale({ sales_funnel_id: funnel.id, produto: entry, data_venda: noon(day), utm_source: 'facebookads', utm_campaign: `c ${id}` })

    const rows = await getStageDaily(owner, funnel.id, d1, spDay(0))
    expect(rows.filter((row) => row.stageId === windowed.id).map((row) => [row.data, row.spend, row.vendas])).toEqual([[d2, 100, 1]])
    // Outside the window, the sales of its campaign fall to the first compra stage that is open then.
    expect(rows.filter((row) => row.stageId === open.id).map((row) => [row.data, row.spend, row.vendas])).toEqual([
      [d1, 0, 1],
      [d3, 0, 1],
    ])
  })

  it('keeps every report number the same after rebuilding the stages, and the old CPA in the combo', async () => {
    const [d1, d2] = [spDay(-3), spDay(-2)]
    const funnel = await project({ resultado: 'compra' })
    const entry = `Curso ${unique()}`
    await admin.from('project_products').insert({ sales_funnel_id: funnel.id, produto_nome: entry, papel: 'entrada' })
    await admin.from('client_tax_rates').insert({ client_id: clientId, valid_from: '2000-01-01', factor: 1.1 })
    const cap = await front({ sales_funnel_id: funnel.id, position: 0, metrica_principal: 'lead', alvo_principal: 4 })
    const vnd = await front({ sales_funnel_id: funnel.id, position: 1 })
    const mark = unique().slice(-5)
    await rule(cap.id, `[K${mark}]`)
    await rule(vnd.id, `[L${mark}]`)
    const capId = await campaign(`[K${mark}] lead`, [d1, d2], { leads: 10 })
    await campaign(`[L${mark}] venda`, [d1, d2], { spend: 200 })
    await sale({ sales_funnel_id: funnel.id, produto: entry, data_venda: noon(d1), utm_source: 'facebookads', utm_campaign: `c ${capId}` })
    await sale({ sales_funnel_id: funnel.id, produto: entry, data_venda: noon(d2) })

    const range = { p_sales_funnel_id: funnel.id, p_since: d1, p_until: spDay(0) }
    const reports = async () => ({
      funnel: (await owner.rpc('get_funnel_daily', range)).data,
      fronts: (await owner.rpc('get_project_front_daily', range)).data,
      frontSales: (await owner.rpc('get_project_front_sales', range)).data,
      quality: (await owner.rpc('get_project_data_quality', range)).data,
      client: (await owner.rpc('get_client_daily', { p_client_id: clientId, p_since: d1, p_until: spDay(0) })).data,
      campaigns: (await owner.rpc('get_client_campaigns', { p_client_id: clientId, p_since: d1, p_until: spDay(0) })).data,
    })
    const before = await reports()
    expect((await admin.rpc('backfill_funnel_stages', { p_sales_funnel_id: funnel.id })).error).toBeNull()
    expect(await reports()).toEqual(before)

    const stages = await getFunnelStages(owner, funnel.id)
    expect(stages.map((row) => [row.name, row.fronts.map((f) => f.id)])).toEqual([
      ['Captação', [cap.id]],
      ['Vendas', [vnd.id]],
    ])
    const rows = await getStageDaily(owner, funnel.id, d1, spDay(0))
    const funnelDays = before.funnel as { spend_com_imposto: number; vendas: number }[]
    const funnelSpend = funnelDays.reduce((sum, row) => sum + Number(row.spend_com_imposto), 0)
    const funnelSales = funnelDays.reduce((sum, row) => sum + Number(row.vendas), 0)
    expect(rows.reduce((sum, row) => sum + row.spendComImposto, 0)).toBeCloseTo(funnelSpend)
    const [combo] = await getCostCombos(owner, funnel.id)
    const comboSpend = rows.filter((row) => combo.stageIds.includes(row.stageId)).reduce((sum, row) => sum + row.spendComImposto, 0)
    const comboSales = rows.filter((row) => row.stageId === combo.overStageId).reduce((sum, row) => sum + row.vendas, 0)
    expect(comboSales).toBe(funnelSales)
    expect(comboSpend / comboSales).toBeCloseTo(funnelSpend / funnelSales)
    await admin.from('client_tax_rates').delete().eq('client_id', clientId)
  })

  it('archives a stage only without active fronts and keeps fronts out of archived or foreign stages', async () => {
    const funnel = await project()
    const first = await stage({ sales_funnel_id: funnel.id, name: 'Vendas' })
    const second = await stage({ sales_funnel_id: funnel.id, name: 'Carrinho', position: 1 })
    const own = await front({ sales_funnel_id: funnel.id, stage_id: first.id })
    await expect(setStageArchived(owner, first.id, true)).rejects.toThrow('mova ou arquive as frentes')
    await moveFrontToStage(owner, own.id, second.id)
    await setStageArchived(owner, first.id, true)
    await expect(moveFrontToStage(owner, own.id, first.id)).rejects.toThrow('Etapa arquivada')
    expect((await admin.from('project_fronts').insert({ sales_funnel_id: funnel.id, code: 'X1', name: 'X', stage_id: first.id })).error).not.toBeNull()

    const other = await project()
    const foreign = await stage({ sales_funnel_id: other.id, name: 'Vendas' })
    expect((await admin.from('project_fronts').update({ stage_id: foreign.id }).eq('id', own.id)).error).not.toBeNull()
    expect((await admin.from('funnel_cost_combos').insert({ sales_funnel_id: funnel.id, name: 'X', stage_ids: [foreign.id], over: 'receita' })).error).not.toBeNull()
    expect((await admin.from('funnel_cost_combos').insert({ sales_funnel_id: funnel.id, name: 'X', stage_ids: [second.id], over: 'stage' })).error).not.toBeNull()
  })

  it('copies the stages and combos of a duplicated project, keyed by front code', async () => {
    const source = await project({ resultado: 'compra' })
    const cap = await front({ sales_funnel_id: source.id, position: 0, code: 'CAP', metrica_principal: 'lead' })
    await front({ sales_funnel_id: source.id, position: 1, code: 'VND' })
    await admin.rpc('backfill_funnel_stages', { p_sales_funnel_id: source.id })
    await admin.from('funnel_stages').update({ tag: 'CAP' }).eq('id', await stageOfFront(cap.id))

    const copy = await project({ resultado: 'compra' })
    const byCode = await copyStages(owner, source.id, copy.id)
    const stages = await getFunnelStages(owner, copy.id)
    expect(stages.map((row) => [row.name, row.tag, row.measure])).toEqual([
      ['Captação', 'CAP', 'lead'],
      ['Vendas', null, 'compra'],
    ])
    expect([byCode.get('CAP'), byCode.get('VND')]).toEqual([stages[0].id, stages[1].id])
    const [combo] = await getCostCombos(owner, copy.id)
    expect([combo.stageIds, combo.overStageId]).toEqual([[stages[0].id, stages[1].id], stages[1].id])
  })

  it('denies the stage reads and writes to anyone outside the client', async () => {
    const funnel = await project()
    const own = await stage({ sales_funnel_id: funnel.id, name: 'Vendas' })
    for (const fn of ['get_funnel_stage_daily', 'get_funnel_stage_origin']) {
      const { error } = await stranger.rpc(fn, { p_funnel_id: funnel.id, p_from: spDay(-3), p_to: spDay(0) })
      expect(error?.message).toContain('access denied')
    }
    expect((await stranger.from('funnel_stages').select('id').eq('sales_funnel_id', funnel.id)).data).toEqual([])
    expect((await stranger.from('funnel_stages').update({ name: 'X' }).eq('id', own.id).select('id')).data).toEqual([])
    expect((await stranger.from('funnel_stages').insert({ sales_funnel_id: funnel.id, name: 'X', measure: 'lead' })).error).not.toBeNull()
    expect((await stranger.from('client_stage_presets').insert({ client_id: clientId, name: 'X', measure: 'lead' })).error).not.toBeNull()
    expect((await stranger.rpc('reorder_funnel_stages', { p_funnel_id: funnel.id, p_stage_ids: [own.id] })).error).not.toBeNull()
    expect((await owner.rpc('backfill_funnel_stages', { p_sales_funnel_id: funnel.id })).error).not.toBeNull()

    expect((await owner.from('client_stage_presets').insert({ client_id: clientId, name: 'Captação', tag: 'CAP', measure: 'lead' })).error).toBeNull()
    expect((await owner.rpc('reorder_funnel_stages', { p_funnel_id: funnel.id, p_stage_ids: [own.id] })).error).toBeNull()
  })
})
