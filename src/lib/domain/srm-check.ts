export interface SrmVariantSample {
  weightPct: number
  visits: number
}

// Chi-square critical values at p=0.001, indexed by degrees of freedom (variants.length - 1).
// p=0.001 (not the usual 0.05) is deliberate for SRM: with the traffic volumes this product
// sees, a looser threshold flags normal random variation as a false alarm constantly.
const CHI_SQUARE_CRITICAL_P001: Record<number, number> = {
  1: 10.828,
  2: 13.816,
  3: 16.266,
  4: 18.467,
  5: 20.515,
  6: 22.458,
  7: 24.322,
  8: 26.124,
  9: 27.877,
}

const MIN_TOTAL_VISITS = 100

export function detectSampleRatioMismatch(variants: SrmVariantSample[]): boolean | null {
  if (variants.length < 2) return null

  const totalVisits = variants.reduce((sum, v) => sum + v.visits, 0)
  if (totalVisits < MIN_TOTAL_VISITS) return null

  const degreesOfFreedom = variants.length - 1
  const criticalValue = CHI_SQUARE_CRITICAL_P001[degreesOfFreedom]
  if (criticalValue === undefined) return null

  const chiSquare = variants.reduce((sum, v) => {
    const expected = totalVisits * (v.weightPct / 100)
    if (expected <= 0) return sum
    return sum + (v.visits - expected) ** 2 / expected
  }, 0)

  return chiSquare > criticalValue
}
