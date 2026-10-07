import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)

describe('sale attribution: ad, then product, then no project (0073)', () => {
  it('puts each sale in one project, keeps the unattributable ones and never deletes on product removal', async () => {
    const { data: user } = await admin.auth.admin.createUser({ email: `attr-${Date.now()}@example.com`, password: 'password123', email_confirm: true })
    const { data: client } = await admin.from('clients').insert({ owner_id: user!.user!.id, name: 'Attr', slug: `attr-${Date.now()}` }).select().single()
    const clientId = client!.id as string
    const project = async (slug: string, campaignId: string) => {
      const { data: funnel } = await admin.from('sales_funnels').insert({ client_id: clientId, name: slug, slug }).select().single()
      const { data: front } = await admin.from('project_fronts').insert({ sales_funnel_id: funnel!.id, code: slug.toUpperCase(), name: slug }).select().single()
      await admin.from('campaign_fronts').insert({ client_id: clientId, campaign_id: campaignId, front_id: front!.id, source: 'manual' })
      return funnel!.id as string
    }
    const perpetuo = await project('perpetuo', 'c-perp')
    const captacao = await project('captacao', 'c-cap')
    await admin.from('ad_creative_spend_daily').insert([
      { sales_funnel_id: perpetuo, source: 'launchops_sync', data: '2026-10-01', ad_id: '770001', ad_name: 'Perp', campaign_id: 'c-perp', spend: 10 },
      { sales_funnel_id: captacao, source: 'launchops_sync', data: '2026-10-01', ad_id: '770002', ad_name: 'Cap', campaign_id: 'c-cap', spend: 10 },
    ])
    // The same entry product sold by both projects; the bump only by the perpetual one.
    await admin.from('project_products').insert([
      { sales_funnel_id: perpetuo, produto_nome: '1K', papel: 'entrada' },
      { sales_funnel_id: captacao, produto_nome: '1K', papel: 'entrada' },
      { sales_funnel_id: perpetuo, produto_nome: 'Bump', papel: 'order_bump' },
    ])

    const sale = (id: string, produto: string, utmCampaign: string | null) => ({
      sales_funnel_id: perpetuo,
      external_id: id,
      data_venda: '2026-10-01T15:00:00Z',
      status: 'aprovada',
      produto,
      utm_campaign: utmCampaign,
    })
    const { error } = await admin.from('sales').insert([
      sale('by-ad-cap', '1K', '770002'),
      sale('by-ad-perp', '1K', 'MTV 770001'),
      sale('no-utm', '1K', null),
      sale('bump', 'Bump', null),
    ])
    expect(error).toBeNull()

    const owners = async () => {
      const { data } = await admin.from('sales').select('external_id, sales_funnel_id, atribuicao, client_id').eq('client_id', clientId).order('external_id')
      return Object.fromEntries((data ?? []).map((row) => [row.external_id, [row.sales_funnel_id, row.atribuicao]]))
    }
    expect(await owners()).toEqual({
      bump: [perpetuo, 'produto'],
      'by-ad-cap': [captacao, 'anuncio'],
      'by-ad-perp': [perpetuo, 'anuncio'],
      'no-utm': [null, 'sem_atribuicao'],
    })

    // The capture project stops selling 1K: every 1K sale now has a single candidate.
    await admin.from('project_products').delete().eq('sales_funnel_id', captacao).eq('produto_nome', '1K')
    expect(await owners()).toMatchObject({ 'by-ad-cap': [perpetuo, 'produto'], 'no-utm': [perpetuo, 'produto'] })

    // Nobody sells 1K any more: its sales stay, without a project.
    await admin.from('project_products').delete().eq('sales_funnel_id', perpetuo).eq('produto_nome', '1K')
    const after = await owners()
    expect(Object.keys(after)).toHaveLength(4)
    expect(after['no-utm']).toEqual([null, 'sem_atribuicao'])
    expect(after.bump).toEqual([perpetuo, 'produto'])

    // The same sale synced again is still one row for the client.
    const { error: again } = await admin.from('sales').upsert(sale('bump', 'Bump', null), { onConflict: 'client_id,source,external_id' })
    expect(again).toBeNull()
    expect(Object.keys(await owners())).toHaveLength(4)
  })
})
