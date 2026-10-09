import type { Stage, StageMeasure } from '@/lib/domain/funnel-stages'
import type { ProjectResult } from '@/lib/domain/project-plan'

export interface CanvasContext {
  client_id: string
  client_slug: string
  funnel_slug: string
  sales_funnel_id: string
}

export interface CanvasFront {
  id: string
  code: string
  name: string
  /** The project a mirror front reads; null for a front with campaigns of its own. */
  sourceName: string | null
  rules: { id: string; kind: 'include' | 'exclude'; value: string }[]
  metricaPrincipal: ProjectResult | null
  alvoPrincipal: number | null
  metricaSecundaria: ProjectResult | null
  alvoSecundaria: number | null
  janelaInicio: string | null
  janelaFim: string | null
  campaigns: number
  spend: number
}

export interface CanvasStage extends Stage {
  fronts: CanvasFront[]
  watchers: { id: string; label: string; scope: string }[]
  tests: { code: string; title: string; status: string }[]
}

export interface CanvasPreset {
  id: string | null
  name: string
  tag: string | null
  measure: StageMeasure
  parallel: boolean
}
