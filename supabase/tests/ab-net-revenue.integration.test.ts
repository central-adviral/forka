import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

type Row = Record<string, number | string | null>
const total = (rows: Row[], column: string) => rows.reduce((sum, row) => sum + Number(row[column]), 0)

let owner: SupabaseClient
let clientId: string
let funnelId: string

beforeAll(async () => {
  const email = `ab-net-${unique()}@example.com`
  const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  owner = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  await owner.auth.signInWithPassword({ email, password: 'password123' })
  const { data: client } = await admin.from('clients').insert({ owner_id: user!.user!.id, name: 'AB Net', slug: `ab-net-${unique()}` }).select().single()
  clientId = client!.id
  const { data: funnel } = await admin.from('sales_funnels').insert({ client_id: clientId, name: 'P', slug: 'p' }).select().single()
  funnelId = funnel!.id
  await admin.from('client_tax_rates').insert({ client_id: clientId, valid_from: '2026-01-01', factor: 1.1 })
  const { error } = await admin
    .from('ad_creative_spend_daily')
    .insert({ sales_funnel_id: funnelId, source: 'launchops_sync', data: '2026-10-01', ad_id: '990000000777', ad_name: 'Video net', spend: 100 })
  expect(error).toBeNull()
})

// The same three buyers in every test: an entry sale LaunchOps synced (R$ 197 gross, R$ 180 net),
// an upsell that carried the click id (R$ 97 gross, R$ 90 net) and an entry not synced yet (R$ 47).
async function testWith(receitaLiquida: boolean) {
  const { data: test } = await admin
    .from('tests')
    .insert({ client_id: clientId, name: 'Página', slug: `net-${unique()}`, conversion_method: 'hubla_webhook', sales_funnel_id: funnelId, receita_liquida: receitaLiquida })
    .select()
    .single()
  const { data: variant } = await admin
    .from('variants')
    .insert({ test_id: test!.id, name: 'A', weight_pct: 100, destination_url: 'https://example.com/a', is_control: true })
    .select()
    .single()
  const buy = async (grossCents: number, sale: { valorLiquido: number; isUpsell: boolean } | null) => {
    const { data: click } = await admin
      .from('click_events')
      .insert({
        test_id: test!.id,
        variant_id: variant!.id,
        visitor_id: `visitor-${unique()}`,
        tracking_id: crypto.randomUUID(),
        source_utms: { fb_ad_id: '990000000777', utm_source: 'facebook' },
        created_at: '2026-10-01T13:00:00Z',
      })
      .select('id, tracking_id')
      .single()
    const invoice = `inv-${unique()}`
    await admin.from('conversions').insert({ click_event_id: click!.id, source: 'hubla_webhook', external_event_id: invoice, value_cents: grossCents, created_at: '2026-10-01T13:10:00Z' })
    if (!sale) return
    const { error } = await admin.from('sales').insert({
      sales_funnel_id: funnelId,
      external_id: `sale-${unique()}`,
      data_venda: '2026-10-01T13:09:00Z',
      status: 'aprovada',
      transaction_id_plataforma: invoice,
      utm_content: click!.tracking_id,
      is_upsell: sale.isUpsell,
      valor_bruto: grossCents / 100,
      valor_liquido: sale.valorLiquido,
    })
    expect(error).toBeNull()
  }
  await buy(19700, { valorLiquido: 180, isUpsell: false })
  await buy(9700, { valorLiquido: 90, isUpsell: true })
  await buy(4700, null)
  return test!.id as string
}

async function readAll(testId: string) {
  const call = async (fn: string, args: Record<string, unknown> = {}) => {
    const { data, error } = await owner.rpc(fn, { p_test_id: testId, ...args })
    expect(error).toBeNull()
    return data as Row[]
  }
  const window = { p_since: null, p_until: null }
  return {
    report: (await call('get_test_report', window))[0],
    daily: await call('get_test_daily', { p_since: null }),
    segment: await call('get_test_report_by_segment', window),
    source: await call('get_test_report_by_source', window),
    ad: await call('get_test_report_by_ad', window),
    weekday: await call('get_test_report_by_weekday', window),
    hour: await call('get_test_report_by_hour', window),
    health: (await call('get_test_data_health', { p_since: null }))[0],
  }
}

describe('0097: new A/B tests read net revenue, entry sales only, taxed spend', () => {
  it('a new test defaults to the new rule', async () => {
    const { data } = await admin
      .from('tests')
      .insert({ client_id: clientId, name: 'Nova', slug: `nova-${unique()}`, conversion_method: 'hubla_webhook' })
      .select('receita_liquida')
      .single()
    expect(data!.receita_liquida).toBe(true)
  })

  it('an old test keeps the gross invoice rule in every report; a new one reads net, drops the upsell and falls back to gross before the sync', async () => {
    const before = await readAll(await testWith(false))
    const after = await readAll(await testWith(true))

    // Old rule: three buyers, R$ 197 + R$ 97 + R$ 47, spend without tax.
    expect(before.report).toMatchObject({ conversions: 3, sales: 3, revenue_cents: 34100 })
    expect(total(before.daily, 'buyers')).toBe(3)
    expect([total(before.segment, 'buyers'), total(before.segment, 'revenue_cents')]).toEqual([3, 34100])
    expect([total(before.source, 'conversions'), total(before.source, 'revenue_cents')]).toEqual([3, 34100])
    expect([total(before.ad, 'conversions'), total(before.ad, 'revenue_cents'), Number(before.ad[0].ad_spend)]).toEqual([3, 34100, 100])
    expect([total(before.weekday, 'conversions'), total(before.weekday, 'revenue_cents')]).toEqual([3, 34100])
    expect([total(before.hour, 'conversions'), total(before.hour, 'revenue_cents')]).toEqual([3, 34100])
    expect(before.health).toMatchObject({ traceable_sales: 2, counted_sales: 2, buyers: 3 })

    // New rule: the upsell is out, the synced entry counts R$ 180 net, the unsynced one its R$ 47 gross.
    expect(after.report).toMatchObject({ conversions: 2, sales: 2, revenue_cents: 22700 })
    expect(total(after.daily, 'buyers')).toBe(2)
    expect([total(after.segment, 'buyers'), total(after.segment, 'revenue_cents')]).toEqual([2, 22700])
    expect([total(after.source, 'conversions'), total(after.source, 'revenue_cents')]).toEqual([2, 22700])
    expect([total(after.ad, 'conversions'), total(after.ad, 'revenue_cents')]).toEqual([2, 22700])
    expect(Number(after.ad[0].ad_spend)).toBeCloseTo(110)
    expect([total(after.weekday, 'conversions'), total(after.weekday, 'revenue_cents')]).toEqual([2, 22700])
    expect([total(after.hour, 'conversions'), total(after.hour, 'revenue_cents')]).toEqual([2, 22700])
    expect(after.health).toMatchObject({ traceable_sales: 1, counted_sales: 1, buyers: 2 })
    // Clicks and people do not depend on the rule.
    expect([after.report.visits, after.report.clicks]).toEqual([before.report.visits, before.report.clicks])
  })
})
