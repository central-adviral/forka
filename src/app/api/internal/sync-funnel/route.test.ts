import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/launchops/client', () => ({ createLaunchOpsClient: vi.fn(() => ({})) }))

const listMock = vi.fn()
vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: vi.fn(() => ({
    from: () => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: listMock(), error: null }) }) }) }),
  })),
}))
// Secrets live in client_secrets, reachable only by the service role, and are looked up per
// client_id -- so the mock is keyed the same way the route looks them up.
const secretsByClientId: Record<string, string | null> = {}
vi.mock('@/lib/repo/client-secrets-repo', () => ({
  getClientSecrets: vi.fn(async (_db: unknown, clientId: string) => ({
    funnelSourceServiceRoleKey: secretsByClientId[clientId] ?? null,
    hublaWebhookToken: null,
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
  fetchLaunchOpsInitiateCheckoutByOperacaoDay: vi.fn(async () => []),
  syncAdSpendForFunnel: vi.fn(async () => ({ synced: 0 })),
}))
vi.mock('@/lib/launchops/sync-ad-creative-spend', () => ({
  fetchLaunchOpsAdCreatives: vi.fn(async () => []),
  fetchLaunchOpsAdCreativeSpendRows: vi.fn(async () => []),
  joinAdCreativeSpend: vi.fn(() => []),
  syncAdCreativeSpendForFunnel: vi.fn(async () => ({ synced: 0 })),
}))
vi.mock('@/lib/launchops/sync-campaigns', () => ({
  syncCampaignsForClient: vi.fn(async () => ({ since: '2026-09-01', campaignDays: 0 })),
}))

import { GET } from './route'
import { getClientSecrets } from '@/lib/repo/client-secrets-repo'
import { createLaunchOpsClient } from '@/lib/launchops/client'
import { syncCampaignsForClient } from '@/lib/launchops/sync-campaigns'
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
    for (const key of Object.keys(secretsByClientId)) delete secretsByClientId[key]
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
        client_id: 'client-1',
        launchops_operacao_ids: ['op-1'],
        launchops_produto_nomes: null,
        clients: { funnel_source_url: null },
      },
    ])
    const request = new NextRequest('https://app.example.com/api/internal/sync-funnel', {
      headers: { authorization: 'Bearer test-secret' },
    })
    const response = await GET(request)
    const body = await response.json()
    expect(body).toEqual({ ok: true, funnelsProcessed: 0, funnelsFailed: 0, clientsWithCampaigns: 0 })
  })

  it('syncs the client campaigns before the funnel, since the creative spend picks its ads from them', async () => {
    listMock.mockReturnValue([
      {
        id: 'funnel-1',
        client_id: 'client-1',
        launchops_operacao_ids: ['op-1'],
        launchops_produto_nomes: null,
        clients: { funnel_source_url: 'https://launchops.example.com' },
      },
    ])
    secretsByClientId['client-1'] = 'key'
    await GET(new NextRequest('http://localhost/api/internal/sync-funnel', { headers: { authorization: 'Bearer test-secret' } }))
    const campaignsAt = vi.mocked(syncCampaignsForClient).mock.invocationCallOrder[0]
    const funnelAt = vi.mocked(fetchLaunchOpsAdSpendRows).mock.invocationCallOrder[0]
    expect(campaignsAt).toBeDefined()
    expect(funnelAt).toBeDefined()
    expect(campaignsAt).toBeLessThan(funnelAt)
  })

  it('re-fetches and syncs the full day (not just the incrementally-fetched rows) when ad spend rows change', async () => {
    listMock.mockReturnValue([
      {
        id: 'funnel-1',
        client_id: 'client-1',
        launchops_operacao_ids: ['op-1'],
        launchops_produto_nomes: null,
        clients: { funnel_source_url: 'https://launchops.example.com' },
      },
    ])
    secretsByClientId['client-1'] = 'key'
    const partialRow = {
      operacao_id: 'op-1',
      data_referencia: '2026-09-01',
      spend: 50,
      impressions: 500,
      clicks: 5,
      leads_periodo: 1,
      reach: 400,
      link_clicks: 30,
      landing_page_views: 20,
      updated_at: '2026-09-01T12:00:00Z',
    }
    const fullDayRows = [
      partialRow,
      {
        operacao_id: 'op-1',
        data_referencia: '2026-09-01',
        spend: 30,
        impressions: 300,
        clicks: 3,
        leads_periodo: 0,
        reach: 250,
        link_clicks: 15,
        landing_page_views: 10,
        updated_at: '2026-09-01T08:00:00Z',
      },
    ]
    const fullDayAggregated = [
      { operacao_id: 'op-1', data: '2026-09-01', spend: 80, impressions: 800, clicks: 8, leads: 1, reach: 650, linkClicks: 45, landingPageViews: 30, initiateCheckout: 0 },
    ]

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
    // fetchLaunchOpsInitiateCheckoutByOperacaoDay is mocked to resolve [] by default, so the
    // merge step attaches initiateCheckout: 0 to every aggregated row before writing.
    expect(syncAdSpendForFunnel).toHaveBeenCalledWith(expect.anything(), 'funnel-1', [{ ...fullDayAggregated[0], initiateCheckout: 0 }])
  })

  it('keeps syncing the next clients when one client fails before its sync starts', async () => {
    listMock.mockReturnValue([
      { id: 'funnel-a', client_id: 'client-a', launchops_operacao_ids: null, launchops_produto_nomes: null, clients: { funnel_source_url: 'https://client-a.example.com' } },
      { id: 'funnel-b', client_id: 'client-b', launchops_operacao_ids: null, launchops_produto_nomes: null, clients: { funnel_source_url: 'https://client-b.example.com' } },
    ])
    secretsByClientId['client-b'] = 'key-b'
    vi.mocked(getClientSecrets).mockRejectedValueOnce(new Error('vault unavailable'))
    const request = new NextRequest('https://app.example.com/api/internal/sync-funnel', {
      headers: { authorization: 'Bearer test-secret' },
    })
    const body = await (await GET(request)).json()

    expect(body).toEqual({ ok: true, funnelsProcessed: 1, funnelsFailed: 1, clientsWithCampaigns: 1 })
    expect(syncCampaignsForClient).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'client-b')
  })

  it('builds a separate LaunchOps client per funnel using that funnel own client credential, never mixing them up', async () => {
    listMock.mockReturnValue([
      {
        id: 'funnel-a',
        client_id: 'client-a',
        launchops_operacao_ids: null,
        launchops_produto_nomes: null,
        clients: { funnel_source_url: 'https://client-a.example.com' },
      },
      {
        id: 'funnel-b',
        client_id: 'client-b',
        launchops_operacao_ids: null,
        launchops_produto_nomes: null,
        clients: { funnel_source_url: 'https://client-b.example.com' },
      },
    ])
    secretsByClientId['client-a'] = 'key-a'
    secretsByClientId['client-b'] = 'key-b'
    const request = new NextRequest('https://app.example.com/api/internal/sync-funnel', {
      headers: { authorization: 'Bearer test-secret' },
    })
    const response = await GET(request)
    const body = await response.json()

    expect(body).toEqual({ ok: true, funnelsProcessed: 2, funnelsFailed: 0, clientsWithCampaigns: 2 })
    // Campaigns are read once per client, with that client's own LaunchOps connection.
    expect(syncCampaignsForClient).toHaveBeenCalledTimes(2)
    expect(syncCampaignsForClient).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'client-a')
    expect(syncCampaignsForClient).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'client-b')
    expect(createLaunchOpsClient).toHaveBeenNthCalledWith(1, { url: 'https://client-a.example.com', serviceRoleKey: 'key-a' })
    expect(createLaunchOpsClient).toHaveBeenNthCalledWith(2, { url: 'https://client-b.example.com', serviceRoleKey: 'key-b' })
  })
})
