import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { probabilityToBeatControl } from '@/lib/domain/significance'
import { toggleTestStatus } from './actions'

interface ReportRow {
  variant_id: string
  variant_name: string
  weight_pct: number
  visits: number
  conversions: number
}

interface SourceReportRow {
  variant_id: string
  variant_name: string
  utm_source: string
  visits: number
  conversions: number
}

export default async function TestReportPage({
  params,
}: {
  params: Promise<{ clientSlug: string; testSlug: string }>
}) {
  const { clientSlug, testSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: test } = await supabase
    .from('tests')
    .select('id, name, slug, status, conversion_method')
    .eq('slug', testSlug)
    .maybeSingle()

  if (!test) notFound()

  const { data: pixelVariants } =
    test.conversion_method === 'thank_you_page'
      ? await supabase.from('variants').select('id, name, thank_you_url').eq('test_id', test.id)
      : { data: null }

  const { data: report } = await supabase.rpc('get_test_report', { p_test_id: test.id })
  const { data: sourceReport } = await supabase.rpc('get_test_report_by_source', { p_test_id: test.id })
  const redirectUrl = `https://${process.env.NEXT_PUBLIC_REDIRECT_DOMAIN}/r/${test.slug}`

  const baseRows = ((report as ReportRow[]) ?? []).map((row) => ({
    ...row,
    rate: row.visits > 0 ? ((row.conversions / row.visits) * 100).toFixed(1) : '0.0',
  }))
  const control = baseRows[0]
  const rows = baseRows.map((row) => ({
    ...row,
    confidencePct:
      control && row.variant_id !== control.variant_id && control.visits > 0 && row.visits > 0
        ? Math.round(
            probabilityToBeatControl(
              { visits: control.visits, conversions: control.conversions },
              { visits: row.visits, conversions: row.conversions }
            ) * 100
          )
        : null,
  }))
  const totalVisits = rows.reduce((sum, row) => sum + row.visits, 0)
  const leaderId =
    totalVisits > 0
      ? rows.reduce(
          (best: (typeof rows)[number] | undefined, row: (typeof rows)[number]) =>
            Number(row.rate) > Number(best?.rate ?? -1) ? row : best,
          rows[0]
        )?.variant_id
      : undefined

  return (
    <div>
      <h1 className="mb-2 text-lg font-semibold">{test.name}</h1>
      <p className="mb-2 text-sm text-gray-600">
        Status: <strong>{test.status === 'active' ? 'ativo' : 'pausado'}</strong>
      </p>
      <form
        action={toggleTestStatus.bind(null, {
          test_id: test.id,
          next_status: test.status === 'active' ? 'paused' : 'active',
          client_slug: clientSlug,
          test_slug: test.slug,
        })}
        className="mb-4"
      >
        <button type="submit" className="rounded border px-3 py-1 text-sm">
          {test.status === 'active' ? 'Pausar teste' : 'Ativar teste'}
        </button>
      </form>
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
            <th>Confiança</th>
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
              <td>
                {row.confidencePct !== null
                  ? `${row.confidencePct}% de ser melhor que o controle`
                  : row.variant_id === control?.variant_id
                    ? 'controle'
                    : 'dados insuficientes'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="mb-2 mt-8 text-lg font-semibold">Por origem (UTM)</h2>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">Variante</th>
            <th>Origem</th>
            <th>Visitas</th>
            <th>Conversões</th>
            <th>Taxa</th>
          </tr>
        </thead>
        <tbody>
          {((sourceReport as SourceReportRow[]) ?? []).map((row) => (
            <tr key={`${row.variant_id}-${row.utm_source}`}>
              <td className="py-2">{row.variant_name}</td>
              <td>{row.utm_source}</td>
              <td>{row.visits}</td>
              <td>{row.conversions}</td>
              <td>{row.visits > 0 ? ((row.conversions / row.visits) * 100).toFixed(1) : '0.0'}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      {pixelVariants && pixelVariants.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-2 text-lg font-semibold">Pixel de conversão (thank-you page)</h2>
          {pixelVariants.map((variant) => {
            const isSafeUrl = variant.thank_you_url ? /^https?:\/\//i.test(variant.thank_you_url) : false
            return (
              <div key={variant.id} className="mb-4 rounded border p-3">
                <p className="mb-2 text-sm text-gray-600">
                  Variante {variant.name}
                  {variant.thank_you_url && isSafeUrl ? (
                    <>
                      {' '}
                      — cole na página:{' '}
                      <a
                        className="text-blue-600 underline"
                        href={variant.thank_you_url}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {variant.thank_you_url}
                      </a>
                    </>
                  ) : variant.thank_you_url ? (
                    <> — URL de thank-you configurada tem um formato inválido: {variant.thank_you_url}</>
                  ) : (
                    <> — nenhuma URL de thank-you configurada para esta variante</>
                  )}
                </p>
              <p className="mb-2 text-xs text-gray-500">
                Importante: seu construtor de página/funil precisa estar configurado para repassar os
                parâmetros da URL original no redirecionamento pra esta página, senão o pixel nunca recebe
                o tracking id.
              </p>
              <pre className="overflow-x-auto rounded bg-gray-100 p-2 text-xs">
                <code>{`<script>
  (function () {
    var params = new URLSearchParams(window.location.search);
    var tid = params.get('utm_content') || params.get('tid');
    if (tid) {
      var img = new Image();
      img.src = 'https://${process.env.NEXT_PUBLIC_REDIRECT_DOMAIN}/ty/${test.slug}?tid=' + encodeURIComponent(tid);
    }
  })();
</script>`}</code>
              </pre>
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
