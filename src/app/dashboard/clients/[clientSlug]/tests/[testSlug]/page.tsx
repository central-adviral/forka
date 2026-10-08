import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { probabilityToBeatControl } from '@/lib/domain/significance'
import { detectSampleRatioMismatch } from '@/lib/domain/srm-check'
import { reportTrust } from '@/lib/domain/test-trust'
import { testLeader } from '@/lib/domain/test-leader'
import { computeReportLayout } from '@/lib/domain/report-layout'
import { resolveRedirectDomain } from '@/lib/domain/redirect-domain'
import { CopyButton } from '@/components/copy-button'
import { ReportCanvas } from './report-canvas'
import { toggleTestStatus } from './actions'
import { REPORT_PERIODS, resolvePeriodSince, resolvePeriodUntil, resolveDateRange, resolvePreviousWindow, formatBr, daysRunningSince } from '@/lib/domain/report-period'
import { RefreshButton } from './refresh-button'
import { CreativeMatrixPanel } from './creative-matrix-panel'
import { InsightPanel } from './insight-panel'
import { MiniBarChart } from '@/components/mini-bar-chart'
import { canActAs } from '@/lib/view-as'

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

// Tabs live in the URL rather than in client state, because this page is a Server Component that
// queries per render: a tab needing three of the reports pays for three, not for all of them.
const REPORT_TABS = [
  { value: 'desempenho', label: 'Desempenho' },
  { value: 'criativos', label: 'Criativos' },
  { value: 'origens', label: 'Origens' },
  { value: 'insight', label: 'Insight' },
] as const

type ReportTab = (typeof REPORT_TABS)[number]['value']

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

