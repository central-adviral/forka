import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/launchops/client', () => ({ createLaunchOpsClient: vi.fn(() => ({})) }))

const listMock = vi.fn()
vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: vi.fn(() => ({
    from: () => ({ select: () => ({ not: () => Promise.resolve({ data: listMock(), error: null }) }) }),
  })),
}))
vi.mock('@/lib/repo/funnel-sync-state-repo', () => ({
  getSyncCursor: vi.fn(async () => null),
  recordSyncResult: vi.fn(async () => undefined),
}))
vi.mock('@/lib/launchops/sync-sales', () => ({
  fetchLaunchOpsSalesRows: vi.fn(async () => []),
  syncSalesForClient: vi.fn(async () => ({ synced: 0, latestUpdatedAt: null })),
}))
vi.mock('@/lib/launchops/sync-ad-spend', () => ({
  fetchLaunchOpsAdSpendRows: vi.fn(async () => []),
  fetchLaunchOpsAdSpendRowsForDays: vi.fn(async () => []),
  aggregateAdSpendByOperacaoDay: vi.fn(() => []),
  syncAdSpendForClient: vi.fn(async () => ({ synced: 0 })),
}))
vi.mock('@/lib/launchops/sync-ad-creative-spend', () => ({
  fetchLaunchOpsAdCreatives: vi.fn(async () => []),
  fetchLaunchOpsAdCreativeSpendRows: vi.fn(async () => []),
  joinAdCreativeSpend: vi.fn(() => []),
  syncAdCreativeSpendForClient: vi.fn(async () => ({ synced: 0 })),
}))

import { GET } from './route'
import {
  fetchLaunchOpsAdSpendRows,
  fetchLaunchOpsAdSpendRowsForDays,
  aggregateAdSpendByOperacaoDay,
  syncAdSpendForClient,
} from '@/lib/launchops/sync-ad-spend'

describe('GET /api/internal/sync-funnel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-secret'
    listMock.mockReturnValue([])
  })

  it('rejects requests without a valid cron secret', async () => {
    const request = new NextRequest('https://app.example.com/api/internal/sync-funnel')
    const response = await GET(request)
    expect(response.status).toBe(401)
  })

  it('accepts requests with the correct bearer token and returns ok', async () => {
    const request = new NextRequest('https://app.example.com/api/internal/sync-funnel', {
      headers: { authorization: 'Bearer test-secret' },
    })
    const response = await GET(request)
    expect(response.status).toBe(200)
  })

  it('fails closed with 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET
    const request = new NextRequest('https://app.example.com/api/internal/sync-funnel', {
      headers: { authorization: 'Bearer undefined' },
    })
    const response = await GET(request)
    expect(response.status).toBe(500)
    process.env.CRON_SECRET = 'test-secret'
  })

  it('re-fetches and syncs the full day (not just the incrementally-fetched rows) when ad spend rows change', async () => {
    listMock.mockReturnValue([{ id: 'client-1', launchops_operacao_ids: ['op-1'], launchops_produto_nomes: null }])
    const partialRow = {
      operacao_id: 'op-1',
      data_referencia: '2026-09-01',
      spend: 50,
      impressions: 500,
      clicks: 5,
      leads_periodo: 1,
      updated_at: '2026-09-01T12:00:00Z',
    }
    const fullDayRows = [
      partialRow,
      { operacao_id: 'op-1', data_referencia: '2026-09-01', spend: 30, impressions: 300, clicks: 3, leads_periodo: 0, updated_at: '2026-09-01T08:00:00Z' },
    ]
    const fullDayAggregated = [{ operacao_id: 'op-1', data: '2026-09-01', spend: 80, impressions: 800, clicks: 8, leads: 1 }]

    vi.mocked(fetchLaunchOpsAdSpendRows).mockResolvedValueOnce([partialRow])
    vi.mocked(fetchLaunchOpsAdSpendRowsForDays).mockResolvedValueOnce(fullDayRows)
    vi.mocked(aggregateAdSpendByOperacaoDay).mockReturnValueOnce(fullDayAggregated)

    const request = new NextRequest('https://app.example.com/api/internal/sync-funnel', {
      headers: { authorization: 'Bearer test-secret' },
    })
    await GET(request)

    expect(fetchLaunchOpsAdSpendRowsForDays).toHaveBeenCalledWith(expect.anything(), {
      operacaoIds: ['op-1'],
      days: ['2026-09-01'],
    })
    expect(aggregateAdSpendByOperacaoDay).toHaveBeenCalledWith(fullDayRows)
    expect(syncAdSpendForClient).toHaveBeenCalledWith(expect.anything(), 'client-1', fullDayAggregated)
  })
})
