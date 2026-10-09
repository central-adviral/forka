import { MEASURES, meetsMeta, stageResult, type CostCombo, type StageMeasure, type StageTotals } from './funnel-stages'

// "Etapas e frentes": the canvas geometry, the words it prints and the checks of its setup strip.

export const MEASURE_COLOR: Record<StageMeasure, string> = {
  alcance: 'var(--ct-ab)',
  lead: 'var(--ct-an)',
  visita: 'var(--ct-accent)',
  compra: 'var(--ct-ok)',
  ascensao: 'var(--ct-warn)',
}

/** The result of each measure in one short word, for the edge labels and the combo formulas. */
export const SHORT_RESULT: Record<StageMeasure, string> = {
  alcance: 'impressões',
  lead: 'leads',
  visita: 'visitas',
  compra: 'vendas',
  ascensao: 'ascensões',
}

export const NODE_WIDTH = 260
export const SEQUENCE_GAP = 96
export const PARALLEL_GAP = 18
/** Edges leave and enter the nodes at this height, level with the node title. */
export const EDGE_Y = 34

export interface Placed {
  id: string
  parallel: boolean
}

/**
 * The stages with one moved into a lane at an index counted over that lane as it is drawn (the
 * moving stage included when it is already there). Parallel stages come first, then the sequence:
 * the order the positions are saved in. A null index puts it at the end of the lane.
 */
export function placeStage<T extends Placed>(stages: T[], moving: T, parallel: boolean, index: number | null): T[] {
  const peers = stages.filter((stage) => stage.parallel === parallel)
  const from = peers.findIndex((stage) => stage.id === moving.id)
  let at = index ?? peers.length
  if (from !== -1 && from < at) at -= 1
  const lane = peers.filter((stage) => stage.id !== moving.id)
  lane.splice(Math.max(0, Math.min(at, lane.length)), 0, { ...moving, parallel })
  const other = stages.filter((stage) => stage.parallel !== parallel && stage.id !== moving.id)
  return parallel ? [...lane, ...other] : [...other, ...lane]
}

/** Where a drop at x (in the lane's own pixels) lands: before the first node whose middle is past it. */
export function dropIndex(x: number, count: number, gap: number): number {
  let index = 0
  while (index < count && index * (NODE_WIDTH + gap) + NODE_WIDTH / 2 < x) index += 1
  return index
}

export function edgeLabel(from: StageMeasure, to: StageMeasure): string {
  return `${SHORT_RESULT[from]} → ${SHORT_RESULT[to]}`
}

export interface SequenceEdge {
  path: string
  label: string
  labelX: number
  labelY: number
}

