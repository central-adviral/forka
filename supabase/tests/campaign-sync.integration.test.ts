import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321', process.env.SUPABASE_SERVICE_ROLE_KEY!)

describe('reliable campaign sync (0056)', () => {
  let clientId: string

  beforeAll(async () => {
    const { data: user } = await admin.auth.admin.createUser({ email: `campaign-sync-${Date.now()}@example.com`, password: 'password123', email_confirm: true })
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: user!.user!.id, name: 'Campaign Sync', slug: `campaign-sync-${Date.now()}` })
      .select()
      .single()
    clientId = client!.id
  })

  it('replaces a whole day, so a campaign that lost its spend leaves instead of lingering', async () => {
    const day = '2026-10-01'
    const campaign = (id: string, spend: number) => ({
      campaign_id: id,
      campaign_name: id,
      spend,
      impressions: 0,
      clicks: 0,
      link_clicks: 0,
      landing_page_views: 0,
      leads: 0,
      reach: 0,
      initiate_checkout: 0,
      source_updated_at: '2026-10-01T14:07:00Z',
    })
    await admin.rpc('replace_campaign_day', { p_client_id: clientId, p_data: day, p_rows: [campaign('a', 100), campaign('b', 50)] })
    const { data: written, error } = await admin.rpc('replace_campaign_day', { p_client_id: clientId, p_data: day, p_rows: [campaign('a', 120)] })
    expect(error).toBeNull()
    expect(written).toBe(1)
    const { data } = await admin.from('campaign_daily').select('campaign_id, spend, source_updated_at').eq('client_id', clientId).eq('data', day)
    expect(data).toEqual([{ campaign_id: 'a', spend: 120, source_updated_at: '2026-10-01T14:07:00+00:00' }])
  })

  it('lets one sync hold a client at a time, and frees it when the lease ends', async () => {
    expect((await admin.rpc('claim_sync_lease', { p_client_id: clientId, p_seconds: 300 })).data).toBe(true)
    expect((await admin.rpc('claim_sync_lease', { p_client_id: clientId, p_seconds: 300 })).data).toBe(false)
    await admin.rpc('release_sync_lease', { p_client_id: clientId })
    expect((await admin.rpc('claim_sync_lease', { p_client_id: clientId, p_seconds: 0 })).data).toBe(true)
    // A run that died without releasing: its zero-second lease is already over.
    expect((await admin.rpc('claim_sync_lease', { p_client_id: clientId, p_seconds: 300 })).data).toBe(true)
    await admin.rpc('release_sync_lease', { p_client_id: clientId })
  })
})
