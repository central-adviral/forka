import { describe, it, expect } from 'vitest'
import { buildTrafficDays } from './traffic-days'

const day = (data: string, spend: number, vendas: number | null) => ({
  data,
  spend,
  impressions: 10000,
  linkClicks: 200,
  landingPageViews: 150,
  initiateCheckout: 30,
  leads: 0,
  vendas,
})

describe('buildTrafficDays', () => {
  it('derives the media rates and the CPA of each day', () => {
    const { days } = buildTrafficDays([day('2026-10-05', 200, 8)])
    expect(days[0]).toMatchObject({ cpm: 20, ctr: 2, connectRate: 75, pvToIc: 20, cpa: 25, cpl: null })
  })

  it('takes the total rates from the summed counts, not from an average of the days', () => {
    const { total } = buildTrafficDays([day('2026-10-04', 100, 10), day('2026-10-05', 300, 10)])
    expect(total.spend).toBe(400)
    expect(total.vendas).toBe(20)
    expect(total.cpa).toBe(20)
  })

  it('has no CPA for a front, whose days carry no sales', () => {
    const { days, total } = buildTrafficDays([day('2026-10-05', 200, null)])
    expect(days[0].cpa).toBeNull()
    expect(total.vendas).toBeNull()
  })
})
