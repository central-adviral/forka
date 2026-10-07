import { describe, it, expect } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function ownerWithClient(label: string): Promise<{ db: SupabaseClient; clientId: string }> {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  const db = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  await db.auth.signInWithPassword({ email, password: 'password123' })
  const { data: client } = await admin.from('clients').insert({ owner_id: user!.user!.id, name: label, slug: `${label}-${Date.now()}` }).select().single()
  return { db, clientId: client!.id }
}

describe('same number on every screen (0069)', () => {
  it('reads creative spend with the day tax, once per ad and day after a rename, and counts entry sales only', async () => {
    const { db, clientId } = await ownerWithClient('same-number-creative')
    const { data: funnel } = await admin.from('sales_funnels').insert({ client_id: clientId, name: '1K', slug: '1k' }).select().single()
    await admin.from('client_tax_rates').insert({ client_id: clientId, valid_from: '2026-01-01', factor: 1.1 })
    const spendRow = (adName: string, updatedAt: string) => ({
      sales_funnel_id: funnel!.id,
      source: 'launchops_sync',
      data: '2026-10-01',
      ad_id: '990000000001',
      ad_name: adName,
      spend: 100,
      updated_at: updatedAt,
    })
    // The same ad and day under its old and new name: only the newest write counts.
    const { error: spendError } = await admin.from('ad_creative_spend_daily').insert([
      spendRow('Video antigo', '2026-10-01T10:00:00Z'),
      spendRow('Video novo', '2026-10-02T10:00:00Z'),
    ])
    expect(spendError).toBeNull()
    const sale = (id: string, isUpsell: boolean, value: number) => ({
      sales_funnel_id: funnel!.id,
      external_id: id,
      data_venda: '2026-10-01T15:00:00Z',
      status: 'aprovada',
      utm_campaign: '990000000001',
      is_upsell: isUpsell,
      valor_liquido: value,
    })
    await admin.from('sales').insert([sale('e1', false, 90), sale('e2', false, 90), sale('u1', true, 40)])

    const { data, error } = await db.rpc('get_funnel_report_by_creative', { p_sales_funnel_id: funnel!.id, p_since: '2026-10-01', p_until: '2026-10-02' })
    expect(error).toBeNull()
    const rows = data as { ad_name: string; spend: number; sales_count: number; revenue: number }[]
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].spend)).toBeCloseTo(110)
    expect(Number(rows[0].sales_count)).toBe(2)
    expect(Number(rows[0].revenue)).toBe(220)
  })

  it('counts a person once in an A/B test, in the first variant they entered', async () => {
    const { db, clientId } = await ownerWithClient('same-number-ab')
    const { data: test } = await admin
      .from('tests')
      .insert({ client_id: clientId, name: 'hero', slug: `hero-${Date.now()}`, conversion_method: 'thank_you_page' })
      .select()
      .single()
    const { data: variants } = await admin
      .from('variants')
      .insert([
        { test_id: test!.id, name: 'A', weight_pct: 50, destination_url: 'https://example.com/a', is_control: true },
        { test_id: test!.id, name: 'B', weight_pct: 50, destination_url: 'https://example.com/b', is_control: false },
      ])
      .select()
    const variant = (name: string) => variants!.find((v) => v.name === name)!.id
    const click = async (variantId: string, at: string) =>
      (await admin
        .from('click_events')
        .insert({ test_id: test!.id, variant_id: variantId, visitor_id: 'v1', tracking_id: crypto.randomUUID(), source_utms: {}, created_at: at })
        .select()
        .single()).data!
    await click(variant('A'), '2026-10-01T10:00:00Z')
    const second = await click(variant('B'), '2026-10-01T11:00:00Z')
    await admin.from('conversions').insert({ click_event_id: second.id, source: 'thank_you_page', created_at: '2026-10-01T11:05:00Z' })

    const { data, error } = await db.rpc('get_test_report', { p_test_id: test!.id, p_since: null, p_until: null })
    expect(error).toBeNull()
    const byName = Object.fromEntries((data as { variant_name: string; visits: number; conversions: number }[]).map((row) => [row.variant_name, row]))
    expect([Number(byName.A.visits), Number(byName.A.conversions)]).toEqual([1, 1])
    expect([Number(byName.B.visits), Number(byName.B.conversions)]).toEqual([0, 0])
  })
})
