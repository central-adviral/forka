import { describe, it, expect } from 'vitest'
import { aggregateAdSpendByOperacaoDay, type LaunchOpsAdSpendRow } from './sync-ad-spend'

describe('aggregateAdSpendByOperacaoDay', () => {
  it('sums spend across multiple campaigns/adsets for the same operation and day', () => {
    const rows: LaunchOpsAdSpendRow[] = [
      { operacao_id: 'op-1', data_referencia: '2026-09-01', spend: 100, impressions: 1000, clicks: 10, leads_periodo: 2, updated_at: '2026-09-01T10:00:00Z' },
      { operacao_id: 'op-1', data_referencia: '2026-09-01', spend: 50, impressions: 500, clicks: 5, leads_periodo: 1, updated_at: '2026-09-01T11:00:00Z' },
      { operacao_id: 'op-1', data_referencia: '2026-09-02', spend: 30, impressions: 300, clicks: 3, leads_periodo: 0, updated_at: '2026-09-02T09:00:00Z' },
    ]
    const result = aggregateAdSpendByOperacaoDay(rows)
    expect(result).toEqual(
      expect.arrayContaining([
        { operacao_id: 'op-1', data: '2026-09-01', spend: 150, impressions: 1500, clicks: 15, leads: 3 },
        { operacao_id: 'op-1', data: '2026-09-02', spend: 30, impressions: 300, clicks: 3, leads: 0 },
      ])
    )
    expect(result.length).toBe(2)
  })

  it('keeps two different operations on the same day as separate rows', () => {
    const rows: LaunchOpsAdSpendRow[] = [
      { operacao_id: 'op-1', data_referencia: '2026-09-01', spend: 100, impressions: 1000, clicks: 10, leads_periodo: 2, updated_at: '2026-09-01T10:00:00Z' },
      { operacao_id: 'op-2', data_referencia: '2026-09-01', spend: 40, impressions: 400, clicks: 4, leads_periodo: 1, updated_at: '2026-09-01T10:00:00Z' },
    ]
    expect(aggregateAdSpendByOperacaoDay(rows).length).toBe(2)
  })
})
