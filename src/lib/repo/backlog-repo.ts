import type { SupabaseClient } from '@supabase/supabase-js'
import type { BacklogStatus, Method, Stage } from '@/lib/domain/backlog'

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
  variants: BacklogVariant[]
  gates: BacklogGate[]
}

/** A project's backlog with variants and pre-requisites (0068). RLS decides what a client member sees. */
export async function getBacklog(db: SupabaseClient, salesFunnelId: string): Promise<BacklogItem[]> {
  const { data, error } = await db
    .from('backlog_items')
    .select(
      'id, code, title, hypothesis, stage, method, status, impact, confidence, ease, ice, metric, owner, started_at, decided_at, result, winner_key, learning, published, ab_test_id, backlog_variants(id, key, name, status, position), backlog_gates(id, label, done_at, position)'
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
    backlog_variants: { id: string; key: string; name: string; status: BacklogVariant['status']; position: number }[]
    backlog_gates: { id: string; label: string; done_at: string | null; position: number }[]
  }[]).map((row) => ({
    id: row.id,
    code: row.code,
    title: row.title,
    hypothesis: row.hypothesis,
    stage: row.stage,
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
    variants: [...(row.backlog_variants ?? [])].sort((a, b) => a.position - b.position).map(({ id, key, name, status }) => ({ id, key, name, status })),
    gates: [...(row.backlog_gates ?? [])].sort((a, b) => a.position - b.position).map((gate) => ({ id: gate.id, label: gate.label, doneAt: gate.done_at })),
  }))
}
