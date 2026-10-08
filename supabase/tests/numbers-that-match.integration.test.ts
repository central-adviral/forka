import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

async function newClient() {
  const { data: user } = await admin.auth.admin.createUser({ email: `match-${unique()}@example.com`, password: 'password123', email_confirm: true })
  const { data: client } = await admin.from('clients').insert({ owner_id: user!.user!.id, name: 'Match', slug: `match-${unique()}` }).select().single()
  return client!.id as string
}

async function projectWithFront(clientId: string, slug: string, resultado: 'compra' | 'lead' = 'compra') {
  const { data: funnel } = await admin.from('sales_funnels').insert({ client_id: clientId, name: slug, slug, resultado }).select().single()
  const { data: front } = await admin.from('project_fronts').insert({ sales_funnel_id: funnel!.id, code: slug.toUpperCase(), name: slug }).select().single()
  return { funnelId: funnel!.id as string, frontId: front!.id as string }
}

describe('0090: números que batem', () => {
  it('releases only the campaigns a naming rule can touch', async () => {
    const clientId = await newClient()
    const ger = await projectWithFront(clientId, 'ger')
    const vnd = await projectWithFront(clientId, 'vnd')
    await admin.from('campaign_daily').insert([
      { client_id: clientId, data: '2026-10-01', campaign_id: 'c-ger', campaign_name: '[GER] captação', spend: 10 },
      { client_id: clientId, data: '2026-10-01', campaign_id: 'c-vnd', campaign_name: '[VND] remarketing', spend: 10 },
    ])
    await admin.from('campaign_fronts').insert([
      { client_id: clientId, campaign_id: 'c-ger', front_id: ger.frontId, source: 'auto' },
      { client_id: clientId, campaign_id: 'c-vnd', front_id: vnd.frontId, source: 'auto' },
    ])

    await admin.from('naming_rules').insert({ front_id: ger.frontId, kind: 'include', value: '[ger]' })

    const { data: owners } = await admin.from('campaign_fronts').select('campaign_id').eq('client_id', clientId).order('campaign_id')
    // The [GER] campaign is released to be decided again; the [VND] one, out of the rule's reach, keeps its owner.
    expect(owners).toEqual([{ campaign_id: 'c-vnd' }])
  })

  it('gives a pending sale its project once its ad is known, and the newest ad day wins a tie', async () => {
    const clientId = await newClient()
    // Meta ids are global: unique ones keep earlier runs out of this one.
    const ad = String(Date.now()).slice(-9)
    const [ca, cb] = [`ca-${unique()}`, `cb-${unique()}`]
    const a = await projectWithFront(clientId, 'proj-a')
    const b = await projectWithFront(clientId, 'proj-b')
    await admin.from('project_products').insert([
      { sales_funnel_id: a.funnelId, produto_nome: '1K', papel: 'entrada' },
      { sales_funnel_id: b.funnelId, produto_nome: '1K', papel: 'entrada' },
    ])
    await admin.from('campaign_fronts').insert([
      { client_id: clientId, campaign_id: ca, front_id: a.frontId, source: 'manual' },
      { client_id: clientId, campaign_id: cb, front_id: b.frontId, source: 'manual' },
    ])
    const { error } = await admin.from('sales').insert({
      sales_funnel_id: a.funnelId, external_id: `new-ad-${unique()}`, data_venda: '2026-10-02T15:00:00Z', status: 'aprovada', produto: '1K', utm_campaign: `X ${ad}`,
    })
    expect(error).toBeNull()
    const sale = async () => (await admin.from('sales').select('sales_funnel_id, atribuicao').eq('client_id', clientId).single()).data!
    expect(await sale()).toEqual({ sales_funnel_id: null, atribuicao: 'sem_atribuicao' })

    // The ad's spend arrives: it ran in A's campaign on the 1st and in B's on the 2nd.
    await admin.from('ad_creative_spend_daily').insert([
      { sales_funnel_id: a.funnelId, source: 'launchops_sync', data: '2026-10-01', ad_id: ad, ad_name: 'Novo', campaign_id: ca, spend: 5 },
      { sales_funnel_id: b.funnelId, source: 'launchops_sync', data: '2026-10-02', ad_id: ad, ad_name: 'Novo', campaign_id: cb, spend: 5 },
    ])
    expect((await admin.rpc('reattribute_pending_sales', { p_client_id: clientId })).data).toBe(1)
    expect(await sale()).toEqual({ sales_funnel_id: b.funnelId, atribuicao: 'anuncio' })
    expect((await admin.rpc('reattribute_pending_sales', { p_client_id: clientId })).data).toBe(0)
  })

  it("splits Hoje's spend by the owner project's result and counts sales with no project", async () => {
    const clientId = await newClient()
    const venda = await projectWithFront(clientId, 'venda', 'compra')
    const captacao = await projectWithFront(clientId, 'captacao', 'lead')
    await admin.from('campaign_fronts').insert([
      { client_id: clientId, campaign_id: 'cv', front_id: venda.frontId, source: 'manual' },
      { client_id: clientId, campaign_id: 'cc', front_id: captacao.frontId, source: 'manual' },
    ])
    await admin.from('campaign_daily').insert([
      { client_id: clientId, data: '2026-10-01', campaign_id: 'cv', campaign_name: 'Venda', spend: 300, leads: 0 },
      { client_id: clientId, data: '2026-10-01', campaign_id: 'cc', campaign_name: 'Captação', spend: 200, leads: 40 },
      { client_id: clientId, data: '2026-10-01', campaign_id: 'cx', campaign_name: 'Institucional', spend: 100, leads: 0 },
    ])
    // 1K is sold by both projects and the sale has no ad, so it has no project; Curso is only Venda's.
    await admin.from('project_products').insert([
      { sales_funnel_id: venda.funnelId, produto_nome: '1K', papel: 'entrada' },
      { sales_funnel_id: captacao.funnelId, produto_nome: '1K', papel: 'entrada' },
      { sales_funnel_id: venda.funnelId, produto_nome: 'Curso', papel: 'entrada' },
    ])
    const sale = (id: string, produto: string) => ({ sales_funnel_id: venda.funnelId, external_id: `${id}-${unique()}`, data_venda: '2026-10-01T15:00:00Z', status: 'aprovada', produto, valor_liquido: 100 })
    const { error } = await admin.from('sales').insert([sale('a', 'Curso'), sale('b', 'Curso'), sale('c', '1K')])
    expect(error).toBeNull()

    const { data } = await admin.rpc('get_client_daily', { p_client_id: clientId, p_since: '2026-10-01', p_until: '2026-10-02' })
    expect(data[0]).toMatchObject({ spend_com_imposto: 600, spend_compra_com_imposto: 300, spend_lead_com_imposto: 200, spend_sem_frente_com_imposto: 100, vendas: 3, vendas_sem_projeto: 1 })
  })
})
