import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { probabilityToBeatControl } from '@/lib/domain/significance'
import { computeReportLayout } from '@/lib/domain/report-layout'
import { resolveRedirectDomain } from '@/lib/domain/redirect-domain'
import { CopyButton } from '@/components/copy-button'
import { ReportCanvas } from './report-canvas'
import { toggleTestStatus } from './actions'
import { REPORT_PERIODS, resolvePeriodSince, resolvePeriodUntil, resolveDateRange } from '@/lib/domain/report-period'
import { RefreshButton } from './refresh-button'
import { InsightPanel } from './insight-panel'
import { MiniBarChart } from './mini-bar-chart'

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

interface WeekdayReportRow {
  weekday: number
  clicks: number
  conversions: number
  revenue_cents: number
}

interface HourReportRow {
  hour: number
  clicks: number
  conversions: number
  revenue_cents: number
}

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
  clicks: number
  visitors: number
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
  visitors: number
  conversions: number
  revenue_cents: number
  bot_clicks: number
}

function formatBr(iso: string): string {
  const [, month, day] = iso.split('-')
  return `${day}/${month}`
}

const TH_CLASS = 'px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-[#8A90A6]'
const TD_CLASS = 'relative px-4 py-2.5'
const TR_CLASS = 'border-b border-white/[0.04] last:border-0 even:bg-white/[0.015] hover:bg-white/[0.035]'

function BarCell({ value, max, format }: { value: number; max: number; format: string }) {
  const pct = max > 0 ? Math.max(value > 0 ? 6 : 0, (value / max) * 100) : 0
  return (
    <td className={TD_CLASS}>
      <div className="absolute inset-y-1.5 left-0 rounded-r bg-[#7C6FF0]/[0.14]" style={{ width: `${pct}%` }} />
      <span className="relative">{format}</span>
    </td>
  )
}

function RateCell({ rate }: { rate: string }) {
  return <td className={`${TD_CLASS} ${Number(rate) > 0 ? 'text-[#2DD4A8]' : 'text-[#8A90A6]'}`}>{rate}%</td>
}

