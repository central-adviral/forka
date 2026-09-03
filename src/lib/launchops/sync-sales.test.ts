import { describe, it, expect } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { syncSalesForClient } from './sync-sales'

describe('syncSalesForClient', () => {
  it('returns latestUpdatedAt as null for an empty batch, without touching the db', async () => {
    const result = await syncSalesForClient(createServiceRoleClient(), 'unused', [])
    expect(result).toEqual({ synced: 0, latestUpdatedAt: null })
  })
})
