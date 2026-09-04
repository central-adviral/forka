import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getSyncCursor, recordSyncResult } from './funnel-sync-state-repo'

const db = createServiceRoleClient()
let salesFunnelId: string

beforeAll(async () => {
  const { data: user } = await db.auth.admin.createUser({
    email: `sync-state-${Date.now()}@example.com`,
    password: 'password123',
    email_confirm: true,
  })
  const { data: client } = await db
    .from('clients')
    .insert({ owner_id: user!.user!.id, name: 'SyncState', slug: `sync-state-${Date.now()}` })
    .select()
    .single()
  const { data: funnel } = await db
    .from('sales_funnels')
    .insert({ client_id: client!.id, name: 'SyncState Funnel', slug: 'sync-state-funnel' })
    .select()
    .single()
  salesFunnelId = funnel!.id
})

describe('funnel-sync-state-repo', () => {
  it('returns null cursor when the entity has never synced', async () => {
    const cursor = await getSyncCursor(db, salesFunnelId, 'sales')
    expect(cursor).toBeNull()
  })

  it('records a successful sync and advances the cursor', async () => {
    await recordSyncResult(db, { salesFunnelId, entity: 'sales', result: 'ok', newCursor: '2026-09-01T00:00:00Z' })
    const cursor = await getSyncCursor(db, salesFunnelId, 'sales')
    expect(cursor).toBe('2026-09-01T00:00:00.000Z')
  })

  it('does not advance the cursor on a failed sync', async () => {
    await recordSyncResult(db, { salesFunnelId, entity: 'sales', result: 'ok', newCursor: '2026-09-01T00:00:00Z' })
    await recordSyncResult(db, { salesFunnelId, entity: 'sales', result: 'error', message: 'LaunchOps timeout' })
    const cursor = await getSyncCursor(db, salesFunnelId, 'sales')
    expect(cursor).toBe('2026-09-01T00:00:00.000Z')
  })

  it('does not collide between two entities of the same funnel (composite key sales_funnel_id, entity)', async () => {
    await recordSyncResult(db, { salesFunnelId, entity: 'sales', result: 'ok', newCursor: '2026-09-01T00:00:00Z' })
    await recordSyncResult(db, { salesFunnelId, entity: 'ad_spend_daily', result: 'ok', newCursor: '2026-09-02T00:00:00Z' })
    expect(await getSyncCursor(db, salesFunnelId, 'sales')).toBe('2026-09-01T00:00:00.000Z')
    expect(await getSyncCursor(db, salesFunnelId, 'ad_spend_daily')).toBe('2026-09-02T00:00:00.000Z')
  })

  it('does not collide between the same entity on two different funnels', async () => {
    const { data: user } = await db.auth.admin.createUser({
      email: `sync-state-2-${Date.now()}@example.com`,
      password: 'password123',
      email_confirm: true,
    })
    const { data: client } = await db
      .from('clients')
      .insert({ owner_id: user!.user!.id, name: 'SyncState2', slug: `sync-state-2-${Date.now()}` })
      .select()
      .single()
    const { data: otherFunnel } = await db
      .from('sales_funnels')
      .insert({ client_id: client!.id, name: 'SyncState Other Funnel', slug: 'sync-state-other-funnel' })
      .select()
      .single()

    await recordSyncResult(db, { salesFunnelId, entity: 'sales', result: 'ok', newCursor: '2026-09-01T00:00:00Z' })
    await recordSyncResult(db, { salesFunnelId: otherFunnel!.id, entity: 'sales', result: 'ok', newCursor: '2026-09-03T00:00:00Z' })
    expect(await getSyncCursor(db, salesFunnelId, 'sales')).toBe('2026-09-01T00:00:00.000Z')
    expect(await getSyncCursor(db, otherFunnel!.id, 'sales')).toBe('2026-09-03T00:00:00.000Z')
  })
})
