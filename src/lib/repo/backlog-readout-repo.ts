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

// Meta tests read every tagged ad of the project's creative report since the earliest running
// start; tags are unique per project, so an older window cannot leak another test's ads. A linked
// A/B test is read from the card's own start, not the test's whole life.
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
  const since = meta
    .map((item) => (item.startedAt ? new Date(item.startedAt).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) : null))
    .filter((day): day is string => Boolean(day))
    .sort()[0] ?? null
  const [creativeResult, linkReports, { data: controls }] = await Promise.all([
    meta.length > 0
      ? supabase.rpc('get_funnel_report_by_creative', { p_sales_funnel_id: salesFunnelId, p_since: since, p_until: null })
      : Promise.resolve({ data: [], error: null }),
    Promise.all(link.map((item) => supabase.rpc('get_test_report', { p_test_id: item.abTestId, p_since: item.startedAt, p_until: null }))),
    link.length > 0
      ? supabase.from('variants').select('id, test_id').eq('is_control', true).in('test_id', link.map((item) => item.abTestId!))
      : Promise.resolve({ data: [] }),
  ])
  if (creativeResult.error) console.error('[backlog-creative-readout-failed]', { salesFunnelId }, creativeResult.error)
  // A lead project (0071) measures its creatives by paid leads: they take the purchases' place.
  const creatives = ((creativeResult.data ?? []) as (CreativeRow & { leads: number })[]).map((row) =>
    resultado === 'lead' ? { ...row, sales_count: Number(row.leads ?? 0) } : row
  )
  const readouts = new Map<string, Readout>()
  for (const item of meta) {
    const read = readMetaTest(item.code, item.variants.map((variant) => variant.key), creatives, rules)
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

/**
 * The running cards whose rules already speak (win, cut or saturated), across the given projects,
 * for the Hoje queue. Same rules and reads as the backlog screen, so both say the same thing.
 */
export async function loadRunningVerdicts(
  supabase: SupabaseClient,
  projects: { id: string; slug: string; test_rules: unknown; resultado: string | null }[]
): Promise<RunningVerdict[]> {
  const perProject = await Promise.all(
    projects.map(async (project) => {
      const items = (await getBacklog(supabase, project.id)).filter((item) => item.status === 'running')
      if (items.length === 0) return []
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
      return items.flatMap((item) => {
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
    })
  )
  return perProject.flat()
}
