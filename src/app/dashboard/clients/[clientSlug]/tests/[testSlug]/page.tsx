import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { probabilityToBeatControl } from '@/lib/domain/significance'
import { computeReportLayout } from '@/lib/domain/report-layout'
import { resolveRedirectDomain } from '@/lib/domain/redirect-domain'
import { CopyButton } from '@/components/copy-button'
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
    .select('id, name, slug, status, conversion_method, fallback_url, client_id, clients(custom_domain, domain_status)')
    .eq('slug', testSlug)
    .maybeSingle()

  if (!test) notFound()

  const { data: pixelVariants } =
    test.conversion_method === 'thank_you_page'
      ? await supabase.from('variants').select('id, name, thank_you_url').eq('test_id', test.id)
      : { data: null }

  const { data: variantRows } = await supabase
    .from('variants')
    .select('id, destination_url, is_control')
    .eq('test_id', test.id)
  const destinationById = new Map((variantRows ?? []).map((v) => [v.id, v.destination_url as string]))
  const controlVariantId = (variantRows ?? []).find((v) => v.is_control)?.id

  const { data: report } = await supabase.rpc('get_test_report', { p_test_id: test.id })
  const { data: sourceReport } = await supabase.rpc('get_test_report_by_source', { p_test_id: test.id })

  if (!report || report.length === 0) {
    return (
      <div className="p-8">
        <p className="text-sm text-[#8A90A6]">
          Não foi possível carregar os dados deste teste. Tente novamente em instantes.
        </p>
      </div>
    )
  }

  const clientDomain = test.clients as unknown as { custom_domain: string | null; domain_status: 'unconfigured' | 'pending' | 'verified' } | null
  const activeDomain = resolveRedirectDomain(
    { customDomain: clientDomain?.custom_domain ?? null, domainStatus: clientDomain?.domain_status ?? 'unconfigured' },
    process.env.NEXT_PUBLIC_REDIRECT_DOMAIN ?? ''
  )
  const redirectUrl = `https://${activeDomain}/r/${test.slug}`

  const baseRows = ((report as ReportRow[]) ?? []).map((row) => ({
    ...row,
    rate: row.visits > 0 ? ((row.conversions / row.visits) * 100).toFixed(1) : '0.0',
  }))
  const control = baseRows.find((row) => row.variant_id === controlVariantId) ?? baseRows[0]
  const rows = baseRows.map((row) => {
    const p =
      control && row.variant_id !== control.variant_id
        ? probabilityToBeatControl(
            { visits: control.visits, conversions: control.conversions },
            { visits: row.visits, conversions: row.conversions }
          )
        : null
    return { ...row, confidencePct: p !== null ? Math.round(p * 100) : null }
  })

  const layout = computeReportLayout(
    rows.map((row) => ({
      id: row.variant_id,
      name: row.variant_name,
      weightPct: row.weight_pct,
      visits: row.visits,
      conversions: row.conversions,
      destinationUrl: destinationById.get(row.variant_id) ?? '',
    })),
    Boolean(test.fallback_url)
  )

  const confidenceLabelById = new Map(
    rows.map((row) => [
      row.variant_id,
      row.variant_id === control?.variant_id
        ? 'controle'
        : row.confidencePct !== null
          ? `${row.confidencePct}% de ser melhor que o controle`
          : 'dados insuficientes',
    ])
  )

  const totalVisits = rows.reduce((sum, row) => sum + row.visits, 0)

  return (
    <div className="flex h-screen flex-col">
      <div className="flex h-[88px] flex-shrink-0 items-center justify-between border-b border-white/[0.08] px-8">
        <div>
          <a
            href={`/dashboard/clients/${clientSlug}`}
            className="mb-1 flex items-center gap-1 text-xs text-[#8A90A6] hover:text-[#E8EAF2]"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M6.5 2L3 5L6.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Testes
          </a>
          <div className="flex items-center gap-2.5">
            <h1 className="font-['Space_Grotesk'] text-[19px] font-semibold">{test.name}</h1>
            <span
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium ${
                test.status === 'active' ? 'border-[#2DD4A8]/35 text-[#2DD4A8]' : 'border-[#F76C6C]/35 text-[#F76C6C]'
              }`}
            >
              {test.status === 'active' ? 'Ativo' : 'Pausado'}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <p className="font-['JetBrains_Mono'] text-xs text-[#8A90A6]">{redirectUrl}</p>
            <CopyButton text={redirectUrl} />
          </div>
        </div>
        <div className="flex items-center gap-5">
          <div className="flex flex-col items-end">
            <span className="font-['JetBrains_Mono'] text-[17px] font-medium">{totalVisits}</span>
            <span className="text-[11px] text-[#8A90A6]">acessos</span>
          </div>
          <a
            href={`/dashboard/clients/${clientSlug}/tests/${test.slug}/edit`}
            className="flex h-9 items-center rounded-[9px] border border-white/[0.08] bg-transparent px-4 text-[13px] font-medium text-[#8A90A6]"
          >
            Editar
          </a>
          <form
            action={toggleTestStatus.bind(null, {
              test_id: test.id,
              next_status: test.status === 'active' ? 'paused' : 'active',
              client_slug: clientSlug,
              test_slug: test.slug,
            })}
          >
            <button
              type="submit"
              className="h-9 rounded-[9px] border border-white/[0.08] bg-transparent px-4 text-[13px] font-medium text-[#8A90A6]"
            >
              {test.status === 'active' ? 'Pausar teste' : 'Ativar teste'}
            </button>
          </form>
        </div>
      </div>

      <div className="relative m-6 flex-1 overflow-auto rounded-2xl border border-white/[0.08]">
        <svg
          width={layout.canvasWidth}
          height={layout.canvasHeight}
          viewBox={`0 0 ${layout.canvasWidth} ${layout.canvasHeight}`}
          className="absolute left-5 top-5"
          fill="none"
        >
          {layout.variants.map((variant) => (
            <path
              key={`traffic-${variant.id}`}
              d={variant.trafficEdge.path}
              stroke="#4F8EF7"
              strokeWidth={variant.trafficEdge.strokeWidth}
              strokeLinecap="round"
              opacity={0.55}
            />
          ))}
          {layout.variants.map((variant) => (
            <path
              key={`conversion-${variant.id}`}
              d={variant.conversionEdge.path}
              stroke={variant.conversionEdge.color}
              strokeWidth={variant.conversionEdge.strokeWidth}
              strokeLinecap="round"
              opacity={0.8}
            />
          ))}
          {layout.fallback && (
            <path
              d={layout.fallback.edge.path}
              stroke="#F76C6C"
              strokeWidth={2}
              strokeDasharray="5 5"
              strokeLinecap="round"
              opacity={0.5}
            />
          )}
        </svg>

        <div
          className="absolute rounded-xl border border-white/[0.08] bg-[#141829] p-[18px]"
          style={{ left: layout.entryNode.x + 20, top: layout.entryNode.y + 20, width: layout.entryNode.w, height: layout.entryNode.h }}
        >
          <div className="mb-2.5 font-['JetBrains_Mono'] text-[10.5px] uppercase tracking-widest text-[#8A90A6]">
            Link do teste
          </div>
          <div className="mb-4 break-all font-['JetBrains_Mono'] text-[12.5px] text-[#4F8EF7]">{redirectUrl}</div>
          <div className="font-['Space_Grotesk'] text-[22px] font-semibold">{totalVisits}</div>
          <div className="text-[11.5px] text-[#8A90A6]">acessos totais</div>
        </div>

        {layout.fallback && (
          <div
            className="absolute rounded-[10px] border border-[#F76C6C]/30 bg-[#141829] px-3.5 py-2.5 opacity-85"
            style={{ left: layout.fallback.node.x + 20, top: layout.fallback.node.y + 20, width: layout.fallback.node.w }}
          >
            <div className="mb-0.5 text-[10.5px] uppercase tracking-wide text-[#F76C6C]">Fallback</div>
            <div className="font-['JetBrains_Mono'] text-[11.5px] text-[#8A90A6]">{test.fallback_url}</div>
          </div>
        )}

        {layout.variants.map((variant) => (
          <div key={variant.id}>
            <div
              className={`absolute rounded-xl border bg-[#141829] p-[18px_20px] ${
                variant.isLeader
                  ? 'border-[#F5B94D] shadow-[0_0_0_3px_rgba(245,185,77,0.14),0_0_32px_rgba(245,185,77,0.18)]'
                  : 'border-white/[0.08]'
              }`}
              style={{ left: variant.node.x + 20, top: variant.node.y + 20, width: variant.node.w, height: variant.node.h }}
            >
              <div className="mb-3.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-[3px] bg-[#4F8EF7]" />
                  <span className="font-['Space_Grotesk'] text-[15px] font-semibold">Variante {variant.name}</span>
                  {variant.isLeader && (
                    <span className="rounded-full bg-[#F5B94D]/15 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#F5B94D]">
                      Líder
                    </span>
                  )}
                </div>
                <span className="rounded-full bg-[#1B2036] px-2.5 py-0.5 font-['JetBrains_Mono'] text-[11.5px] text-[#8A90A6]">
                  alvo {variant.weightPct}%
                </span>
              </div>
              <div className="mb-3.5 flex gap-7">
                <div>
                  <div className="font-['JetBrains_Mono'] text-base font-medium">{variant.visits}</div>
                  <div className="text-[11px] text-[#8A90A6]">acessos</div>
                </div>
                <div>
                  <div className="font-['JetBrains_Mono'] text-base font-medium">{variant.conversions}</div>
                  <div className="text-[11px] text-[#8A90A6]">conversões</div>
                </div>
              </div>
              <div className="truncate border-t border-white/[0.08] pt-3 font-['JetBrains_Mono'] text-xs text-[#8A90A6]">
                {variant.destinationUrl}
              </div>
            </div>

            <div
              className={`absolute flex flex-col justify-center rounded-xl border bg-[#141829] p-4 ${
                variant.isLeader ? 'border-[#F5B94D] shadow-[0_0_24px_rgba(245,185,77,0.14)]' : 'border-white/[0.08]'
              }`}
              style={{
                left: variant.conversionNode.x + 20,
                top: variant.conversionNode.y + 20,
                width: variant.conversionNode.w,
                height: variant.conversionNode.h,
              }}
            >
              <div className="mb-2 text-[10.5px] uppercase tracking-wide text-[#8A90A6]">Conversão</div>
              <div
                className="font-['JetBrains_Mono'] text-[26px] font-semibold leading-none"
                style={{ color: variant.isLeader ? '#F5B94D' : '#2DD4A8' }}
              >
                {variant.ratePct.toFixed(1)}%
              </div>
              <div className="mt-1 text-[11.5px] text-[#8A90A6]">
                {variant.conversions} vendas · {confidenceLabelById.get(variant.id)}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mx-6 mb-6">
        <h2 className="mb-2 mt-8 font-['Space_Grotesk'] text-lg font-semibold">Por origem (UTM)</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/[0.08] text-left">
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
      </div>
      {pixelVariants && pixelVariants.length > 0 && (
        <div className="mx-6 mb-6">
          <h2 className="mb-2 font-['Space_Grotesk'] text-lg font-semibold">Pixel de conversão (thank-you page)</h2>
          {pixelVariants.map((variant) => {
            const isSafeUrl = variant.thank_you_url ? /^https?:\/\//i.test(variant.thank_you_url) : false
            return (
              <div key={variant.id} className="mb-4 rounded-[10px] border border-white/[0.08] p-3">
                <p className="mb-2 text-sm text-[#8A90A6]">
                  Variante {variant.name}
                  {variant.thank_you_url && isSafeUrl ? (
                    <>
                      {' '}
                      — cole na página:{' '}
                      <a
                        className="text-[#4F8EF7] underline"
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
                <p className="mb-2 text-xs text-[#8A90A6]">
                  Importante: seu construtor de página/funil precisa estar configurado para repassar os
                  parâmetros da URL original no redirecionamento pra esta página, senão o pixel nunca recebe
                  o tracking id.
                </p>
                <pre className="overflow-x-auto rounded bg-[#1B2036] p-2 text-xs">
                  <code>{`<script>
  (function () {
    var params = new URLSearchParams(window.location.search);
    var tid = params.get('utm_content') || params.get('tid');
    if (tid) {
      var img = new Image();
      img.src = 'https://${activeDomain}/ty/${test.slug}?tid=' + encodeURIComponent(tid);
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
