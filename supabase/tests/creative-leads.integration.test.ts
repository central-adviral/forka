import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)

describe('leads per creative (0072)', () => {
  it('returns the paid leads of each ad, once per ad and day, for a lead project', async () => {
    const email = `creative-leads-${Date.now()}@example.com`
    const { data: user } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
    const owner = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    await owner.auth.signInWithPassword({ email, password: 'password123' })
    const { data: client } = await admin.from('clients').insert({ owner_id: user!.user!.id, name: 'Leads', slug: `leads-${Date.now()}` }).select().single()
    const { data: funnel } = await admin.from('sales_funnels').insert({ client_id: client!.id, name: 'GER', slug: 'ger', resultado: 'lead' }).select().single()
    const row = (adId: string, data: string, spend: number, leads: number, updatedAt: string, name = `Video ${adId}`) => ({
      sales_funnel_id: funnel!.id,
      source: 'launchops_sync',
      data,
      ad_id: adId,
      ad_name: name,
      spend,
      leads,
      updated_at: updatedAt,
    })
    const { error } = await admin.from('ad_creative_spend_daily').insert([
      row('880001', '2026-10-01', 100, 5, '2026-10-01T10:00:00Z'),
      // Same ad and day under an old name: the newest write is the one counted.
      row('880001', '2026-10-01', 100, 5, '2026-09-30T10:00:00Z', 'Video antigo'),
      row('880001', '2026-10-02', 0, 2, '2026-10-02T10:00:00Z'),
      row('880002', '2026-10-01', 60, 0, '2026-10-01T10:00:00Z'),
    ])
    expect(error).toBeNull()

    const { data, error: reportError } = await owner.rpc('get_funnel_report_by_creative', { p_sales_funnel_id: funnel!.id, p_since: '2026-10-01', p_until: '2026-10-03' })
    expect(reportError).toBeNull()
    const byAd = Object.fromEntries((data as { ad_id: string; spend: number; leads: number }[]).map((r) => [r.ad_id, r]))
    expect(Number(byAd['880001'].leads)).toBe(7)
    expect(Number(byAd['880001'].spend)).toBe(100)
    expect(Number(byAd['880002'].leads)).toBe(0)
  })
})