// One count for the whole report (0077): visits are people, conversions are buyers, and sales and
// revenue are every purchase of those buyers, upsell included.
interface ReportRow {
  variant_id: string
  variant_name: string
  weight_pct: number
  visits: number
  conversions: number
  clicks: number
  sales: number
  revenue_cents: number
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

interface AdReportRow {
  variant_id: string
  variant_name: string
  ad_name: string
  clicks: number
  visitors: number
  conversions: number
  revenue_cents: number
  bot_clicks: number
  ad_spend: number | null
  ad_impressions: number | null
  ad_link_clicks: number | null
}

const TH_CLASS = 'px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--ct-text-2)]'
const TD_CLASS = 'relative px-4 py-2.5'
const TR_CLASS = 'border-b border-[var(--ct-line)] last:border-0 even:bg-[var(--ct-surface-2)] hover:bg-[var(--ct-surface-2)]'

const METRIC_INFO = {
  cliques: 'Total de vezes que o link foi clicado, incluindo cliques repetidos da mesma pessoa.',
  visitas: 'Número de pessoas diferentes que clicaram, contando cada uma só uma vez mesmo se ela clicar várias vezes.',
  vendas: 'Número de vendas confirmadas atribuídas a essa linha.',
  faturamento: 'Soma do valor de todas as vendas confirmadas dessa linha.',
  rsPorClique: 'Faturamento dividido pelo número de cliques — quanto cada clique rendeu em média.',
  rsPorAcesso: 'Faturamento dividido pelo número de visitas únicas — quanto cada visitante rendeu em média.',
  pessoas: 'Pessoas diferentes que entraram no teste, cada uma contada uma vez, na primeira variante que recebeu.',
  compradores: 'Pessoas que compraram depois de entrar. É o número que decide o teste: a taxa e a chance usam ele.',
  vendasTeste: 'Todas as compras dessas pessoas, incluindo upsell e segunda compra. Por isso pode ser maior que compradores.',
  faturamentoTeste: 'Soma do valor dessas vendas.',
  rsPorPessoa: 'Faturamento dividido pelas pessoas — quanto cada pessoa que entrou rendeu em média. Decide teste de preço e oferta.',
  taxaClique: 'Porcentagem de cliques desta linha que viraram venda. É um recorte por clique: quem decide o teste é a taxa de compradores do resultado.',
  taxa: 'Porcentagem de pessoas que compraram: cada pessoa conta uma vez, mesmo com upsell. Por isso pode diferir da coluna de vendas, que conta cada venda.',
  gasto: 'Total investido em mídia paga nesse anúncio, vindo do Meta Ads.',
  cpm: 'Custo por mil impressões do anúncio no Meta Ads.',
  ctr: 'Porcentagem de impressões do anúncio que viraram clique no link, direto no Meta Ads.',
}

function InfoTooltip({ text }: { text: string }) {
  return (
    <span tabIndex={0} aria-label={text} className="group relative ml-1 inline-flex cursor-help align-middle outline-none">
      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-[var(--ct-line-2)] text-[9px] font-bold normal-case text-[var(--ct-text-2)]">
        !
      </span>
      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 w-48 -translate-x-1/2 rounded-md border border-[var(--ct-line)] bg-[var(--ct-surface-2)] p-2 text-[11px] font-normal normal-case leading-snug tracking-normal text-[var(--ct-text)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus:opacity-100">
        {text}
      </span>
    </span>
  )
}

function ThWithInfo({ label, info }: { label: string; info: string }) {
  return (
    <th className={TH_CLASS}>
      <span className="inline-flex items-center">
        {label}
        <InfoTooltip text={info} />
      </span>
    </th>
  )
}

function BarCell({
  value,
  max,
  format,
  children,
}: {
  value: number
  max: number
  format: string
  children?: React.ReactNode
}) {
  const pct = max > 0 ? Math.max(value > 0 ? 6 : 0, (value / max) * 100) : 0
  return (
    <td className={TD_CLASS}>
      <div className="absolute inset-y-1.5 left-0 rounded-r bg-[var(--ct-accent)]/[0.14]" style={{ width: `${pct}%` }} />
      <span className="relative">{format}</span>
      {children && <div className="relative mt-0.5">{children}</div>}
    </td>
  )
}

function RateCell({ rate, children }: { rate: string; children?: React.ReactNode }) {
  return (
    <td className={`${TD_CLASS} ${Number(rate) > 0 ? 'text-[var(--ct-ok)]' : 'text-[var(--ct-text-2)]'}`}>
      {rate}%
      {children && <div className="mt-0.5">{children}</div>}
    </td>
  )
}

// Counts and money read as a percentage; a rate reads in percentage points, because a rate that
// moves from 2,1% to 3,4% rose 1,3 p.p., not 62%.
function Delta({ current, previous, unit }: { current: number; previous: number | null; unit: 'pct' | 'pp' }) {
  if (previous === null) return <span className="text-[11px] text-[var(--ct-text-3)]">—</span>
  const diff = unit === 'pp' ? current - previous : previous === 0 ? null : ((current - previous) / previous) * 100
  if (diff === null) {
    return <span className="text-[11px] text-[var(--ct-text-3)]">novo</span>
  }
  const rounded = unit === 'pp' ? diff.toFixed(1) : Math.round(diff).toString()
  const sign = diff > 0 ? '+' : ''
  const tone = diff > 0 ? 'text-[var(--ct-ok)]' : diff < 0 ? 'text-[var(--ct-crit)]' : 'text-[var(--ct-text-3)]'
  return (
    <span className={`font-[family-name:var(--font-geist-mono)] text-[11px] ${tone}`}>
      {sign}
      {rounded}
      {unit === 'pp' ? ' p.p.' : '%'}
    </span>
  )
}

function BotTag({ clicks, botClicks }: { clicks: number; botClicks: number }) {
  if (botClicks === 0) return null
  const pct = Math.round((botClicks / (clicks + botClicks)) * 100)
  return (
    <span
      title="Cliques adicionais identificados como bot/crawler (ex.: pré-visualização de link da Meta) — não contam em visitas, vendas ou faturamento."
      className="ml-2 inline-flex cursor-help items-center rounded-full bg-[var(--ct-surface-2)] px-1.5 py-0.5 text-[10px] font-medium normal-case text-[var(--ct-text-2)]"
    >
      {pct}% bot
    </span>
  )
}

export default async function TestReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string; testSlug: string }>
  searchParams: Promise<{ periodo?: string; desde?: string; ate?: string; aba?: string; comparar?: string }>
}) {
  const { clientSlug, testSlug } = await params
  const { periodo, desde, ate, aba, comparar } = await searchParams
  const tab: ReportTab = REPORT_TABS.some((option) => option.value === aba) ? (aba as ReportTab) : 'desempenho'
  const customRange = periodo === 'custom' ? resolveDateRange(desde, ate) : null
  const since = periodo === 'custom' ? (customRange?.since ?? null) : resolvePeriodSince(periodo)
  const sinceIso = since ? since.toISOString() : null
  const until = periodo === 'custom' ? (customRange?.until ?? null) : resolvePeriodUntil(periodo)
  const untilIso = until ? until.toISOString() : null
  const previousWindow = comparar === '1' ? resolvePreviousWindow(since, until) : null
  const previousSinceIso = previousWindow ? previousWindow.since.toISOString() : null
  const previousUntilIso = previousWindow ? previousWindow.until.toISOString() : null
  const supabase = await createServerSupabaseClient()
  const { data: test, error: testError } = await supabase
    .from('tests')
    .select('id, name, slug, status, archived_at, conversion_method, fallback_url, test_type, client_id, created_at, clients(custom_domain, domain_status)')
    .eq('slug', testSlug)
    .maybeSingle()

  if (testError) {
    console.error('[test-report-fetch-failed]', { testSlug }, testError)
    return (
      <div className="p-8">
        <p className="text-sm text-[var(--ct-text-2)]">Não foi possível carregar este teste agora. Tente novamente em instantes.</p>
      </div>
    )
  }
  if (!test) notFound()
  // The client reads the report; editing, pausing and the paid insight stay with who runs the test.
  const canEdit = await canActAs(supabase, test.client_id, 'gestor')
  // An archived test is read-only history (0076): no edit, no reactivation.
  const archived = test.archived_at !== null

  // get_test_report and the variant rows feed the header and the summary bar, which every tab
  // shows; the rest is fetched only by the tab that renders it.
  const skip = Promise.resolve({ data: null, error: null })
  const period = { p_test_id: test.id, p_since: sinceIso, p_until: untilIso }
  const previousPeriod = { p_test_id: test.id, p_since: previousSinceIso, p_until: previousUntilIso }

  const [
    { data: variantRows, error: variantRowsError },
    { data: report, error: reportError },
    { data: sourceReport, error: sourceReportError },
    { data: adReport, error: adReportError },
    { data: weekdayReport, error: weekdayReportError },
    { data: hourReport, error: hourReportError },
    { data: previousReport },
    { data: lastWeightChange },
    { data: measuredCards },
  ] = await Promise.all([
    supabase.from('variants').select('id, destination_url, is_control').eq('test_id', test.id),
    supabase.rpc('get_test_report', period),
    tab === 'origens' ? supabase.rpc('get_test_report_by_source', period) : skip,
    tab === 'criativos' ? supabase.rpc('get_test_report_by_ad', period) : skip,
    tab === 'desempenho' ? supabase.rpc('get_test_report_by_weekday', period) : skip,
    tab === 'desempenho' ? supabase.rpc('get_test_report_by_hour', period) : skip,
    previousWindow ? supabase.rpc('get_test_report', previousPeriod) : skip,
    supabase.from('test_changes').select('created_at').eq('test_id', test.id).eq('field', 'weight_pct').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('backlog_items').select('code, title, status, sales_funnels(slug)').eq('ab_test_id', test.id).order('created_at', { ascending: false }).limit(1),
  ])
  // The card this test measures: the decision lives there, next to the hypothesis and the learning.
  const measuredCard = ((measuredCards ?? []) as unknown as { code: string; title: string; status: string; sales_funnels: { slug: string } | null }[])[0]

  // Traffic before the last weight change was drawn with the old weights: the draw is checked
  // only from that change on, or a 70/30 → 50/50 switch reads as a skewed draw (0076).
  const weightChangedAt: string | null = lastWeightChange?.created_at ?? null
  const srmSince = weightChangedAt && (!sinceIso || weightChangedAt > sinceIso) ? weightChangedAt : null
  const { data: srmReport } = srmSince
    ? await supabase.rpc('get_test_report', { p_test_id: test.id, p_since: srmSince, p_until: untilIso })
    : { data: null }

  if (variantRowsError) console.error('[test-report-rpc-failed]', { testId: test.id, rpc: 'variantRows' }, variantRowsError)
  if (reportError) console.error('[test-report-rpc-failed]', { testId: test.id, rpc: 'get_test_report' }, reportError)
  if (sourceReportError) console.error('[test-report-rpc-failed]', { testId: test.id, rpc: 'get_test_report_by_source' }, sourceReportError)
  if (adReportError) console.error('[test-report-rpc-failed]', { testId: test.id, rpc: 'get_test_report_by_ad' }, adReportError)
  if (weekdayReportError) console.error('[test-report-rpc-failed]', { testId: test.id, rpc: 'get_test_report_by_weekday' }, weekdayReportError)
  if (hourReportError) console.error('[test-report-rpc-failed]', { testId: test.id, rpc: 'get_test_report_by_hour' }, hourReportError)

  const hasPartialDataError = Boolean(
    variantRowsError || reportError || sourceReportError || adReportError || weekdayReportError || hourReportError
  )

  const destinationById = new Map((variantRows ?? []).map((v) => [v.id, v.destination_url as string]))
  const controlVariantId = (variantRows ?? []).find((v) => v.is_control)?.id

  if (reportError || !report || report.length === 0) {
    return (
      <div className="p-8">
        <p className="text-sm text-[var(--ct-text-2)]">
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

  const daysRunning = daysRunningSince(test.created_at)
  const srmRows = srmReport ? (srmReport as ReportRow[]) : rows
  const trust = reportTrust(
    detectSampleRatioMismatch(srmRows.map((row) => ({ weightPct: row.weight_pct, visits: row.visits }))),
    rows.map((row) => ({ isControl: row.variant_id === control?.variant_id, weightPct: row.weight_pct, visits: row.visits, conversions: row.conversions })),
    daysRunning
  )
  const dataQuality = srmSince
    ? { ...trust, explain: `${trust.explain} O sorteio é conferido desde a mudança de peso de ${new Date(srmSince).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.` }
    : trust

  // Same rule as the test list: the canvas, the summary and the list never name different leaders.
  const leader = testLeader(rows, control?.variant_id)
  const leaderRow = leader ? rows.find((row) => row.variant_id === leader.variantId) : undefined


  const layout = computeReportLayout(
    rows.map((row) => ({
      id: row.variant_id,
      name: row.variant_name,
      weightPct: row.weight_pct,
      visits: row.visits,
      clicks: Number(row.clicks),
      conversions: row.conversions,
      revenueCents: Number(row.revenue_cents),
      destinationUrl: destinationById.get(row.variant_id) ?? '',
    })),
    Boolean(test.fallback_url),
    leader?.variantId ?? null
  )

  const assetLabel = test.test_type === 'checkout' ? 'Checkout' : 'Página'
  const assetArticle = test.test_type === 'checkout' ? 'o' : 'a'

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

  // "Tudo" has no window before it, so the toggle is not offered there at all.
  const comparableWindow = resolvePreviousWindow(since, until)
  const previousLabel = comparableWindow
    ? `${formatBr(comparableWindow.since.toISOString().slice(0, 10))} - ${formatBr(
        new Date(comparableWindow.until.getTime() - 1).toISOString().slice(0, 10)
      )}`
    : null
  const comparingQuery = new URLSearchParams()
  if (periodo) comparingQuery.set('periodo', periodo)
  if (periodo === 'custom' && desde) comparingQuery.set('desde', desde)
  if (periodo === 'custom' && ate) comparingQuery.set('ate', ate)
  if (tab !== 'desempenho') comparingQuery.set('aba', tab)
  if (comparar !== '1') comparingQuery.set('comparar', '1')
  const comparingHref = comparingQuery.size > 0 ? `?${comparingQuery}` : '?'

  const previousRows = (previousReport as ReportRow[] | null) ?? null
  const previousTotalVisits = previousRows ? previousRows.reduce((sum, row) => sum + row.visits, 0) : null
  const previousByVariant = new Map((previousRows ?? []).map((row) => [row.variant_id, row]))
  const previousLeaderConversions = previousRows
    ? (previousRows.find((row) => row.variant_id === leaderRow?.variant_id)?.conversions ?? 0)
    : null

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex flex-shrink-0 flex-wrap items-start justify-between gap-4 border-b border-[var(--ct-line)] px-8 py-4">
        <div>
          <a
            href={`/dashboard/clients/${clientSlug}/tests`}
            className="mb-1 flex items-center gap-1 text-xs text-[var(--ct-text-2)] hover:text-[var(--ct-text)]"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M6.5 2L3 5L6.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Testes
          </a>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-[family-name:var(--font-sora)] text-[24px] font-semibold tracking-[-0.015em]">{test.name}</h1>
            {/* Estado do teste como ponto + palavra: é contexto de baixa frequência e não deve
                competir com o nome. O julgamento do dado desceu para junto do número que ele
                qualifica, na barra de resumo. */}
            <span
              className={`flex items-center gap-1.5 text-xs ${
                test.status === 'active' ? 'text-[var(--ct-ok)]' : 'text-[var(--ct-crit)]'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  test.status === 'active' ? 'bg-[var(--ct-ok)]' : 'bg-[var(--ct-crit)]'
                }`}
              />
              {archived ? 'Arquivado' : test.status === 'active' ? 'Ativo' : 'Pausado'}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <p className="font-[family-name:var(--font-geist-mono)] text-xs text-[var(--ct-text-3)]">{redirectUrl}</p>
            <CopyButton text={redirectUrl} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <RefreshButton />
          {canEdit && !archived && <>
          <a
            href={`/dashboard/clients/${clientSlug}/tests/${test.slug}/edit`}
            className="flex h-9 items-center rounded-[9px] border border-[var(--ct-line)] bg-transparent px-4 text-[13px] font-medium text-[var(--ct-text-2)]"
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
              className="h-9 rounded-[9px] border border-[var(--ct-line)] bg-transparent px-4 text-[13px] font-medium text-[var(--ct-text-2)]"
            >
              {test.status === 'active' ? 'Pausar teste' : 'Ativar teste'}
            </button>
          </form>
          </>}
        </div>
      </div>

      <div className="mx-6 mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-[var(--ct-line)]">
      <div className="flex gap-1.5 py-2">
        {REPORT_PERIODS.map((option) => {
          const isActive = (periodo ?? 'all') === option.value
          return (
            <a
              key={option.value}
              href={option.value === 'all' ? `?` : `?periodo=${option.value}`}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                isActive
                  ? 'border-[var(--ct-accent)] bg-[var(--ct-accent)]/15 text-[var(--ct-accent)]'
                  : 'border-[var(--ct-line)] text-[var(--ct-text-2)] hover:text-[var(--ct-text)]'
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
                ? 'border-[var(--ct-accent)] bg-[var(--ct-accent)]/15 text-[var(--ct-accent)]'
                : 'border-[var(--ct-line)] text-[var(--ct-text-2)] hover:text-[var(--ct-text)]'
            }`}
          >
            {periodo === 'custom' && desde && ate ? `${formatBr(desde)} - ${formatBr(ate)}` : 'Personalizado'}
          </summary>
          <form
            method="get"
            className="absolute left-0 top-[calc(100%+6px)] z-10 flex flex-col gap-2 rounded-[10px] border border-[var(--ct-line)] bg-[var(--ct-surface)] p-3 shadow-lg"
          >
            <input type="hidden" name="periodo" value="custom" />
            <label className="flex flex-col gap-1 text-[11px] text-[var(--ct-text-2)]">
              De
              <input
                type="date"
                name="desde"
                defaultValue={desde ?? ''}
                required
                className="rounded-[8px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-2 py-1 text-xs text-[var(--ct-text)]"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[var(--ct-text-2)]">
              Até
              <input
                type="date"
                name="ate"
                defaultValue={ate ?? ''}
                required
                className="rounded-[8px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-2 py-1 text-xs text-[var(--ct-text)]"
              />
            </label>
            <button type="submit" className="rounded-[8px] bg-[var(--ct-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--ct-on-accent)]">
              Aplicar
            </button>
          </form>
        </details>
        {previousLabel && (
          <a
            href={comparingHref}
            className={`ml-auto rounded-full border px-3 py-1.5 text-xs font-medium ${
              comparar === '1'
                ? 'border-[var(--ct-accent)] bg-[var(--ct-accent)]/15 text-[var(--ct-accent)]'
                : 'border-dashed border-[var(--ct-line-2)] text-[var(--ct-text-2)] hover:text-[var(--ct-text)]'
            }`}
          >
            vs {previousLabel}
          </a>
        )}
      </div>

      <div className="order-first flex gap-1">
        {REPORT_TABS.filter((option) => canEdit || option.value !== 'insight').map((option) => {
          const query = new URLSearchParams()
          if (periodo) query.set('periodo', periodo)
          if (periodo === 'custom' && desde) query.set('desde', desde)
          if (periodo === 'custom' && ate) query.set('ate', ate)
          if (comparar === '1') query.set('comparar', '1')
          if (option.value !== 'desempenho') query.set('aba', option.value)
          const isActive = tab === option.value
          return (
            <a
              key={option.value}
              href={query.size > 0 ? `?${query}` : '?'}
              className={`-mb-px border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors ${
                isActive
                  ? 'border-[var(--ct-accent)] text-[var(--ct-text)]'
                  : 'border-transparent text-[var(--ct-text-2)] hover:text-[var(--ct-text)]'
              }`}
            >
              {option.label}
            </a>
          )
        })}
      </div>
      </div>

      {measuredCard && measuredCard.sales_funnels && (
        <Link
          href={`/dashboard/clients/${clientSlug}/backlog?projeto=${measuredCard.sales_funnels.slug}&item=${measuredCard.code}${measuredCard.status === 'running' ? '#decidir' : ''}`}
          className="mx-6 mt-4 flex flex-wrap items-center gap-2 rounded-[12px] border border-[var(--ct-line)] bg-[var(--ct-surface)] px-4 py-2.5 text-[12.5px] text-[var(--ct-text-2)] hover:border-[var(--ct-line-2)]"
        >
          <span className="font-[family-name:var(--font-geist-mono)] text-[var(--ct-text-3)]">{measuredCard.code}</span>
          Este teste mede o card <b className="text-[var(--ct-text)]">{measuredCard.title}</b> do Quadro.
          <span className="ml-auto text-[var(--ct-accent)]">{measuredCard.status === 'running' ? 'Decidir no card →' : 'Abrir o card →'}</span>
        </Link>
      )}

      {hasPartialDataError && (
        <div className="mx-6 mt-4 rounded-[10px] border border-[var(--ct-warn)]/35 bg-[var(--ct-warn)]/10 px-4 py-2.5 text-xs text-[var(--ct-warn)]">
          Alguns dados desta página podem estar incompletos — houve uma falha ao carregar parte do relatório. Tente
          atualizar a página em instantes.
        </div>
      )}

      <div className="mx-6 mt-4 flex flex-wrap items-center gap-x-7 gap-y-3 rounded-2xl border border-[var(--ct-line)] bg-[var(--ct-surface)] px-6 py-4">
        <div>
          <div className="font-[family-name:var(--font-geist-mono)] text-[22px] font-semibold tabular-nums">{totalVisits}</div>
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] text-[var(--ct-text-2)]">pessoas no teste</span>
            {previousTotalVisits !== null && <Delta current={totalVisits} previous={previousTotalVisits} unit="pct" />}
          </div>
        </div>
        <div className="h-[34px] w-px bg-[var(--ct-surface-2)]" />
        <div>
          <div className="font-[family-name:var(--font-geist-mono)] text-[22px] font-semibold tabular-nums text-[var(--ct-warn)]">
            {leaderRow?.conversions ?? 0}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] text-[var(--ct-text-2)]">{leader ? `compradores · ${leader.name} lidera` : 'compradores · sem líder ainda'}</span>
            {previousLeaderConversions !== null && (
              <Delta current={leaderRow?.conversions ?? 0} previous={previousLeaderConversions} unit="pct" />
            )}
          </div>
        </div>
        <div className="h-[34px] w-px bg-[var(--ct-surface-2)]" />
        <div>
          <div className="flex items-center gap-2.5">
            <div
              className={`font-[family-name:var(--font-geist-mono)] text-[22px] font-semibold tabular-nums ${
                dataQuality.trustworthy
                  ? 'text-[var(--ct-ok)]'
                  : dataQuality.strikeConfidence
                    ? 'text-[var(--ct-text-3)] line-through decoration-[var(--ct-warn)] decoration-2'
                    : 'text-[var(--ct-text-3)]'
              }`}
            >
              {leader ? `${leader.confidencePct}%` : '—'}
            </div>
            <span
              title={dataQuality.explain}
              className={`flex cursor-help items-center gap-1.5 rounded-full border px-2.5 py-1 font-[family-name:var(--font-geist-mono)] text-[10.5px] ${
                dataQuality.trustworthy
                  ? 'border-[var(--ct-ok)]/30 bg-[var(--ct-ok)]/[0.08] text-[var(--ct-ok)]'
                  : 'border-[var(--ct-warn)]/32 bg-[var(--ct-warn)]/[0.09] text-[var(--ct-warn)]'
              }`}
            >
              {dataQuality.badge}
            </span>
          </div>
          <div className={`text-[11.5px] ${dataQuality.trustworthy ? 'text-[var(--ct-text-2)]' : 'text-[var(--ct-warn)]'}`}>
            {dataQuality.instruction}
          </div>
        </div>
        <div className="h-[34px] w-px bg-[var(--ct-surface-2)]" />
        <div>
          <div className="font-[family-name:var(--font-geist-mono)] text-[22px] font-semibold tabular-nums">
            {daysRunning} {daysRunning === 1 ? 'dia' : 'dias'}
          </div>
          <div className="text-[11.5px] text-[var(--ct-text-2)]">em execução</div>
        </div>
      </div>

      {tab === 'desempenho' && (
        <>
      <ReportCanvas
        layout={layout}
        redirectUrl={redirectUrl}
        totalVisits={totalVisits}
        fallbackUrl={test.fallback_url}
        confidenceLabelById={confidenceLabelById}
        assetLabel={assetLabel}
      />
      <div className="mx-6 mb-6 grid grid-cols-1 divide-y divide-[var(--ct-line)] rounded-2xl border border-[var(--ct-line)] md:grid-cols-3 md:divide-x md:divide-y-0">
        <div className="p-5">
          <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-wide text-[var(--ct-text-2)]">
            Faturamento por {assetLabel.toLowerCase()}
          </h3>
          <MiniBarChart
            data={rows.map((row) => ({
              label: row.variant_name,
              value: Number(row.revenue_cents),
            }))}
            valueFormat={(v) => `R$ ${(v / 100).toFixed(0)}`}
            barColor="#4ADE9B"
          />
        </div>
        <div className="p-5">
          <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-wide text-[var(--ct-text-2)]">
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
          <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-wide text-[var(--ct-text-2)]">
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
      <div className="mx-6 mb-6">
        <h2 className="mb-2 mt-8 font-[family-name:var(--font-sora)] text-lg font-semibold">Total por {assetLabel.toLowerCase()}</h2>
        {(() => {
          const maxClicks = Math.max(1, ...rows.map((r) => Number(r.clicks)))
          const maxRevenue = Math.max(1, ...rows.map((r) => Number(r.revenue_cents)))
          const perPerson = (row: ReportRow) => (row.visits > 0 ? Number(row.revenue_cents) / row.visits / 100 : 0)
          const buyerRate = (row: ReportRow) => (row.visits > 0 ? (row.conversions / row.visits) * 100 : 0)
          return (
            <div className="overflow-x-auto rounded-2xl border border-[var(--ct-line)]">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--ct-line)] bg-[var(--ct-surface-2)] text-left">
                    <th className={TH_CLASS}>{assetLabel}</th>
                    <ThWithInfo label="Cliques" info={METRIC_INFO.cliques} />
                    <ThWithInfo label="Pessoas" info={METRIC_INFO.pessoas} />
                    <ThWithInfo label="Compradores" info={METRIC_INFO.compradores} />
                    <ThWithInfo label="Taxa" info={METRIC_INFO.taxa} />
                    <ThWithInfo label="Vendas" info={METRIC_INFO.vendasTeste} />
                    <ThWithInfo label="Faturamento" info={METRIC_INFO.faturamentoTeste} />
                    <ThWithInfo label="R$/pessoa" info={METRIC_INFO.rsPorPessoa} />
                    <ThWithInfo label="R$/clique" info={METRIC_INFO.rsPorClique} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const previous = previousByVariant.get(row.variant_id) ?? null
                    const clicks = Number(row.clicks)
                    const revenue = Number(row.revenue_cents)
                    return (
                    <tr key={row.variant_id} className={`${TR_CLASS} ${clicks === 0 ? 'opacity-50' : ''}`}>
                      <td className={TD_CLASS}>
                        {row.variant_name}
                        {previous && (
                          <div className="mt-0.5 font-[family-name:var(--font-geist-mono)] text-[10.5px] normal-case text-[var(--ct-text-3)]">
                            período anterior
                          </div>
                        )}
                      </td>
                      <BarCell value={clicks} max={maxClicks} format={String(clicks)}>
                        {previous && <Delta current={clicks} previous={Number(previous.clicks)} unit="pct" />}
                      </BarCell>
                      <td className={TD_CLASS}>
                        {row.visits}
                        {previous && (
                          <div className="mt-0.5">
                            <Delta current={row.visits} previous={previous.visits} unit="pct" />
                          </div>
                        )}
                      </td>
                      <td className={TD_CLASS}>
                        {row.conversions}
                        {previous && (
                          <div className="mt-0.5">
                            <Delta current={row.conversions} previous={previous.conversions} unit="pct" />
                          </div>
                        )}
                      </td>
                      <RateCell rate={buyerRate(row).toFixed(1)}>
                        {previous && <Delta current={buyerRate(row)} previous={buyerRate(previous)} unit="pp" />}
                      </RateCell>
                      <td className={TD_CLASS}>{Number(row.sales)}</td>
                      <BarCell value={revenue} max={maxRevenue} format={`R$ ${(revenue / 100).toFixed(2)}`}>
                        {previous && <Delta current={revenue} previous={Number(previous.revenue_cents)} unit="pct" />}
                      </BarCell>
                      <td className={TD_CLASS}>R$ {perPerson(row).toFixed(2)}</td>
                      <td className={TD_CLASS}>R$ {(clicks > 0 ? revenue / clicks / 100 : 0).toFixed(2)}</td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })()}
      </div>
        </>
      )}
      {tab === 'origens' && (
        <>
      <div className="mx-6 mb-6">
        <h2 className="mb-2 mt-8 font-[family-name:var(--font-sora)] text-lg font-semibold">Por origem (UTM)</h2>
        {(() => {
          const sourceRows = (sourceReport as SourceReportRow[]) ?? []
          const maxClicks = Math.max(1, ...sourceRows.map((r) => r.clicks))
          const maxRevenue = Math.max(1, ...sourceRows.map((r) => r.revenue_cents))
          return (
            <div className="overflow-x-auto rounded-2xl border border-[var(--ct-line)]">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--ct-line)] bg-[var(--ct-surface-2)] text-left">
                    <th className={TH_CLASS}>{assetLabel}</th>
                    <th className={TH_CLASS}>Origem</th>
                    <ThWithInfo label="Cliques" info={METRIC_INFO.cliques} />
                    <ThWithInfo label="Visitas únicas" info={METRIC_INFO.visitas} />
                    <ThWithInfo label="Vendas" info={METRIC_INFO.vendas} />
                    <ThWithInfo label="Faturamento" info={METRIC_INFO.faturamento} />
                    <ThWithInfo label="R$/clique" info={METRIC_INFO.rsPorClique} />
                    <ThWithInfo label="R$/acesso" info={METRIC_INFO.rsPorAcesso} />
                    <ThWithInfo label="Taxa" info={METRIC_INFO.taxaClique} />
                  </tr>
                </thead>
                <tbody>
                  {sourceRows.map((row) => (
                    <tr
                      key={`${row.variant_id}-${row.utm_source}`}
                      className={`${TR_CLASS} ${row.clicks === 0 ? 'opacity-50' : ''}`}
                    >
                      <td className={TD_CLASS}>{row.variant_name}</td>
                      <td className={TD_CLASS}>
                        {row.utm_source}
                        <BotTag clicks={row.clicks} botClicks={row.bot_clicks} />
                      </td>
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
                      <td className={TD_CLASS}>
                        R$ {(row.visitors > 0 ? row.revenue_cents / row.visitors / 100 : 0).toFixed(2)}
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
        </>
      )}
      {tab === 'criativos' && (
        <>
      <div className="mx-6 mb-6">
        <CreativeMatrixPanel
          adRows={(adReport as AdReportRow[]) ?? []}
          variants={rows.map((r) => ({
            id: r.variant_id,
            name: r.variant_name,
          }))}
          assetLabel={assetLabel}
        />
        <h2 className="mb-2 mt-8 font-[family-name:var(--font-sora)] text-lg font-semibold">Por anúncio</h2>
        {(() => {
          const adRows = (adReport as AdReportRow[]) ?? []
          const maxClicks = Math.max(1, ...adRows.map((r) => r.clicks))
          const maxRevenue = Math.max(1, ...adRows.map((r) => r.revenue_cents))
          return (
            <div className="overflow-x-auto rounded-2xl border border-[var(--ct-line)]">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--ct-line)] bg-[var(--ct-surface-2)] text-left">
                    <th className={TH_CLASS}>{assetLabel}</th>
                    <th className={TH_CLASS}>Anúncio</th>
                    <ThWithInfo label="Cliques" info={METRIC_INFO.cliques} />
                    <ThWithInfo label="Visitas únicas" info={METRIC_INFO.visitas} />
                    <ThWithInfo label="Vendas" info={METRIC_INFO.vendas} />
                    <ThWithInfo label="Faturamento" info={METRIC_INFO.faturamento} />
                    <ThWithInfo label="R$/clique" info={METRIC_INFO.rsPorClique} />
                    <ThWithInfo label="R$/acesso" info={METRIC_INFO.rsPorAcesso} />
                    <ThWithInfo label="Taxa" info={METRIC_INFO.taxaClique} />
                    <ThWithInfo label="Gasto" info={METRIC_INFO.gasto} />
                    <ThWithInfo label="CPM" info={METRIC_INFO.cpm} />
                    <ThWithInfo label="CTR" info={METRIC_INFO.ctr} />
                  </tr>
                </thead>
                <tbody>
                  {adRows.length === 0 ? (
                    <tr>
                      <td className={`${TD_CLASS} text-[var(--ct-text-2)]`} colSpan={12}>
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
                        <td className={TD_CLASS}>
                          {row.ad_name}
                          <BotTag clicks={row.clicks} botClicks={row.bot_clicks} />
                        </td>
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
                        <td className={TD_CLASS}>
                          R$ {(row.visitors > 0 ? row.revenue_cents / row.visitors / 100 : 0).toFixed(2)}
                        </td>
                        <RateCell rate={row.clicks > 0 ? ((row.conversions / row.clicks) * 100).toFixed(1) : '0.0'} />
                        <td className={TD_CLASS}>R$ {((row.ad_spend ?? 0) / 1).toFixed(2)}</td>
                        <td className={TD_CLASS}>
                          {row.ad_impressions ? `R$ ${(((row.ad_spend ?? 0) / row.ad_impressions) * 1000).toFixed(2)}` : '—'}
                        </td>
                        <td className={TD_CLASS}>
                          {row.ad_impressions ? `${(((row.ad_link_clicks ?? 0) / row.ad_impressions) * 100).toFixed(1)}%` : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )
        })()}
      </div>
        </>
      )}
      {tab === 'insight' && canEdit && (
        <>
      <InsightPanel testId={test.id} sinceIso={sinceIso} untilIso={untilIso} />
        </>
      )}
    </div>
  )
}
