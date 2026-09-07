import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const db = createServiceRoleClient()
let testId: string
let asOwner: SupabaseClient

beforeAll(async () => {
  const email = `report-ad-spend-${Date.now()}@example.com`
  const password = 'password123'
  const { data: user } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  asOwner = createClient(URL, ANON_KEY)
  await asOwner.auth.signInWithPassword({ email, password })
  const { data: client } = await db
    .from('clients')
    .insert({ owner_id: user!.user!.id, name: 'ReportAdSpend', slug: `report-ad-spend-${Date.now()}` })
    .select()
    .single()
  const clientId = client!.id
  const { data: funnel } = await db
    .from('sales_funnels')
    .insert({ client_id: clientId, name: 'ReportAdSpend Funnel', slug: 'report-ad-spend-funnel' })
    .select()
    .single()
  const salesFunnelId = funnel!.id
  const { data: test } = await db
    .from('tests')
    .insert({ client_id: clientId, name: 'T', slug: `report-ad-spend-t-${Date.now()}`, conversion_method: 'hubla_webhook' })
    .select()
    .single()
  testId = test!.id
  const { data: variant } = await db
    .from('variants')
    .insert({ test_id: testId, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a', is_control: true })
    .select()
    .single()
  const variantId = variant!.id

  // 3 clicks for the same ad, plus 5 days of R$10 spend for that ad — a broken
  // (non-pre-aggregated) join would multiply spend by click count (15x R$10 instead of R$50 total).
  for (let i = 0; i < 3; i++) {
    await db.from('click_events').insert({
      test_id: testId,
      variant_id: variantId,
      visitor_id: `visitor-${i}`,
      tracking_id: crypto.randomUUID(),
      source_utms: { fb_ad_id: 'ad-123' },
    })
  }
  const spendRows = Array.from({ length: 5 }, (_, i) => ({
    sales_funnel_id: salesFunnelId,
    source: 'launchops_sync',
    data: `2026-09-0${i + 1}`,
    ad_id: 'ad-123',
    ad_name: 'Criativo X',
    spend: 10,
    impressions: 100,
    link_clicks: 2,
  }))
  await db.from('ad_creative_spend_daily').insert(spendRows)
})

describe('get_test_report_by_ad — spend enrichment', () => {
  it('returns total spend for the period, not spend multiplied by click count', async () => {
    const { data, error } = await asOwner.rpc('get_test_report_by_ad', { p_test_id: testId, p_since: null, p_until: null })
    expect(error).toBeNull()
    const row = (data as { ad_name: string; clicks: number; ad_spend: number }[]).find((r) => r.ad_name === 'Criativo X')
    expect(row?.clicks).toBe(3)
    expect(row?.ad_spend).toBe(50)
  })
})
