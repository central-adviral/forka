import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { probabilityToBeatControl } from '@/lib/domain/significance'
import { computeReportLayout } from '@/lib/domain/report-layout'
import { resolveRedirectDomain } from '@/lib/domain/redirect-domain'
import { CopyButton } from '@/components/copy-button'
import { ReportCanvas } from './report-canvas'
import { toggleTestStatus } from './actions'
import { REPORT_PERIODS, resolvePeriodSince } from '@/lib/domain/report-period'
import { RefreshButton } from './refresh-button'

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
  revenue_cents: number
  bot_clicks: number
}

interface TotalsReportRow {
  variant_id: string
  variant_name: string
  clicks: number
  visitors: number
  conversions: number
  revenue_cents: number
}

interface AdReportRow {
  variant_id: string
  variant_name: string
  ad_name: string
  clicks: number
  conversions: number
  revenue_cents: number
  bot_clicks: number
}

export default async function TestReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string; testSlug: string }>
  searchParams: Promise<{ periodo?: string }>
}) {
  const { clientSlug, testSlug } = await params
  const { periodo } = await searchParams
  const since = resolvePeriodSince(periodo)
  const sinceIso = since ? since.toISOString() : null
  const supabase = await createServerSupabaseClient()
  const { data: test } = await supabase
    .from('tests')
    .select('id, name, slug, status, conversion_method, fallback_url, test_type, client_id, clients(custom_domain, domain_status)')
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

  const { data: report } = await supabase.rpc('get_test_report', { p_test_id: test.id, p_since: sinceIso })
  const { data: sourceReport } = await supabase.rpc('get_test_report_by_source', {
    p_test_id: test.id,
    p_since: sinceIso,
  })
  const { data: adReport } = await supabase.rpc('get_test_report_by_ad', { p_test_id: test.id, p_since: sinceIso })
  const { data: totalsReport } = await supabase.rpc('get_test_report_totals', {
    p_test_id: test.id,
    p_since: sinceIso,
  })
  const { data: botClickCount } = await supabase.rpc('get_test_bot_click_count', {
    p_test_id: test.id,
    p_since: sinceIso,
  })

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
  const checkoutLinkUrl = `https://${activeDomain}/c/${test.slug}`

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
          ? `${row.confidencePct}% de ser melhor que a Variante ${control?.variant_name}`
          : 'dados insuficientes',
    ])
  )

  const totalVisits = rows.reduce((sum, row) => sum + row.visits, 0)

  return (
    <div className="flex min-h-screen flex-col">
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
          <RefreshButton />
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

      <div className="mx-6 mt-4 flex gap-1.5">
        {REPORT_PERIODS.map((option) => {
          const isActive = (periodo ?? 'all') === option.value
          return (
            <a
              key={option.value}
              href={option.value === 'all' ? `?` : `?periodo=${option.value}`}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                isActive
                  ? 'border-[#7C6FF0] bg-[#7C6FF0]/15 text-[#7C6FF0]'
                  : 'border-white/[0.08] text-[#8A90A6] hover:text-[#E8EAF2]'
              }`}
            >
              {option.label}
            </a>
          )
        })}
      </div>

      <ReportCanvas
        layout={layout}
        redirectUrl={redirectUrl}
        totalVisits={totalVisits}
        fallbackUrl={test.fallback_url}
        confidenceLabelById={confidenceLabelById}
      />
      {test.test_type === 'checkout' && (
        <div className="mx-6 mb-6">
          <h2 className="mb-2 font-['Space_Grotesk'] text-lg font-semibold">Link do botão de comprar</h2>
          <div className="rounded-[10px] border border-white/[0.08] p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <p className="break-all font-['JetBrains_Mono'] text-xs text-[#4F8EF7]">{checkoutLinkUrl}</p>
              <CopyButton text={checkoutLinkUrl} />
            </div>
            <p className="text-xs text-[#8A90A6]">
              Cole este endereço no botão de comprar da página de vendas. Se a página tiver vários botões de
              compra, todos recebem o mesmo endereço. Trocar os checkouts ou os pesos depois não exige mexer na
              página de novo.
            </p>
          </div>
        </div>
      )}
      <div className="mx-6 mb-6">
        <div className="mb-2 mt-8 flex items-center gap-2">
          <h2 className="font-['Space_Grotesk'] text-lg font-semibold">Total por variante</h2>
          <span className="text-xs text-[#8A90A6]">
            ({botClickCount ?? 0} {botClickCount === 1 ? 'clique de bot filtrado' : 'cliques de bot filtrados'}, não
            contam no total)
          </span>
        </div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/[0.08] text-left">
              <th className="py-2">Variante</th>
              <th>Cliques</th>
              <th>Visitas</th>
              <th>Vendas</th>
              <th>Faturamento</th>
              <th>Taxa</th>
            </tr>
          </thead>
          <tbody>
            {((totalsReport as TotalsReportRow[]) ?? []).map((row) => (
              <tr key={row.variant_id}>
                <td className="py-2">{row.variant_name}</td>
                <td>{row.clicks}</td>
                <td>{row.visitors}</td>
                <td>{row.conversions}</td>
                <td>R$ {(row.revenue_cents / 100).toFixed(2)}</td>
                <td>{row.clicks > 0 ? ((row.conversions / row.clicks) * 100).toFixed(1) : '0.0'}%</td>
              </tr>
            ))}
          </tbody>
        </table>
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
              <th>Faturamento</th>
              <th>Taxa</th>
              <th className="text-[#8A90A6]">Bots</th>
            </tr>
          </thead>
          <tbody>
            {((sourceReport as SourceReportRow[]) ?? []).map((row) => (
              <tr key={`${row.variant_id}-${row.utm_source}`}>
                <td className="py-2">{row.variant_name}</td>
                <td>{row.utm_source}</td>
                <td>{row.visits}</td>
                <td>{row.conversions}</td>
                <td>R$ {(row.revenue_cents / 100).toFixed(2)}</td>
                <td>{row.visits > 0 ? ((row.conversions / row.visits) * 100).toFixed(1) : '0.0'}%</td>
                <td className="text-[#8A90A6]">{row.bot_clicks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mx-6 mb-6">
        <h2 className="mb-2 mt-8 font-['Space_Grotesk'] text-lg font-semibold">Por anúncio</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/[0.08] text-left">
              <th className="py-2">Variante</th>
              <th>Anúncio</th>
              <th>Cliques</th>
              <th>Vendas</th>
              <th>Faturamento</th>
              <th className="text-[#8A90A6]">Bots</th>
            </tr>
          </thead>
          <tbody>
            {((adReport as AdReportRow[]) ?? []).length === 0 ? (
              <tr>
                <td className="py-2 text-[#8A90A6]" colSpan={6}>
                  Nenhum clique com anúncio identificado ainda.
                </td>
              </tr>
            ) : (
              ((adReport as AdReportRow[]) ?? []).map((row) => (
                <tr key={`${row.variant_id}-${row.ad_name}`}>
                  <td className="py-2">{row.variant_name}</td>
                  <td>{row.ad_name}</td>
                  <td>{row.clicks}</td>
                  <td>{row.conversions}</td>
                  <td>R$ {(row.revenue_cents / 100).toFixed(2)}</td>
                  <td className="text-[#8A90A6]">{row.bot_clicks}</td>
                </tr>
              ))
            )}
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
