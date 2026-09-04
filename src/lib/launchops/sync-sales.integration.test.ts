import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { syncSalesForFunnel, type LaunchOpsSaleRow } from './sync-sales'

const db = createServiceRoleClient()
let salesFunnelId: string
let matchedExternalEventId: string
let matchedConversionId: string

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

  const { data: test } = await db
    .from('tests')
    .insert({ client_id: client!.id, name: 'SyncSales Test', slug: `sync-sales-test-${Date.now()}`, conversion_method: 'hubla_webhook' })
    .select()
    .single()
  const { data: variant } = await db
    .from('variants')
    .insert({ test_id: test!.id, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a' })
    .select()
    .single()
  const { data: clickEvent } = await db
    .from('click_events')
    .insert({ test_id: test!.id, variant_id: variant!.id, visitor_id: 'visitor-sync-sales', tracking_id: crypto.randomUUID(), source_utms: {} })
    .select()
    .single()
  matchedExternalEventId = `inv_${Date.now()}`
  const { data: conversion } = await db
    .from('conversions')
    .insert({ click_event_id: clickEvent!.id, source: 'hubla_webhook', external_event_id: matchedExternalEventId, value_cents: 770 })
    .select()
    .single()
  matchedConversionId = conversion!.id
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
    transaction_id_plataforma: null,
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

  it('links conversion_id when transaction_id_plataforma matches an existing conversion external_event_id', async () => {
    const saleRow = row({ transaction_id_plataforma: matchedExternalEventId })
    await syncSalesForFunnel(db, salesFunnelId, [saleRow])

    const { data } = await db
      .from('sales')
      .select('conversion_id')
      .eq('sales_funnel_id', salesFunnelId)
      .eq('external_id', saleRow.id)
      .single()
    expect(data!.conversion_id).toBe(matchedConversionId)
  })

  it('leaves conversion_id null when transaction_id_plataforma does not match any conversion', async () => {
    const saleRow = row({ transaction_id_plataforma: `inv_no_match_${Date.now()}` })
    await syncSalesForFunnel(db, salesFunnelId, [saleRow])

    const { data } = await db
      .from('sales')
      .select('conversion_id')
      .eq('sales_funnel_id', salesFunnelId)
      .eq('external_id', saleRow.id)
      .single()
    expect(data!.conversion_id).toBeNull()
  })

  it('leaves conversion_id null when transaction_id_plataforma is null', async () => {
    const saleRow = row({ transaction_id_plataforma: null })
    await syncSalesForFunnel(db, salesFunnelId, [saleRow])

    const { data } = await db
      .from('sales')
      .select('conversion_id')
      .eq('sales_funnel_id', salesFunnelId)
      .eq('external_id', saleRow.id)
      .single()
    expect(data!.conversion_id).toBeNull()
  })
})
