import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

const db = createServiceRoleClient()
let clientId: string
let salesFunnelId: string
let clickEventId: string
let clickEventId2: string

beforeAll(async () => {
  const { data: user } = await db.auth.admin.createUser({
    email: `migration-0034-${Date.now()}@example.com`,
    password: 'password123',
    email_confirm: true,
  })
  const { data: client } = await db
    .from('clients')
    .insert({ owner_id: user!.user!.id, name: 'Migration0034', slug: `migration-0034-${Date.now()}` })
    .select()
    .single()
  clientId = client!.id
  const { data: funnel } = await db
    .from('sales_funnels')
    .insert({ client_id: clientId, name: 'Migration0034 Funnel', slug: 'migration-0034-funnel' })
    .select()
    .single()
  salesFunnelId = funnel!.id
  const { data: test } = await db
    .from('tests')
    .insert({ client_id: clientId, name: 'Migration0034 Test', slug: `migration-0034-test-${Date.now()}`, conversion_method: 'hubla_webhook' })
    .select()
    .single()
  const { data: variant } = await db
    .from('variants')
    .insert({ test_id: test!.id, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a', is_control: true })
    .select()
    .single()
  const { data: clickEvent } = await db
    .from('click_events')
    .insert({ test_id: test!.id, variant_id: variant!.id, visitor_id: 'visitor-0034', tracking_id: crypto.randomUUID(), source_utms: {} })
    .select()
    .single()
  clickEventId = clickEvent!.id
  const { data: clickEvent2 } = await db
    .from('click_events')
    .insert({ test_id: test!.id, variant_id: variant!.id, visitor_id: 'visitor-0034-b', tracking_id: crypto.randomUUID(), source_utms: {} })
    .select()
    .single()
  clickEventId2 = clickEvent2!.id
})

describe('migration 0034 — launchops sync enrichment columns', () => {
  it('accepts transaction_id_plataforma and conversion_id on sales', async () => {
    const { data: conversion } = await db
      .from('conversions')
      .insert({ click_event_id: clickEventId, source: 'hubla_webhook', external_event_id: `inv_0034_${Date.now()}`, value_cents: 770 })
      .select()
      .single()
    const { data: sale, error } = await db
      .from('sales')
      .insert({
        sales_funnel_id: salesFunnelId,
        source: 'launchops_sync',
        external_id: crypto.randomUUID(),
        data_venda: '2026-09-01T00:00:00Z',
        status: 'aprovada',
        transaction_id_plataforma: 'txn-0034',
        conversion_id: conversion!.id,
      })
      .select()
      .single()
    expect(error).toBeNull()
    expect(sale!.transaction_id_plataforma).toBe('txn-0034')
    expect(sale!.conversion_id).toBe(conversion!.id)
  })

  it('sets conversion_id to null (does not delete the sale) when the linked conversion is deleted', async () => {
    const { data: conversion } = await db
      .from('conversions')
      .insert({ click_event_id: clickEventId2, source: 'hubla_webhook', external_event_id: `inv_0034_del_${Date.now()}`, value_cents: 770 })
      .select()
      .single()
    const { data: sale } = await db
      .from('sales')
      .insert({
        sales_funnel_id: salesFunnelId,
        source: 'launchops_sync',
        external_id: crypto.randomUUID(),
        data_venda: '2026-09-01T00:00:00Z',
        status: 'aprovada',
        conversion_id: conversion!.id,
      })
      .select()
      .single()

    await db.from('conversions').delete().eq('id', conversion!.id)

    const { data: saleAfterDelete } = await db.from('sales').select('id, conversion_id').eq('id', sale!.id).single()
    expect(saleAfterDelete).not.toBeNull()
    expect(saleAfterDelete!.conversion_id).toBeNull()
  })

  it('accepts campaign_id/campaign_name/adset_id/adset_name on ad_creative_spend_daily', async () => {
    const { data, error } = await db
      .from('ad_creative_spend_daily')
      .insert({
        sales_funnel_id: salesFunnelId,
        source: 'launchops_sync',
        data: '2026-09-01',
        ad_id: 'ad-0034',
        ad_name: 'Criativo 0034',
        campaign_id: 'camp-0034',
        campaign_name: 'Campanha 0034',
        adset_id: 'adset-0034',
        adset_name: 'Conjunto 0034',
        spend: 10,
      })
      .select()
      .single()
    expect(error).toBeNull()
    expect(data!.campaign_id).toBe('camp-0034')
    expect(data!.adset_name).toBe('Conjunto 0034')
  })
})
