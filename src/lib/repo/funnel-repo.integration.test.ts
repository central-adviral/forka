import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getDailyFunnel, getFunnelSyncHealth } from './funnel-repo'

const db = createServiceRoleClient()
let clientId: string
const operacaoIdA = crypto.randomUUID()
const operacaoIdB = crypto.randomUUID()

beforeAll(async () => {
  const { data: user } = await db.auth.admin.createUser({
    email: `funnel-repo-${Date.now()}@example.com`,
    password: 'password123',
    email_confirm: true,
  })
  const { data: client } = await db
    .from('clients')
    .insert({ owner_id: user!.user!.id, name: 'FunnelRepo', slug: `funnel-repo-${Date.now()}` })
    .select()
    .single()
  clientId = client!.id

  await db.from('sales').insert([
    { client_id: clientId, external_id: 's1', data_venda: '2026-09-01T10:00:00Z', status: 'aprovada', valor_bruto: 10, valor_liquido: 9 },
    { client_id: clientId, external_id: 's2', data_venda: '2026-09-01T11:00:00Z', status: 'aprovada', valor_bruto: 20, valor_liquido: 18 },
    // 23:30 BRT on 09-01 is 02:30 UTC on 09-02 — must bucket under the BRT day, not the UTC day.
    { client_id: clientId, external_id: 's3', data_venda: '2026-09-01T23:30:00-03:00', status: 'aprovada', valor_bruto: 40, valor_liquido: 36 },
  ])
  await db.from('ad_spend_daily').insert([
    { client_id: clientId, operacao_id: operacaoIdA, data: '2026-09-01', spend: 5 },
    { client_id: clientId, operacao_id: operacaoIdB, data: '2026-09-01', spend: 7 },
  ])
  await db
    .from('funnel_sync_state')
    .upsert({ client_id: clientId, entity: 'sales', last_run_at: '2026-09-01T12:00:00Z', last_result: 'ok' }, { onConflict: 'client_id,entity' })
})

describe('funnel-repo', () => {
  it('aggregates sales across multiple sales rows for the same day', async () => {
    const rows = await getDailyFunnel(db, clientId, '2026-09-01', '2026-09-02')
    const day = rows.find((r) => r.data === '2026-09-01')
    expect(day?.vendas).toBe(2)
    expect(day?.receitaBruta).toBe(30)
    expect(day?.receitaLiquida).toBe(27)
  })

  it('sums ad_spend_daily across both operations for the same day', async () => {
    const rows = await getDailyFunnel(db, clientId, '2026-09-01', '2026-09-02')
    const day = rows.find((r) => r.data === '2026-09-01')
    expect(day?.spend).toBe(12)
    expect(day?.roas).toBeCloseTo(30 / 12)
  })

  it('reports sync health for a client', async () => {
    const health = await getFunnelSyncHealth(db, clientId)
    const sales = health.find((h) => h.entity === 'sales')
    expect(sales?.lastResult).toBe('ok')
  })

  it('buckets a late-evening BRT sale under the BRT day, not the UTC day', async () => {
    const rows = await getDailyFunnel(db, clientId, '2026-09-01', '2026-09-03')
    const day1 = rows.find((r) => r.data === '2026-09-01')
    const day2 = rows.find((r) => r.data === '2026-09-02')
    expect(day1?.vendas).toBe(3)
    expect(day1?.receitaBruta).toBe(70)
    expect(day2).toBeUndefined()
  })
})
