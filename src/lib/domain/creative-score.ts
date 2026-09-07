export interface CreativeMetrics {
  adName: string
  spendCents: number
  revenueCents: number
  conversions: number
  visitors: number
}

export interface CreativeScore {
  adName: string
  roas: number | null
  conversionRate: number | null
  cpaCents: number | null
  score: number | null
}

// Rascunho — critério em definição (mesmo aviso do mockup "Forka Redesign"). Pesos
// provisórios, ajustar com o Vitor antes de tratar o score como definitivo.
const WEIGHTS = { roas: 0.4, conversionRate: 0.4, cpaInverted: 0.2 }

function normalize(values: (number | null)[]): (number | null)[] {
  const present = values.filter((v): v is number => v !== null)
  if (present.length === 0) return values.map(() => null)
  const min = Math.min(...present)
  const max = Math.max(...present)
  if (max === min) return values.map((v) => (v === null ? null : 1))
  return values.map((v) => (v === null ? null : (v - min) / (max - min)))
}

export function scoreCreatives(creatives: CreativeMetrics[]): CreativeScore[] {
  const roasValues = creatives.map((c) => (c.spendCents > 0 ? c.revenueCents / c.spendCents : null))
  const rateValues = creatives.map((c) => (c.visitors > 0 ? c.conversions / c.visitors : null))
  const cpaValues = creatives.map((c) => (c.conversions > 0 ? c.spendCents / c.conversions : null))
  // CPA menor é melhor — inverte antes de normalizar, senão o menor CPA normalizaria pra perto de 0.
  const cpaInvertedValues = cpaValues.map((v) => (v === null || v === 0 ? null : 1 / v))

  const normRoas = normalize(roasValues)
  const normRate = normalize(rateValues)
  const normCpa = normalize(cpaInvertedValues)

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
      roas: roasValues[i],
      conversionRate: rateValues[i],
      cpaCents: cpaValues[i],
      score,
    }
  })
}
