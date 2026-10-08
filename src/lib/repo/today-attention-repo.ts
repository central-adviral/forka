import type { SupabaseClient } from '@supabase/supabase-js'
import { findBestVariant } from './client-hub-repo'
import { getClientDaily, saoPauloDay, type ClientDay } from './today-repo'
import { getAlerts, getWatchers } from './watchers-repo'
import { getPagesWithChecks } from './pages-repo'
import { loadBacklogAttention } from './backlog-readout-repo'
import { detectSampleRatioMismatch } from '@/lib/domain/srm-check'
import { brtDayBoundaryUtc } from '@/lib/domain/report-period'
import { buildAttention, type AttentionItem } from '@/lib/domain/attention'
import { METRICS, formatMetric, watcherScope } from '@/lib/domain/watchers'
import { checkFindings, isSilenced, pageStatus } from '@/lib/domain/page-probe'

export interface TodayAttention {
  attention: AttentionItem[]
  today: string
  week: { since: string; until: string }
  weekDays: ClientDay[]
  metaDataAt: string | null
  todayRow: ClientDay | undefined
  funnels: { slug: string; name: string; is_active: boolean; daily_sales_target: number | null; resultado: string | null }[]
  activeTests: { id: string; name: string; slug: string }[]
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
    supabase.from('sales_funnels').select('id, slug, name, is_active, daily_sales_target, resultado, test_rules').eq('client_id', client.id).order('name'),
    supabase.from('tests').select('id, name, slug').eq('client_id', client.id).eq('status', 'active'),
  ])
  // A failed read must not pass for a quiet day: no conflicts, no unclassified spend, no sync.
  const readError = campaignsResult.error ?? lastRunResult.error ?? funnelsResult.error
  if (readError) throw readError
  const campaigns = campaignsResult.data
  const lastRun = lastRunResult.data
  const funnels = funnelsResult.data
  const [bestVariant, watchers, alerts, pages, unattributedResult, backlogAttention, skewedDraws] = await Promise.all([
    findBestVariant(supabase, activeTests ?? [], monthSince, week.until).catch(() => null),
    getWatchers(supabase, client.id),
    getAlerts(supabase, client.id),
    getPagesWithChecks(supabase, client.id, { checksPerPage: 2 }),
    supabase.from('sales').select('valor_liquido').eq('client_id', client.id).is('sales_funnel_id', null).gte('data_venda', brtDayBoundaryUtc(week.since)),
    // A failed verdict read only drops these items; the rest of the queue still stands.
    loadBacklogAttention(supabase, (funnels ?? []).filter((funnel) => funnel.is_active)).catch((error) => {
      console.error('[today-test-verdicts-failed]', { clientId: client.id }, error)
      return { verdicts: [], ready: [] }
    }),
    findSkewedDraws(supabase, activeTests ?? []).catch((error) => {
      console.error('[today-srm-failed]', { clientId: client.id }, error)
      return []
    }),
  ])
  // "Pronto pra subir" opens the link to paste when the card has its test, otherwise the card.
  const readyTestIds = backlogAttention.ready.flatMap((card) => (card.testId ? [card.testId] : []))
  const { data: readyTests } = readyTestIds.length > 0 ? await supabase.from('tests').select('id, slug').in('id', readyTestIds) : { data: [] }
  const readyCards = backlogAttention.ready.map((card) => {
    const slug = (readyTests ?? []).find((test) => test.id === card.testId)?.slug
    return { code: card.code, title: card.title, href: slug ? `${base}/tests/${slug}/link` : `${base}/backlog?projeto=${card.projectSlug}&item=${card.code}`, hasLink: Boolean(slug) }
  })
  if (unattributedResult.error) throw unattributedResult.error
  const unattributedSales = (unattributedResult.data ?? []) as { valor_liquido: number | null }[]
  // A page the ads point to that is down or failing a check (0066, 0089) goes to the same queue as
  // the watchers; a page silenced for maintenance stays out until then.
  const now = new Date()
  const pageAlerts = pages.flatMap((page) => {
    if (!page.isActive || isSilenced(page.silencedUntil, now)) return []
    const status = pageStatus(page.checks, page.watch, now)
    if (status !== 'critico' && status !== 'atencao') return []
    const failed = checkFindings(page.checks[0], page.watch, now).find((finding) => !finding.ok)
    return [{
      severity: (status === 'critico' ? 'crit' : 'warn') as 'crit' | 'warn',
      title:
        status === 'critico' ? `${page.label} fora do ar`
        : failed?.id === 'abre' ? `${page.label} não abriu (confirmando)`
        : `${page.label}: ${failed?.label.toLowerCase() ?? 'atenção'}`,
      detail: failed ? `${failed.detail[0].toUpperCase()}${failed.detail.slice(1)} na última checagem.` : 'Veja a sonda.',
      href: `${base}/paginas#pagina-${page.id}`,
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
    testVerdicts: backlogAttention.verdicts,
    skewedDraws,
    readyCards,
  })

  return { attention, today, week, weekDays, metaDataAt, todayRow, funnels: funnels ?? [], activeTests: activeTests ?? [], conflicts, orphans, firstProject }
}

/**
 * Active tests whose traffic does not split by the weights (SRM), counted from the last weight
 * change (0076) so a 70/30 → 50/50 switch is not an alarm. One report per active test: a client
 * runs a handful at a time.
 */
async function findSkewedDraws(supabase: SupabaseClient, tests: { id: string; name: string; slug: string }[]) {
  const perTest = await Promise.all(
    tests.map(async (test) => {
      const { data: lastChange } = await supabase
        .from('test_changes')
        .select('created_at')
        .eq('test_id', test.id)
        .eq('field', 'weight_pct')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const { data, error } = await supabase.rpc('get_test_report', { p_test_id: test.id, p_since: lastChange?.created_at ?? null, p_until: null })
      if (error) throw error
      const rows = (data ?? []) as { variant_name: string; weight_pct: number; visits: number }[]
      if (detectSampleRatioMismatch(rows.map((row) => ({ weightPct: Number(row.weight_pct), visits: Number(row.visits) }))) !== 'mismatch') return []
      // The variant furthest from its share, in the words of the alert.
      const live = rows.filter((row) => Number(row.weight_pct) > 0)
      const totalVisits = live.reduce((sum, row) => sum + Number(row.visits), 0)
      const totalWeight = live.reduce((sum, row) => sum + Number(row.weight_pct), 0)
      const worst = live
        .map((row) => ({ name: row.variant_name, actualPct: Math.round((Number(row.visits) / totalVisits) * 100), expectedPct: Math.round((Number(row.weight_pct) / totalWeight) * 100) }))
        .sort((a, b) => Math.abs(b.actualPct - b.expectedPct) - Math.abs(a.actualPct - a.expectedPct))[0]
      return [{ testName: test.name, testSlug: test.slug, ...worst }]
    })
  )
  return perTest.flat()
}

