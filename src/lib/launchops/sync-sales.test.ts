import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { syncSalesForFunnel } from './sync-sales'

// A stub, not a real client. This test's whole claim is that an empty batch never reaches the
// database, so handing it a client that could is unnecessary and dangerous: unit runs loaded
// .env.local, which points at production, and this was the one unit test building a service-role
// client out of it. It passed only because the empty-batch path returns before any query -- one
// line of change away from a unit test writing to the real database.
const NEVER_CALLED = {} as SupabaseClient

describe('syncSalesForFunnel', () => {
  it('returns latestUpdatedAt as null for an empty batch, without touching the db', async () => {
    const result = await syncSalesForFunnel(NEVER_CALLED, 'unused', [])
    expect(result).toEqual({ synced: 0, latestUpdatedAt: null })
  })
})
