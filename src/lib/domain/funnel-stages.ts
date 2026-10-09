import type { ProjectResult } from './project-plan'
import type { ProductRole } from './product-roles'

// Etapas no funil (0105): Funil -> Etapa -> Frente. A stage's measure is fixed and says what it
// produces and what its cost is; the stage's spend is only the spend of its fronts' campaigns.

export type StageMeasure = 'alcance' | 'lead' | 'visita' | 'compra' | 'ascensao'

export const STAGE_MEASURES: StageMeasure[] = ['alcance', 'lead', 'visita', 'compra', 'ascensao']

export interface MeasureInfo {
  label: string
  /** The stage's cost metric: CPM, CPL, CPA... */
  cost: string
  /** 'max': the meta is a ceiling (a cost); 'min': a floor (the ascension rate). */
  direction: 'max' | 'min'
  /** What one unit of the result is, in the plural. */
  result: string
  format: 'money' | 'pct'
}

export const MEASURES: Record<StageMeasure, MeasureInfo> = {
  alcance: { label: 'Alcance', cost: 'CPM', direction: 'max', result: 'mil impressões', format: 'money' },
  lead: { label: 'Lead', cost: 'CPL', direction: 'max', result: 'leads', format: 'money' },
  visita: { label: 'Visita', cost: 'custo por visita', direction: 'max', result: 'visitas na página', format: 'money' },
  compra: { label: 'Compra', cost: 'CPA', direction: 'max', result: 'vendas de entrada', format: 'money' },
  ascensao: { label: 'Ascensão', cost: 'taxa de ascensão', direction: 'min', result: 'vendas de ascensão', format: 'pct' },
}

export interface Stage {
  id: string
  salesFunnelId: string
  name: string
  /** The stage code every own front's campaign name must also contain (CAP, VND); null takes any. */
  tag: string | null
  measure: StageMeasure
  position: number
  /** Runs alongside the sequence (Reconhecimento) instead of being a step of it. */
  parallel: boolean
  janelaInicio: string | null
  janelaFim: string | null
  meta: number | null
  /** Compra only: the ROAS floor next to the CPA ceiling. */
  metaRoas: number | null
  archivedAt: string | null
  /** The funnel whose sales the stage also shows (0108); null for a stage with only its own. */
  mirror: StageMirror | null
}

/**
 * "Espelhar vendas de outro funil" (0108): the stage shows the source funnel's sales of these roles
 * (and products, when listed) inside its window, without taking them from the source.
 */
export interface StageMirror {
  funnelId: string
  funnelName: string
  papeis: ProductRole[]
  /** Null takes every product of the roles. */
  products: string[] | null
}

/** The measures whose stage can mirror sales (0108): the sales are its leads, entry sales or ascensions. */
export const MIRROR_MEASURES: StageMeasure[] = ['lead', 'compra', 'ascensao']

export interface StagePreset {
  name: string
  tag: string | null
  measure: StageMeasure
  parallel: boolean
  position: number
}

export interface CostCombo {
  id: string
  salesFunnelId: string
  name: string
  stageIds: string[]
  /** 'receita': the spend over the project's revenue (ROAS); 'stage': over one stage's result. */
  over: 'receita' | 'stage'
  overStageId: string | null
  enabled: boolean
  meta: number | null
  position: number
}

/** The ready stages a client starts from when it has none of its own (client_stage_presets). */
export const DEFAULT_STAGE_PRESETS: StagePreset[] = [
  { name: 'Reconhecimento', tag: 'REC', measure: 'alcance', parallel: true, position: 0 },
  { name: 'Captação', tag: 'CAP', measure: 'lead', parallel: false, position: 1 },
  { name: 'Lembrete do evento', tag: 'LEMB', measure: 'alcance', parallel: false, position: 2 },
  { name: 'Aquecimento', tag: 'AQC', measure: 'visita', parallel: false, position: 3 },
  { name: 'Vendas', tag: 'VND', measure: 'compra', parallel: false, position: 4 },
  { name: 'Remarketing de carrinho', tag: 'RCAR', measure: 'compra', parallel: false, position: 5 },
  { name: 'Ascensão', tag: 'ASC', measure: 'ascensao', parallel: false, position: 6 },
]

/** The name the backfill (and the wizard, for a project with no front) gives a stage of each measure. */
export const STAGE_NAME: Record<StageMeasure, string> = { alcance: 'Reconhecimento', lead: 'Captação', visita: 'Aquecimento', compra: 'Vendas', ascensao: 'Ascensão' }

/** The stage a front or project metric lives in, as the backfill and the wizard group them. */
export function measureOfMetric(metric: ProjectResult): Exclude<StageMeasure, 'ascensao'> {
  if (metric === 'compra' || metric === 'roas' || metric === 'checkout') return 'compra'
  return metric
}

/**
 * The funnel's result stage (0107): its last open stage of the sequence, parallel stages and ascensão
 * left out. Stages come in position order, as getFunnelStages reads them.
 */
export function funnelResultStage<T extends Pick<Stage, 'measure' | 'parallel' | 'archivedAt'>>(stages: T[]): T | undefined {
  return stages.filter((stage) => !stage.parallel && !stage.archivedAt && stage.measure !== 'ascensao').at(-1)
}

