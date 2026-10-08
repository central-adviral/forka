import type { SupabaseClient } from '@supabase/supabase-js'
import { findBestVariant } from './client-hub-repo'
import { getClientDaily, saoPauloDay, type ClientDay } from './today-repo'
import { getAlerts, getWatchers } from './watchers-repo'
import { getPagesWithChecks } from './pages-repo'
import { brtDayBoundaryUtc } from '@/lib/domain/report-period'
import { buildAttention, type AttentionItem } from '@/lib/domain/attention'
import { METRICS, formatMetric, watcherScope } from '@/lib/domain/watchers'
import { isOutage, pageHealth } from '@/lib/domain/page-probe'

export interface TodayAttention {
  attention: AttentionItem[]
  today: string
  week: { since: string; until: string }
  weekDays: ClientDay[]
  metaDataAt: string | null
  todayRow: ClientDay | undefined
  funnels: { slug: string; name: string; is_active: boolean; daily_sales_target: number | null; resultado: string | null }[]
  activeTests: { id: string; name: string }[]
  conflicts: { campaign_name: string; spend: number }[]
  orphans: { campaign_name: string; spend: number }[]
  firstProject: { slug: string } | undefined
}

/**
 * The Hoje queue and the data it is built from. The Hoje screen and the sidebar's Hoje badge both
 * read it, so the badge always counts exactly the items the screen lists.
 */
export async function loadTodayAttention(supabase: SupabaseClient, client: { id: string; slug: string }): Promise<TodayAttention> {
  const today = saoPauloDay(0)
  const week = { since: saoPauloDay(-6), until: saoPauloDay(1) }
  const monthSince = saoPauloDay(-29)
  const base = `/dashboard/clients/${client.slug}`

  const [weekDays, campaignsResult, lastRunResult, funnelsResult, { data: activeTests }] = await Promise.all([
    getClientDaily(supabase, client.id, week.since, week.until),
    supabase.rpc('get_client_campaigns', { p_client_id: client.id, p_since: monthSince, p_until: week.until }),
    supabase.from('sync_runs').select('finished_at, error').eq('client_id', client.id).not('finished_at', 'is', null).order('started_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('sales_funnels').select('slug, name, is_active, daily_sales_target, resultado').eq('client_id', client.id).order('name'),
    supabase.from('tests').select('id, name').eq('client_id', client.id).eq('status', 'active'),
  ])
  // A failed read must not pass for a quiet day: no conflicts, no unclassified spend, no sync.
  const readError = campaignsResult.error ?? lastRunResult.error ?? funnelsResult.error
  if (readError) throw readError
  const campaigns = campaignsResult.data
  const lastRun = lastRunResult.data
  const funnels = funnelsResult.data
  const [bestVariant, watchers, alerts, pages, unattributedResult] = await Promise.all([
    findBestVariant(supabase, activeTests ?? [], monthSince, week.until).catch(() => null),
    getWatchers(supabase, client.id),
    getAlerts(supabase, client.id),
    getPagesWithChecks(supabase, client.id, 2),
    supabase.from('sales').select('valor_liquido').eq('client_id', client.id).is('sales_funnel_id', null).gte('data_venda', brtDayBoundaryUtc(week.since)),
  ])
  if (unattributedResult.error) throw unattributedResult.error
  const unattributedSales = (unattributedResult.data ?? []) as { valor_liquido: number | null }[]
  // A page the ads point to that is down or slow (0066) goes to the same queue as the watchers.
  const pageAlerts = pages.flatMap((page) => {
    const health = pageHealth(page.checks)
    if (!page.isActive || health === 'ok' || health === 'sem_check') return []
    const last = page.checks[0]
    return [{
      severity: (isOutage(page.checks) ? 'crit' : 'warn') as 'crit' | 'warn',
      title: `${page.label} ${health === 'fora' ? 'fora do ar' : 'lenta'}`,
      detail: health === 'fora' ? `${last.error ?? 'Não respondeu'} na última checagem.` : `${((last.ttfbMs ?? 0) / 1000).toFixed(1).replace('.', ',')}s para responder na última checagem.`,
    }]
  })
  const watcherById = new Map(watchers.map((watcher) => [watcher.id, watcher]))
  const watcherAlerts = alerts.flatMap((alert) => {
    const watcher = watcherById.get(alert.watcherId)
    if (alert.closedAt || !watcher) return []
    const scope = `${watcher.projectName} · ${watcherScope(watcher)}`
    return [{
      severity: alert.severity,
      title: `${scope} · ${METRICS[watcher.metric].label} ${alert.severity === 'crit' ? 'crítico' : 'em atenção'}`,
      detail: `${formatMetric(watcher.metric, alert.value)} contra alvo de ${formatMetric(watcher.metric, watcher.target)} no último dia fechado.`,
    }]
  })

  const todayRow = weekDays.find((day) => day.data === today)
  const metaDataAt = todayRow?.dadosAte ?? null
  const classified = (campaigns ?? []) as { campaign_name: string; spend: number; front_ids: string[]; suggested_front_ids: string[] }[]
  const conflicts = classified.filter((c) => c.front_ids.length === 0 && c.suggested_front_ids.length > 1)
  const orphans = classified.filter((c) => c.front_ids.length === 0 && c.suggested_front_ids.length === 0)
  const firstProject = (funnels ?? [])[0]
  const attention = buildAttention({
    base,
    now: new Date(),
    metaDataAt,
    lastRun: lastRun ? { finishedAt: lastRun.finished_at, error: lastRun.error } : null,
    conflicts: conflicts.map((c) => ({ name: c.campaign_name, spend: Number(c.spend) })),
    unclassified: { count: orphans.length, spend: orphans.reduce((total, c) => total + Number(c.spend), 0) },
    rulesHref: firstProject ? `${base}/funis-venda/${firstProject.slug}/regras` : null,
    bestVariant,
    unattributed: { count: unattributedSales.length, revenue: unattributedSales.reduce((sum, sale) => sum + Number(sale.valor_liquido ?? 0), 0) },
    watcherAlerts: [...watcherAlerts, ...pageAlerts],
  })

  return { attention, today, week, weekDays, metaDataAt, todayRow, funnels: funnels ?? [], activeTests: activeTests ?? [], conflicts, orphans, firstProject }
}
