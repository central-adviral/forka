import type { SupabaseClient } from '@supabase/supabase-js'
import { getDailyFunnel } from './funnel-repo'

export interface BestVariant {
  testName: string
  variantName: string
  liftPct: number
}

export interface ClientHubKpis {
  revenue: number
  roas: number | null
  activeTests: number
  bestVariant: BestVariant | null
}

interface TestReportRow {
  variant_id: string
  variant_name: string
  visits: number
  conversions: number
}

export async function getClientHubKpis(
  db: SupabaseClient,
  clientId: string,
  since: string,
  until: string
): Promise<ClientHubKpis> {
  const [{ data: funnels }, { data: activeTestRows }] = await Promise.all([
    db.from('sales_funnels').select('id').eq('client_id', clientId),
    db.from('tests').select('id, name').eq('client_id', clientId).eq('status', 'active'),
  ])

  const funnelDays = await Promise.all(
    (funnels ?? []).map((funnel) => getDailyFunnel(db, funnel.id, since, until))
  )
  const money = funnelDays.flat().reduce(
    (acc, row) => ({ revenue: acc.revenue + row.receitaLiquida, spend: acc.spend + row.spendComImposto }),
    { revenue: 0, spend: 0 }
  )

  return {
    revenue: money.revenue,
    roas: money.spend > 0 ? money.revenue / money.spend : null,
    activeTests: (activeTestRows ?? []).length,
    bestVariant: await findBestVariant(db, activeTestRows ?? [], since, until),
  }
}

async function findBestVariant(
  db: SupabaseClient,
  tests: { id: string; name: string }[],
  since: string,
  until: string
): Promise<BestVariant | null> {
  const sinceIso = new Date(`${since}T00:00:00`).toISOString()
  const untilIso = new Date(`${until}T00:00:00`).toISOString()

  const perTest = await Promise.all(
    tests.map(async (test) => {
      const [{ data: variants }, { data: report }] = await Promise.all([
        db.from('variants').select('id, is_control').eq('test_id', test.id),
        db.rpc('get_test_report', { p_test_id: test.id, p_since: sinceIso, p_until: untilIso }),
      ])
      const rows = (report as TestReportRow[]) ?? []
      const controlId = (variants ?? []).find((v) => v.is_control)?.id
      const control = rows.find((row) => row.variant_id === controlId)
      if (!control || control.visits === 0 || control.conversions === 0) return null

      const controlRate = control.conversions / control.visits
      let best: BestVariant | null = null
      for (const row of rows) {
        if (row.variant_id === control.variant_id || row.visits === 0) continue
        const liftPct = ((row.conversions / row.visits - controlRate) / controlRate) * 100
        if (!best || liftPct > best.liftPct) {
          best = { testName: test.name, variantName: row.variant_name, liftPct }
        }
      }
      return best
    })
  )

  return perTest.reduce<BestVariant | null>(
    (best, candidate) => (candidate && (!best || candidate.liftPct > best.liftPct) ? candidate : best),
    null
  )
}
