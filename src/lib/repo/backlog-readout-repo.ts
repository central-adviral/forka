import type { SupabaseClient } from '@supabase/supabase-js'
import { getBacklog, type BacklogItem } from './backlog-repo'
import { readRules, withPlanTeto, type TestRules } from '@/lib/domain/backlog'
import { readLinkTest, readMetaTest, readoutSummary, type CreativeRow, type LinkRow } from '@/lib/domain/backlog-readout'
import { daysRunningSince } from '@/lib/domain/report-period'

export interface Readout {
  summary: string | null
  meta?: ReturnType<typeof readMetaTest>
  link?: ReturnType<typeof readLinkTest>
}

// Each Meta test reads the project's creative report from its own start (one read per start day),
// so an older card's window never adds spend from before a newer card began. A linked A/B test is
// read from the card's own start too, not the test's whole life.
export async function loadReadouts(
  supabase: SupabaseClient,
  salesFunnelId: string,
  items: BacklogItem[],
  rules: TestRules,
  resultado: string
): Promise<Map<string, Readout>> {
  const running = items.filter((item) => item.status === 'running')
  const meta = running.filter((item) => item.method === 'meta')
  const link = running.filter((item) => item.method === 'link' && item.abTestId)
  const startDay = (item: BacklogItem) => (item.startedAt ? new Date(item.startedAt).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) : null)
  const days = [...new Set(meta.map(startDay))]
  const [creativeReads, linkReports, { data: controls }] = await Promise.all([
    Promise.all(days.map((day) => supabase.rpc('get_funnel_report_by_creative', { p_sales_funnel_id: salesFunnelId, p_since: day, p_until: null }))),
    Promise.all(link.map((item) => supabase.rpc('get_test_report', { p_test_id: item.abTestId, p_since: item.startedAt, p_until: null }))),
    link.length > 0
      ? supabase.from('variants').select('id, test_id').eq('is_control', true).in('test_id', link.map((item) => item.abTestId!))
      : Promise.resolve({ data: [] }),
  ])
  // A lead project (0071) measures its creatives by paid leads: they take the purchases' place.
  const creativesByDay = new Map(
    days.map((day, index) => {
      const result = creativeReads[index]
      if (result.error) console.error('[backlog-creative-readout-failed]', { salesFunnelId, day }, result.error)
      const rows = ((result.data ?? []) as (CreativeRow & { leads: number })[]).map((row) => (resultado === 'lead' ? { ...row, sales_count: Number(row.leads ?? 0) } : row))
      return [day, rows] as const
    })
  )
  const readouts = new Map<string, Readout>()
  for (const item of meta) {
    const read = readMetaTest(item.code, item.variants.map((variant) => variant.key), creativesByDay.get(startDay(item)) ?? [], rules)
    const days = item.startedAt ? daysRunningSince(item.startedAt) : 1
    readouts.set(item.id, { meta: read, summary: readoutSummary(read.map((v) => ({ label: v.key, verdict: v.verdict })), days, rules, 'meta') })
  }
  link.forEach((item, index) => {
    const controlId = (controls ?? []).find((row) => row.test_id === item.abTestId)?.id
    const read = readLinkTest((linkReports[index].data ?? []) as LinkRow[], controlId, rules)
    const days = item.startedAt ? daysRunningSince(item.startedAt) : 1
    readouts.set(item.id, { link: read, summary: readoutSummary(read.map((v) => ({ label: v.name, verdict: v.verdict })), days, rules, 'link') })
  })
  return readouts
}

/** win and cut come from a variant's verdict; decide is the saturation summary with neither. */
export type VerdictKind = 'win' | 'cut' | 'decide'

export function readoutKind(readout: Readout): VerdictKind {
  const verdicts = [...(readout.meta ?? []), ...(readout.link ?? [])].map((v) => v.verdict)
  return verdicts.includes('win') ? 'win' : verdicts.includes('cut') ? 'cut' : 'decide'
}

export interface RunningVerdict {
  code: string
  title: string
  summary: string
  kind: VerdictKind
  projectSlug: string
  daysRunning: number
}

export interface ReadyCard {
  code: string
  title: string
  projectSlug: string
  /** The card's A/B test, when it has one: "pronto pra subir" then means "paste the link". */
  testId: string | null
}

/**
 * What the Testes tool puts in the Hoje queue, across the given projects: running cards whose rules
 * already speak (win, cut or saturated), with the same reads as the Quadro, and cards whose checklist
 * is complete and wait to go live.
 */
export async function loadBacklogAttention(
  supabase: SupabaseClient,
  projects: { id: string; slug: string; test_rules: unknown; resultado: string | null }[]
): Promise<{ verdicts: RunningVerdict[]; ready: ReadyCard[] }> {
  const perProject = await Promise.all(
    projects.map(async (project) => {
      const backlog = await getBacklog(supabase, project.id)
      const ready = backlog
        .filter((item) => item.status === 'ready')
        .map((item) => ({ code: item.code, title: item.title, projectSlug: project.slug, testId: item.abTestId }))
      const items = backlog.filter((item) => item.status === 'running')
      if (items.length === 0) return { verdicts: [], ready }
      const { data: costWatcher } = await supabase
        .from('watchers')
        .select('target')
        .eq('sales_funnel_id', project.id)
        .is('front_id', null)
        .eq('metric', 'cpa_geral')
        .maybeSingle()
      const resultado = project.resultado ?? 'compra'
      const rules = withPlanTeto(readRules(project.test_rules), costWatcher ? Number(costWatcher.target) : null, resultado)
      const readouts = await loadReadouts(supabase, project.id, items, rules, resultado)
      const verdicts = items.flatMap((item) => {
        const readout = readouts.get(item.id)
        if (!readout?.summary) return []
        return [{
          code: item.code,
          title: item.title,
          summary: readout.summary,
          kind: readoutKind(readout),
          projectSlug: project.slug,
          daysRunning: item.startedAt ? daysRunningSince(item.startedAt) : 1,
        }]
      })
      return { verdicts, ready }
    })
  )
  return { verdicts: perProject.flatMap((project) => project.verdicts), ready: perProject.flatMap((project) => project.ready) }
}
