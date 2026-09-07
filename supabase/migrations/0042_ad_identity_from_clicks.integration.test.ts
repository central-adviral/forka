import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const admin = createClient(URL, SERVICE_ROLE_KEY)

// One name, two ads, two adsets -- the production shape that 0038 collapsed into a single row.
const SHARED = 'av.1KLT.17.V1 - Salário de Juíz'.normalize('NFC')
const SOLO = 'av.1KLT.99.V9 - Anúncio Único'.normalize('NFC')

let asOwner: SupabaseClient
let testId: string
let stamp: number

beforeAll(async () => {
  stamp = Date.now()
  const email = `ad-from-clicks-${stamp}@example.com`
  const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  asOwner = createClient(URL, ANON_KEY)
  await asOwner.auth.signInWithPassword({ email, password: 'password123' })

  const { data: client } = await admin
    .from('clients')
    .insert({ owner_id: user.user!.id, name: 'Ad From Clicks', slug: `ad-from-clicks-${stamp}` })
    .select()
    .single()
  const { data: test } = await admin
    .from('tests')
    .insert({
      client_id: client!.id,
      name: 'Teste Identidade Por Id',
      slug: `teste-identidade-id-${stamp}`,
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
    .insert({ client_id: client!.id, name: 'Funil', slug: `funil-${stamp}` })
    .select()
    .single()

  await admin.from('ad_creative_spend_daily').insert([
    {
      sales_funnel_id: funnel!.id,
      data: '2026-09-01',
      ad_id: `dup-1-${stamp}`,
      ad_name: SHARED,
      adset_name: 'Conjunto Alfa',
      campaign_name: 'Campanha ABO',
      spend: 100,
      impressions: 1000,
      link_clicks: 50,
    },
    {
      sales_funnel_id: funnel!.id,
      data: '2026-09-01',
      ad_id: `dup-2-${stamp}`,
      ad_name: SHARED,
      adset_name: 'Conjunto Beta',
      campaign_name: 'Campanha CBO',
      spend: 60,
      impressions: 600,
      link_clicks: 30,
    },
    {
      sales_funnel_id: funnel!.id,
      data: '2026-09-01',
      ad_id: `solo-1-${stamp}`,
      ad_name: SOLO,
      adset_name: 'Conjunto Alfa',
      campaign_name: 'Campanha ABO',
      spend: 25,
      impressions: 250,
      link_clicks: 10,
    },
  ])

  await admin.from('click_events').insert([
    // Two ads sharing a name, each identified by its own id.
    { test_id: testId, variant_id: variant!.id, visitor_id: 'v-dup1-a', tracking_id: crypto.randomUUID(), source_utms: { fb_ad_id: `dup-1-${stamp}`, utm_term: SHARED } },
    { test_id: testId, variant_id: variant!.id, visitor_id: 'v-dup1-b', tracking_id: crypto.randomUUID(), source_utms: { fb_ad_id: `dup-1-${stamp}`, utm_term: SHARED } },
    { test_id: testId, variant_id: variant!.id, visitor_id: 'v-dup2', tracking_id: crypto.randomUUID(), source_utms: { fb_ad_id: `dup-2-${stamp}`, utm_term: SHARED } },
    // A name the click stream only ever saw on one id: resolvable even without fb_ad_id.
    { test_id: testId, variant_id: variant!.id, visitor_id: 'v-solo-id', tracking_id: crypto.randomUUID(), source_utms: { fb_ad_id: `solo-1-${stamp}`, utm_term: SOLO } },
    { test_id: testId, variant_id: variant!.id, visitor_id: 'v-solo-name', tracking_id: crypto.randomUUID(), source_utms: { utm_term: SOLO } },
    // An old click carrying only the ambiguous name: must not be credited to either ad.
    { test_id: testId, variant_id: variant!.id, visitor_id: 'v-ambiguous', tracking_id: crypto.randomUUID(), source_utms: { utm_term: SHARED } },
  ])
})

interface Row {
  ad_name: string
  clicks: number
  ad_spend: number | null
}

async function report(): Promise<Row[]> {
  const { data, error } = await asOwner.rpc('get_test_report_by_ad', { p_test_id: testId })
  expect(error).toBeNull()
  return (data as Row[]).filter((r) => r.clicks > 0)
}

describe('get_test_report_by_ad — identity is the ad id', () => {
  it('keeps two ads that share a name as two rows, each with its own spend', async () => {
    const withSpend = (await report()).filter((r) => r.ad_name.startsWith(SHARED) && Number(r.ad_spend ?? 0) > 0)
    expect(withSpend).toHaveLength(2)
    expect(withSpend.map((r) => Number(r.ad_spend)).sort((a, b) => a - b)).toEqual([60, 100])
  })

  it('tells the two apart by their adset, so the operator can act on either', async () => {
    const labels = (await report())
      .filter((r) => r.ad_name.startsWith(SHARED) && Number(r.ad_spend ?? 0) > 0)
      .map((r) => r.ad_name)
    expect(labels).toContain(`${SHARED} · Conjunto Alfa`)
    expect(labels).toContain(`${SHARED} · Conjunto Beta`)
  })

  it('resolves a name-only click when the click stream saw that name on exactly one ad', async () => {
    const solo = (await report()).filter((r) => r.ad_name.startsWith(SOLO))
    expect(solo).toHaveLength(1)
    expect(solo[0].clicks).toBe(2)
    expect(Number(solo[0].ad_spend)).toBe(25)
  })

  it('leaves an ambiguous name-only click unattributed rather than guessing an ad', async () => {
    const unresolved = (await report()).find((r) => r.ad_name === `${SHARED} · anúncio não identificado`)
    expect(unresolved).toBeDefined()
    expect(unresolved!.clicks).toBe(1)
    expect(Number(unresolved!.ad_spend ?? 0)).toBe(0)
  })
})
