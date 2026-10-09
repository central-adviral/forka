import { DEFAULT_STAGE_PRESETS, derivedResultado, funnelResultStage, type StageMeasure, type StagePreset } from './funnel-stages'
import type { ProjectResult } from './project-plan'

// "Novo funil" in one screen (0107): a name, the funnel tag and a model whose stages open on the canvas.
// Pure, shared by the form and the server action that creates the funnel.

export type ProjectStatus = 'rascunho' | 'rodando' | 'encerrado'
export type PageKind = 'captura' | 'obrigado' | 'vendas' | 'checkout'

export const PAGE_KINDS: PageKind[] = ['captura', 'obrigado', 'vendas', 'checkout']
export const PAGE_KIND_LABEL: Record<PageKind, string> = { captura: 'Captura', obrigado: 'Obrigado', vendas: 'Vendas', checkout: 'Checkout' }

export type FunnelModelKey = 'lancamento_completo' | 'lancamento' | 'perpetuo_ascensao' | 'perpetuo' | 'do_zero'

export interface FunnelModel {
  key: FunnelModelKey
  name: string
  text: string
  /** Default preset names, in journey order; the parallel ones run alongside. */
  stages: { name: string; parallel: boolean }[]
}

const stage = (name: string, parallel = false) => ({ name, parallel })

export const FUNNEL_MODELS: FunnelModel[] = [
  {
    key: 'lancamento_completo',
    name: 'Lançamento completo',
    text: 'Reconhecimento em paralelo, captação, lembrete, vendas e ascensão.',
    stages: [stage('Reconhecimento', true), stage('Captação'), stage('Lembrete do evento'), stage('Vendas'), stage('Ascensão')],
  },
  { key: 'lancamento', name: 'Lançamento', text: 'Captação, lembrete e vendas no mesmo funil.', stages: [stage('Captação'), stage('Lembrete do evento'), stage('Vendas')] },
  { key: 'perpetuo_ascensao', name: 'Perpétuo + ascensão', text: 'Venda direta e a ascensão para o produto maior.', stages: [stage('Vendas'), stage('Ascensão')] },
  { key: 'perpetuo', name: 'Perpétuo', text: 'Só venda direta.', stages: [stage('Vendas')] },
  { key: 'do_zero', name: 'Do zero', text: 'Monte as etapas uma a uma.', stages: [] },
]

export interface PlannedStage {
  name: string
  tag: string | null
  measure: StageMeasure
  parallel: boolean
  position: number
}

const plain = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '')
const sameName = (a: string, b: string) => plain(a).trim().toLowerCase() === plain(b).trim().toLowerCase()

/**
 * The model's stages, each from the client's ready stage of the same name (its tag and measure), else
 * the built-in one. Parallel stages come first, then the sequence: the order the canvas saves.
 */
export function modelStages(key: FunnelModelKey, presets: Pick<StagePreset, 'name' | 'tag' | 'measure'>[]): PlannedStage[] {
  const model = FUNNEL_MODELS.find((option) => option.key === key) ?? FUNNEL_MODELS[0]
  const planned = model.stages.map((item) => {
    const preset = presets.find((option) => sameName(option.name, item.name)) ?? DEFAULT_STAGE_PRESETS.find((option) => option.name === item.name)!
    return { name: preset.name, tag: preset.tag, measure: preset.measure, parallel: item.parallel }
  })
  return [...planned.filter((item) => item.parallel), ...planned.filter((item) => !item.parallel)].map((item, position) => ({ ...item, position }))
}

export const MAX_PLANNED_STAGES = 12

export type StageDraft = Omit<PlannedStage, 'position'>

/** What keeps the edited stage list from being created, in the screen's words; empty when it can be. */
export function plannedStagesIssues(stages: Pick<StageDraft, 'name' | 'tag'>[]): string[] {
  const issues: string[] = []
  if (stages.length === 0) issues.push('monte ao menos uma etapa')
  if (stages.length > MAX_PLANNED_STAGES) issues.push(`até ${MAX_PLANNED_STAGES} etapas por funil`)
  if (stages.some((item) => !item.name.trim())) issues.push('dê um nome para cada etapa')
  const tags = stages.flatMap((item) => (item.tag ? [item.tag.toUpperCase()] : []))
  for (const tag of new Set(tags.filter((tag, index) => tags.indexOf(tag) !== index))) issues.push(`etiqueta ${tag} repetida`)
  return issues
}

/** The edited list in the order the canvas saves: parallel stages first, then the sequence. */
export function orderPlanned(stages: StageDraft[]): PlannedStage[] {
  return [...stages.filter((item) => item.parallel), ...stages.filter((item) => !item.parallel)].map((item, position) => ({ ...item, position }))
}

/** The list with the item at index moved one step up (-1) or down (+1); unchanged at an edge. */
export function moveItem<T>(list: T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list
  const next = [...list]
  ;[next[index], next[to]] = [next[to], next[index]]
  return next
}

/** What a new funnel's resultado is, so its versioned history starts right: its result stage's measure. */
export function resultadoOf(stages: { measure: StageMeasure; parallel: boolean }[], current: ProjectResult = 'compra'): ProjectResult {
  return derivedResultado(current, funnelResultStage(stages.map((item) => ({ ...item, archivedAt: null })))?.measure)
}

/** "1K LATAM" -> "1k-latam": the funnel's internal address. */
export function slugify(name: string): string {
  return plain(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'funil'
}

/** The slug, with -2, -3... until no funnel of the client has it. */
export function uniqueSlug(name: string, taken: string[]): string {
  const base = slugify(name)
  const used = new Set(taken)
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

/** The front a new stage starts with: its code is the stage tag, else letters of the stage name. */
export function firstFrontCode(stageItem: Pick<PlannedStage, 'name' | 'tag'>, taken: string[]): string {
  const base = (stageItem.tag ?? plain(stageItem.name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)) || 'FR'
  let code = base
  let n = 2
  while (taken.includes(code)) code = `${base}${n++}`
  return code
}
