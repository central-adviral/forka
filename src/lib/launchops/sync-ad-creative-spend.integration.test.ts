import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { syncAdCreativeSpendForFunnel, type JoinedAdCreativeSpendRow } from './sync-ad-creative-spend'

const db = createServiceRoleClient()
let salesFunnelId: string

beforeAll(async () => {
  const { data: user } = await db.auth.admin.createUser({
    email: `sync-adcreative-${Date.now()}@example.com`,
    password: 'password123',
    email_confirm: true,
  })
  const { data: client } = await db
    .from('clients')
    .insert({ owner_id: user!.user!.id, name: 'SyncAdCreative', slug: `sync-adcreative-${Date.now()}` })
    .select()
    .single()
  const { data: funnel } = await db
    .from('sales_funnels')
    .insert({ client_id: client!.id, name: 'SyncAdCreative Funnel', slug: 'sync-adcreative-funnel' })
    .select()
    .single()
  salesFunnelId = funnel!.id
})

describe('syncAdCreativeSpendForFunnel (integration)', () => {
  it('does not duplicate a row when ad_id is null and the same batch is synced twice', async () => {
    const row: JoinedAdCreativeSpendRow = { ad_id: null, ad_name: 'Criativo Sem ID', data: '2026-09-01', spend: 10, impressions: 100, link_clicks: 2 }
    await syncAdCreativeSpendForFunnel(db, salesFunnelId, [row])
    await syncAdCreativeSpendForFunnel(db, salesFunnelId, [row])

    const { data } = await db
      .from('ad_creative_spend_daily')
      .select('id')
      .eq('sales_funnel_id', salesFunnelId)
      .eq('data', '2026-09-01')
      .is('ad_id', null)
      .eq('ad_name', 'Criativo Sem ID')
    expect(data!.length).toBe(1)
  })
})
