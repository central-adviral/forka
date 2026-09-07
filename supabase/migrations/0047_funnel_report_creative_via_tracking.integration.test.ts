import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const admin = createClient(URL, SERVICE_ROLE_KEY)

// A sale that came through a Forka test carries a tracking id where the adset would be.
const TRACKED = 'av.1KLT.55.V5 - Veio Pelo Teste'.normalize('NFC')
// A sale that did not: utm_content really is the adset name.
const PLAIN = 'av.1KLT.66.V6 - Veio Direto'.normalize('NFC')

let asOwner: SupabaseClient
let funnelId: string
let trackingWithId: string
let trackingNameOnly: string

beforeAll(async () => {
  const stamp = Date.now()
  const email = `funnel-track-${stamp}@example.com`
  const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  asOwner = createClient(URL, ANON_KEY)
  await asOwner.auth.signInWithPassword({ email, password: 'password123' })

  const { data: client } = await admin
    .from('clients')
    .insert({ owner_id: user.user!.id, name: 'Funnel Track', slug: `funnel-track-${stamp}` })
    .select()
    .single()
  const { data: test } = await admin
    .from('tests')
    .insert({
      client_id: client!.id,
      name: 'Teste Rastreio',
      slug: `teste-rastreio-${stamp}`,
      conversion_method: 'hubla_webhook',
    })
    .select()
    .single()
  const { data: variant } = await admin
    .from('variants')
    .insert({ test_id: test!.id, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a', is_control: true })
    .select()
    .single()
  const { data: funnel } = await admin
    .from('sales_funnels')
    .insert({ client_id: client!.id, name: 'Funil Rastreio', slug: `funil-rastreio-${stamp}` })
    .select()
    .single()
  funnelId = funnel!.id

  const { error: spendError } = await admin.from('ad_creative_spend_daily').insert([
    {
      sales_funnel_id: funnelId,
      data: '2026-09-01',
      ad_id: `ad-track-${stamp}`,
      ad_name: TRACKED,
      adset_name: 'Conjunto Zeta',
      campaign_name: 'Campanha Teste',
      spend: 200,
      impressions: 2000,
      link_clicks: 100,
    },
    {
      sales_funnel_id: funnelId,
      data: '2026-09-01',
      ad_id: `ad-plain-${stamp}`,
      ad_name: PLAIN,
      adset_name: 'Conjunto Eta',
      campaign_name: 'Campanha Teste',
      spend: 100,
      impressions: 1000,
      link_clicks: 50,
    },
  ])
  expect(spendError).toBeNull()

  trackingWithId = crypto.randomUUID()
  trackingNameOnly = crypto.randomUUID()
  // Every row spells the same keys: a PostgREST bulk insert writes NULL for a key any row omits
  // rather than falling back to the column default, which rejects the whole batch.
  const click = (visitorId: string, trackingId: string, utms: Record<string, string>) => ({
    test_id: test!.id,
    variant_id: variant!.id,
    visitor_id: visitorId,
    tracking_id: trackingId,
    created_at: '2026-09-05T12:00:00Z',
    source_utms: utms,
  })
  const { error: clickError } = await admin.from('click_events').insert([
    // The click knows the ad id outright.
    click('v-track-id', trackingWithId, { fb_ad_id: `ad-track-${stamp}`, utm_term: TRACKED }),
    // An older click: only the ad name, which the spend alias can still resolve.
    click('v-track-name', trackingNameOnly, { utm_term: PLAIN }),
  ])
  expect(clickError).toBeNull()

  const sale = (externalId: string, revenue: number, utmTerm: string, utmContent: string) => ({
    sales_funnel_id: funnelId,
    source: 'launchops_sync',
    external_id: externalId,
    data_venda: '2026-09-05',
    status: 'aprovada',
    valor_liquido: revenue,
    utm_term: utmTerm,
    utm_content: utmContent,
  })
  const { error: salesError } = await admin.from('sales').insert([
    // utm_content holds the tracking id, not an adset -- resolves through the click's ad id.
    sale(`sale-track-${stamp}`, 300, TRACKED, trackingWithId),
    // Same shape, but the click only carried the ad name.
    sale(`sale-track-name-${stamp}`, 50, PLAIN, trackingNameOnly),
    // The ordinary case: utm_content really is the adset.
    sale(`sale-plain-${stamp}`, 150, PLAIN, 'Conjunto Eta'),
  ])
  expect(salesError).toBeNull()
})

interface Row {
  ad_name: string
  ad_id: string | null
  adset_name: string | null
  spend: number
  sales_count: number
  revenue: number
}

async function report(): Promise<Row[]> {
  const { data, error } = await asOwner.rpc('get_funnel_report_by_creative', { p_sales_funnel_id: funnelId })
  expect(error).toBeNull()
  return data as Row[]
}

describe('get_funnel_report_by_creative — sales resolved through the tracking id', () => {
  it('credits a sale whose utm_content is a tracking id to the ad that click identified', async () => {
    const row = (await report()).find((r) => r.ad_name === TRACKED)
    expect(row).toBeDefined()
    expect(Number(row!.spend)).toBe(200)
    expect(row!.sales_count).toBe(1)
    expect(Number(row!.revenue)).toBe(300)
  })

  it('resolves through the ad name when the click carried no fb_ad_id', async () => {
    // Both PLAIN sales land on the same ad: one via the click's name, one via its own adset.
    const row = (await report()).find((r) => r.ad_name === PLAIN)
    expect(row).toBeDefined()
    expect(row!.sales_count).toBe(2)
    expect(Number(row!.revenue)).toBe(200)
    expect(Number(row!.spend)).toBe(100)
  })

  it('never reports a tracking id as if it were an adset', async () => {
    const adsets = (await report()).map((r) => r.adset_name).filter((a): a is string => a !== null)
    expect(adsets).not.toContain(trackingWithId)
    expect(adsets.some((a) => /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(a))).toBe(false)
  })

  it('leaves no orphan row: every sale lands on an ad that has spend', async () => {
    const rows = await report()
    expect(rows.reduce((sum, r) => sum + Number(r.revenue), 0)).toBe(500)
    expect(rows.filter((r) => Number(r.spend) === 0 && Number(r.revenue) > 0)).toHaveLength(0)
  })
})