/** The flow between consecutive sequence nodes, in the sequence lane's own pixels. */
export function sequenceEdges(measures: StageMeasure[]): SequenceEdge[] {
  return measures.slice(1).map((measure, i) => {
    const x1 = i * (NODE_WIDTH + SEQUENCE_GAP) + NODE_WIDTH
    const x2 = (i + 1) * (NODE_WIDTH + SEQUENCE_GAP)
    const mx = (x1 + x2) / 2
    return {
      path: `M${x1} ${EDGE_Y} C${mx} ${EDGE_Y}, ${mx} ${EDGE_Y}, ${x2} ${EDGE_Y}`,
      label: edgeLabel(measures[i], measure),
      labelX: mx,
      labelY: EDGE_Y + 24,
    }
  })
}

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** A stage meta as the screen prints it: a money ceiling, or the ascension rate (stored as a fraction) in %. */
export function metaText(measure: StageMeasure, value: number): string {
  return MEASURES[measure].format === 'pct' ? `${(value * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : money(value)
}

export function metaToInput(measure: StageMeasure, value: number | null): string {
  if (value === null) return ''
  return String(MEASURES[measure].format === 'pct' ? Math.round(value * 1000) / 10 : value).replace('.', ',')
}

/** "6,50" or "6.50" into 6.5; the ascension rate is typed in % and stored as a fraction. Empty is null. */
export function metaFromInput(measure: StageMeasure, raw: string): number | null {
  const text = raw.trim()
  if (!text) return null
  const value = Number(text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text)
  if (!Number.isFinite(value)) return NaN
  return MEASURES[measure].format === 'pct' ? value / 100 : value
}

/** A stage or front tag as the campaign names carry it: upper case, no spaces; empty is none. */
export function cleanTag(raw: string): string | null {
  return raw.toUpperCase().replace(/\s+/g, '') || null
}

/** "CAP | FRIO | nome do criativo": the stage tag (when it has one), the front's tag, the creative. */
export function campaignNameSuggestion(stageTag: string | null, frontTag: string): string {
  return [stageTag, frontTag, 'nome do criativo'].filter(Boolean).join(' | ')
}

export function comboFormula(combo: Pick<CostCombo, 'stageIds' | 'over' | 'overStageId'>, stages: { id: string; name: string; measure: StageMeasure }[]): string {
  const names = combo.stageIds.flatMap((id) => stages.find((stage) => stage.id === id)?.name ?? [])
  const sum = names.length ? `(${names.join(' + ')})` : '(nenhuma etapa)'
  if (combo.over === 'receita') return `receita ÷ gasto ${sum}`
  const over = stages.find((stage) => stage.id === combo.overStageId)
  return `${sum} ÷ ${over ? `${SHORT_RESULT[over.measure]} de ${over.name}` : '?'}`
}

export interface SetupStage {
  name: string
  tag: string | null
  measure: StageMeasure
  meta: number | null
  fronts: { name: string; mirror: boolean; includes: number }[]
}

/** What the setup strip lists as missing before the stage numbers can be trusted. */
export function stageSetupItems(stages: SetupStage[]): string[] {
  const items: string[] = []
  const byTag = new Map<string, string[]>()
  for (const stage of stages) {
    if (stage.meta === null) items.push(`meta da etapa ${stage.name}`)
    for (const front of stage.fronts) {
      if (!front.mirror && front.includes === 0) items.push(`etiqueta "contém" da frente ${front.name}`)
    }
    const tag = stage.tag?.trim().toLowerCase()
    if (tag) byTag.set(tag, [...(byTag.get(tag) ?? []), stage.name])
  }
  for (const [tag, names] of byTag) {
    if (names.length > 1) items.push(`etiqueta ${tag.toUpperCase()} repetida (${names.join(', ')})`)
  }
  if (stages.some((stage) => stage.measure === 'ascensao') && !stages.some((stage) => stage.measure === 'compra')) {
    items.push('uma etapa de compra para a ascensão')
  }
  return items
}

/** The stage a plan watcher's metric speaks for; null for the media metrics (CTR, frequência...). */
export function measureOfWatcherMetric(metric: string): StageMeasure | null {
  if (metric === 'cpa_geral' || metric === 'cpa_anuncio' || metric === 'roas' || metric === 'custo_checkout') return 'compra'
  if (metric === 'cpl') return 'lead'
  if (metric === 'cpm') return 'alcance'
  if (metric === 'custo_visita') return 'visita'
  return null
}

export type Tone = 'ok' | 'warn' | 'crit'

/** Within the meta is ok; up to 20% past it is warn, beyond that crit (the default watcher band). */
export function metaTone(measure: StageMeasure, value: number | null, meta: number | null): Tone | null {
  const meets = meetsMeta(measure, value, meta)
  if (meets === null) return null
  if (meets) return 'ok'
  const miss = MEASURES[measure].direction === 'max' ? value! / meta! - 1 : 1 - value! / meta!
  return miss <= 0.2 ? 'warn' : 'crit'
}

/** The count the next stage is a share of: impressions for alcance (not thousands), the result otherwise. */
export function stageCount(measure: StageMeasure, totals: StageTotals): number {
  return measure === 'alcance' ? totals.impressions : stageResult(measure, totals)
}

/** The next stage's result over this one's: how many leads per impression, sales per lead... */
export function passageRate(from: { measure: StageMeasure; totals: StageTotals }, to: { measure: StageMeasure; totals: StageTotals }): number | null {
  const base = stageCount(from.measure, from.totals)
  return base > 0 ? stageCount(to.measure, to.totals) / base : null
}
