import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321', process.env.SUPABASE_SERVICE_ROLE_KEY!)

interface DayRow {
  data: string
  vendas: number
  vendas_anuncio: number
  vendas_upsell: number
  receita_bruta: number
  spend: number
  spend_com_imposto: number
}

describe('project overview: entry vs upsell, sale origin and Meta tax (0055)', () => {
  let funnelId: string
  const day = '2026-09-20'
  const next = '2026-09-21'

  beforeAll(async () => {
    const { data: user } = await admin.auth.admin.createUser({ email: `overview-${Date.now()}@example.com`, password: 'password123', email_confirm: true })
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: user!.user!.id, name: 'Overview', slug: `overview-${Date.now()}` })
      .select()
      .single()
    const { data: funnel } = await admin.from('sales_funnels').insert({ client_id: client!.id, name: '1K', slug: '1k' }).select().single()
    funnelId = funnel!.id
    const { data: front } = await admin.from('project_fronts').insert({ sales_funnel_id: funnelId, code: 'PAG', name: 'Venda' }).select().single()
    await admin.from('naming_rules').insert({ front_id: front!.id, kind: 'include', value: '[1K-POR-DIA]' })
    await admin.from('campaign_daily').insert({ client_id: client!.id, data: day, campaign_id: 'c1', campaign_name: '[1K-POR-DIA] venda', spend: 1000 })
    await admin.from('client_tax_rates').insert({ client_id: client!.id, valid_from: '2026-09-01', factor: 1.138 })
    const sale = (externalId: string, extra: Record<string, unknown>) => ({
      sales_funnel_id: funnelId,
      external_id: externalId,
      data_venda: `${day}T15:00:00Z`,
      status: 'aprovada',
      valor_bruto: 10,
      valor_liquido: 9,
      // A bulk insert sends every key of every row; a row without one gets null, not the default.
      is_upsell: false,
      utm_source: null,
      utm_medium: null,
      utm_content: null,
      ...extra,
    })
    await admin.from('sales').insert([
      sale('ad-1', { utm_source: 'facebookads', utm_content: '120231234567890123' }),
      sale('ad-2', { utm_source: 'facebookads', utm_content: 'Conjunto Antigo' }),
      sale('bio-1', { utm_source: 'ig', utm_medium: 'social', utm_content: 'link_in_bio' }),
      sale('none-1', {}),
      sale('up-1', { is_upsell: true, valor_bruto: 50, valor_liquido: 45, utm_content: '120231234567890123' }),
    ])
  })

  it('counts entry sales of any origin for the overview CPA, ad sales apart, upsell in the revenue', async () => {
    const { data, error } = await admin.rpc('get_funnel_daily', { p_sales_funnel_id: funnelId, p_since: day, p_until: next })
    expect(error).toBeNull()
    const row = (data as DayRow[])[0]
    expect(Number(row.vendas)).toBe(4)
    expect(Number(row.vendas_anuncio)).toBe(2)
    expect(Number(row.vendas_upsell)).toBe(1)
    expect(Number(row.receita_bruta)).toBe(90)
    expect(Number(row.spend)).toBe(1000)
    expect(Number(row.spend_com_imposto)).toBeCloseTo(1138)
  })

  it('breaks the sales down by origin', async () => {
    const { data, error } = await admin.rpc('get_funnel_sales_by_origin', { p_sales_funnel_id: funnelId, p_since: day, p_until: next })
    expect(error).toBeNull()
    const byOrigin = Object.fromEntries((data as { origem: string; vendas: number; vendas_upsell: number }[]).map((row) => [row.origem, [Number(row.vendas), Number(row.vendas_upsell)]]))
    expect(byOrigin).toEqual({ anuncio: [1, 1], anuncio_legado: [1, 0], organico_bio: [1, 0], sem_utm: [1, 0] })
  })
})

