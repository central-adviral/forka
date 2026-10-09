import type { Stage, StageMeasure } from '@/lib/domain/funnel-stages'
import type { ProjectResult } from '@/lib/domain/project-plan'
import type { PageKind } from '@/lib/domain/new-funnel'
import type { StageFollowers, TargetSource, TestTeto, TetoMedida } from '@/lib/domain/targets'
import type { WatcherMetric } from '@/lib/domain/watchers'

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
  /** The pages linked to the front (pages.front_id), watched in Alertas › Páginas. */
  pages: { id: string; url: string; tipo: PageKind | null; isActive: boolean }[]
}

export interface CanvasWatcher {
  id: string
  metric: WatcherMetric
  label: string
  scope: string
  /** 'plano' (the funnel result) and 'frente' keep their meta where it is set; 'livre' sets its own here. */
  source: 'plano' | 'frente' | 'livre'
  /** The target it judges with, its own one and where a followed one comes from (0106). */
  target: number | null
  ownTarget: number | null
  targetSource: TargetSource | null
  targetStageName: string | null
  warnPct: number
  critPct: number
  ownBand: boolean
}

export interface CanvasTest {
  id: string
  code: string
  title: string
  /** The column's label (Fila, Rodando...). */
  status: string
  running: boolean
  meta: boolean
  /** Its own teto; null follows the Critérios or the stage. */
  teto: number | null
  tetoInicial: number | null
  tetoMedida: TetoMedida | null
  tetoNow: TestTeto
}

export interface CanvasStage extends Stage {
  fronts: CanvasFront[]
  watchers: CanvasWatcher[]
  tests: CanvasTest[]
  /** Who follows this stage's meta and who has a number of its own, for the line before a change. */
  followers: StageFollowers
}

export interface CanvasPreset {
  id: string | null
  name: string
  tag: string | null
  measure: StageMeasure
  parallel: boolean
}
