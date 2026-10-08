import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

describe('0103: a sale is an ad sale when its campaign is identified', () => {
  it('counts the same ad sales for the project and its fronts, keeps the legacy ones apart and picks up a late campaign', async () => {
    const email = `one-rule-${unique()}@example.com`
    const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
    const owner = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    await owner.auth.signInWithPassword({ email, password: 'password123' })
    const { data: client } = await admin.from('clients').insert({ owner_id: user!.user!.id, name: 'One rule', slug: `one-rule-${unique()}` }).select().single()
    const clientId = client!.id as string
    const project = async (slug: string) => (await admin.from('sales_funnels').insert({ client_id: clientId, name: slug, slug }).select().single()).data!.id as string
    const [p, q] = [await project('p'), await project('q')]
    const { data: frontP } = await admin.from('project_fronts').insert({ sales_funnel_id: p, code: 'PF', name: 'PF' }).select().single()
    const { data: frontQ } = await admin.from('project_fronts').insert({ sales_funnel_id: q, code: 'QF', name: 'QF' }).select().single()
    await admin.from('naming_rules').insert([
      { front_id: frontP!.id, kind: 'include', value: '[P]' },
      { front_id: frontQ!.id, kind: 'include', value: '[Q]' },
    ])
    const base = Date.now()
    const [ownId, otherId, noFrontId, lateId] = [`7${base}1`, `7${base}2`, `7${base}3`, `7${base}4`]
    const yesterday = new Date(base - 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    const today = new Date(base).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    await admin.from('campaign_daily').insert([
      { client_id: clientId, data: yesterday, campaign_id: ownId, campaign_name: '[P] Venda', spend: 100 },
      { client_id: clientId, data: yesterday, campaign_id: otherId, campaign_name: '[Q] Venda', spend: 100 },
      { client_id: clientId, data: yesterday, campaign_id: noFrontId, campaign_name: 'Institucional', spend: 50 },
    ])
    await admin.from('project_products').insert({ sales_funnel_id: p, produto_nome: 'Curso', papel: 'entrada' })
    const sale = (id: string, utm: Record<string, string>) => ({
      sales_funnel_id: p, external_id: `${id}-${unique()}`, data_venda: `${yesterday}T15:00:00Z`, status: 'aprovada', produto: 'Curso',
      valor_bruto: 10, valor_liquido: 9, is_upsell: false, ...utm,
    })
    const { error } = await admin.from('sales').insert([
      sale('own', { utm_source: 'facebookads', utm_campaign: `P ${ownId}` }),
      // Q's front owns this campaign; the product is only P's, so the sale and its ad stay in P.
      sale('other', { utm_source: 'facebookads', utm_campaign: `Q ${otherId}` }),
      sale('no-front', { utm_source: 'facebookads', utm_campaign: `I ${noFrontId}` }),
      sale('legacy', { utm_source: 'facebookads', utm_campaign: 'Campanha antiga' }),
      sale('late', { utm_source: 'facebookads', utm_campaign: `P nova ${lateId}` }),
      sale('none', {}),
    ])
    expect(error).toBeNull()

    const read = async () => {
      const { data: days } = await admin.rpc('get_funnel_daily', { p_sales_funnel_id: p, p_since: yesterday, p_until: today })
      const { data: clientDays } = await admin.rpc('get_client_daily', { p_client_id: clientId, p_since: yesterday, p_until: today })
      const { data: fronts, error: frontsError } = await owner.rpc('get_project_front_sales', { p_sales_funnel_id: p, p_since: yesterday, p_until: today })
      expect(frontsError).toBeNull()
      const { data: quality } = await owner.rpc('get_project_data_quality', { p_sales_funnel_id: p, p_since: yesterday, p_until: today })
      const day = days[0]
      return {
        vendas: Number(day.vendas),
        anuncio: Number(day.vendas_anuncio),
        semId: Number(day.vendas_anuncio_sem_id),
        clientAnuncio: Number(clientDays[0].vendas_anuncio),
        clientSemId: Number(clientDays[0].vendas_anuncio_sem_id),
        qualityAnuncio: Number(quality[0].vendas_anuncio),
        qualitySemId: Number(quality[0].vendas_anuncio_sem_id),
        frontP: Number((fronts as { front_id: string; vendas: number }[]).find((row) => row.front_id === frontP!.id)?.vendas ?? 0),
      }
    }

    // The late campaign is not in campaign_daily yet: until it is, that sale is an ad with no identification.
    let numbers = await read()
    expect(numbers).toEqual({ vendas: 6, anuncio: 3, semId: 2, clientAnuncio: 3, clientSemId: 2, qualityAnuncio: 3, qualitySemId: 2, frontP: 1 })
    // Project ad sales = its own fronts' sales + those whose campaign no front of P owns (Q's, none).
    expect(numbers.anuncio).toBe(numbers.frontP + 2)

    await admin.from('campaign_daily').insert({ client_id: clientId, data: yesterday, campaign_id: lateId, campaign_name: '[P] Nova', spend: 10 })
    expect((await admin.rpc('reattribute_pending_sales', { p_client_id: clientId })).error).toBeNull()
    const { data: late } = await admin.from('sales').select('campanha_id').eq('sales_funnel_id', p).like('external_id', 'late-%').single()
    expect(late!.campanha_id).toBe(lateId)
    numbers = await read()
    expect([numbers.anuncio, numbers.semId, numbers.frontP]).toEqual([4, 1, 2])
  })
})
