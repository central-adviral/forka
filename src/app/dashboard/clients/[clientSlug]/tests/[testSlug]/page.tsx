import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'

interface ReportRow {
  variant_id: string
  variant_name: string
  weight_pct: number
  visits: number
  conversions: number
}

export default async function TestReportPage({
  params,
}: {
  params: Promise<{ clientSlug: string; testSlug: string }>
}) {
  const { testSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: test } = await supabase
    .from('tests')
    .select('id, name, slug, status')
    .eq('slug', testSlug)
    .maybeSingle()

  if (!test) notFound()

  const { data: report } = await supabase.rpc('get_test_report', { p_test_id: test.id })
  const redirectUrl = `https://${process.env.NEXT_PUBLIC_REDIRECT_DOMAIN}/r/${test.slug}`

  const rows = ((report as ReportRow[]) ?? []).map((row) => ({
    ...row,
    rate: row.visits > 0 ? ((row.conversions / row.visits) * 100).toFixed(1) : '0.0',
  }))
  const leaderId = rows.reduce(
    (best: (typeof rows)[number] | undefined, row: (typeof rows)[number]) => (Number(row.rate) > Number(best?.rate ?? -1) ? row : best),
    rows[0]
  )?.variant_id

  return (
    <div>
      <h1 className="mb-2 text-lg font-semibold">{test.name}</h1>
      <p className="mb-4 text-sm text-gray-600">
        Link: <code className="rounded bg-gray-100 px-1">{redirectUrl}</code>
      </p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">Variante</th>
            <th>Peso</th>
            <th>Visitas</th>
            <th>Conversões</th>
            <th>Taxa</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.variant_id} className={row.variant_id === leaderId ? 'bg-green-50' : ''}>
              <td className="py-2">{row.variant_name}</td>
              <td>{row.weight_pct}%</td>
              <td>{row.visits}</td>
              <td>{row.conversions}</td>
              <td>{row.rate}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
