import { describe, it, expect } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { syncSalesForFunnel } from './sync-sales'

describe('syncSalesForFunnel', () => {
  it('returns latestUpdatedAt as null for an empty batch, without touching the db', async () => {
    const result = await syncSalesForFunnel(createServiceRoleClient(), 'unused', [])
    expect(result).toEqual({ synced: 0, latestUpdatedAt: null })
  })
})
