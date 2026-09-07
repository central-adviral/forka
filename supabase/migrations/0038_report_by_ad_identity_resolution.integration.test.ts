import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const admin = createClient(URL, SERVICE_ROLE_KEY)

// The spend side stores the name pre-composed; the click arrives with the cedilla as a separate
// combining character. Same word on screen, different bytes -- this is the production case.
const NAME_NFC = 'Marçal, Um HB20 Zero'.normalize('NFC')
const NAME_NFD = 'Marçal, Um HB20 Zero'.normalize('NFD')

let asOwner: SupabaseClient
let testId: string

beforeAll(async () => {
  const email = `ad-identity-${Date.now()}@example.com`
  const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  asOwner = createClient(URL, ANON_KEY)
  await asOwner.auth.signInWithPassword({ email, password: 'password123' })

  const { data: client } = await admin
    .from('clients')
    .insert({ owner_id: user.user!.id, name: 'Ad Identity', slug: `ad-identity-${Date.now()}` })
    .select()
    .single()
  const { data: test } = await admin
    .from('tests')
    .insert({
      client_id: client!.id,
      name: 'Teste Identidade',
      slug: `teste-identidade-${Date.now()}`,
      conversion_method: 'hubla_webhook',
    })
    .select()
    .single()
  testId = test!.id
  const { data: variant } = await admin
    .from('variants')
    .insert({ test_id: testId, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a', is_control: true })
    .select()
    .single()
  const { data: funnel } = await admin
    .from('sales_funnels')
    .insert({ client_id: client!.id, name: 'Funil', slug: `funil-${Date.now()}` })
    .select()
    .single()

  await admin.from('ad_creative_spend_daily').insert({
    sales_funnel_id: funnel!.id,
    data: '2026-09-01',
    ad_id: 'ad-identity-1',
    ad_name: NAME_NFC,
    spend: 40,
    impressions: 400,
    link_clicks: 20,
  })

  // Three clicks on the very same ad, in the three shapes production produces.
  await admin.from('click_events').insert([
    {
      test_id: testId,
      variant_id: variant!.id,
      visitor_id: 'v-id',
      tracking_id: crypto.randomUUID(),
      source_utms: { fb_ad_id: 'ad-identity-1' },
    },
    {
      test_id: testId,
      variant_id: variant!.id,
      visitor_id: 'v-name',
      tracking_id: crypto.randomUUID(),
      source_utms: { utm_term: NAME_NFC },
    },
    {
      test_id: testId,
      variant_id: variant!.id,
      visitor_id: 'v-name-nfd',
      tracking_id: crypto.randomUUID(),
      source_utms: { utm_term: NAME_NFD },
    },
  ])
})

describe('get_test_report_by_ad — ad identity resolution', () => {
  it('collapses the same ad into one row however the click identified it', async () => {
    const { data, error } = await asOwner.rpc('get_test_report_by_ad', { p_test_id: testId })
    expect(error).toBeNull()
    const rows = (data as { ad_name: string; clicks: number; ad_spend: number }[]).filter((r) => r.clicks > 0)
    expect(rows).toHaveLength(1)
    expect(rows[0].clicks).toBe(3)
  })

  it('counts the ad spend once, not once per click shape', async () => {
    const { data } = await asOwner.rpc('get_test_report_by_ad', { p_test_id: testId })
    const rows = (data as { clicks: number; ad_spend: number }[]).filter((r) => r.clicks > 0)
    expect(rows.reduce((sum, r) => sum + Number(r.ad_spend ?? 0), 0)).toBe(40)
  })

  it('labels the row with the ad name, not the raw id', async () => {
    const { data } = await asOwner.rpc('get_test_report_by_ad', { p_test_id: testId })
    const row = (data as { ad_name: string; clicks: number }[]).find((r) => r.clicks > 0)
    expect(row?.ad_name).toBe(NAME_NFC)
  })
})
