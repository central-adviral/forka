import type { StageMeasure } from './funnel-stages'
import type { ProjectResult } from './project-plan'
import { measureOfMetric } from './funnel-stages'

// Metas que valem de cima para baixo (0106): Funil -> Etapa -> Frente -> vigias e testes. The numbers
// are typed by the gestor; each level follows the one above unless it has one of its own. The same
// rules run in SQL (private.watcher_inherited, private.test_teto): the evaluation and the test start
// read them there, the screens read them here.

export type TargetSource = 'especifica' | 'frente' | 'etapa'
export type TetoSource = 'especifica' | 'criterios' | 'etapa'
export type TetoMedida = 'cpa' | 'cpl' | 'roas' | 'cpm' | 'custo_visita'

export interface StageMetas {
  id: string
  measure: StageMeasure
  position: number
  archivedAt: string | null
  meta: number | null
  metaRoas: number | null
}

export interface FrontMetas {
  stageId: string
  metricaPrincipal: ProjectResult | null
  alvoPrincipal: number | null
  metricaSecundaria: ProjectResult | null
  alvoSecundaria: number | null
}

export interface Resolved<S> {
  value: number | null
  source: S | null
  /** The stage the value comes from, when it comes from a stage. */
  stageId: string | null
}

/** The stage measure a watcher metric is the cost of; ROAS is the compra stage's second meta. */
export function watcherCostMeasure(metric: string): StageMeasure | null {
  if (metric === 'cpa_geral' || metric === 'cpa_anuncio' || metric === 'roas') return 'compra'
  if (metric === 'cpl') return 'lead'
  if (metric === 'cpm') return 'alcance'
  if (metric === 'custo_visita') return 'visita'
  return null
}

/** The stage's meta in a watcher metric's terms, or null when the stage does not carry that cost. */
export function stageMetaFor(stage: StageMetas | undefined, metric: string): number | null {
  if (!stage || watcherCostMeasure(metric) !== stage.measure) return null
  return metric === 'roas' ? stage.metaRoas : stage.meta
}

/** Where a funnel's result of a measure lives: its first open stage of that measure (as sales are placed). */
export function resultStage<T extends StageMetas>(stages: T[], measure: StageMeasure | null): T | undefined {
  return [...stages]
    .filter((stage) => stage.measure === measure)
    .sort((a, b) => Number(a.archivedAt !== null) - Number(b.archivedAt !== null) || a.position - b.position)[0]
}

/** A front metric in watcher terms (CPA of a front is the ad CPA), as result_watcher_metric(_, true). */
export function frontWatcherMetric(metric: ProjectResult | null): string | null {
  if (!metric) return null
  return { compra: 'cpa_anuncio', lead: 'cpl', roas: 'roas', checkout: 'custo_checkout', visita: 'custo_visita', alcance: 'cpm' }[metric]
}

/** A front's meta for a metric: its own when it set one for that metric, else its stage's. */
export function effectiveFrontMeta(front: FrontMetas, stages: StageMetas[], metric: string): Resolved<'frente' | 'etapa'> {
  const own =
    metric === frontWatcherMetric(front.metricaPrincipal) ? front.alvoPrincipal : metric === frontWatcherMetric(front.metricaSecundaria) ? front.alvoSecundaria : null
  if (own !== null) return { value: own, source: 'frente', stageId: null }
  const value = stageMetaFor(stages.find((stage) => stage.id === front.stageId), metric)
  return { value, source: value === null ? null : 'etapa', stageId: front.stageId }
}

/** A front's principal meta as the canvas prints it: "específica" with its own number, else the stage's. */
export function frontPrincipalMeta(front: FrontMetas, stage: StageMetas): { value: number | null; source: 'especifica' | 'etapa' } {
  if (front.metricaPrincipal && front.alvoPrincipal !== null) return { value: front.alvoPrincipal, source: 'especifica' }
  return { value: stage.measure === 'compra' ? (stage.meta ?? stage.metaRoas) : stage.meta, source: 'etapa' }
}

export interface WatcherLevel {
  metric: string
  target: number | null
  frontId: string | null
  stageId: string | null
}

/** What a watcher judges against: its own target, else its front's, its stage's or the funnel result stage's meta. */
export function effectiveWatcherTarget(watcher: WatcherLevel, stages: StageMetas[], fronts: Map<string, FrontMetas>): Resolved<TargetSource> {
  if (watcher.target !== null) return { value: watcher.target, source: 'especifica', stageId: null }
  if (watcher.frontId) {
    const front = fronts.get(watcher.frontId)
    return front ? effectiveFrontMeta(front, stages, watcher.metric) : { value: null, source: null, stageId: null }
  }
  const stage = watcher.stageId ? stages.find((option) => option.id === watcher.stageId) : resultStage(stages, watcherCostMeasure(watcher.metric))
  const value = stageMetaFor(stage, watcher.metric)
  return { value, source: value === null ? null : 'etapa', stageId: value === null ? null : (stage?.id ?? null) }
}

export interface Band {
  warnPct: number
  critPct: number
}

/** The watcher's band, else the funnel's faixa padrão. */
export function effectiveBand(watcher: { warnPct: number | null; critPct: number | null }, funnel: Band): Band & { own: boolean } {
  if (watcher.warnPct !== null && watcher.critPct !== null) return { warnPct: watcher.warnPct, critPct: watcher.critPct, own: true }
  return { ...funnel, own: false }
}

