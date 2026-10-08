import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`
const spDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

describe('0104: acabamento dos dados', () => {
  let clientId: string
  let owner: SupabaseClient

  beforeAll(async () => {
    const email = `acabamento-${unique()}@example.com`
    const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
    owner = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    await owner.auth.signInWithPassword({ email, password: 'password123' })
    const { data: client } = await admin.from('clients').insert({ owner_id: user!.user!.id, name: 'Acabamento', slug: `acabamento-${unique()}` }).select().single()
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
  const sale = (values: Record<string, unknown>) => ({
    source: 'launchops_sync', external_id: `s-${unique()}`, status: 'aprovada', valor_bruto: 10, valor_liquido: 9, is_upsell: false, ...values,
  })

  it('reads a mirror only inside its own window, falling back to the project dates', async () => {
    const [d1, d2, d3] = [spDay(-3), spDay(-2), spDay(-1)]
    const source = await project()
    const ownFront = await front({ sales_funnel_id: source.id })
    const tag = `[S${unique().slice(-5)}]`
    await admin.from('naming_rules').insert({ front_id: ownFront.id, kind: 'include', value: tag })
    const campaignId = `9${Date.now()}`
    await admin.from('campaign_daily').insert([d1, d2, d3].map((data) => ({ client_id: clientId, data, campaign_id: campaignId, campaign_name: `${tag} venda`, spend: 100 })))

    const reader = await project({ starts_on: d1, ends_on: d3 })
    const windowed = await front({ sales_funnel_id: reader.id, source_sales_funnel_id: source.id, janela_inicio: d2, janela_fim: d2 })
    const fallback = await front({ sales_funnel_id: reader.id, source_sales_funnel_id: source.id })
    const { data: rows, error } = await admin.rpc('get_project_front_daily', { p_sales_funnel_id: reader.id, p_since: d1, p_until: spDay(0) })
    expect(error).toBeNull()
    const days = (frontId: string) => (rows as { front_id: string; data: string }[]).filter((row) => row.front_id === frontId).map((row) => row.data)
    expect(days(windowed.id)).toEqual([d2])
    expect(days(fallback.id)).toEqual([d1, d2, d3])

    // A window outside the campaign's days does not list the mirror on it at all.
    const outside = await front({ sales_funnel_id: reader.id, source_sales_funnel_id: source.id, janela_inicio: spDay(5), janela_fim: spDay(9) })
    const { data: campaigns } = await admin.rpc('get_client_campaigns', { p_client_id: clientId, p_since: d1, p_until: spDay(0) })
    const ids = (campaigns as { campaign_id: string; front_ids: string[] }[]).find((row) => row.campaign_id === campaignId)!.front_ids
    expect(ids).toContain(windowed.id)
    expect(ids).not.toContain(outside.id)

    // Only a mirror has a window, and it ends after it starts.
    expect((await admin.from('project_fronts').insert({ sales_funnel_id: source.id, code: 'X1', name: 'X', janela_inicio: d1 })).error).not.toBeNull()
    expect((await admin.from('project_fronts').insert({ sales_funnel_id: reader.id, code: 'X2', name: 'X', source_sales_funnel_id: source.id, janela_inicio: d3, janela_fim: d1 })).error).not.toBeNull()

    // "Espelho sem janela": a mirror with no window of its own in a project with no dates.
    const undated = await project()
    const lost = await front({ sales_funnel_id: undated.id, source_sales_funnel_id: source.id })
    const quality = async () => Number(((await owner.rpc('get_project_data_quality', { p_sales_funnel_id: undated.id, p_since: d1, p_until: spDay(0) })).data as { espelhos_sem_janela: number }[])[0].espelhos_sem_janela)
    expect(await quality()).toBe(1)
    await admin.from('project_fronts').update({ janela_inicio: d1, janela_fim: d3 }).eq('id', lost.id)
    expect(await quality()).toBe(0)
  })

  it('keeps the page kind in its own column, read from the wizard labels for the old pages', async () => {
    const kind = async (label: string) => (await admin.rpc('page_kind_of_label', { p_label: label })).data
    expect(await kind('Captura · Captação')).toBe('captura')
    expect(await kind('Obrigado · Captação')).toBe('obrigado')
    expect(await kind('Checkout · Vendas')).toBe('checkout')
    expect(await kind('vendas · Público frio')).toBe('vendas')
    expect(await kind('Página de vendas 1K')).toBeNull()
    expect(await kind('Vendas2')).toBeNull()

    const { data: page, error } = await admin.from('pages').insert({ client_id: clientId, label: 'Oferta', url: `https://exemplo.com/${unique()}`, tipo: 'vendas' }).select('tipo').single()
    expect(error).toBeNull()
    expect(page!.tipo).toBe('vendas')
    expect((await admin.from('pages').insert({ client_id: clientId, label: 'Outra', url: `https://exemplo.com/${unique()}`, tipo: 'blog' })).error).not.toBeNull()
  })

  it('gives a closed project no sale made after it closed, keeps the ones before, and lets a draft take sales', async () => {
    const product = `Curso ${unique()}`
    const closing = await project()
    await admin.from('project_products').insert({ sales_funnel_id: closing.id, produto_nome: product, papel: 'entrada' })
    const projectOf = async (externalId: string) =>
      (await admin.from('sales').select('sales_funnel_id, motivo').eq('client_id', clientId).eq('external_id', externalId).single()).data!

    // The sync path: an upsert that names the project as a hint.
    const before = sale({ sales_funnel_id: closing.id, produto: product, data_venda: new Date(Date.now() - 3_600_000).toISOString() })
    expect((await admin.from('sales').upsert(before, { onConflict: 'client_id,source,external_id' })).error).toBeNull()
    expect((await projectOf(before.external_id)).sales_funnel_id).toBe(closing.id)

    await admin.from('sales_funnels').update({ status: 'encerrado' }).eq('id', closing.id)
    const closed = (await admin.from('sales_funnels').select('encerrado_em').eq('id', closing.id).single()).data!
    expect(closed.encerrado_em).not.toBeNull()

    const after = sale({ sales_funnel_id: closing.id, produto: product, data_venda: new Date(Date.now() + 60_000).toISOString() })
    expect((await admin.from('sales').upsert(after, { onConflict: 'client_id,source,external_id' })).error).toBeNull()
    expect(await projectOf(after.external_id)).toEqual({ sales_funnel_id: null, motivo: 'produto_fora_de_projeto' })

    // A resync of the sale made before closing does not move it.
    expect((await admin.from('sales').upsert({ ...before, valor_liquido: 8 }, { onConflict: 'client_id,source,external_id' })).error).toBeNull()
    expect((await projectOf(before.external_id)).sales_funnel_id).toBe(closing.id)

    // Another project selling the product takes the new sale alone.
    const running = await project()
    await admin.from('project_products').insert({ sales_funnel_id: running.id, produto_nome: product, papel: 'entrada' })
    const next = sale({ produto: product, sales_funnel_id: running.id, data_venda: new Date(Date.now() + 120_000).toISOString() })
    await admin.from('sales').insert(next)
    expect(await projectOf(next.external_id)).toEqual({ sales_funnel_id: running.id, motivo: 'produto_exclusivo' })

    // Reopening clears the date.
    await admin.from('sales_funnels').update({ status: 'rodando' }).eq('id', closing.id)
    expect((await admin.from('sales_funnels').select('encerrado_em').eq('id', closing.id).single()).data!.encerrado_em).toBeNull()

    const draft = await project({ status: 'rascunho' })
    const ebook = `Ebook ${unique()}`
    await admin.from('project_products').insert({ sales_funnel_id: draft.id, produto_nome: ebook, papel: 'entrada' })
    const drafted = sale({ produto: ebook, sales_funnel_id: draft.id, data_venda: new Date().toISOString() })
    await admin.from('sales').insert(drafted)
    expect((await projectOf(drafted.external_id)).sales_funnel_id).toBe(draft.id)
  })

  it('fills the ad project of a late campaign together with the campaign', async () => {
    const seller = await project()
    const advertiser = await project()
    const adFront = await front({ sales_funnel_id: advertiser.id })
    const product = `Mentoria ${unique()}`
    await admin.from('project_products').insert({ sales_funnel_id: seller.id, produto_nome: product, papel: 'entrada' })
    const lateId = `8${Date.now()}`
    const late = sale({ sales_funnel_id: seller.id, produto: product, data_venda: new Date(Date.now() - 3_600_000).toISOString(), utm_source: 'facebookads', utm_campaign: `Nova ${lateId}` })
    expect((await admin.from('sales').insert(late)).error).toBeNull()
    const read = async () => (await admin.from('sales').select('sales_funnel_id, campanha_id, anuncio_funnel_id').eq('external_id', late.external_id).single()).data!
    expect(await read()).toEqual({ sales_funnel_id: seller.id, campanha_id: null, anuncio_funnel_id: null })

    await admin.from('campaign_daily').insert({ client_id: clientId, data: spDay(0), campaign_id: lateId, campaign_name: 'Nova', spend: 10 })
    await admin.from('campaign_fronts').insert({ client_id: clientId, campaign_id: lateId, front_id: adFront.id, source: 'manual' })
    expect((await admin.rpc('reattribute_pending_sales', { p_client_id: clientId })).error).toBeNull()
    // The sale stays in the project that sells the product; the ad is the other project's (a cross sale).
    expect(await read()).toEqual({ sales_funnel_id: seller.id, campanha_id: lateId, anuncio_funnel_id: advertiser.id })
  })

  it('splits past spend by the resultado valid on each day, and Aplicar desde rewrites it from the chosen date', async () => {
    const [yesterday, today] = [spDay(-1), spDay(0)]
    const owned = await project({ resultado: 'compra' })
    const ownFront = await front({ sales_funnel_id: owned.id })
    const tag = `[R${unique().slice(-5)}]`
    await admin.from('naming_rules').insert({ front_id: ownFront.id, kind: 'include', value: tag })
    const campaignId = `6${Date.now()}`
    await admin.from('campaign_daily').insert([
      { client_id: clientId, data: yesterday, campaign_id: campaignId, campaign_name: `${tag} a`, spend: 100 },
      { client_id: clientId, data: today, campaign_id: campaignId, campaign_name: `${tag} a`, spend: 40 },
    ])
    const split = async () => {
      const { data, error } = await admin.rpc('get_client_daily', { p_client_id: clientId, p_since: yesterday, p_until: spDay(1) })
      expect(error).toBeNull()
      const day = (data: string, rows: { data: string; spend_compra_com_imposto: number; spend_lead_com_imposto: number }[]) => {
        const row = rows.find((item) => item.data === data)!
        return [Number(row.spend_compra_com_imposto), Number(row.spend_lead_com_imposto)]
      }
      // Other tests of this client add spend of their own: only this project's campaign is compared.
      return { yesterday: day(yesterday, data), today: day(today, data) }
    }
    const base = await split()

    await admin.from('sales_funnels').update({ resultado: 'lead' }).eq('id', owned.id)
    const { data: history } = await admin.from('sales_funnels_resultado_history').select('resultado, valid_from, valid_until').eq('sales_funnel_id', owned.id).order('valid_from')
    expect(history).toEqual([
      { resultado: 'compra', valid_from: '-infinity', valid_until: today },
      { resultado: 'lead', valid_from: today, valid_until: 'infinity' },
    ])
    let now = await split()
    expect(now.yesterday).toEqual(base.yesterday)
    expect(now.today).toEqual([base.today[0] - 40, base.today[1] + 40])

    expect((await owner.rpc('apply_config_since', { p_sales_funnel_id: owned.id, p_since: yesterday })).error).toBeNull()
    now = await split()
    expect(now.yesterday).toEqual([base.yesterday[0] - 100, base.yesterday[1] + 100])
    const { data: rewritten } = await admin.from('sales_funnels_resultado_history').select('resultado, valid_from').eq('sales_funnel_id', owned.id).order('valid_from')
    expect(rewritten).toEqual([
      { resultado: 'compra', valid_from: '-infinity' },
      { resultado: 'lead', valid_from: yesterday },
    ])
  })
})
