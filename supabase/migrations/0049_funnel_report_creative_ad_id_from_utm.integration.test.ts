import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const admin = createClient(URL, SERVICE_ROLE_KEY)

// Two ads no inference can separate: same name, same adset, same campaign. Only the id carried on
// the sale tells them apart.
const TWIN = 'av.1KLT.42.V2 - Gêmeo'.normalize('NFC')
const SOLO = 'av.1KLT.43.V3 - Sozinho'.normalize('NFC')
const ADSET = 'Conjunto Iota'
const CAMPAIGN = '20 - [1K-POR-DIA][VENDA][CBO]_Hubla_Iota_01/09'
const AD_A = '120249000000001'
const AD_B = '120249000000002'
const AD_SOLO = '120249000000003'

let asOwner: SupabaseClient
let funnelId: string

beforeAll(async () => {
  const stamp = Date.now()
  const email = `funnel-adid-${stamp}@example.com`
  const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  asOwner = createClient(URL, ANON_KEY)
  await asOwner.auth.signInWithPassword({ email, password: 'password123' })

  const { data: client } = await admin
    .from('clients')
    .insert({ owner_id: user.user!.id, name: 'Funnel AdId', slug: `funnel-adid-${stamp}` })
    .select()
    .single()
  const { data: funnel } = await admin
    .from('sales_funnels')
    .insert({ client_id: client!.id, name: 'Funil AdId', slug: `funil-adid-${stamp}` })
    .select()
    .single()
  funnelId = funnel!.id

  // Every row spells the same keys: a PostgREST bulk insert writes NULL for a key any row omits
  // rather than falling back to the column default, which rejects the whole batch.
  const spend = (adId: string, name: string, amount: number) => ({
    sales_funnel_id: funnelId,
    data: '2026-09-01',
    ad_id: adId,
    ad_name: name,
    adset_name: ADSET,
    campaign_name: CAMPAIGN,
    spend: amount,
    impressions: amount * 10,
    link_clicks: amount,
  })
  const { error: spendError } = await admin
    .from('ad_creative_spend_daily')
    .insert([spend(AD_A, TWIN, 90), spend(AD_B, TWIN, 60), spend(AD_SOLO, SOLO, 30)])
  expect(spendError).toBeNull()

  const sale = (externalId: string, utmCampaign: string, utmTerm: string, revenue: number) => ({
    sales_funnel_id: funnelId,
    source: 'launchops_sync',
    external_id: externalId,
    data_venda: '2026-09-05',
    status: 'aprovada',
    valor_liquido: revenue,
    utm_term: utmTerm,
    utm_content: ADSET,
    utm_medium: CAMPAIGN,
    utm_campaign: utmCampaign,
  })
  const { error: salesError } = await admin.from('sales').insert([
    // The bare {{ad.id}} -- the template being adopted.
    sale(`s-bare-${stamp}`, AD_A, TWIN, 400),
    // A campaign still carrying the old label in front of the id, mid-changeover.
    sale(`s-prefixed-${stamp}`, `1K_Latam-${AD_B}`, TWIN, 100),
    // The legacy label alone: no id to read, so the name cascade has to carry it.
    sale(`s-legacy-${stamp}`, '1K_Latam', SOLO, 70),
    // An id the spend table has never seen: must not resolve to anything.
    sale(`s-unknown-${stamp}`, '999999999999', TWIN, 25),
  ])
  expect(salesError).toBeNull()
})

interface Row {
  ad_name: string
  ad_id: string | null
  spend: number
  sales_count: number
  revenue: number
}

async function report(): Promise<Row[]> {
  const { data, error } = await asOwner.rpc('get_funnel_report_by_creative', { p_sales_funnel_id: funnelId })
  expect(error).toBeNull()
  return data as Row[]
}

describe('get_funnel_report_by_creative — ad id carried on utm_campaign', () => {
  it('splits twins that no name-based inference could separate', async () => {
    const twins = (await report()).filter((r) => r.ad_name === TWIN && r.ad_id !== null)
    expect(twins).toHaveLength(2)
    expect(Number(twins.find((r) => r.ad_id === AD_A)?.revenue)).toBe(400)
    expect(Number(twins.find((r) => r.ad_id === AD_B)?.revenue)).toBe(100)
  })

  it('reads the id through a leftover label during the changeover', async () => {
    const b = (await report()).find((r) => r.ad_id === AD_B)
    expect(b).toBeDefined()
    expect(b!.sales_count).toBe(1)
    expect(Number(b!.spend)).toBe(60)
  })

  it('still resolves a sale carrying only the old label, through the name cascade', async () => {
    const solo = (await report()).find((r) => r.ad_id === AD_SOLO)
    expect(solo).toBeDefined()
    expect(Number(solo!.revenue)).toBe(70)
  })

  it('refuses an id the spend table does not know, instead of inventing a row', async () => {
    const rows = await report()
    expect(rows.find((r) => r.ad_id === '999999999999')).toBeUndefined()
    // It falls through to the unresolved name bucket, which is where it belongs.
    expect(rows.find((r) => r.ad_id === null && Number(r.revenue) === 25)).toBeDefined()
  })

  it('keeps the totals intact', async () => {
    const rows = await report()
    expect(rows.reduce((sum, r) => sum + Number(r.revenue), 0)).toBe(595)
    expect(rows.reduce((sum, r) => sum + Number(r.spend), 0)).toBe(180)
  })
})
