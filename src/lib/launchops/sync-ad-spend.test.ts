import { describe, it, expect, vi } from 'vitest'
import { aggregateAdSpendByOperacaoDay, fetchAllPages, type LaunchOpsAdSpendRow } from './sync-ad-spend'

describe('aggregateAdSpendByOperacaoDay', () => {
  it('sums spend across multiple campaigns/adsets for the same operation and day', () => {
    const rows: LaunchOpsAdSpendRow[] = [
      { operacao_id: 'op-1', data_referencia: '2026-09-01', spend: 100, impressions: 1000, clicks: 10, leads_periodo: 2, reach: 800, link_clicks: 60, landing_page_views: 40, updated_at: '2026-09-01T10:00:00Z' },
      { operacao_id: 'op-1', data_referencia: '2026-09-01', spend: 50, impressions: 500, clicks: 5, leads_periodo: 1, reach: 400, link_clicks: 30, landing_page_views: 20, updated_at: '2026-09-01T11:00:00Z' },
      { operacao_id: 'op-1', data_referencia: '2026-09-02', spend: 30, impressions: 300, clicks: 3, leads_periodo: 0, reach: 250, link_clicks: 15, landing_page_views: 10, updated_at: '2026-09-02T09:00:00Z' },
    ]
    const result = aggregateAdSpendByOperacaoDay(rows)
    expect(result).toEqual(
      expect.arrayContaining([
        { operacao_id: 'op-1', data: '2026-09-01', spend: 150, impressions: 1500, clicks: 15, leads: 3, reach: 1200, linkClicks: 90, landingPageViews: 60, initiateCheckout: 0 },
        { operacao_id: 'op-1', data: '2026-09-02', spend: 30, impressions: 300, clicks: 3, leads: 0, reach: 250, linkClicks: 15, landingPageViews: 10, initiateCheckout: 0 },
      ])
    )
    expect(result.length).toBe(2)
  })

  it('keeps two different operations on the same day as separate rows', () => {
    const rows: LaunchOpsAdSpendRow[] = [
      { operacao_id: 'op-1', data_referencia: '2026-09-01', spend: 100, impressions: 1000, clicks: 10, leads_periodo: 2, reach: 800, link_clicks: 60, landing_page_views: 40, updated_at: '2026-09-01T10:00:00Z' },
      { operacao_id: 'op-2', data_referencia: '2026-09-01', spend: 40, impressions: 400, clicks: 4, leads_periodo: 1, reach: 350, link_clicks: 20, landing_page_views: 15, updated_at: '2026-09-01T10:00:00Z' },
    ]
    expect(aggregateAdSpendByOperacaoDay(rows).length).toBe(2)
  })
})

describe('fetchAllPages', () => {
  it('stops after a page shorter than pageSize, concatenating every page fetched', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: [1, 2], error: null })
      .mockResolvedValueOnce({ data: [3], error: null })
    const rows = await fetchAllPages(fetchPage, 2)
    expect(rows).toEqual([1, 2, 3])
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(fetchPage).toHaveBeenNthCalledWith(1, 0, 1)
    expect(fetchPage).toHaveBeenNthCalledWith(2, 2, 3)
  })

  it('keeps fetching while every page comes back exactly full — this is the regression test for the truncation bug', async () => {
    const fullPage = Array.from({ length: 3 }, (_, i) => i)
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: fullPage, error: null })
      .mockResolvedValueOnce({ data: fullPage, error: null })
      .mockResolvedValueOnce({ data: [0], error: null })
    const rows = await fetchAllPages(fetchPage, 3)
    expect(rows.length).toBe(7)
    expect(fetchPage).toHaveBeenCalledTimes(3)
  })

  it('throws if a page still reports an error after one retry', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ data: null, error: new Error('boom') })
    await expect(fetchAllPages(fetchPage, 10, 0)).rejects.toThrow('boom')
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('retries a failed page once and keeps going when the retry works', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: new Error('timeout') })
      .mockResolvedValueOnce({ data: [1, 2], error: null })
    await expect(fetchAllPages(fetchPage, 10, 0)).resolves.toEqual([1, 2])
    expect(fetchPage).toHaveBeenNthCalledWith(2, 0, 9)
  })
})
