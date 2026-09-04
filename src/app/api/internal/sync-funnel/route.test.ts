import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/launchops/client', () => ({ createLaunchOpsClient: vi.fn(() => ({})) }))

const listMock = vi.fn()
vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: vi.fn(() => ({
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: listMock(), error: null }) }) }),
  })),
}))
vi.mock('@/lib/repo/funnel-sync-state-repo', () => ({
  getSyncCursor: vi.fn(async () => null),
  recordSyncResult: vi.fn(async () => undefined),
}))
vi.mock('@/lib/launchops/sync-sales', () => ({
  fetchLaunchOpsSalesRows: vi.fn(async () => []),
  syncSalesForFunnel: vi.fn(async () => ({ synced: 0, latestUpdatedAt: null })),
}))
vi.mock('@/lib/launchops/sync-ad-spend', () => ({
  fetchLaunchOpsAdSpendRows: vi.fn(async () => []),
  fetchLaunchOpsAdSpendRowsForDays: vi.fn(async () => []),
  aggregateAdSpendByOperacaoDay: vi.fn(() => []),
  syncAdSpendForFunnel: vi.fn(async () => ({ synced: 0 })),
}))
vi.mock('@/lib/launchops/sync-ad-creative-spend', () => ({
  fetchLaunchOpsAdCreatives: vi.fn(async () => []),
  fetchLaunchOpsAdCreativeSpendRows: vi.fn(async () => []),
  joinAdCreativeSpend: vi.fn(() => []),
  syncAdCreativeSpendForFunnel: vi.fn(async () => ({ synced: 0 })),
}))

import { GET } from './route'
import { createLaunchOpsClient } from '@/lib/launchops/client'
import {
  fetchLaunchOpsAdSpendRows,
  fetchLaunchOpsAdSpendRowsForDays,
  aggregateAdSpendByOperacaoDay,
  syncAdSpendForFunnel,
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

  it('skips a funnel whose client has no data-source credential configured', async () => {
    listMock.mockReturnValue([
      {
        id: 'funnel-1',
        launchops_operacao_ids: ['op-1'],
        launchops_produto_nomes: null,
        clients: { funnel_source_url: null, funnel_source_service_role_key: null },
      },
    ])
    const request = new NextRequest('https://app.example.com/api/internal/sync-funnel', {
      headers: { authorization: 'Bearer test-secret' },
    })
    const response = await GET(request)
    const body = await response.json()
    expect(body).toEqual({ ok: true, funnelsProcessed: 0 })
  })

  it('re-fetches and syncs the full day (not just the incrementally-fetched rows) when ad spend rows change', async () => {
    listMock.mockReturnValue([
      {
        id: 'funnel-1',
        launchops_operacao_ids: ['op-1'],
        launchops_produto_nomes: null,
        clients: { funnel_source_url: 'https://launchops.example.com', funnel_source_service_role_key: 'key' },
      },
    ])
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
    expect(syncAdSpendForFunnel).toHaveBeenCalledWith(expect.anything(), 'funnel-1', fullDayAggregated)
  })

  it('builds a separate LaunchOps client per funnel using that funnel own client credential, never mixing them up', async () => {
    listMock.mockReturnValue([
      {
        id: 'funnel-a',
        launchops_operacao_ids: null,
        launchops_produto_nomes: null,
        clients: { funnel_source_url: 'https://client-a.example.com', funnel_source_service_role_key: 'key-a' },
      },
      {
        id: 'funnel-b',
        launchops_operacao_ids: null,
        launchops_produto_nomes: null,
        clients: { funnel_source_url: 'https://client-b.example.com', funnel_source_service_role_key: 'key-b' },
      },
    ])
    const request = new NextRequest('https://app.example.com/api/internal/sync-funnel', {
      headers: { authorization: 'Bearer test-secret' },
    })
    const response = await GET(request)
    const body = await response.json()

    expect(body).toEqual({ ok: true, funnelsProcessed: 2 })
    expect(createLaunchOpsClient).toHaveBeenNthCalledWith(1, { url: 'https://client-a.example.com', serviceRoleKey: 'key-a' })
    expect(createLaunchOpsClient).toHaveBeenNthCalledWith(2, { url: 'https://client-b.example.com', serviceRoleKey: 'key-b' })
  })
})
