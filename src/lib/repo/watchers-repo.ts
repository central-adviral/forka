import type { SupabaseClient } from '@supabase/supabase-js'
import type { WatcherMetric, WatcherStatus } from '@/lib/domain/watchers'

export interface Watcher {
  id: string
  metric: WatcherMetric
  target: number
  warnPct: number
  critPct: number
  minSpend: number
  isActive: boolean
  projectName: string
  projectSlug: string
  frontName: string | null
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

export async function getWatchers(db: SupabaseClient, clientId: string): Promise<Watcher[]> {
  const { data, error } = await db
    .from('watchers')
    .select(
      'id, metric, target, warn_pct, crit_pct, min_spend, is_active, last_day, last_value, last_status, project:sales_funnels!inner(name, slug), front:project_fronts(name)'
    )
    .eq('client_id', clientId)
    .order('created_at')
  if (error) throw error
  return ((data ?? []) as unknown as {
    id: string
    metric: WatcherMetric
    target: number
    warn_pct: number
    crit_pct: number
    min_spend: number
    is_active: boolean
    last_day: string | null
    last_value: number | null
    last_status: WatcherStatus | null
    project: { name: string; slug: string }
    front: { name: string } | null
  }[]).map((row) => ({
    id: row.id,
    metric: row.metric,
    target: Number(row.target),
    warnPct: Number(row.warn_pct),
    critPct: Number(row.crit_pct),
    minSpend: Number(row.min_spend),
    isActive: row.is_active,
    projectName: row.project.name,
    projectSlug: row.project.slug,
    frontName: row.front?.name ?? null,
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
