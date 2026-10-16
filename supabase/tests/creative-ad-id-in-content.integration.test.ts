import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)

describe('creative report reads the ad id from utm_content (0109)', () => {
  it('ties a sale of the 1K template (ids in campaign, term and content) to its ad and spend', async () => {
    const email = `creative-content-${Date.now()}@example.com`
    const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
    const owner = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    await owner.auth.signInWithPassword({ email, password: 'password123' })
    const { data: client } = await admin.from('clients').insert({ owner_id: user!.user!.id, name: 'Content', slug: `content-${Date.now()}` }).select().single()
    const { data: funnel } = await admin.from('sales_funnels').insert({ client_id: client!.id, name: '1K', slug: '1k' }).select().single()
    const { error: spendError } = await admin.from('ad_creative_spend_daily').insert({
      sales_funnel_id: funnel!.id,
      source: 'launchops_sync',
      data: '2026-10-01',
      ad_id: '770000000003',
      ad_name: 'PAG-GER-Salário de Juíz',
      adset_id: '770000000002',
      campaign_id: '770000000001',
      spend: 100,
    })
    expect(spendError).toBeNull()
    const { error: saleError } = await admin.from('sales').insert(
      ['s1', 's2'].map((id) => ({
        sales_funnel_id: funnel!.id,
        external_id: id,
        data_venda: '2026-10-01T15:00:00Z',
        status: 'aprovada',
        utm_campaign: '770000000001',
        utm_medium: 'paid',
        utm_term: '770000000002',
        utm_content: '770000000003',
        valor_liquido: 50,
      })),
    )
    expect(saleError).toBeNull()

    const { data, error } = await owner.rpc('get_funnel_report_by_creative', { p_sales_funnel_id: funnel!.id, p_since: '2026-10-01', p_until: '2026-10-02' })
    expect(error).toBeNull()
    const rows = data as { ad_name: string; ad_id: string; spend: number; sales_count: number }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].ad_name).toBe('PAG-GER-Salário de Juíz')
    expect(rows[0].ad_id).toBe('770000000003')
    expect(Number(rows[0].spend)).toBe(100)
    expect(Number(rows[0].sales_count)).toBe(2)
  })
})
