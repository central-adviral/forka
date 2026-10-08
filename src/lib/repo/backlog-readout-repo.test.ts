import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { findTaggedCards } from './backlog-readout-repo'

const db = (rows: { ad_name: string; spend: number }[]) =>
  ({ rpc: vi.fn(async () => ({ data: rows.map((row) => ({ ...row, sales_count: 0 })), error: null })) }) as unknown as SupabaseClient

describe('findTaggedCards', () => {
  it('finds the cards whose tag is on an ad that spent', async () => {
    const found = await findTaggedCards(
      db([
        { ad_name: 'UGC dor [T3-A]', spend: 120 },
        { ad_name: 'Estúdio [T3-B]', spend: 80 },
        { ad_name: 'Carrossel [T4-A]', spend: 0 },
      ]),
      'funnel-1',
      ['T3', 'T4', 'T5']
    )
    expect([...found]).toEqual(['T3'])
  })

  it('reads nothing when no card waits for its tag', async () => {
    const client = db([])
    expect((await findTaggedCards(client, 'funnel-1', [])).size).toBe(0)
    expect(client.rpc).not.toHaveBeenCalled()
  })
})