describe('today is a partial day (0057)', () => {
  it('cuts today sales at the last Meta pull and reports the later ones apart', async () => {
    const { data: user } = await admin.auth.admin.createUser({ email: `partial-${Date.now()}@example.com`, password: 'password123', email_confirm: true })
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: user!.user!.id, name: 'Partial', slug: `partial-${Date.now()}` })
      .select()
      .single()
    const { data: funnel } = await admin.from('sales_funnels').insert({ client_id: client!.id, name: 'Hoje', slug: 'hoje' }).select().single()
    const { data: front } = await admin.from('project_fronts').insert({ sales_funnel_id: funnel!.id, code: 'PAG', name: 'Venda' }).select().single()
    await admin.from('naming_rules').insert({ front_id: front!.id, kind: 'include', value: 'venda' })

    const now = Date.now()
    const today = new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    const tomorrow = new Date(now + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    const lastPull = new Date(now - 2 * 60_000).toISOString()
    await admin.from('campaign_daily').insert({
      client_id: client!.id,
      data: today,
      campaign_id: 'c1',
      campaign_name: 'venda',
      spend: 100,
      source_updated_at: lastPull,
    })
    const sale = (externalId: string, minutesAgo: number) => ({
      sales_funnel_id: funnel!.id,
      external_id: externalId,
      data_venda: new Date(now - minutesAgo * 60_000).toISOString(),
      status: 'aprovada',
      valor_bruto: 10,
      valor_liquido: 9,
      is_upsell: false,
    })
    // Minutes apart, so both stay on today's São Paulo date unless the test runs in the day's first 3 minutes.
    await admin.from('sales').insert([sale('before', 3), sale('after', 1)])

    const { data, error } = await admin.rpc('get_funnel_daily', { p_sales_funnel_id: funnel!.id, p_since: today, p_until: tomorrow })
    expect(error).toBeNull()
    const row = (data as { vendas: number; vendas_apos_dados: number; dados_ate: string | null }[])[0]
    expect(Number(row.vendas)).toBe(1)
    expect(Number(row.vendas_apos_dados)).toBe(1)
    expect(new Date(row.dados_ate!).toISOString()).toBe(lastPull)
  })
})

describe('client day for the Hoje screen (0058)', () => {
  it('counts each campaign once even when a project reads another, and sums sales of every project', async () => {
    const { data: user } = await admin.auth.admin.createUser({ email: `client-day-${Date.now()}@example.com`, password: 'password123', email_confirm: true })
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: user!.user!.id, name: 'Client Day', slug: `client-day-${Date.now()}` })
      .select()
      .single()
    const { data: perpetual } = await admin.from('sales_funnels').insert({ client_id: client!.id, name: '1K', slug: '1k' }).select().single()
    const { data: launch } = await admin.from('sales_funnels').insert({ client_id: client!.id, name: 'T15', slug: 't15' }).select().single()
    const { data: owner } = await admin.from('project_fronts').insert({ sales_funnel_id: perpetual!.id, code: 'PAG', name: 'Venda' }).select().single()
    await admin.from('naming_rules').insert({ front_id: owner!.id, kind: 'include', value: '[1K]' })
    await admin.from('project_fronts').insert({ sales_funnel_id: launch!.id, code: 'PAGA', name: 'Paga', source_sales_funnel_id: perpetual!.id })
    const day = '2026-09-20'
    await admin.from('campaign_daily').insert({ client_id: client!.id, data: day, campaign_id: 'c1', campaign_name: '[1K] venda', spend: 500, leads: 7 })
    const sale = (funnelId: string, externalId: string) => ({
      sales_funnel_id: funnelId,
      external_id: externalId,
      data_venda: `${day}T15:00:00Z`,
      status: 'aprovada',
      valor_bruto: 10,
      valor_liquido: 9,
      is_upsell: false,
    })
    await admin.from('sales').insert([sale(perpetual!.id, 'p-1'), sale(launch!.id, 'l-1')])

    const { data, error } = await admin.rpc('get_client_daily', { p_client_id: client!.id, p_since: day, p_until: '2026-09-21' })
    expect(error).toBeNull()
    const row = (data as { spend: number; leads: number; vendas: number }[])[0]
    expect(Number(row.spend)).toBe(500)
    expect(Number(row.leads)).toBe(7)
    expect(Number(row.vendas)).toBe(2)
  })
})