export default async function TestReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string; testSlug: string }>
  searchParams: Promise<{ periodo?: string; desde?: string; ate?: string }>
}) {
  const { clientSlug, testSlug } = await params
  const { periodo, desde, ate } = await searchParams
  const customRange = periodo === 'custom' ? resolveDateRange(desde, ate) : null
  const since = periodo === 'custom' ? (customRange?.since ?? null) : resolvePeriodSince(periodo)
  const sinceIso = since ? since.toISOString() : null
  const until = periodo === 'custom' ? (customRange?.until ?? null) : resolvePeriodUntil(periodo)
  const untilIso = until ? until.toISOString() : null
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

  const { data: report } = await supabase.rpc('get_test_report', {
    p_test_id: test.id,
    p_since: sinceIso,
    p_until: untilIso,
  })
  const { data: sourceReport } = await supabase.rpc('get_test_report_by_source', {
    p_test_id: test.id,
    p_since: sinceIso,
    p_until: untilIso,
  })
  const { data: adReport } = await supabase.rpc('get_test_report_by_ad', {
    p_test_id: test.id,
    p_since: sinceIso,
    p_until: untilIso,
  })
  const { data: totalsReport } = await supabase.rpc('get_test_report_totals', {
    p_test_id: test.id,
    p_since: sinceIso,
    p_until: untilIso,
  })
  const { data: weekdayReport } = await supabase.rpc('get_test_report_by_weekday', {
    p_test_id: test.id,
    p_since: sinceIso,
    p_until: untilIso,
  })
  const { data: hourReport } = await supabase.rpc('get_test_report_by_hour', {
    p_test_id: test.id,
    p_since: sinceIso,
    p_until: untilIso,
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

  const revenueByVariant = new Map(
    ((totalsReport as TotalsReportRow[]) ?? []).map((row) => [row.variant_id, row.revenue_cents])
  )

  const layout = computeReportLayout(
    rows.map((row) => ({
      id: row.variant_id,
      name: row.variant_name,
      weightPct: row.weight_pct,
      visits: row.visits,
      conversions: row.conversions,
      revenueCents: revenueByVariant.get(row.variant_id) ?? 0,
      destinationUrl: destinationById.get(row.variant_id) ?? '',
    })),
    Boolean(test.fallback_url)
  )

  const assetLabel = test.test_type === 'checkout' ? 'Checkout' : 'Página'
  const assetArticle = test.test_type === 'checkout' ? 'o' : 'a'
  const assetDemonstrative = test.test_type === 'checkout' ? 'este' : 'esta'

  const confidenceLabelById = new Map(
    rows.map((row) => [
      row.variant_id,
      row.variant_id === control?.variant_id
        ? 'controle'
        : row.confidencePct !== null
          ? `${row.confidencePct}% de ser melhor que ${assetArticle} ${assetLabel} ${control?.variant_name}`
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
        <details className="relative" open={periodo === 'custom' || undefined}>
          <summary
            className={`cursor-pointer list-none rounded-full border px-3 py-1.5 text-xs font-medium ${
              periodo === 'custom'
                ? 'border-[#7C6FF0] bg-[#7C6FF0]/15 text-[#7C6FF0]'
                : 'border-white/[0.08] text-[#8A90A6] hover:text-[#E8EAF2]'
            }`}
          >
            {periodo === 'custom' && desde && ate ? `${formatBr(desde)} - ${formatBr(ate)}` : 'Personalizado'}
          </summary>
          <form
            method="get"
            className="absolute left-0 top-[calc(100%+6px)] z-10 flex flex-col gap-2 rounded-[10px] border border-white/[0.08] bg-[#141829] p-3 shadow-lg"
          >
            <input type="hidden" name="periodo" value="custom" />
            <label className="flex flex-col gap-1 text-[11px] text-[#8A90A6]">
              De
              <input
                type="date"
                name="desde"
                defaultValue={desde ?? ''}
                required
                className="rounded-[8px] border border-white/[0.08] bg-[#1B2036] px-2 py-1 text-xs text-[#E8EAF2]"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[#8A90A6]">
              Até
              <input
                type="date"
                name="ate"
                defaultValue={ate ?? ''}
                required
                className="rounded-[8px] border border-white/[0.08] bg-[#1B2036] px-2 py-1 text-xs text-[#E8EAF2]"
              />
            </label>
            <button type="submit" className="rounded-[8px] bg-[#7C6FF0] px-3 py-1.5 text-xs font-semibold text-[#0B0E1A]">
              Aplicar
            </button>
          </form>
        </details>
      </div>

      <ReportCanvas
        layout={layout}
        redirectUrl={redirectUrl}
        totalVisits={totalVisits}
        fallbackUrl={test.fallback_url}
        confidenceLabelById={confidenceLabelById}
        assetLabel={assetLabel}
      />
      <div className="mx-6 mb-6 grid grid-cols-1 divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] md:grid-cols-3 md:divide-x md:divide-y-0">
        <div className="p-5">
          <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-wide text-[#8A90A6]">
            Faturamento por {assetLabel.toLowerCase()}
          </h3>
          <MiniBarChart
            data={((totalsReport as TotalsReportRow[]) ?? []).map((row) => ({
              label: row.variant_name,
              value: row.revenue_cents,
            }))}
            valueFormat={(v) => `R$ ${(v / 100).toFixed(0)}`}
            barColor="#2DD4A8"
          />
        </div>
        <div className="p-5">
          <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-wide text-[#8A90A6]">
            Cliques por dia da semana
          </h3>
          <MiniBarChart
            data={((weekdayReport as WeekdayReportRow[]) ?? []).map((row) => ({
              label: WEEKDAY_LABELS[row.weekday],
              value: row.clicks,
            }))}
          />
        </div>
        <div className="p-5">
          <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-wide text-[#8A90A6]">
            Vendas por horário do dia
          </h3>
          <MiniBarChart
            data={((hourReport as HourReportRow[]) ?? []).map((row) => ({
              label: row.hour % 3 === 0 ? String(row.hour) : '',
              value: row.conversions,
            }))}
            barColor="#4F8EF7"
          />
        </div>
      </div>
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
        <h2 className="mb-2 mt-8 font-['Space_Grotesk'] text-lg font-semibold">Total por {assetLabel.toLowerCase()}</h2>
        {(() => {
          const totalsRows = (totalsReport as TotalsReportRow[]) ?? []
          const maxClicks = Math.max(1, ...totalsRows.map((r) => r.clicks))
          const maxRevenue = Math.max(1, ...totalsRows.map((r) => r.revenue_cents))
          return (
            <div className="overflow-hidden rounded-2xl border border-white/[0.08]">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-white/[0.08] bg-white/[0.02] text-left">
                    <th className={TH_CLASS}>{assetLabel}</th>
                    <th className={TH_CLASS}>Cliques</th>
                    <th className={TH_CLASS}>Visitas únicas</th>
                    <th className={TH_CLASS}>Vendas</th>
                    <th className={TH_CLASS}>Faturamento</th>
                    <th className={TH_CLASS}>R$/clique</th>
                    <th className={TH_CLASS}>Taxa</th>
                  </tr>
                </thead>
                <tbody>
                  {totalsRows.map((row) => (
                    <tr key={row.variant_id} className={`${TR_CLASS} ${row.clicks === 0 ? 'opacity-50' : ''}`}>
                      <td className={TD_CLASS}>{row.variant_name}</td>
                      <BarCell value={row.clicks} max={maxClicks} format={String(row.clicks)} />
                      <td className={TD_CLASS}>{row.visitors}</td>
                      <td className={TD_CLASS}>{row.conversions}</td>
                      <BarCell
                        value={row.revenue_cents}
                        max={maxRevenue}
                        format={`R$ ${(row.revenue_cents / 100).toFixed(2)}`}
                      />
                      <td className={TD_CLASS}>
                        R$ {(row.clicks > 0 ? row.revenue_cents / row.clicks / 100 : 0).toFixed(2)}
                      </td>
                      <RateCell rate={row.clicks > 0 ? ((row.conversions / row.clicks) * 100).toFixed(1) : '0.0'} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })()}
      </div>
      <div className="mx-6 mb-6">
        <h2 className="mb-2 mt-8 font-['Space_Grotesk'] text-lg font-semibold">Por origem (UTM)</h2>
        {(() => {
          const sourceRows = (sourceReport as SourceReportRow[]) ?? []
          const maxClicks = Math.max(1, ...sourceRows.map((r) => r.clicks))
          const maxRevenue = Math.max(1, ...sourceRows.map((r) => r.revenue_cents))
          return (
            <div className="overflow-hidden rounded-2xl border border-white/[0.08]">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-white/[0.08] bg-white/[0.02] text-left">
                    <th className={TH_CLASS}>{assetLabel}</th>
                    <th className={TH_CLASS}>Origem</th>
                    <th className={TH_CLASS}>Cliques</th>
                    <th className={TH_CLASS}>Visitas únicas</th>
                    <th className={TH_CLASS}>Vendas</th>
                    <th className={TH_CLASS}>Faturamento</th>
                    <th className={TH_CLASS}>R$/clique</th>
                    <th className={TH_CLASS}>Taxa</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceRows.map((row) => (
                    <tr
                      key={`${row.variant_id}-${row.utm_source}`}
                      className={`${TR_CLASS} ${row.clicks === 0 ? 'opacity-50' : ''}`}
                    >
                      <td className={TD_CLASS}>{row.variant_name}</td>
                      <td className={TD_CLASS}>{row.utm_source}</td>
                      <BarCell value={row.clicks} max={maxClicks} format={String(row.clicks)} />
                      <td className={TD_CLASS}>{row.visitors}</td>
                      <td className={TD_CLASS}>{row.conversions}</td>
                      <BarCell
                        value={row.revenue_cents}
                        max={maxRevenue}
                        format={`R$ ${(row.revenue_cents / 100).toFixed(2)}`}
                      />
                      <td className={TD_CLASS}>
                        R$ {(row.clicks > 0 ? row.revenue_cents / row.clicks / 100 : 0).toFixed(2)}
                      </td>
                      <RateCell rate={row.clicks > 0 ? ((row.conversions / row.clicks) * 100).toFixed(1) : '0.0'} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })()}
      </div>
      <div className="mx-6 mb-6">
        <h2 className="mb-2 mt-8 font-['Space_Grotesk'] text-lg font-semibold">Por anúncio</h2>
        {(() => {
          const adRows = (adReport as AdReportRow[]) ?? []
          const maxClicks = Math.max(1, ...adRows.map((r) => r.clicks))
          const maxRevenue = Math.max(1, ...adRows.map((r) => r.revenue_cents))
          return (
            <div className="overflow-hidden rounded-2xl border border-white/[0.08]">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-white/[0.08] bg-white/[0.02] text-left">
                    <th className={TH_CLASS}>{assetLabel}</th>
                    <th className={TH_CLASS}>Anúncio</th>
                    <th className={TH_CLASS}>Cliques</th>
                    <th className={TH_CLASS}>Visitas únicas</th>
                    <th className={TH_CLASS}>Vendas</th>
                    <th className={TH_CLASS}>Faturamento</th>
                    <th className={TH_CLASS}>R$/clique</th>
                    <th className={TH_CLASS}>Taxa</th>
                  </tr>
                </thead>
                <tbody>
                  {adRows.length === 0 ? (
                    <tr>
                      <td className={`${TD_CLASS} text-[#8A90A6]`} colSpan={8}>
                        Nenhum clique com anúncio identificado ainda.
                      </td>
                    </tr>
                  ) : (
                    adRows.map((row) => (
                      <tr
                        key={`${row.variant_id}-${row.ad_name}`}
                        className={`${TR_CLASS} ${row.clicks === 0 ? 'opacity-50' : ''}`}
                      >
                        <td className={TD_CLASS}>{row.variant_name}</td>
                        <td className={TD_CLASS}>{row.ad_name}</td>
                        <BarCell value={row.clicks} max={maxClicks} format={String(row.clicks)} />
                        <td className={TD_CLASS}>{row.visitors}</td>
                        <td className={TD_CLASS}>{row.conversions}</td>
                        <BarCell
                          value={row.revenue_cents}
                          max={maxRevenue}
                          format={`R$ ${(row.revenue_cents / 100).toFixed(2)}`}
                        />
                        <td className={TD_CLASS}>
                          R$ {(row.clicks > 0 ? row.revenue_cents / row.clicks / 100 : 0).toFixed(2)}
                        </td>
                        <RateCell rate={row.clicks > 0 ? ((row.conversions / row.clicks) * 100).toFixed(1) : '0.0'} />
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )
        })()}
      </div>
      <InsightPanel testId={test.id} sinceIso={sinceIso} untilIso={untilIso} />
      {pixelVariants && pixelVariants.length > 0 && (
        <div className="mx-6 mb-6">
          <h2 className="mb-2 font-['Space_Grotesk'] text-lg font-semibold">Pixel de conversão (thank-you page)</h2>
          {pixelVariants.map((variant) => {
            const isSafeUrl = variant.thank_you_url ? /^https?:\/\//i.test(variant.thank_you_url) : false
            return (
              <div key={variant.id} className="mb-4 rounded-[10px] border border-white/[0.08] p-3">
                <p className="mb-2 text-sm text-[#8A90A6]">
                  {assetLabel} {variant.name}
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
                    <> — nenhuma URL de thank-you configurada para {assetDemonstrative} {assetLabel.toLowerCase()}</>
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
