import type { SupabaseClient } from '@supabase/supabase-js'
import { brtDayBoundaryUtc } from '@/lib/domain/report-period'

export interface BestVariant {
  testName: string
  variantName: string
  liftPct: number
}

interface TestReportRow {
  variant_id: string
  variant_name: string
  visits: number
  conversions: number
}

export async function findBestVariant(
  db: SupabaseClient,
  tests: { id: string; name: string }[],
  since: string,
  until: string
): Promise<BestVariant | null> {
  // São Paulo midnights, not the server's: Vercel runs in UTC.
  const sinceIso = brtDayBoundaryUtc(since)
  const untilIso = brtDayBoundaryUtc(until)

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
