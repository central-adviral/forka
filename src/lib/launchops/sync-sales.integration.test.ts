import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { syncSalesForClient, type LaunchOpsSaleRow } from './sync-sales'

const db = createServiceRoleClient()
let clientId: string

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
  clientId = client!.id
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

describe('syncSalesForClient (integration)', () => {
  it('inserts a new sale and re-running with the same row does not duplicate it', async () => {
    const saleRow = row()
    await syncSalesForClient(db, clientId, [saleRow])
    await syncSalesForClient(db, clientId, [saleRow])

    const { data } = await db.from('sales').select('id').eq('client_id', clientId).eq('external_id', saleRow.id)
    expect(data!.length).toBe(1)
  })

  it('updates an existing sale in place when the row is re-synced with new values', async () => {
    const saleRow = row({ valor_bruto: 10 })
    await syncSalesForClient(db, clientId, [saleRow])
    await syncSalesForClient(db, clientId, [{ ...saleRow, valor_bruto: 12 }])

    const { data } = await db
      .from('sales')
      .select('valor_bruto')
      .eq('client_id', clientId)
      .eq('external_id', saleRow.id)
      .single()
    expect(data!.valor_bruto).toBe(12)
  })
})
