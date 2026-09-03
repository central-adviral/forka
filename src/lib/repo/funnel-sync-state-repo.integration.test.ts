import { describe, it, expect, beforeAll } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getSyncCursor, recordSyncResult } from './funnel-sync-state-repo'

const db = createServiceRoleClient()
let clientId: string

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
  clientId = client!.id
})

describe('funnel-sync-state-repo', () => {
  it('returns null cursor when the entity has never synced', async () => {
    const cursor = await getSyncCursor(db, clientId, 'sales')
    expect(cursor).toBeNull()
  })

  it('records a successful sync and advances the cursor', async () => {
    await recordSyncResult(db, { clientId, entity: 'sales', result: 'ok', newCursor: '2026-09-01T00:00:00Z' })
    const cursor = await getSyncCursor(db, clientId, 'sales')
    expect(cursor).toBe('2026-09-01T00:00:00.000Z')
  })

  it('does not advance the cursor on a failed sync', async () => {
    await recordSyncResult(db, { clientId, entity: 'sales', result: 'ok', newCursor: '2026-09-01T00:00:00Z' })
    await recordSyncResult(db, { clientId, entity: 'sales', result: 'error', message: 'LaunchOps timeout' })
    const cursor = await getSyncCursor(db, clientId, 'sales')
    expect(cursor).toBe('2026-09-01T00:00:00.000Z')
  })
})
