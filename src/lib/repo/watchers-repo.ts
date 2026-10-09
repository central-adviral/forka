import type { SupabaseClient } from '@supabase/supabase-js'
import type { WatcherMetric, WatcherStatus } from '@/lib/domain/watchers'
import type { TargetSource } from '@/lib/domain/targets'

export interface Watcher {
  id: string
  metric: WatcherMetric
  /** The target it judges against (0106): its own, or the one it follows; null when nothing gives one. */
  target: number | null
  /** Its own target; null follows the front, the stage or the funnel result's stage. */
  ownTarget: number | null
  targetSource: TargetSource | null
  /** The stage whose meta a following watcher uses. */
  targetStageId: string | null
  /** The band it judges with: its own, or the funnel's faixa padrão. */
  warnPct: number
  critPct: number
  ownBand: boolean
  minSpend: number
  isActive: boolean
  projectName: string
  projectSlug: string
  frontId: string | null
  frontName: string | null
  /** A watcher of one stage reads only that stage's campaigns and sales. */
  stageId: string | null
  stageName: string | null
  funnelId: string
  /** Set when the Plano (project) or the front's metrics own the metric and target (0094, 0102). */
  planRole: 'principal' | 'secundaria' | null
  /** Its project or front is archived, so it is not evaluated (0100). */
  archived: boolean
  /** Only the client's campaigns whose name contains this (0065). */
  lastDay: string | null
  lastValue: number | null
  lastStatus: WatcherStatus | null
}

export interface Alert {
  id: string
  watcherId: string
  severity: 'warn' | 'crit'
  value: number
  day: string
  openedAt: string
  closedAt: string | null
}

/** The client's watchers, or one funnel's. */
export async function getWatchers(db: SupabaseClient, clientId: string, salesFunnelId?: string): Promise<Watcher[]> {
  let query = db
    .from('watchers')
    .select(
      'id, metric, target, effective_target, target_source, target_stage_id, warn_pct, crit_pct, effective_warn_pct, effective_crit_pct, min_spend, is_active, last_day, last_value, last_status, sales_funnel_id, stage_id, plan_role, project:sales_funnels!inner(name, slug, archived_at), front:project_fronts(id, name, archived_at), stage:funnel_stages!watchers_stage_fkey(name, archived_at)'
    )
    .eq('client_id', clientId)
  if (salesFunnelId) query = query.eq('sales_funnel_id', salesFunnelId)
  const { data, error } = await query.order('created_at')
  if (error) throw error
  return ((data ?? []) as unknown as {
    id: string
    metric: WatcherMetric
    target: number | null
    effective_target: number | null
    target_source: TargetSource | null
    target_stage_id: string | null
    warn_pct: number | null
    crit_pct: number | null
    effective_warn_pct: number
    effective_crit_pct: number
    min_spend: number
    is_active: boolean
    last_day: string | null
    last_value: number | null
    last_status: WatcherStatus | null
    sales_funnel_id: string
    stage_id: string | null
    plan_role: 'principal' | 'secundaria' | null
    project: { name: string; slug: string; archived_at: string | null }
    front: { id: string; name: string; archived_at: string | null } | null
    stage: { name: string; archived_at: string | null } | null
  }[]).map((row) => ({
    id: row.id,
    metric: row.metric,
    target: row.effective_target === null ? null : Number(row.effective_target),
    ownTarget: row.target === null ? null : Number(row.target),
    targetSource: row.target_source,
    targetStageId: row.target_stage_id,
    warnPct: Number(row.effective_warn_pct),
    critPct: Number(row.effective_crit_pct),
    ownBand: row.warn_pct !== null,
    minSpend: Number(row.min_spend),
    isActive: row.is_active,
    projectName: row.project.name,
    projectSlug: row.project.slug,
    frontId: row.front?.id ?? null,
    frontName: row.front?.name ?? null,
    stageId: row.stage_id,
    stageName: row.stage?.name ?? null,
    funnelId: row.sales_funnel_id,
    planRole: row.plan_role,
    archived: Boolean(row.project.archived_at || row.front?.archived_at || row.stage?.archived_at),
    lastDay: row.last_day,
    lastValue: row.last_value === null ? null : Number(row.last_value),
    lastStatus: row.last_status,
  }))
}

export async function getAlerts(db: SupabaseClient, clientId: string, limit = 30): Promise<Alert[]> {
  const { data, error } = await db
    .from('alerts')
    .select('id, watcher_id, severity, value, day, opened_at, closed_at')
    .eq('client_id', clientId)
    .order('opened_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    watcherId: row.watcher_id,
    severity: row.severity,
    value: Number(row.value),
    day: row.day,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
  }))
}