// Tests -------------------------------------------------------------------------------------------

export const TETO_MEDIDA: Record<TetoMedida, { cost: string; results: string; unit: 'brl' | 'x' }> = {
  cpa: { cost: 'CPA', results: 'compras', unit: 'brl' },
  cpl: { cost: 'CPL', results: 'leads', unit: 'brl' },
  roas: { cost: 'ROAS', results: 'compras', unit: 'x' },
  cpm: { cost: 'CPM', results: 'mil impressões', unit: 'brl' },
  custo_visita: { cost: 'custo por visita', results: 'visitas', unit: 'brl' },
}

const MONEY_MEDIDA: Record<StageMeasure, TetoMedida | null> = { compra: 'cpa', lead: 'cpl', alcance: 'cpm', visita: 'custo_visita', ascensao: null }

export interface TestTeto {
  value: number | null
  source: TetoSource | null
  /** Null for a stage whose creatives have no cost to judge (ascensão). */
  medida: TetoMedida | null
}

/**
 * The teto a test would get now: its own, else the Critérios override, else its stage's meta (the
 * funnel result's stage when the test has none). A compra stage judges by CPA, and by ROAS only when
 * the stage has a ROAS meta and no CPA meta and nothing above overrides it.
 */
export function effectiveTestTeto(
  test: { teto: number | null; funnelStageId: string | null },
  stages: StageMetas[],
  resultado: ProjectResult,
  rulesTeto: number | null
): TestTeto {
  const stage = test.funnelStageId ? stages.find((option) => option.id === test.funnelStageId) : resultStage(stages, measureOfMetric(resultado))
  const measure = stage?.measure ?? measureOfMetric(resultado)
  const money = MONEY_MEDIDA[measure]
  if (test.teto !== null) return { value: test.teto, source: 'especifica', medida: money }
  if (rulesTeto !== null) return { value: rulesTeto, source: 'criterios', medida: money }
  if (measure === 'compra' && stage?.meta == null && stage?.metaRoas != null) return { value: stage.metaRoas, source: 'etapa', medida: 'roas' }
  const value = measure === 'ascensao' ? null : (stage?.meta ?? null)
  return { value, source: value === null ? null : 'etapa', medida: money }
}

/** A running test whose teto would be different today: the "a meta mudou" banner. */
export function tetoChanged(started: { value: number | null; medida: TetoMedida | null }, now: TestTeto): boolean {
  if (started.value === null) return false
  return started.value !== now.value || started.medida !== now.medida
}

/** Whether the readout can judge creatives in this cost: the creative report has spend, sales, leads and impressions, not page views. */
export function decidesCreatives(medida: TetoMedida | null): medida is Exclude<TetoMedida, 'custo_visita'> {
  return medida !== null && medida !== 'custo_visita'
}

// Impact of a stage meta change --------------------------------------------------------------------

export interface StageFollowers {
  following: number
  specific: number
}

/** One place that reads a stage meta: the stage whose meta it uses (or would use) and whether it follows it. */
export interface MetaReader {
  stageId: string | null
  follows: boolean
}

/** A watcher as a reader of a stage meta; null when its metric is not a cost any stage carries. */
export function watcherReader(watcher: WatcherLevel, stages: StageMetas[], fronts: Map<string, FrontMetas>): MetaReader | null {
  const measure = watcherCostMeasure(watcher.metric)
  if (!measure) return null
  if (watcher.frontId) {
    const front = fronts.get(watcher.frontId)
    if (!front) return null
    const followsFront = effectiveFrontMeta(front, stages, watcher.metric).source === 'frente'
    return { stageId: front.stageId, follows: watcher.target === null && !followsFront }
  }
  const stage = watcher.stageId ? stages.find((option) => option.id === watcher.stageId) : resultStage(stages, measure)
  if (!stage || stage.measure !== measure) return null
  return { stageId: stage.id, follows: watcher.target === null }
}

/**
 * Before a stage meta changes: how many places follow it (and move with it) and how many have their
 * own number (and stay). The caller lists the stage's fronts, the watchers that read it and its new
 * or running tests (a running test only shows the change; it keeps its teto until asked).
 */
export function stageFollowers(stageId: string, readers: MetaReader[]): StageFollowers {
  const mine = readers.filter((reader) => reader.stageId === stageId)
  const following = mine.filter((reader) => reader.follows).length
  return { following, specific: mine.length - following }
}

/** "3 lugares seguem esta meta; 1 é específico e não muda." */
export function followersLine(impact: StageFollowers): string {
  const follow = `${impact.following} ${impact.following === 1 ? 'lugar segue' : 'lugares seguem'} esta meta`
  if (impact.specific === 0) return `${follow}.`
  return `${follow}; ${impact.specific} ${impact.specific === 1 ? 'é específico e não muda' : 'são específicos e não mudam'}.`
}

export function sourceLabel(source: TargetSource | TetoSource | null, stageName?: string): string {
  if (source === 'especifica') return 'específica'
  if (source === 'frente') return 'segue a frente'
  if (source === 'criterios') return 'segue os Critérios de decisão'
  if (source === 'etapa') return stageName ? `segue a etapa ${stageName}` : 'segue a etapa'
  return 'sem meta'
}
