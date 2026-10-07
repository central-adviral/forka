// "Padrões ao longo dos dias": which media rate moves with the cost, read off the closed days of a
// period. Plain arithmetic on the daily view, no model: the point is to say where to look first.

export type PatternMetric = 'cpm' | 'ctr' | 'connectRate' | 'pvToIc' | 'conv'

export interface PatternDay {
  data: string
  spend: number
  /** The period's main cost (CPA, CPL or CPM); null when the day has none. */
  cost: number | null
  metrics: Record<PatternMetric, number | null>
}

export const PATTERN_METRICS: Record<PatternMetric, { label: string; better: 'lower' | 'higher'; fix: string }> = {
  cpm: { label: 'CPM', better: 'lower', fix: 'Leilão mais caro: abrir público, trocar criativos cansados ou rever o posicionamento.' },
  ctr: { label: 'CTR', better: 'higher', fix: 'Menos clique no anúncio: testar ganchos novos nos primeiros segundos e outra chamada.' },
  connectRate: { label: 'Connect rate', better: 'higher', fix: 'Clique que não vira visita: conferir velocidade da página, redirecionamentos e link do anúncio.' },
  pvToIc: { label: 'Página → checkout', better: 'higher', fix: 'Visita que não vai ao checkout: revisar promessa da dobra, prova e botão da página.' },
  conv: { label: 'Conversão da página', better: 'higher', fix: 'Checkout que não fecha: rever preço exibido, order bump e meios de pagamento.' },
}

const KEYS = Object.keys(PATTERN_METRICS) as PatternMetric[]

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length < 3) return null
  const mx = mean(xs)
  const my = mean(ys)
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    dx += (xs[i] - mx) ** 2
    dy += (ys[i] - my) ** 2
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : null
}

/** A change is "worse" when it moves the metric in the direction that hurts the cost. */
const worse = (metric: PatternMetric, changePct: number) => (PATTERN_METRICS[metric].better === 'lower' ? changePct > 0 : changePct < 0)

export interface PatternReport {
  days: number
  best: PatternDay & { cost: number }
  worst: PatternDay & { cost: number }
  medianCost: number
  /** Good days (cost at or under the median) against bad ones, per metric. */
  goodVsBad: { metric: PatternMetric; good: number; bad: number; changePct: number; worse: boolean }[]
  /** The metric that most separates bad days from good ones, in the direction that hurts. */
  separator: PatternMetric | null
  correlation: { metric: PatternMetric; r: number }[]
  /** Per day: the cost against the median and the metrics that moved ≥ 10% against their own median. */
  drivers: { data: string; spend: number; cost: number; vsMedianPct: number; moved: { metric: PatternMetric; changePct: number; worse: boolean }[] }[]
  suggestions: { metric: PatternMetric; changePct: number; text: string }[]
}

export const MIN_PATTERN_DAYS = 4

export function analyzePatterns(days: PatternDay[], minSpend = 0): PatternReport | null {
  const valid = days.filter((day): day is PatternDay & { cost: number } => day.cost !== null && day.spend >= minSpend)
  if (valid.length < MIN_PATTERN_DAYS) return null

  const byCost = [...valid].sort((a, b) => a.cost - b.cost)
  const medianCost = median(valid.map((day) => day.cost))
  const good = valid.filter((day) => day.cost <= medianCost)
  const bad = valid.filter((day) => day.cost > medianCost)

  const goodVsBad = KEYS.flatMap((metric) => {
    const g = good.map((day) => day.metrics[metric]).filter((value): value is number => value !== null)
    const b = bad.map((day) => day.metrics[metric]).filter((value): value is number => value !== null)
    if (g.length === 0 || b.length === 0 || mean(g) === 0) return []
    const changePct = (mean(b) / mean(g) - 1) * 100
    return [{ metric, good: mean(g), bad: mean(b), changePct, worse: worse(metric, changePct) }]
  })
  const hurting = goodVsBad.filter((row) => row.worse).sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))

  const correlation = KEYS.flatMap((metric) => {
    const pairs = valid.filter((day) => day.metrics[metric] !== null)
    const r = pearson(
      pairs.map((day) => day.metrics[metric] as number),
      pairs.map((day) => day.cost)
    )
    return r === null ? [] : [{ metric, r }]
  }).sort((a, b) => Math.abs(b.r) - Math.abs(a.r))

  const medianOf = Object.fromEntries(
    KEYS.map((metric) => {
      const values = valid.map((day) => day.metrics[metric]).filter((value): value is number => value !== null)
      return [metric, values.length > 0 ? median(values) : null]
    })
  ) as Record<PatternMetric, number | null>
  const drivers = valid.map((day) => ({
    data: day.data,
    spend: day.spend,
    cost: day.cost,
    vsMedianPct: (day.cost / medianCost - 1) * 100,
    moved: KEYS.flatMap((metric) => {
      const value = day.metrics[metric]
      const base = medianOf[metric]
      if (value === null || base === null || base === 0) return []
      const changePct = (value / base - 1) * 100
      return Math.abs(changePct) >= 10 ? [{ metric, changePct, worse: worse(metric, changePct) }] : []
    }).sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)),
  }))

  return {
    days: valid.length,
    best: byCost[0],
    worst: byCost[byCost.length - 1],
    medianCost,
    goodVsBad,
    separator: hurting[0]?.metric ?? null,
    correlation,
    drivers,
    suggestions: hurting
      .filter((row) => Math.abs(row.changePct) >= 10)
      .slice(0, 3)
      .map((row) => ({ metric: row.metric, changePct: row.changePct, text: PATTERN_METRICS[row.metric].fix })),
  }
}
