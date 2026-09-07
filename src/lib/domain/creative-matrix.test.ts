import { describe, it, expect } from 'vitest'
import { buildCreativeMatrix, METRIC_KEYS } from './creative-matrix'

const VARIANTS = ['v1', 'v2', 'v3']

describe('buildCreativeMatrix', () => {
  it('groups the report rows into one row per creative, keyed by variant', () => {
    const [row] = buildCreativeMatrix(
      [
        { adName: 'Oferta 12x', variantId: 'v1', clicks: 100, visitors: 90, conversions: 9, revenueCents: 447300 },
        { adName: 'Oferta 12x', variantId: 'v2', clicks: 120, visitors: 110, conversions: 22, revenueCents: 1093400 },
      ],
      VARIANTS
    )
    expect(row.adName).toBe('Oferta 12x')
    expect(row.byVariantId.v1.conversionRate).toBeCloseTo(10)
    expect(row.byVariantId.v2.conversionRate).toBeCloseTo(20)
  })

  it('derives totals from summed counters, never from averaging the per-page metrics', () => {
    // The average of 10% and 20% is 15%, but v2 carries 9x the traffic -- the honest
    // pooled rate is 19%. Averaging the columns is the bug this test exists to catch.
    const [row] = buildCreativeMatrix(
      [
        { adName: 'Oferta 12x', variantId: 'v1', clicks: 100, visitors: 100, conversions: 10, revenueCents: 497000 },
        { adName: 'Oferta 12x', variantId: 'v2', clicks: 900, visitors: 900, conversions: 180, revenueCents: 8946000 },
      ],
      VARIANTS
    )
    expect(row.totals.conversionRate).toBeCloseTo(19)
    expect(row.totals.revenueCents).toBe(9443000)
    expect(row.totals.revenuePerClick).toBeCloseTo(9443)
    expect(row.totals.revenuePerVisitor).toBeCloseTo(9443)
  })

  it('reports a metric as null instead of zero when its denominator is missing', () => {
    // A page that got no traffic has no rate. Rendering 0,0% would read as "converts
    // terribly" when the truth is "no data yet".
    const [row] = buildCreativeMatrix(
      [{ adName: 'Stories', variantId: 'v1', clicks: 0, visitors: 0, conversions: 0, revenueCents: 0 }],
      VARIANTS
    )
    expect(row.byVariantId.v1.conversionRate).toBeNull()
    expect(row.byVariantId.v1.revenuePerClick).toBeNull()
    expect(row.byVariantId.v1.revenuePerVisitor).toBeNull()
    expect(row.byVariantId.v1.revenueCents).toBe(0)
  })

  it('fills a cell for every variant, including pages the creative never reached', () => {
    const [row] = buildCreativeMatrix(
      [{ adName: 'Stories', variantId: 'v1', clicks: 10, visitors: 10, conversions: 1, revenueCents: 49700 }],
      VARIANTS
    )
    expect(Object.keys(row.byVariantId).sort()).toEqual(['v1', 'v2', 'v3'])
    expect(row.byVariantId.v3.conversionRate).toBeNull()
  })

  it('picks a winner per metric, and lets them disagree', () => {
    // v1 converts better; v2 sells a lot more in absolute terms. Both facts are true and
    // the panel has to be able to say so instead of crowning one page.
    const [row] = buildCreativeMatrix(
      [
        { adName: 'Oferta 12x', variantId: 'v1', clicks: 100, visitors: 100, conversions: 30, revenueCents: 1491000 },
        { adName: 'Oferta 12x', variantId: 'v2', clicks: 900, visitors: 900, conversions: 180, revenueCents: 8946000 },
      ],
      VARIANTS
    )
    expect(row.winners.conversionRate).toBe('v1')
    expect(row.winners.revenueCents).toBe('v2')
  })

  it('has no winner for a metric no page has data for', () => {
    const [row] = buildCreativeMatrix(
      [{ adName: 'Stories', variantId: 'v1', clicks: 0, visitors: 0, conversions: 0, revenueCents: 0 }],
      VARIANTS
    )
    expect(row.winners.conversionRate).toBeNull()
    expect(row.winners.revenuePerClick).toBeNull()
  })

  it('breaks a tie by variant order so the highlight never jumps between renders', () => {
    const [row] = buildCreativeMatrix(
      [
        { adName: 'Oferta 12x', variantId: 'v2', clicks: 100, visitors: 100, conversions: 10, revenueCents: 497000 },
        { adName: 'Oferta 12x', variantId: 'v1', clicks: 100, visitors: 100, conversions: 10, revenueCents: 497000 },
      ],
      VARIANTS
    )
    for (const key of METRIC_KEYS) expect(row.winners[key]).toBe('v1')
  })

  it('returns nothing when there are no rows to chart', () => {
    expect(buildCreativeMatrix([], VARIANTS)).toEqual([])
  })
})
