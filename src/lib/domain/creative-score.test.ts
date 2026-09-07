import { describe, it, expect } from 'vitest'
import { scoreCreatives } from './creative-score'

describe('scoreCreatives', () => {
  it('does not let a lucky handful of visits outrank a proven creative', () => {
    // 1 sale in 4 visits is a 25% rate and a 26x ROAS on raw numbers -- above the proven
    // creative on every metric, purely by chance. Ranking raw rates would put it first.
    const [proven, lucky] = scoreCreatives([
      { adName: 'Consistente', spendCents: 400000, revenueCents: 2485000, conversions: 50, visitors: 1500 },
      { adName: 'Sortudo', spendCents: 1900, revenueCents: 49700, conversions: 1, visitors: 4 },
    ])
    expect(proven.score!).toBeGreaterThan(lucky.score!)
    expect(lucky.hasThinData).toBe(true)
    expect(proven.hasThinData).toBe(false)
  })

  it('still ranks the better creative first when both have solid traffic', () => {
    const [best, worst] = scoreCreatives([
      { adName: 'Oferta 12x', spendCents: 187000, revenueCents: 1889000, conversions: 38, visitors: 800 },
      { adName: 'VSL 3min', spendCents: 324000, revenueCents: 1691000, conversions: 34, visitors: 1360 },
    ])
    expect(best.score!).toBeGreaterThan(worst.score!)
  })

  it('reports the observed metrics, not the shrunk ones, so the panel matches the table', () => {
    const [row] = scoreCreatives([
      { adName: 'Oferta 12x', spendCents: 100000, revenueCents: 500000, conversions: 10, visitors: 200 },
    ])
    expect(row.roas).toBeCloseTo(5)
    expect(row.conversionRate).toBeCloseTo(0.05)
    expect(row.cpaCents).toBeCloseTo(10000)
  })

  it('handles zero spend without crashing (roas null, still scores on conversion rate)', () => {
    const [row] = scoreCreatives([
      { adName: 'Orgânico', spendCents: 0, revenueCents: 0, conversions: 5, visitors: 100 },
    ])
    expect(row.roas).toBeNull()
    expect(row.score).not.toBeNull()
  })

  it('returns null score when there is no usable data at all', () => {
    const [row] = scoreCreatives([{ adName: 'Sem dado', spendCents: 0, revenueCents: 0, conversions: 0, visitors: 0 }])
    expect(row.score).toBeNull()
  })

  it('returns an empty array for no creatives', () => {
    expect(scoreCreatives([])).toEqual([])
  })

  it('scores a single creative as 100 (best of one)', () => {
    const [row] = scoreCreatives([
      { adName: 'Único', spendCents: 100000, revenueCents: 300000, conversions: 8, visitors: 150 },
    ])
    expect(row.score).toBe(100)
  })
})
