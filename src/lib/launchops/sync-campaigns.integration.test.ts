import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { syncCampaignsForClient } from './sync-campaigns'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321', process.env.SUPABASE_SERVICE_ROLE_KEY!)

// A LaunchOps client whose every read answers "no rows, no error".
function emptyLaunchOps(): SupabaseClient {
  const chain: Record<string, unknown> = {}
  const self = new Proxy(chain, {
    get: (_target, prop) => {
      if (prop === 'then') return (resolve: (value: { data: unknown[]; error: null }) => void) => resolve({ data: [], error: null })
      return () => self
    },
  })
  return { from: () => self } as unknown as SupabaseClient
}

describe('campaign sync guards an empty LaunchOps read', () => {
  let clientId: string
  const now = new Date('2026-10-06T15:00:00Z')

  beforeAll(async () => {
    const { data: user } = await admin.auth.admin.createUser({ email: `empty-read-${Date.now()}@example.com`, password: 'password123', email_confirm: true })
    const { data: client } = await admin
      .from('clients')
      .insert({ owner_id: user!.user!.id, name: 'Empty Read', slug: `empty-read-${Date.now()}` })
      .select()
      .single()
    clientId = client!.id
    await admin.from('campaign_daily').insert([
      { client_id: clientId, data: '2026-10-04', campaign_id: 'c1', campaign_name: 'c1', spend: 300 },
      { client_id: clientId, data: '2026-10-05', campaign_id: 'c1', campaign_name: 'c1', spend: 250 },
    ])
  })

  it('keeps the spend, logs the run as failed and frees the lease', async () => {
    await expect(syncCampaignsForClient(admin, emptyLaunchOps(), clientId, now)).rejects.toThrow(/no ad rows/)

    const { data: kept } = await admin.from('campaign_daily').select('data, spend').eq('client_id', clientId).order('data')
    expect(kept).toEqual([
      { data: '2026-10-04', spend: 300 },
      { data: '2026-10-05', spend: 250 },
    ])
    const { data: run } = await admin.from('sync_runs').select('error, finished_at').eq('client_id', clientId).single()
    expect(run!.error).toMatch(/no ad rows/)
    expect(run!.finished_at).not.toBeNull()
    const { data: claimed } = await admin.rpc('claim_sync_lease', { p_client_id: clientId, p_seconds: 1 })
    expect(claimed).toBe(true)
  })
})
