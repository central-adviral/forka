// The project's plan (0071, 0094): what the project produces and what it costs at most to produce it.
// The objective picks the metric every screen shows and every alert judges.

export type ProjectResult = 'compra' | 'lead' | 'roas' | 'checkout' | 'visita' | 'alcance'

export interface ResultInfo {
  label: string
  unit: string
  perDay: string
  /** The metric's short name: CPA, CPL, ROAS, CPM... */
  cost: string
  costMetric: 'cpa_geral' | 'cpl' | 'roas' | 'custo_checkout' | 'custo_visita' | 'cpm'
  /** Compra and ROAS count sales; the others come from the campaigns. */
  sales: boolean
  /** ROAS is a return: higher is better, and the target is a minimum. */
  higherIsBetter: boolean
  description: string
}

export const PROJECT_RESULTS: Record<ProjectResult, ResultInfo> = {
  compra: { label: 'Compra', unit: 'vendas de entrada', perDay: 'vendas por dia', cost: 'CPA', costMetric: 'cpa_geral', sales: true, higherIsBetter: false, description: 'Custo por venda de entrada. Mostra ROAS junto.' },
  lead: { label: 'Lead', unit: 'leads pagos', perDay: 'leads por dia', cost: 'CPL', costMetric: 'cpl', sales: false, higherIsBetter: false, description: 'Custo por lead. Produto é opcional.' },
  roas: { label: 'Receita (ROAS)', unit: 'de receita líquida', perDay: 'vendas por dia', cost: 'ROAS', costMetric: 'roas', sales: true, higherIsBetter: true, description: 'Receita por real gasto. Perpétuo, alto valor, otimização por valor.' },
  checkout: { label: 'Checkout iniciado', unit: 'checkouts iniciados', perDay: 'checkouts por dia', cost: 'custo por checkout', costMetric: 'custo_checkout', sales: false, higherIsBetter: false, description: 'Oferta nova, antes de ter volume de venda.' },
  visita: { label: 'Visita na página', unit: 'visitas na página', perDay: 'visitas por dia', cost: 'custo por visita', costMetric: 'custo_visita', sales: false, higherIsBetter: false, description: 'Tráfego para conteúdo ou captura fria.' },
  alcance: { label: 'Alcance', unit: 'mil impressões', perDay: 'mil impressões por dia', cost: 'CPM', costMetric: 'cpm', sales: false, higherIsBetter: false, description: 'Distribuir conteúdo antes do lançamento.' },
}

export function readResult(raw: unknown): ProjectResult {
  return typeof raw === 'string' && raw in PROJECT_RESULTS ? (raw as ProjectResult) : 'compra'
}

/** Whether the project's objective is read from sales (compra, ROAS) rather than from the campaigns. */
export function resultUsesSales(raw: unknown): boolean {
  return PROJECT_RESULTS[readResult(raw)].sales
}

/**
 * Median daily cost per result over the days that had results: the starting point for a target.
 * For a return (ROAS) it is the median of results per real spent.
 */
export function suggestedCost(days: { spend: number; results: number }[], higherIsBetter = false): number | null {
  const costs = days
    .filter((day) => day.results > 0 && day.spend > 0)
    .map((day) => (higherIsBetter ? day.results / day.spend : day.spend / day.results))
    .sort((a, b) => a - b)
  if (costs.length === 0) return null
  const middle = Math.floor(costs.length / 2)
  const median = costs.length % 2 ? costs[middle] : (costs[middle - 1] + costs[middle]) / 2
  return Math.round(median * 100) / 100
}

/** What a period produced, enough to price any objective: spend with tax and the counts it bought. */
export interface ResultInputs {
  spend: number
  vendas: number
  receita: number
  leads: number
  checkouts: number
  visitas: number
  impressions: number
}

/** The objective's metric over a period (CPA, CPL, ROAS...), null when nothing was produced. */
export function resultValue(result: ProjectResult, inputs: ResultInputs): number | null {
  const per = (count: number) => (count > 0 ? inputs.spend / count : null)
  switch (result) {
    case 'compra':
      return per(inputs.vendas)
    case 'lead':
      return per(inputs.leads)
    case 'roas':
      return inputs.spend > 0 ? inputs.receita / inputs.spend : null
    case 'checkout':
      return per(inputs.checkouts)
    case 'visita':
      return per(inputs.visitas)
    case 'alcance':
      return inputs.impressions > 0 ? (inputs.spend / inputs.impressions) * 1000 : null
  }
}

/** Whether the value meets the target, in the metric's good direction; null with no value or no target. */
export function meetsTarget(result: ProjectResult, value: number | null, target: number | null): boolean | null {
  if (value === null || !target) return null
  return PROJECT_RESULTS[result].higherIsBetter ? value >= target : value <= target
}

export function formatResult(result: ProjectResult, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return PROJECT_RESULTS[result].higherIsBetter
    ? `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`
    : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Median results per day over the days with spend, rounded: the starting point for the daily volume. */
export function suggestedVolume(days: { spend: number; results: number }[]): number | null {
  const volumes = days.filter((day) => day.spend > 0).map((day) => day.results).sort((a, b) => a - b)
  if (volumes.length === 0) return null
  const middle = Math.floor(volumes.length / 2)
  return Math.round(volumes.length % 2 ? volumes[middle] : (volumes[middle - 1] + volumes[middle]) / 2)
}
