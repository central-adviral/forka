import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const admin = createClient(URL, SERVICE_ROLE_KEY)

// The owner's real shape: one creative running in two campaigns, same name, same adset. Only the
// campaign tells them apart -- and the sale carries it in utm_medium.
const SAME = 'av.1KLT.21.V7 - Marçal, Um HB20 Zero'.normalize('NFC')
const ADSET = 'Conjunto Theta'
const CAMPAIGN_ABO = '16 - [TOOL-AB][1K-POR-DIA][VENDA][ABO]_Hubla_Teste_PV_01/09'
const CAMPAIGN_CBO = '17 - [TOOL-AB][1K-POR-DIA][VENDA][CBO]_Hubla_Teste_PV_01/09'

let asOwner: SupabaseClient
let funnelId: string

beforeAll(async () => {
  const stamp = Date.now()
  const email = `funnel-campaign-${stamp}@example.com`
  const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  asOwner = createClient(URL, ANON_KEY)
  await asOwner.auth.signInWithPassword({ email, password: 'password123' })

  const { data: client } = await admin
    .from('clients')
    .insert({ owner_id: user.user!.id, name: 'Funnel Campaign', slug: `funnel-campaign-${stamp}` })
    .select()
    .single()
  const { data: funnel } = await admin
    .from('sales_funnels')
    .insert({ client_id: client!.id, name: 'Funil Campanha', slug: `funil-campanha-${stamp}` })
    .select()
    .single()
  funnelId = funnel!.id

  // Every row spells the same keys: a PostgREST bulk insert writes NULL for a key any row omits
  // rather than falling back to the column default, which rejects the whole batch.
  const spend = (adId: string, campaign: string, amount: number) => ({
    sales_funnel_id: funnelId,
    data: '2026-09-01',
    ad_id: adId,
    ad_name: SAME,
    adset_name: ADSET,
    campaign_name: campaign,
    spend: amount,
    impressions: amount * 10,
    link_clicks: amount,
  })
  const { error: spendError } = await admin
    .from('ad_creative_spend_daily')
    .insert([spend(`abo-${stamp}`, CAMPAIGN_ABO, 90), spend(`cbo-${stamp}`, CAMPAIGN_CBO, 60)])
  expect(spendError).toBeNull()

  const sale = (externalId: string, campaign: string, revenue: number) => ({
    sales_funnel_id: funnelId,
    source: 'launchops_sync',
    external_id: externalId,
    data_venda: '2026-09-05',
    status: 'aprovada',
    valor_liquido: revenue,
    utm_term: SAME,
    utm_content: ADSET,
    utm_medium: campaign,
  })
  const { error: salesError } = await admin
    .from('sales')
    .insert([sale(`sale-abo-${stamp}`, CAMPAIGN_ABO, 400), sale(`sale-cbo-${stamp}`, CAMPAIGN_CBO, 100)])
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

describe('get_funnel_report_by_creative — campaign as the third key', () => {
  it('splits two ads that share a name and an adset, crediting each campaign its own revenue', async () => {
    const rows = (await report()).filter((r) => r.ad_name === SAME)
    expect(rows).toHaveLength(2)

    const abo = rows.find((r) => Number(r.spend) === 90)
    const cbo = rows.find((r) => Number(r.spend) === 60)
    expect(abo).toBeDefined()
    expect(cbo).toBeDefined()
    // Without the campaign key both sales pile onto one unresolved row and neither ad gets any.
    expect(Number(abo!.revenue)).toBe(400)
    expect(Number(cbo!.revenue)).toBe(100)
    expect(abo!.sales_count).toBe(1)
    expect(cbo!.sales_count).toBe(1)
  })

  it('reports each row against a real ad id, not an unresolved name bucket', async () => {
    const rows = (await report()).filter((r) => r.ad_name === SAME)
    expect(rows.every((r) => r.ad_id !== null)).toBe(true)
  })

  it('keeps the totals intact while splitting them', async () => {
    const rows = await report()
    expect(rows.reduce((sum, r) => sum + Number(r.revenue), 0)).toBe(500)
    expect(rows.reduce((sum, r) => sum + Number(r.spend), 0)).toBe(150)
  })
})
