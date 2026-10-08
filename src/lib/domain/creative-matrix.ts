import { probabilityToBeBest } from './significance'

/** One row of get_test_report_by_ad: a single creative on a single page/checkout. */
export interface CreativeVariantRow {
  adName: string
  variantId: string
  clicks: number
  visitors: number
  conversions: number
  revenueCents: number
}

export const METRIC_KEYS = ['conversionRate', 'revenueCents', 'revenuePerClick', 'revenuePerVisitor'] as const

export type MetricKey = (typeof METRIC_KEYS)[number]

export interface CreativeCellMetrics {
  /** Percentage points, over unique visitors -- the same denominator the score uses. */
  conversionRate: number | null
  revenueCents: number
  revenuePerClick: number | null
  revenuePerVisitor: number | null
}

export interface CreativeMatrixRow {
  adName: string
  byVariantId: Record<string, CreativeCellMetrics>
  totals: CreativeCellMetrics
  /** Variant leading each metric. They disagree often: the page that converts best is
      frequently not the one that bills most, and the panel has to be able to say so. */
  winners: Record<MetricKey, string | null>
  /** Chance, in %, that each page converts best for this creative; null for a page it never reached. */
  chanceBest: Record<string, number | null>
  /** Pages this creative sent too few people to for their number to mean anything yet. */
  thin: Record<string, boolean>
}

/** People a page needs from one creative before its conversion rate stops being mostly luck. */
export const THIN_CELL_VISITORS = 300

interface Counters {
  clicks: number
  visitors: number
  conversions: number
  revenueCents: number
}

const emptyCounters = (): Counters => ({ clicks: 0, visitors: 0, conversions: 0, revenueCents: 0 })

// A metric with no denominator is unknown, not zero -- rendering 0,0% for a page that got
// no traffic reads as "converts terribly" instead of "no data yet".
function derive(c: Counters): CreativeCellMetrics {
  return {
    conversionRate: c.visitors > 0 ? (c.conversions / c.visitors) * 100 : null,
    revenueCents: c.revenueCents,
    revenuePerClick: c.clicks > 0 ? c.revenueCents / c.clicks : null,
    revenuePerVisitor: c.visitors > 0 ? c.revenueCents / c.visitors : null,
  }
}

export function buildCreativeMatrix(
  rows: CreativeVariantRow[],
  variantIds: string[]
): CreativeMatrixRow[] {
  const byAdName = new Map<string, Map<string, Counters>>()

  for (const row of rows) {
    let perVariant = byAdName.get(row.adName)
    if (!perVariant) {
      perVariant = new Map(variantIds.map((id) => [id, emptyCounters()]))
      byAdName.set(row.adName, perVariant)
    }
    const cell = perVariant.get(row.variantId)
    if (!cell) continue // a row for a variant that no longer belongs to this test
    cell.clicks += row.clicks
    cell.visitors += row.visitors
    cell.conversions += row.conversions
    cell.revenueCents += row.revenueCents
  }

  return Array.from(byAdName.entries()).map(([adName, perVariant]) => {
    const byVariantId: Record<string, CreativeCellMetrics> = {}
    // Totals sum the raw counters and derive once. Averaging the columns would skew the
    // number whenever the pages carry different volumes, which rebalancing guarantees.
    const pooled = emptyCounters()

    for (const id of variantIds) {
      const counters = perVariant.get(id) ?? emptyCounters()
      byVariantId[id] = derive(counters)
      pooled.clicks += counters.clicks
      pooled.visitors += counters.visitors
      pooled.conversions += counters.conversions
      pooled.revenueCents += counters.revenueCents
    }

    const winners = {} as Record<MetricKey, string | null>
    for (const key of METRIC_KEYS) {
      let winner: string | null = null
      let best = -Infinity
      for (const id of variantIds) {
        const value = byVariantId[id][key]
        // Ties keep the first variant so the highlight never jumps between renders.
        if (value !== null && value > best) {
          best = value
          winner = id
        }
      }
      // Revenue is never null, so a creative with no sales at all would otherwise crown
      // whichever page came first on a field of zeros.
      winners[key] = best > 0 ? winner : null
    }

    // Per cell, the chance of being the best page for this creative: the matrix splits the traffic
    // into many small cells, and a 5% on 120 people reads as a winner when it is only luck.
    const best = probabilityToBeBest(variantIds.map((id) => {
      const counters = perVariant.get(id) ?? emptyCounters()
      return { visits: counters.visitors, conversions: counters.conversions }
    }))
    const chanceBest: Record<string, number | null> = {}
    const thin: Record<string, boolean> = {}
    variantIds.forEach((id, index) => {
      chanceBest[id] = best[index] === null ? null : Math.round(best[index]! * 100)
      thin[id] = (perVariant.get(id)?.visitors ?? 0) < THIN_CELL_VISITORS
    })

    return { adName, byVariantId, totals: derive(pooled), winners, chanceBest, thin }
  })
}
