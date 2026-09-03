import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { syncAdCreativeSpendForClient, type JoinedAdCreativeSpendRow } from './sync-ad-creative-spend'

const db = createServiceRoleClient()
let clientId: string

beforeAll(async () => {
  const { data: user } = await db.auth.admin.createUser({
    email: `sync-adcreative-${Date.now()}@example.com`,
    password: 'password123',
    email_confirm: true,
  })
  const { data: client } = await db
    .from('clients')
    .insert({ owner_id: user!.user!.id, name: 'SyncAdCreative', slug: `sync-adcreative-${Date.now()}` })
    .select()
    .single()
  clientId = client!.id
})

describe('syncAdCreativeSpendForClient (integration)', () => {
  it('does not duplicate a row when ad_id is null and the same batch is synced twice', async () => {
    const row: JoinedAdCreativeSpendRow = { ad_id: null, ad_name: 'Criativo Sem ID', data: '2026-09-01', spend: 10, impressions: 100, link_clicks: 2 }
    await syncAdCreativeSpendForClient(db, clientId, [row])
    await syncAdCreativeSpendForClient(db, clientId, [row])

    const { data } = await db
      .from('ad_creative_spend_daily')
      .select('id')
      .eq('client_id', clientId)
      .eq('data', '2026-09-01')
      .is('ad_id', null)
      .eq('ad_name', 'Criativo Sem ID')
    expect(data!.length).toBe(1)
  })
})
