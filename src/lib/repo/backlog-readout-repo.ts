import type { SupabaseClient } from '@supabase/supabase-js'
import { getBacklog, type BacklogItem } from './backlog-repo'
import { TAG_LOOKBACK_DAYS, readRules, type TestRules } from '@/lib/domain/backlog'
import { readLinkTest, readMetaTest, readoutSummary, tagKey, type CreativeRow, type LinkRow, type MetaTeto } from '@/lib/domain/backlog-readout'
import { TETO_MEDIDA, decidesCreatives } from '@/lib/domain/targets'
import { daysRunningSince } from '@/lib/domain/report-period'

export interface Readout {
  summary: string | null
  meta?: ReturnType<typeof readMetaTest>
  link?: ReturnType<typeof readLinkTest>
  /** The teto a Meta test judges with (the one it started with); null when its stage decides no creative. */
  teto?: MetaTeto | null
  /** What a Meta test counts per variant: compras, leads, mil impressões. */
  resultsLabel?: string
}

/** The teto a running Meta test judges with: the snapshot taken when it started (0106). */
export function startedTeto(item: Pick<BacklogItem, 'tetoInicial' | 'tetoMedida'>): MetaTeto | null {
  return item.tetoInicial !== null && decidesCreatives(item.tetoMedida) ? { value: item.tetoInicial, medida: item.tetoMedida } : null
}

// Each Meta test reads the project's creative report from its own start (one read per start day),
// so an older card's window never adds spend from before a newer card began, and judges with the teto
// and the cost it started with. A linked A/B test is read from the card's own start too.
export async function loadReadouts(supabase: SupabaseClient, salesFunnelId: string, items: BacklogItem[], rules: TestRules): Promise<Map<string, Readout>> {
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
  const creativesByDay = new Map(
    days.map((day, index) => {
      const result = creativeReads[index]
      if (result.error) console.error('[backlog-creative-readout-failed]', { salesFunnelId, day }, result.error)
      return [day, (result.data ?? []) as CreativeRow[]] as const
    })
  )
  const readouts = new Map<string, Readout>()
  for (const item of meta) {
    const teto = startedTeto(item)
    const read = readMetaTest(item.code, item.variants.map((variant) => variant.key), creativesByDay.get(startDay(item)) ?? [], rules, teto)
    const days = item.startedAt ? daysRunningSince(item.startedAt) : 1
    readouts.set(item.id, {
      meta: read,
      teto,
      resultsLabel: TETO_MEDIDA[teto?.medida ?? 'cpa'].results,
      summary: readoutSummary(read.map((v) => ({ label: v.key, verdict: v.verdict })), days, rules, 'meta'),
    })
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
 * The cards whose tag is on an ad that spent in the last days, out of the given codes: the
 * evidence for the "Anúncios com a tag" gate. One read of the project's creative report.
 */
export async function findTaggedCards(supabase: SupabaseClient, salesFunnelId: string, codes: string[]): Promise<Set<string>> {
  if (codes.length === 0) return new Set()
  const since = new Date(Date.now() - TAG_LOOKBACK_DAYS * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const { data, error } = await supabase.rpc('get_funnel_report_by_creative', { p_sales_funnel_id: salesFunnelId, p_since: since, p_until: null })
  if (error) throw error
  const rows = (data ?? []) as CreativeRow[]
  return new Set(codes.filter((code) => rows.some((row) => Number(row.spend ?? 0) > 0 && tagKey(row.ad_name ?? '', code) !== null)))
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
  projects: { id: string; slug: string; test_rules: unknown }[]
): Promise<{ verdicts: RunningVerdict[]; ready: ReadyCard[] }> {
  const perProject = await Promise.all(
    projects.map(async (project) => {
      const backlog = await getBacklog(supabase, project.id)
      const ready = backlog
        .filter((item) => item.status === 'ready')
        .map((item) => ({ code: item.code, title: item.title, projectSlug: project.slug, testId: item.abTestId }))
      const items = backlog.filter((item) => item.status === 'running')
      if (items.length === 0) return { verdicts: [], ready }
      const readouts = await loadReadouts(supabase, project.id, items, readRules(project.test_rules))
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
