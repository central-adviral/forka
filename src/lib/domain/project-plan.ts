// The project's plan (0071): what the project produces and what it costs at most to produce it.
// The result picks the cost metric every screen shows and every alert judges.

export type ProjectResult = 'compra' | 'lead'

export const PROJECT_RESULTS: Record<ProjectResult, { label: string; unit: string; perDay: string; cost: string; costMetric: 'cpa_geral' | 'cpl' }> = {
  compra: { label: 'Compra', unit: 'vendas de entrada', perDay: 'vendas por dia', cost: 'CPA', costMetric: 'cpa_geral' },
  lead: { label: 'Lead', unit: 'leads pagos', perDay: 'leads por dia', cost: 'CPL', costMetric: 'cpl' },
}

export function readResult(raw: unknown): ProjectResult {
  return raw === 'lead' ? 'lead' : 'compra'
}

/** Median daily cost per result over the days that had results: the starting point for a target. */
export function suggestedCost(days: { spend: number; results: number }[]): number | null {
  const costs = days.filter((day) => day.results > 0 && day.spend > 0).map((day) => day.spend / day.results).sort((a, b) => a - b)
  if (costs.length === 0) return null
  const middle = Math.floor(costs.length / 2)
  const median = costs.length % 2 ? costs[middle] : (costs[middle - 1] + costs[middle]) / 2
  return Math.round(median * 100) / 100
}

/** Median results per day over the days with spend, rounded: the starting point for the daily volume. */
export function suggestedVolume(days: { spend: number; results: number }[]): number | null {
  const volumes = days.filter((day) => day.spend > 0).map((day) => day.results).sort((a, b) => a - b)
  if (volumes.length === 0) return null
  const middle = Math.floor(volumes.length / 2)
  return Math.round(volumes.length % 2 ? volumes[middle] : (volumes[middle - 1] + volumes[middle]) / 2)
}
