import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { syncSalesForFunnel, type LaunchOpsSaleRow } from './sync-sales'

const db = createServiceRoleClient()
let salesFunnelId: string

beforeAll(async () => {
  const { data: user } = await db.auth.admin.createUser({
    email: `sync-sales-${Date.now()}@example.com`,
    password: 'password123',
    email_confirm: true,
  })
  const { data: client } = await db
    .from('clients')
    .insert({ owner_id: user!.user!.id, name: 'SyncSales', slug: `sync-sales-${Date.now()}` })
    .select()
    .single()
  const { data: funnel } = await db
    .from('sales_funnels')
    .insert({ client_id: client!.id, name: 'SyncSales Funnel', slug: 'sync-sales-funnel' })
    .select()
    .single()
  salesFunnelId = funnel!.id
})

function row(overrides: Partial<LaunchOpsSaleRow> = {}): LaunchOpsSaleRow {
  return {
    id: crypto.randomUUID(),
    data_venda: '2026-09-01T12:00:00Z',
    produto_nome: '1K Por Dia Latam',
    status: 'aprovada',
    valor_bruto: 7.7,
    valor_liquido: 6.9,
    metodo_pagamento: 'pix',
    updated_at: '2026-09-01T12:00:00Z',
    ...overrides,
  }
}

describe('syncSalesForFunnel (integration)', () => {
  it('inserts a new sale and re-running with the same row does not duplicate it', async () => {
    const saleRow = row()
    await syncSalesForFunnel(db, salesFunnelId, [saleRow])
    await syncSalesForFunnel(db, salesFunnelId, [saleRow])

    const { data } = await db.from('sales').select('id').eq('sales_funnel_id', salesFunnelId).eq('external_id', saleRow.id)
    expect(data!.length).toBe(1)
  })

  it('updates an existing sale in place when the row is re-synced with new values', async () => {
    const saleRow = row({ valor_bruto: 10 })
    await syncSalesForFunnel(db, salesFunnelId, [saleRow])
    await syncSalesForFunnel(db, salesFunnelId, [{ ...saleRow, valor_bruto: 12 }])

    const { data } = await db
      .from('sales')
      .select('valor_bruto')
      .eq('sales_funnel_id', salesFunnelId)
      .eq('external_id', saleRow.id)
      .single()
    expect(data!.valor_bruto).toBe(12)
  })
})
