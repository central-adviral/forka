import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

describe('0095: the sale keeps why it is in its project, and which project its ad was', () => {
  it('counts a product only A sells in A, shows B generated it, and splits a project sales by front', async () => {
    const email = `reason-${unique()}@example.com`
    const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
    const owner = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    await owner.auth.signInWithPassword({ email, password: 'password123' })
    const { data: client } = await admin.from('clients').insert({ owner_id: user!.user!.id, name: 'Reason', slug: `reason-${unique()}` }).select().single()
    const clientId = client!.id as string
    const project = async (slug: string) => (await admin.from('sales_funnels').insert({ client_id: clientId, name: slug, slug }).select().single()).data!.id as string
    const [a, b] = [await project('a'), await project('b')]
    const front = async (funnelId: string, code: string) => (await admin.from('project_fronts').insert({ sales_funnel_id: funnelId, code, name: code }).select().single()).data!.id as string
    const [fa, fb] = [await front(a, 'FA'), await front(b, 'FB')]
    const [ca, cb] = [`ca-${unique()}`, `cb-${unique()}`]
    const [adA, adB] = [String(Date.now()).slice(-9), String(Date.now() + 1).slice(-9)]
    await admin.from('campaign_fronts').insert([
      { client_id: clientId, campaign_id: ca, front_id: fa, source: 'manual' },
      { client_id: clientId, campaign_id: cb, front_id: fb, source: 'manual' },
    ])
    const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    await admin.from('campaign_daily').insert([
      { client_id: clientId, data: yesterday, campaign_id: ca, campaign_name: 'A', spend: 100 },
      { client_id: clientId, data: yesterday, campaign_id: cb, campaign_name: 'B', spend: 100 },
    ])
    await admin.from('ad_creative_spend_daily').insert([
      { sales_funnel_id: a, source: 'launchops_sync', data: yesterday, ad_id: adA, ad_name: 'A', campaign_id: ca, spend: 100 },
      { sales_funnel_id: b, source: 'launchops_sync', data: yesterday, ad_id: adB, ad_name: 'B', campaign_id: cb, spend: 100 },
    ])
    await admin.from('project_products').insert([
      { sales_funnel_id: a, produto_nome: 'Só A', papel: 'entrada' },
      { sales_funnel_id: a, produto_nome: 'Dos dois', papel: 'entrada' },
      { sales_funnel_id: b, produto_nome: 'Dos dois', papel: 'entrada' },
    ])
    const sale = (id: string, produto: string, ad: string | null) => ({
      sales_funnel_id: a, external_id: `${id}-${unique()}`, data_venda: `${yesterday}T15:00:00Z`, status: 'aprovada', produto, utm_campaign: ad ? `X ${ad}` : null, valor_liquido: 100,
    })
    const { error } = await admin.from('sales').insert([
      sale('only-a-by-b', 'Só A', adB),
      sale('only-a-by-a', 'Só A', adA),
      sale('both-by-b', 'Dos dois', adB),
      sale('both-no-ad', 'Dos dois', null),
    ])
    expect(error).toBeNull()

    const { data: rows } = await admin.from('sales').select('external_id, sales_funnel_id, motivo, anuncio_funnel_id').eq('client_id', clientId)
    const byId = Object.fromEntries((rows ?? []).map((row) => [row.external_id.split('-').slice(0, -2).join('-'), row]))
    expect(byId['only-a-by-b']).toMatchObject({ sales_funnel_id: a, motivo: 'produto_exclusivo', anuncio_funnel_id: b })
    expect(byId['both-by-b']).toMatchObject({ sales_funnel_id: b, motivo: 'anuncio_do_projeto', anuncio_funnel_id: b })
    expect(byId['both-no-ad']).toMatchObject({ sales_funnel_id: null, motivo: 'produto_em_varios_sem_anuncio' })

    const range = { p_since: yesterday, p_until: today }
    expect((await owner.rpc('get_project_cross_sales', { p_sales_funnel_id: b, ...range })).data[0]).toMatchObject({ geradas_para_outro: 1, vindas_de_outro: 0 })
    expect((await owner.rpc('get_project_cross_sales', { p_sales_funnel_id: a, ...range })).data[0]).toMatchObject({ geradas_para_outro: 0, vindas_de_outro: 1 })
    // A's front FA: only the sale its own ad brought; the one B's ad brought is not FA's.
    const { data: frontSales } = await owner.rpc('get_project_front_sales', { p_sales_funnel_id: a, ...range })
    expect(frontSales).toEqual([{ front_id: fa, vendas: 1, receita_liquida: 100 }])
  })

  it("reads the campaign id the client's real ads put in utm_campaign (0096)", async () => {
    const { data: user } = await admin.auth.admin.createUser({ email: `camp-${unique()}@example.com`, password: 'password123', email_confirm: true })
    const { data: client } = await admin.from('clients').insert({ owner_id: user!.user!.id, name: 'Camp', slug: `camp-${unique()}` }).select().single()
    const clientId = client!.id as string
    const project = async (slug: string) => (await admin.from('sales_funnels').insert({ client_id: clientId, name: slug, slug }).select().single()).data!.id as string
    const [a, b] = [await project('a'), await project('b')]
    const { data: fb } = await admin.from('project_fronts').insert({ sales_funnel_id: b, code: 'FB', name: 'FB' }).select().single()
    const campaign = String(Date.now() + 7).slice(-12)
    await admin.from('campaign_fronts').insert({ client_id: clientId, campaign_id: campaign, front_id: fb!.id, source: 'manual' })
    const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    await admin.from('campaign_daily').insert({ client_id: clientId, data: yesterday, campaign_id: campaign, campaign_name: 'B', spend: 50 })
    await admin.from('project_products').insert([
      { sales_funnel_id: a, produto_nome: 'Dos dois', papel: 'entrada' },
      { sales_funnel_id: b, produto_nome: 'Dos dois', papel: 'entrada' },
    ])
    const { error } = await admin.from('sales').insert({
      sales_funnel_id: a, external_id: `camp-${unique()}`, data_venda: `${yesterday}T15:00:00Z`, status: 'aprovada', produto: 'Dos dois', utm_campaign: campaign, valor_liquido: 80,
    })
    expect(error).toBeNull()
    const { data: sale } = await admin.from('sales').select('sales_funnel_id, motivo, anuncio_funnel_id').eq('client_id', clientId).single()
    expect(sale).toEqual({ sales_funnel_id: b, motivo: 'anuncio_do_projeto', anuncio_funnel_id: b })
  })
})
