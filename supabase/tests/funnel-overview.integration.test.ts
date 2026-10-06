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
