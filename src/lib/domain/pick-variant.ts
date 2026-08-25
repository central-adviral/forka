export interface WeightedVariant {
  id: string
  weightPct: number
}

export function pickVariant(variants: WeightedVariant[], rand: () => number = Math.random): string {
  if (variants.length === 0) {
    throw new Error('pickVariant requires at least one variant')
  }
  const totalWeight = variants.reduce((sum, v) => sum + v.weightPct, 0)
  const target = rand() * totalWeight
  let cumulative = 0
  for (const variant of variants) {
    cumulative += variant.weightPct
    if (target < cumulative) {
      return variant.id
    }
  }
  return variants[variants.length - 1].id
}
