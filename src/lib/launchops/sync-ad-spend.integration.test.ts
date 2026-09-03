import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { syncAdSpendForClient, type AggregatedAdSpendRow } from './sync-ad-spend'

const db = createServiceRoleClient()
let clientId: string
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
  clientId = client!.id
})

describe('syncAdSpendForClient (integration)', () => {
  it('keeps operation A untouched when only operation B is re-synced for the same day', async () => {
    const rowA: AggregatedAdSpendRow = { operacao_id: operacaoIdA, data: '2026-09-01', spend: 100, impressions: 1000, clicks: 10, leads: 2 }
    const rowB: AggregatedAdSpendRow = { operacao_id: operacaoIdB, data: '2026-09-01', spend: 40, impressions: 400, clicks: 4, leads: 1 }
    await syncAdSpendForClient(db, clientId, [rowA, rowB])

    await syncAdSpendForClient(db, clientId, [{ ...rowB, spend: 55 }])

    const { data } = await db
      .from('ad_spend_daily')
      .select('operacao_id, spend')
      .eq('client_id', clientId)
      .eq('data', '2026-09-01')
      .order('operacao_id')

    const byOp = new Map(data!.map((r) => [r.operacao_id, r.spend]))
    expect(byOp.get(operacaoIdA)).toBe(100)
    expect(byOp.get(operacaoIdB)).toBe(55)
  })
})
