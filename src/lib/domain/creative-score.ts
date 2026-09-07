export interface CreativeMetrics {
  adName: string
  spendCents: number
  revenueCents: number
  conversions: number
  visitors: number
}

export interface CreativeScore {
  adName: string
  /** Observed, not shrunk -- these sit next to the "Por anúncio" table and must match it. */
  roas: number | null
  conversionRate: number | null
  cpaCents: number | null
  /** Ranking uses shrunk estimates, so a lucky handful of visits can't top the list. */
  score: number | null
  hasThinData: boolean
}

// Rascunho — critério em definição (mesmo aviso do mockup "Forka Redesign"). Pesos
// provisórios, ajustar com o Vitor antes de tratar o score como definitivo.
const WEIGHTS = { roas: 0.4, conversionRate: 0.4, cpaInverted: 0.2 }

// Empirical-Bayes shrinkage: each creative's rate is pulled toward the test's pooled rate,
// weighted by how much traffic it actually has. Ranking raw rates hands the top spot to
// whichever creative got lucky on a handful of visits -- the winner's curse. A creative with
// PRIOR_VISITORS visits counts half its own rate and half the pooled one; at 10x that, its own
// rate dominates.
const PRIOR_VISITORS = 50

function shrink(own: number, pooled: number, visitors: number): number {
  const weight = visitors / (visitors + PRIOR_VISITORS)
  return weight * own + (1 - weight) * pooled
}

function normalize(values: (number | null)[]): (number | null)[] {
  const present = values.filter((v): v is number => v !== null)
  if (present.length === 0) return values.map(() => null)
  const min = Math.min(...present)
  const max = Math.max(...present)
  if (max === min) return values.map((v) => (v === null ? null : 1))
  return values.map((v) => (v === null ? null : (v - min) / (max - min)))
}

export function scoreCreatives(creatives: CreativeMetrics[]): CreativeScore[] {
  const totals = creatives.reduce(
    (acc, c) => ({
      visitors: acc.visitors + c.visitors,
      conversions: acc.conversions + c.conversions,
      revenueCents: acc.revenueCents + c.revenueCents,
    }),
    { visitors: 0, conversions: 0, revenueCents: 0 }
  )
  const pooledRate = totals.visitors > 0 ? totals.conversions / totals.visitors : 0
  const pooledRpv = totals.visitors > 0 ? totals.revenueCents / totals.visitors : 0

  // Rates get shrunk; spend and visits are counted rather than estimated, so ROAS and CPA are
  // derived from the shrunk rates instead of being shrunk on their own.
  const shrunkRate = creatives.map((c) =>
    c.visitors > 0 ? shrink(c.conversions / c.visitors, pooledRate, c.visitors) : pooledRate
  )
  const shrunkRpv = creatives.map((c) =>
    c.visitors > 0 ? shrink(c.revenueCents / c.visitors, pooledRpv, c.visitors) : pooledRpv
  )

  const rankRoas = creatives.map((c, i) =>
    c.spendCents > 0 && c.visitors > 0 ? (shrunkRpv[i] * c.visitors) / c.spendCents : null
  )
  // No visits at all means no evidence to rank on -- not "average performance".
  const rankRate = creatives.map((c, i) => (c.visitors > 0 ? shrunkRate[i] : null))
  const rankCpaInverted = creatives.map((c, i) => {
    if (c.spendCents <= 0 || c.visitors === 0 || shrunkRate[i] <= 0) return null
    const cpa = c.spendCents / c.visitors / shrunkRate[i]
    // Lower CPA is better -- invert before normalizing, or the cheapest would score near zero.
    return cpa > 0 ? 1 / cpa : null
  })

  const normRoas = normalize(rankRoas)
  const normRate = normalize(rankRate)
  const normCpa = normalize(rankCpaInverted)

  return creatives.map((creative, i) => {
    const parts: { weight: number; value: number }[] = []
    if (normRoas[i] !== null) parts.push({ weight: WEIGHTS.roas, value: normRoas[i]! })
    if (normRate[i] !== null) parts.push({ weight: WEIGHTS.conversionRate, value: normRate[i]! })
    if (normCpa[i] !== null) parts.push({ weight: WEIGHTS.cpaInverted, value: normCpa[i]! })

    const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0)
    const score =
      totalWeight > 0 ? Math.round((parts.reduce((sum, p) => sum + p.weight * p.value, 0) / totalWeight) * 100) : null

    return {
      adName: creative.adName,
      roas: creative.spendCents > 0 ? creative.revenueCents / creative.spendCents : null,
      conversionRate: creative.visitors > 0 ? creative.conversions / creative.visitors : null,
      cpaCents: creative.conversions > 0 ? creative.spendCents / creative.conversions : null,
      score,
      hasThinData: creative.visitors < PRIOR_VISITORS,
    }
  })
}
