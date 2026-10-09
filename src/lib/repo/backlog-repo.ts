import type { SupabaseClient } from '@supabase/supabase-js'
import type { BacklogStatus, Method, Stage } from '@/lib/domain/backlog'
import type { TestTeto, TetoMedida, TetoSource } from '@/lib/domain/targets'

export interface BacklogVariant {
  id: string
  key: string
  name: string
  status: 'active' | 'paused' | 'winner'
}

export interface BacklogGate {
  id: string
  label: string
  doneAt: string | null
}

export interface BacklogItem {
  id: string
  code: string
  title: string
  hypothesis: string
  stage: Stage
  /** The funnel stage (0105) the test belongs to; backlog_items.stage is where it tests. */
  funnelStageId: string | null
  method: Method
  status: BacklogStatus
  impact: number
  confidence: number
  ease: number
  ice: number
  metric: string
  owner: string | null
  startedAt: string | null
  decidedAt: string | null
  result: string | null
  winnerKey: string | null
  learning: string | null
  published: boolean
  abTestId: string | null
  /** The test's own teto (0106); null follows the Critérios override or its stage meta. */
  teto: number | null
  /** The teto it started with and judges with while it runs, and its cost. */
  tetoInicial: number | null
  tetoMedida: TetoMedida | null
  /** The teto it would get now (effective_teto): differs from the start after a meta change. */
  tetoNow: TestTeto
  variants: BacklogVariant[]
  gates: BacklogGate[]
}

/** A project's backlog with variants and pre-requisites (0068). RLS decides what a client member sees. */
export async function getBacklog(db: SupabaseClient, salesFunnelId: string): Promise<BacklogItem[]> {
  const { data, error } = await db
    .from('backlog_items')
    .select(
      'id, code, title, hypothesis, stage, funnel_stage_id, method, status, impact, confidence, ease, ice, metric, owner, started_at, decided_at, result, winner_key, learning, published, ab_test_id, teto, teto_inicial, teto_medida, effective_teto, effective_teto_source, effective_teto_medida, backlog_variants(id, key, name, status, position), backlog_gates(id, label, done_at, position)'
    )
    .eq('sales_funnel_id', salesFunnelId)
    .order('ice', { ascending: false })
  if (error) throw error
  return ((data ?? []) as unknown as {
    id: string
    code: string
    title: string
    hypothesis: string
    stage: Stage
    funnel_stage_id: string | null
    method: Method
    status: BacklogStatus
    impact: number
    confidence: number
    ease: number
    ice: number
    metric: string
    owner: string | null
    started_at: string | null
    decided_at: string | null
    result: string | null
    winner_key: string | null
    learning: string | null
    published: boolean
    ab_test_id: string | null
    teto: number | null
    teto_inicial: number | null
    teto_medida: TetoMedida | null
    effective_teto: number | null
    effective_teto_source: TetoSource | null
    effective_teto_medida: TetoMedida | null
    backlog_variants: { id: string; key: string; name: string; status: BacklogVariant['status']; position: number }[]
    backlog_gates: { id: string; label: string; done_at: string | null; position: number }[]
  }[]).map((row) => ({
    id: row.id,
    code: row.code,
    title: row.title,
    hypothesis: row.hypothesis,
    stage: row.stage,
    funnelStageId: row.funnel_stage_id,
    method: row.method,
    status: row.status,
    impact: row.impact,
    confidence: row.confidence,
    ease: row.ease,
    ice: Number(row.ice),
    metric: row.metric,
    owner: row.owner,
    startedAt: row.started_at,
    decidedAt: row.decided_at,
    result: row.result,
    winnerKey: row.winner_key,
    learning: row.learning,
    published: row.published,
    abTestId: row.ab_test_id,
    teto: row.teto === null ? null : Number(row.teto),
    tetoInicial: row.teto_inicial === null ? null : Number(row.teto_inicial),
    tetoMedida: row.teto_medida,
    tetoNow: {
      value: row.effective_teto === null ? null : Number(row.effective_teto),
      source: row.effective_teto_source,
      medida: row.effective_teto_medida,
    },
    variants: [...(row.backlog_variants ?? [])].sort((a, b) => a.position - b.position).map(({ id, key, name, status }) => ({ id, key, name, status })),
    gates: [...(row.backlog_gates ?? [])].sort((a, b) => a.position - b.position).map((gate) => ({ id: gate.id, label: gate.label, doneAt: gate.done_at })),
  }))
}
