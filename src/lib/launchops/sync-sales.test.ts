import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { syncSalesForFunnel } from './sync-sales'

// A stub, not a real client. This test's whole claim is that an empty batch never reaches the
// database, so handing it a client that could is unnecessary and dangerous: unit runs loaded
// .env.local, which points at production, and this was the one unit test building a service-role
// client out of it. It passed only because the empty-batch path returns before any query -- one
// line of change away from a unit test writing to the real database.
const NEVER_CALLED = {} as SupabaseClient

describe('syncSalesForFunnel', () => {
  it('returns latestUpdatedAt as null for an empty batch, without touching the db', async () => {
    const result = await syncSalesForFunnel(NEVER_CALLED, 'unused', [])
    expect(result).toEqual({ synced: 0, refunded: 0, latestUpdatedAt: null })
  })

  it('marks a refunded row with its LaunchOps updated_at instead of deleting it (0099)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null })
    const from = vi.fn(() => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { client_id: 'client-1' }, error: null }) }) }),
      delete: () => {
        throw new Error('a refund must not delete the sale')
      },
    }))
    const db = { rpc, from } as unknown as SupabaseClient
    const result = await syncSalesForFunnel(db, 'funnel-1', [
      {
        id: 'sale-1', data_venda: '2026-09-01T12:00:00Z', produto_nome: 'Curso', status: 'reembolsada', valor_bruto: 10, valor_liquido: 9,
        metodo_pagamento: 'pix', updated_at: '2026-09-03T12:00:00Z', transaction_id_plataforma: null,
      },
    ])
    expect(rpc).toHaveBeenCalledWith('mark_sales_refunded', {
      p_client_id: 'client-1',
      p_rows: [{ external_id: 'sale-1', status: 'reembolsada', updated_at: '2026-09-03T12:00:00Z' }],
    })
    expect(result).toEqual({ synced: 0, refunded: 1, latestUpdatedAt: '2026-09-03T12:00:00Z' })
  })
})
