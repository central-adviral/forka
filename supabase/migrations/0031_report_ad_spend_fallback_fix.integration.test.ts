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
  const email = `report-fallback-fix-${Date.now()}@example.com`
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
    .insert({ owner_id: user!.user!.id, name: 'ReportFallbackFix', slug: `report-fallback-fix-${Date.now()}` })
    .select()
    .single()
  const clientId = client!.id
  const { data: funnel } = await db
    .from('sales_funnels')
    .insert({ client_id: clientId, name: 'ReportFallbackFix Funnel', slug: 'report-fallback-fix-funnel' })
    .select()
    .single()
  const salesFunnelId = funnel!.id
  const { data: test } = await db
    .from('tests')
    .insert({ client_id: clientId, name: 'T', slug: `report-fallback-fix-t-${Date.now()}`, conversion_method: 'hubla_webhook' })
    .select()
    .single()
  testId = test!.id
  const { data: variant } = await db
    .from('variants')
    .insert({ test_id: testId, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a', is_control: true })
    .select()
    .single()
  const variantId = variant!.id

  // click has no fb_ad_id (the redirect route writes '' for it, not null) but a real utm_term.
  // LaunchOps only reports ad_name for this ad (ad_id is null), matching the realistic case where
  // the CTE key correctly falls through to ad_name — but a broken join predicate on the click side
  // (coalesce('', utm_term) never falls through to utm_term) would still leave ad_spend null.
  await db.from('click_events').insert({
    test_id: testId,
    variant_id: variantId,
    visitor_id: 'visitor-1',
    tracking_id: crypto.randomUUID(),
    source_utms: { fb_ad_id: '', utm_term: 'Criativo Y' },
  })
  await db.from('ad_creative_spend_daily').insert({
    sales_funnel_id: salesFunnelId,
    source: 'launchops_sync',
    data: '2026-09-01',
    ad_id: null,
    ad_name: 'Criativo Y',
    spend: 25,
    impressions: 200,
    link_clicks: 4,
  })
})

describe('get_test_report_by_ad — utm_term fallback with empty-string fb_ad_id', () => {
  it('matches spend via utm_term when fb_ad_id is an empty string, not null', async () => {
    const { data, error } = await asOwner.rpc('get_test_report_by_ad', { p_test_id: testId, p_since: null, p_until: null })
    expect(error).toBeNull()
    const row = (data as { ad_name: string; clicks: number; ad_spend: number | null }[]).find((r) => r.ad_name === 'Criativo Y')
    expect(row?.clicks).toBe(1)
    expect(row?.ad_spend).toBe(25)
  })
})