/** The funnel's resultado for its result stage's measure, as private.derived_resultado: ROAS and checkout live in the compra stage. */
export function derivedResultado(current: ProjectResult, measure: StageMeasure | null | undefined): ProjectResult {
  if (!measure || measure === 'ascensao') return current
  if (measure === 'compra' && (current === 'compra' || current === 'roas' || current === 'checkout')) return current
  return measure
}

/**
 * The stage that counts a product's sales (0105): entrada, order bump and upsell in the compra stage,
 * ascensão in the ascensao stage; with two, the first open one by position (as the sales are placed).
 */
export function stageOfProductRole<T extends Pick<Stage, 'measure' | 'position' | 'archivedAt'>>(role: string, stages: T[]): T | undefined {
  const measure: StageMeasure = role === 'ascensao' ? 'ascensao' : 'compra'
  return stages.filter((stage) => stage.measure === measure && !stage.archivedAt).sort((a, b) => a.position - b.position)[0]
}

/** A stage's totals over a period, as get_funnel_stage_daily gives them per day. */
export interface StageTotals {
  spendComImposto: number
  impressions: number
  leads: number
  landingPageViews: number
  /** Entry sales in a compra stage, ascension sales in an ascensao stage. */
  vendas: number
  /** Net of the refunds of the period. */
  receitaLiquida: number
  /** How many of the vendas are another funnel's, mirrored (0108). */
  vendasEspelho: number
}

export const EMPTY_TOTALS: StageTotals = { spendComImposto: 0, impressions: 0, leads: 0, landingPageViews: 0, vendas: 0, receitaLiquida: 0, vendasEspelho: 0 }

export function sumTotals(rows: StageTotals[]): StageTotals {
  return rows.reduce(
    (sum, row) => ({
      spendComImposto: sum.spendComImposto + row.spendComImposto,
      impressions: sum.impressions + row.impressions,
      leads: sum.leads + row.leads,
      landingPageViews: sum.landingPageViews + row.landingPageViews,
      vendas: sum.vendas + row.vendas,
      receitaLiquida: sum.receitaLiquida + row.receitaLiquida,
      vendasEspelho: sum.vendasEspelho + row.vendasEspelho,
    }),
    EMPTY_TOTALS
  )
}

/**
 * A lead stage that mirrors sales has the mirrored buyers as its leads (0108, as watcher_day): the
 * buyers of the source's entry product are the paid leads, so its CPL is the spend over them.
 */
export function withMirroredLeads(stage: Pick<Stage, 'measure' | 'mirror'>, totals: StageTotals): StageTotals {
  return stage.measure === 'lead' && stage.mirror ? { ...totals, leads: totals.vendas } : totals
}

/** The stage's result count in its measure's unit (thousands of impressions for alcance). */
export function stageResult(measure: StageMeasure, totals: StageTotals): number {
  switch (measure) {
    case 'alcance':
      return totals.impressions / 1000
    case 'lead':
      return totals.leads
    case 'visita':
      return totals.landingPageViews
    case 'compra':
    case 'ascensao':
      return totals.vendas
  }
}

const per = (spend: number, count: number) => (count > 0 ? spend / count : null)

/**
 * The stage's cost: CPM, CPL, cost per visit, CPA. Ascensão has no cost of its own: its number is
 * the rate of entry buyers who ascended, so it needs the project's entry sales.
 */
export function stageCost(measure: StageMeasure, totals: StageTotals, entrySales = 0): number | null {
  if (measure === 'ascensao') return ascensionRate(totals.vendas, entrySales)
  return per(totals.spendComImposto, stageResult(measure, totals))
}

export function stageRoas(totals: StageTotals): number | null {
  return totals.spendComImposto > 0 ? totals.receitaLiquida / totals.spendComImposto : null
}

export function ascensionRate(ascensionSales: number, entrySales: number): number | null {
  return entrySales > 0 ? ascensionSales / entrySales : null
}

/** Whether the value meets the stage meta in the measure's direction; null with no value or no meta. */
export function meetsMeta(measure: StageMeasure, value: number | null, meta: number | null): boolean | null {
  if (value === null || !meta) return null
  return MEASURES[measure].direction === 'max' ? value <= meta : value >= meta
}

/**
 * A cost combo: the spend of its stages over the project's revenue (a ROAS, higher is better) or
 * over the result of one stage (a cost). Stages missing from the totals add nothing.
 */
export function comboValue(
  combo: Pick<CostCombo, 'stageIds' | 'over' | 'overStageId'>,
  stages: Pick<Stage, 'id' | 'measure'>[],
  totals: Map<string, StageTotals>,
  revenue: number
): { kind: 'roas' | 'cost'; value: number | null } {
  const spend = combo.stageIds.reduce((sum, id) => sum + (totals.get(id)?.spendComImposto ?? 0), 0)
  if (combo.over === 'receita') return { kind: 'roas', value: spend > 0 ? revenue / spend : null }
  const over = stages.find((stage) => stage.id === combo.overStageId)
  if (!over) return { kind: 'cost', value: null }
  return { kind: 'cost', value: per(spend, stageResult(over.measure, totals.get(over.id) ?? EMPTY_TOTALS)) }
}