describe('each project classifies its products (0061)', () => {
  const day = '2026-09-20'
  const next = '2026-09-21'

  it('splits entry, bump and ascension sales, re-labels on a role change and keeps the sync list in step', async () => {
    const { data: user } = await admin.auth.admin.createUser({ email: `products-${Date.now()}@example.com`, password: 'password123', email_confirm: true })
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: user!.user!.id, name: 'Products', slug: `products-${Date.now()}` })
      .select()
      .single()
    const { data: funnel } = await admin.from('sales_funnels').insert({ client_id: client!.id, name: 'P', slug: 'p' }).select().single()
    const funnelId = funnel!.id as string
    await admin.from('project_products').insert([
      { sales_funnel_id: funnelId, produto_nome: 'Entrada', papel: 'entrada' },
      { sales_funnel_id: funnelId, produto_nome: 'Bump', papel: 'order_bump' },
    ])
    await admin.from('funnel_sync_state').insert({ sales_funnel_id: funnelId, entity: 'sales', cursor_updated_at: `${day}T00:00:00Z`, last_result: 'ok' })
    const { error: productError } = await admin.from('project_products').insert({ sales_funnel_id: funnelId, produto_nome: 'Mentoria', papel: 'ascensao' })
    expect(productError).toBeNull()

    const sale = (externalId: string, produto: string, valor: number) => ({
      sales_funnel_id: funnelId,
      external_id: externalId,
      data_venda: `${day}T15:00:00Z`,
      status: 'aprovada',
      produto,
      valor_bruto: valor,
      valor_liquido: valor,
      is_upsell: false,
    })
    const { error: salesError } = await admin
      .from('sales')
      .insert([sale('e1', 'Entrada', 10), sale('e2', 'Entrada', 10), sale('b1', 'Bump', 5), sale('m1', 'Mentoria', 1000)])
    expect(salesError).toBeNull()

    const read = async () => {
      const { data } = await admin.rpc('get_funnel_daily', { p_sales_funnel_id: funnelId, p_since: day, p_until: next })
      return (data as (DayRow & { receita_liquida: number; vendas_ascensao: number; receita_ascensao_liquida: number })[])[0]
    }
    let row = await read()
    expect([Number(row.vendas), Number(row.vendas_upsell), Number(row.vendas_ascensao)]).toEqual([2, 1, 1])
    expect(Number(row.receita_liquida)).toBe(25)
    expect(Number(row.receita_ascensao_liquida)).toBe(1000)

    const { data: synced } = await admin.from('sales_funnels').select('launchops_produto_nomes').eq('id', funnelId).single()
    expect(synced!.launchops_produto_nomes).toEqual(['Bump', 'Entrada', 'Mentoria'])
    // A product entering the list re-reads the sales history.
    const { data: cursor } = await admin.from('funnel_sync_state').select('entity').eq('sales_funnel_id', funnelId)
    expect(cursor).toEqual([])

    await admin.from('project_products').update({ papel: 'entrada' }).eq('sales_funnel_id', funnelId).eq('produto_nome', 'Bump')
    row = await read()
    expect([Number(row.vendas), Number(row.vendas_upsell)]).toEqual([3, 0])

    await admin.from('project_products').delete().eq('sales_funnel_id', funnelId).eq('produto_nome', 'Mentoria')
    row = await read()
    expect(Number(row.vendas_ascensao)).toBe(0)
    const { count } = await admin.from('sales').select('id', { count: 'exact', head: true }).eq('sales_funnel_id', funnelId)
    expect(count).toBe(3)
  })
})
