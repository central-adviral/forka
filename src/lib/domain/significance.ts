function sampleGamma(shape: number, rand: () => number, normal: () => number): number {
  if (shape < 1) {
    const u = rand()
    return sampleGamma(shape + 1, rand, normal) * Math.pow(u, 1 / shape)
  }
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x: number
    let v: number
    do {
      x = normal()
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = rand()
    if (u < 1 - 0.0331 * x * x * x * x) return d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

function makeSeededNormal(rand: () => number): () => number {
  return () => {
    const u1 = Math.max(rand(), 1e-12)
    const u2 = rand()
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  }
}

function sampleBeta(alpha: number, beta: number, rand: () => number, normal: () => number): number {
  const x = sampleGamma(alpha, rand, normal)
  const y = sampleGamma(beta, rand, normal)
  return x / (x + y)
}

// mulberry32: a tiny deterministic generator, so a seed always yields the same draws.
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A seed from the four counts: the same data gives the same chance on every screen and every reload. */
function seedFromCounts(...counts: number[]): number {
  return counts.reduce((hash, n) => Math.imul(hash ^ Math.round(n), 0x9e3779b1) >>> 0, 0x811c9dc5)
}

export function probabilityToBeatControl(
  control: { visits: number; conversions: number },
  variant: { visits: number; conversions: number },
  rand?: () => number,
  samples = 10000
): number | null {
  if (control.visits === 0 || variant.visits === 0) return null
  rand ??= seededRandom(seedFromCounts(control.visits, control.conversions, variant.visits, variant.conversions))
  // Since 0050 one click can carry several conversions (upsell, renewal), so conversions can pass
  // visits. A Beta needs both shapes above zero; past that point the variant converted every visit.
  const controlConversions = Math.min(control.conversions, control.visits)
  const variantConversions = Math.min(variant.conversions, variant.visits)
  const normal = makeSeededNormal(rand)
  let wins = 0
  for (let i = 0; i < samples; i++) {
    const controlRate = sampleBeta(controlConversions + 1, control.visits - controlConversions + 1, rand, normal)
    const variantRate = sampleBeta(variantConversions + 1, variant.visits - variantConversions + 1, rand, normal)
    if (variantRate > controlRate) wins++
  }
  return wins / samples
}
