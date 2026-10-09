import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getFunnelStages, getStageDaily, getStageOrigin, updateStageMirror } from '@/lib/repo/funnel-stages-repo'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`
const spDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
const noon = (day: string) => `${day}T15:00:00Z`

describe('0108: espelho de vendas na etapa', () => {
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
  const insert = async <T = { id: string }>(table: string, values: Record<string, unknown>): Promise<T> => {
    const { data, error } = await admin.from(table).insert(values).select().single()
    expect(error).toBeNull()
    return data as T
  }

  beforeAll(async () => {
    const user = await signIn('espelho')
    owner = user.session
    stranger = (await signIn('espelho-outro')).session
    clientId = (await insert('clients', { owner_id: user.id, name: 'Espelho', slug: `espelho-${unique()}` })).id
  })

  // "1K por dia" sells the cheap entry all year; the "T15" launch sells the Mentoria. The 1K buyers
  // are the T15's paid leads, and the Mentoria is the 1K's ascension.
  const setup = async () => {
    const mark = unique().slice(-6)
    const oneK = await insert('sales_funnels', { client_id: clientId, name: '1K por dia', slug: `1k-${unique()}`, resultado: 'compra' })
    const t15 = await insert('sales_funnels', { client_id: clientId, name: 'T15', slug: `t15-${unique()}`, resultado: 'compra' })
    const product = { entry: `1K ${mark}`, bump: `Bump ${mark}`, mentoria: `VOE ${mark}` }
    expect(
      (
        await admin.from('project_products').insert([
          { sales_funnel_id: oneK.id, produto_nome: product.entry, papel: 'entrada' },
          { sales_funnel_id: oneK.id, produto_nome: product.bump, papel: 'order_bump' },
          { sales_funnel_id: t15.id, produto_nome: product.mentoria, papel: 'entrada' },
        ])
      ).error
    ).toBeNull()
    const oneKSales = await insert('funnel_stages', { sales_funnel_id: oneK.id, name: 'Vendas', measure: 'compra', position: 0 })
    const oneKAsc = await insert('funnel_stages', { sales_funnel_id: oneK.id, name: 'Ascensão', measure: 'ascensao', position: 1 })
    const paid = await insert('funnel_stages', { sales_funnel_id: t15.id, name: 'Captação paga', measure: 'lead', position: 0, janela_inicio: spDay(-3), janela_fim: spDay(-1) })
    const t15Sales = await insert('funnel_stages', { sales_funnel_id: t15.id, name: 'Vendas', measure: 'compra', position: 1 })

    // The 1K campaign spends 100 a day; the T15 reads it through a mirror front inside its window.
    const oneKFront = await insert('project_fronts', { sales_funnel_id: oneK.id, stage_id: oneKSales.id, code: `K${mark}`, name: 'Frio' })
    await insert('naming_rules', { front_id: oneKFront.id, kind: 'include', value: `[K${mark}]` })
    await insert('project_fronts', { sales_funnel_id: t15.id, stage_id: paid.id, code: `M${mark}`, name: '1K', source_sales_funnel_id: oneK.id, janela_inicio: spDay(-3), janela_fim: spDay(-1) })
    const campaignId = `${Date.now()}${Math.floor(Math.random() * 1e6)}`
    expect(
      (
        await admin.from('campaign_daily').insert(
          [spDay(-5), spDay(-2)].map((data) => ({ client_id: clientId, data, campaign_id: campaignId, campaign_name: `[K${mark}] venda`, spend: 100 }))
        )
      ).error
    ).toBeNull()

    const sale = (funnelId: string, produto: string, day: string, values: Record<string, unknown> = {}) =>
      insert('sales', { source: 'launchops_sync', external_id: `s-${unique()}`, status: 'aprovada', valor_bruto: 100, valor_liquido: 90, sales_funnel_id: funnelId, produto, data_venda: noon(day), ...values })
    await sale(oneK.id, product.entry, spDay(-2))
    await sale(oneK.id, product.entry, spDay(-2))
    await sale(oneK.id, product.entry, spDay(-2), { reembolsado_em: noon(spDay(-1)) })
    await sale(oneK.id, product.entry, spDay(-5))
    await sale(oneK.id, product.bump, spDay(-2), { valor_liquido: 20 })
    await sale(t15.id, product.mentoria, spDay(-2), { valor_liquido: 900 })
    return { oneK, t15, product, oneKSales, oneKAsc, paid, t15Sales }
  }

  const range = { since: spDay(-6), until: spDay(0) }
  const stageSum = async (funnelId: string, stageId: string) => {
    const rows = (await getStageDaily(owner, funnelId, range.since, range.until)).filter((row) => row.stageId === stageId)
    const sum = (key: 'vendas' | 'vendasEspelho' | 'reembolsos' | 'receitaLiquida' | 'spend') => rows.reduce((total, row) => total + row[key], 0)
    return { vendas: sum('vendas'), espelho: sum('vendasEspelho'), reembolsos: sum('reembolsos'), receita: sum('receitaLiquida'), spend: sum('spend'), rows }
  }
  const funnelDaily = async (funnelId: string) => (await owner.rpc('get_funnel_daily', { p_sales_funnel_id: funnelId, p_since: range.since, p_until: range.until })).data
  const clientDaily = async () => (await owner.rpc('get_client_daily', { p_client_id: clientId, p_since: range.since, p_until: range.until })).data

  it('shows the source sales in the mirror stage, inside its window, without moving any total', async () => {
    const { oneK, t15, product, oneKAsc, paid } = await setup()
    const before = { t15: await funnelDaily(t15.id), oneK: await funnelDaily(oneK.id), client: await clientDaily() }

    await updateStageMirror(owner, paid.id, { funnelId: oneK.id, papeis: ['entrada'], products: null })
    await updateStageMirror(owner, oneKAsc.id, { funnelId: t15.id, papeis: ['entrada'], products: [product.mentoria] })

    // Captação paga: the three 1K entries of day -2 (the one of day -5 is outside the window), the
    // refund on its own day, and the spend of the mirror front inside the window.
    const captacao = await stageSum(t15.id, paid.id)
    expect([captacao.vendas, captacao.espelho, captacao.reembolsos]).toEqual([3, 3, 1])
    expect(captacao.rows.find((row) => row.data === spDay(-1))?.reembolsos).toBe(1)
    expect(captacao.spend).toBe(100)
    // The Mentoria of the T15 is the 1K's ascension: entrada at the source, ascensão here.
    const ascensao = await stageSum(oneK.id, oneKAsc.id)
    expect([ascensao.vendas, ascensao.espelho, ascensao.receita]).toEqual([1, 1, 900])

    // Funnel and client totals never count a mirrored sale.
    expect(await funnelDaily(t15.id)).toEqual(before.t15)
    expect(await funnelDaily(oneK.id)).toEqual(before.oneK)
    expect(await clientDaily()).toEqual(before.client)
    // The sale stays where it was, and the origin leaves the mirrored sales out.
    expect((await admin.from('sales').select('sales_funnel_id').eq('produto', product.mentoria).single()).data!.sales_funnel_id).toBe(t15.id)
    expect((await getStageOrigin(owner, t15.id, range.since, range.until)).some((origin) => origin.stageId === paid.id)).toBe(false)

    const stages = await getFunnelStages(owner, t15.id)
    expect(stages.find((stage) => stage.id === paid.id)?.mirror).toEqual({ funnelId: oneK.id, funnelName: '1K por dia', papeis: ['entrada'], products: null })
  })

  it('filters by role and product, and a stage stops mirroring when cleared', async () => {
    const { oneK, product, paid, t15 } = await setup()
    await updateStageMirror(owner, paid.id, { funnelId: oneK.id, papeis: ['entrada', 'order_bump'], products: null })
    expect((await stageSum(t15.id, paid.id)).vendas).toBe(4)
    await updateStageMirror(owner, paid.id, { funnelId: oneK.id, papeis: ['entrada', 'order_bump'], products: [product.bump] })
    expect((await stageSum(t15.id, paid.id)).vendas).toBe(1)
    await updateStageMirror(owner, paid.id, null)
    expect((await stageSum(t15.id, paid.id)).vendas).toBe(0)
    const row = (await admin.from('funnel_stages').select('mirror_funnel_id, mirror_papeis, mirror_products').eq('id', paid.id).single()).data
    expect(row).toEqual({ mirror_funnel_id: null, mirror_papeis: null, mirror_products: null })
  })

  it('defaults the roles to entrada and refuses itself, another client, a measure without sales and a stranger', async () => {
    const { oneK, t15, paid, t15Sales } = await setup()
    expect((await owner.from('funnel_stages').update({ mirror_funnel_id: oneK.id }).eq('id', t15Sales.id)).error).toBeNull()
    expect((await admin.from('funnel_stages').select('mirror_papeis').eq('id', t15Sales.id).single()).data!.mirror_papeis).toEqual(['entrada'])

    await expect(updateStageMirror(owner, paid.id, { funnelId: t15.id, papeis: ['entrada'], products: null })).rejects.toThrow('A etapa não pode espelhar o próprio funil.')
    const other = await insert('clients', { owner_id: (await admin.from('clients').select('owner_id').eq('id', clientId).single()).data!.owner_id, name: 'Outro', slug: `outro-${unique()}` })
    const foreign = await insert('sales_funnels', { client_id: other.id, name: 'Alheio', slug: `alheio-${unique()}` })
    await expect(updateStageMirror(owner, paid.id, { funnelId: foreign.id, papeis: ['entrada'], products: null })).rejects.toThrow('Só dá para espelhar um funil do mesmo cliente.')
    const reach = await insert('funnel_stages', { sales_funnel_id: t15.id, name: 'Reconhecimento', measure: 'alcance', position: 5 })
    await expect(updateStageMirror(owner, reach.id, { funnelId: oneK.id, papeis: ['entrada'], products: null })).rejects.toThrow('Só etapas de lead, compra ou ascensão espelham vendas.')
    await expect(updateStageMirror(stranger, paid.id, { funnelId: oneK.id, papeis: ['entrada'], products: null })).rejects.toThrow('Só gestor ou owner pode mudar a etapa.')
    await expect(getStageDaily(stranger, t15.id, range.since, range.until)).rejects.toBeTruthy()
  })

  it('a stage watcher reads the mirrored sales: the CPL of a mirror lead stage is spend over buyers', async () => {
    const { oneK, oneKAsc, paid, t15 } = await setup()
    await updateStageMirror(owner, paid.id, { funnelId: oneK.id, papeis: ['entrada'], products: null })
    await updateStageMirror(owner, oneKAsc.id, { funnelId: t15.id, papeis: ['entrada'], products: null })
    const cpl = await insert('watchers', { client_id: clientId, sales_funnel_id: t15.id, stage_id: paid.id, metric: 'cpl', target: 50, warn_pct: 20, crit_pct: 40 })
    const judged = (await owner.rpc('watcher_day', { p_watcher_id: cpl.id, p_day: spDay(-2) })).data[0] as { spend: number; value: number; status: string }
    expect(Number(judged.spend)).toBe(100)
    expect(Number(judged.value)).toBeCloseTo(100 / 3)
    expect(judged.status).toBe('ok')
    // Outside the window the stage sells nothing.
    const outside = (await owner.rpc('watcher_day', { p_watcher_id: cpl.id, p_day: spDay(-5) })).data[0] as { value: number | null }
    expect(outside.value).toBeNull()
  })
})
