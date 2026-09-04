import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { syncAdSpendForFunnel, type AggregatedAdSpendRow } from './sync-ad-spend'

const db = createServiceRoleClient()
let salesFunnelId: string
const operacaoIdA = crypto.randomUUID()
const operacaoIdB = crypto.randomUUID()

beforeAll(async () => {
  const { data: user } = await db.auth.admin.createUser({
    email: `sync-adspend-${Date.now()}@example.com`,
    password: 'password123',
    email_confirm: true,
  })
  const { data: client } = await db
    .from('clients')
    .insert({ owner_id: user!.user!.id, name: 'SyncAdSpend', slug: `sync-adspend-${Date.now()}` })
    .select()
    .single()
  const { data: funnel } = await db
    .from('sales_funnels')
    .insert({ client_id: client!.id, name: 'SyncAdSpend Funnel', slug: 'sync-adspend-funnel' })
    .select()
    .single()
  salesFunnelId = funnel!.id
})

describe('syncAdSpendForFunnel (integration)', () => {
  it('keeps operation A untouched when only operation B is re-synced for the same day', async () => {
    const rowA: AggregatedAdSpendRow = {
      operacao_id: operacaoIdA,
      data: '2026-09-01',
      spend: 100,
      impressions: 1000,
      clicks: 10,
      leads: 2,
      reach: 800,
      linkClicks: 60,
      landingPageViews: 40,
      initiateCheckout: 5,
    }
    const rowB: AggregatedAdSpendRow = {
      operacao_id: operacaoIdB,
      data: '2026-09-01',
      spend: 40,
      impressions: 400,
      clicks: 4,
      leads: 1,
      reach: 350,
      linkClicks: 20,
      landingPageViews: 15,
      initiateCheckout: 2,
    }
    await syncAdSpendForFunnel(db, salesFunnelId, [rowA, rowB])

    await syncAdSpendForFunnel(db, salesFunnelId, [{ ...rowB, spend: 55 }])

    const { data } = await db
      .from('ad_spend_daily')
      .select('operacao_id, spend')
      .eq('sales_funnel_id', salesFunnelId)
      .eq('data', '2026-09-01')
      .order('operacao_id')

    const byOp = new Map(data!.map((r) => [r.operacao_id, r.spend]))
    expect(byOp.get(operacaoIdA)).toBe(100)
    expect(byOp.get(operacaoIdB)).toBe(55)
  })
})
