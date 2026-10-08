import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getDailyFunnel, getFunnelSyncHealth, getPaymentMethodBreakdown, getSalesByOrigin } from '@/lib/repo/funnel-repo'
import { REPORT_PERIODS, resolvePeriodDateRange, formatBr } from '@/lib/domain/report-period'
import { FunnelCone } from './funnel-cone'
import { FunnelKpiCards } from './funnel-kpi-cards'
import { MIN_SALES_FOR_CPA, topByCpa, topBySales } from '@/lib/domain/creative-ranking'
import { buildTrafficDays } from '@/lib/domain/traffic-days'
import { TrafficPanel } from './traffic-panel'
import { PatternsPanel } from './patterns-panel'
import { analyzePatterns } from '@/lib/domain/patterns'
import { saoPauloDay } from '@/lib/repo/today-repo'
import { FunnelPaymentPie } from './funnel-payment-pie'
import { SyncFunnelButton } from './sync-funnel-button'
import { SyncStatus } from '@/components/sync-status'
import { MiniBarChart } from '@/components/mini-bar-chart'
import { SalesOriginPanel } from './sales-origin-panel'
import { PageHeader } from '@/components/page-header'
import { headerAction } from '@/components/header-actions'
import { FrontsPanel, type FrontDayRow, type FrontInfo } from './fronts-panel'
import { readAnalysisTab } from '@/lib/domain/analysis-tabs'

export default async function SalesFunnelPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string; funnelSlug: string }>
  searchParams: Promise<{ periodo?: string; desde?: string; ate?: string; aba?: string; frente?: string }>
}) {
  const { clientSlug, funnelSlug } = await params
  const { periodo, desde, ate, aba, frente } = await searchParams
  const tab = readAnalysisTab(aba)
  // Links keep the period, the tab and the front together, whichever one the user changes.
  const withParams = (changes: Record<string, string | undefined>) => {
    const merged = { periodo, desde, ate, aba: tab === 'visao' ? undefined : tab, frente, ...changes }
    const query = new URLSearchParams(Object.entries(merged).filter((entry): entry is [string, string] => Boolean(entry[1])))
    return query.size > 0 ? `?${query}` : '?'
  }
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, name, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()

  const { data: funnel } = await supabase
    .from('sales_funnels')
    .select('id, name, slug, resultado')
    .eq('client_id', client.id)
    .eq('slug', funnelSlug)
    .maybeSingle()
  if (!funnel) notFound()

  const { since, until } = resolvePeriodDateRange(periodo, desde, ate)
  const [rows, health, paymentBreakdown, creativeResult, productResult, hourResult, salesByOrigin, { count: taxRates }, { data: frontRows }, { data: frontDays }] = await Promise.all([
    getDailyFunnel(supabase, funnel.id, since, until),
    getFunnelSyncHealth(supabase, funnel.id),
    getPaymentMethodBreakdown(supabase, funnel.id, since, until),
    supabase.rpc('get_funnel_report_by_creative', {
      p_sales_funnel_id: funnel.id,
      p_since: since,
      p_until: until,
    }),
    supabase.rpc('get_funnel_sales_by_product', { p_sales_funnel_id: funnel.id, p_since: since, p_until: until }),
    supabase.rpc('get_funnel_sales_by_hour', { p_sales_funnel_id: funnel.id, p_since: since, p_until: until }),
    getSalesByOrigin(supabase, funnel.id, since, until),
    supabase.from('client_tax_rates').select('valid_from', { count: 'exact', head: true }).eq('client_id', client.id),
    supabase
      .from('project_fronts')
      .select('id, code, name, source:sales_funnels!project_fronts_source_sales_funnel_id_fkey(name)')
      .eq('sales_funnel_id', funnel.id)
      .order('position'),
    supabase.rpc('get_project_front_daily', { p_sales_funnel_id: funnel.id, p_since: since, p_until: until }),
  ])
  const fronts: FrontInfo[] = ((frontRows ?? []) as unknown as { id: string; code: string; name: string; source: { name: string } | null }[]).map(
    (front) => ({ id: front.id, code: front.code, name: front.name, sourceName: front.source?.name ?? null })
  )
  if (creativeResult.error) {
    console.error('[funnel-creative-report-failed]', { salesFunnelId: funnel.id }, creativeResult.error)
  }
  const creatives = (creativeResult.data ?? []) as {
    ad_name: string
    /** Null when the (name, adset) key still covers more than one ad -- see ad_count. */
    ad_id: string | null
    adset_name: string | null
    ad_count: number
    spend: number
    impressions: number
    link_clicks: number
    sales_count: number
    revenue: number
    leads: number
  }[]
  // Sales no ad could be tied to are listed in the table but never ranked as a creative.
  // A lead project ranks and prices its creatives by paid leads (0072); the ranking helpers count
  // whatever sits in sales_count, so the lead count takes that place.
  const isLead = funnel.resultado === 'lead'
  const rankable = creatives
    .filter((c) => c.ad_name !== '(sem anúncio)')
    .map((c) => (isLead ? { ...c, sales_count: Number(c.leads ?? 0) } : c))
  const unit = isLead ? { one: 'lead', many: 'leads', cost: 'CPL' } : { one: 'venda', many: 'vendas', cost: 'CPA' }
  if (productResult.error) console.error('[funnel-product-report-failed]', { salesFunnelId: funnel.id }, productResult.error)
  if (hourResult.error) console.error('[funnel-hour-report-failed]', { salesFunnelId: funnel.id }, hourResult.error)
  const products = (productResult.data ?? []) as { produto: string; sales_count: number; revenue: number }[]
  const salesByHour = (hourResult.data ?? []) as { hour: number; sales_count: number; revenue: number }[]

  const currency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  const totals = rows.reduce(
    (acc, row) => ({
      investimento: acc.investimento + row.spendComImposto,
      receitaBruta: acc.receitaBruta + row.receitaBruta,
      receitaLiquida: acc.receitaLiquida + row.receitaLiquida,
      vendas: acc.vendas + row.vendas,
      vendasAnuncio: acc.vendasAnuncio + row.vendasAnuncio,
      vendasUpsell: acc.vendasUpsell + row.vendasUpsell,
      receitaAscensao: acc.receitaAscensao + row.receitaAscensaoLiquida,
      impressions: acc.impressions + row.impressions,
      reach: acc.reach + row.reach,
      linkClicks: acc.linkClicks + row.linkClicks,
      landingPageViews: acc.landingPageViews + row.landingPageViews,
      initiateCheckout: acc.initiateCheckout + row.initiateCheckout,
    }),
    {
      investimento: 0,
      receitaBruta: 0,
      receitaLiquida: 0,
      vendas: 0,
      vendasAnuncio: 0,
      vendasUpsell: 0,
      receitaAscensao: 0,
      impressions: 0,
      reach: 0,
      linkClicks: 0,
      landingPageViews: 0,
      initiateCheckout: 0,
    }
  )
  const kpiTotals = {
    investimento: totals.investimento,
    comImposto: (taxRates ?? 0) > 0,
    receitaLiquida: totals.receitaLiquida,
    vendas: totals.vendas,
    vendasUpsell: totals.vendasUpsell,
    // Project overview: spend over EVERY entry sale, whatever brought the buyer in. The ad CPA
    // beside it, and every creative row below, count only the sale the UTM ties to an ad.
    cpa: totals.vendas > 0 ? totals.investimento / totals.vendas : null,
    cpaAnuncio: totals.vendasAnuncio > 0 ? totals.investimento / totals.vendasAnuncio : null,
    resultado: totals.receitaLiquida - totals.investimento,
    roas: totals.investimento > 0 ? totals.receitaLiquida / totals.investimento : null,
    roasComAscensao:
      totals.investimento > 0 && totals.receitaAscensao > 0 ? (totals.receitaLiquida + totals.receitaAscensao) / totals.investimento : null,
    ticketMedio: totals.vendas > 0 ? totals.receitaLiquida / totals.vendas : null,
  }
  const coneTotals = {
    spend: totals.investimento,
    impressions: totals.impressions,
    reach: totals.reach,
    linkClicks: totals.linkClicks,
    landingPageViews: totals.landingPageViews,
    initiateCheckout: totals.initiateCheckout,
    vendas: totals.vendasAnuncio,
  }
  const kpiSparklines = {
    receitaLiquida: rows.map((row) => row.receitaLiquida),
    roas: rows.map((row) => (row.spendComImposto > 0 ? row.receitaLiquida / row.spendComImposto : 0)),
  }
  const lastSyncAt = health.find((h) => h.lastRunAt)?.lastRunAt ?? null
  const partialToday = rows.find((row) => row.dadosAte)
  const timeBr = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  const hasSyncError = health.some((h) => h.lastResult === 'error')

  return (
    <div className="flex max-w-[1440px] flex-col px-4 md:px-14 pb-24 pt-12">
      <div className="mb-9">
        <PageHeader
          note={
            <>
              {funnel.resultado === 'lead' ? 'projeto de lead' : 'projeto de compra'}
              {rows.length > 0 ? ` · investimento das ${rows[0].spendSource === 'frentes' ? 'regras de campanha' : 'operações do LaunchOps'}` : ''}
            </>
          }
          title={funnel.name}
          description={
            funnel.resultado === 'lead'
              ? 'Gasto, leads e criativos das campanhas do projeto.'
              : 'Gasto, vendas, receita e criativos do projeto, lidos das regras de campanha e dos produtos.'
          }
          actions={
            <>
              <SyncStatus lastRunAt={lastSyncAt} hasError={hasSyncError} />
              <SyncFunnelButton salesFunnelId={funnel.id} clientSlug={client.slug} funnelSlug={funnel.slug} />
              <a
                href={`/dashboard/clients/${client.slug}/funis-venda/${funnel.slug}/plano`}
                className="rounded-full border border-[var(--ct-accent)] bg-[var(--ct-accent-soft)] px-4 py-2 text-[13px] font-medium text-[var(--ct-accent)]"
              >
                Plano
              </a>
              <a href={`/dashboard/clients/${client.slug}/funis-venda/${funnel.slug}/produtos`} className={headerAction}>
                Produtos
              </a>
              <a href={`/dashboard/clients/${client.slug}/funis-venda/${funnel.slug}/regras`} className={headerAction}>
                Regras de campanha
              </a>
              <a href={`/dashboard/clients/${client.slug}/funis-venda/${funnel.slug}/edit`} className={headerAction}>
                Editar
              </a>
            </>
          }
        />
      </div>

      <div className="mb-6 flex flex-wrap gap-1.5">
        {REPORT_PERIODS.map((option) => {
          const isActive = (periodo ?? 'all') === option.value
          return (
            <a
              key={option.value}
              href={withParams({ periodo: option.value === 'all' ? undefined : option.value, desde: undefined, ate: undefined })}
              className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium ${
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
            {tab !== 'visao' && <input type="hidden" name="aba" value={tab} />}
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
      </div>

      {/* Only speaks up when a sync actually failed. The healthy case is already covered by the
          pulse in the header, and printing "ok, última execução ..." on every load was noise. */}
      {hasSyncError && (
        <div className="mb-6 rounded-2xl border border-[var(--ct-crit)]/35 bg-[var(--ct-crit)]/10 p-4 text-[13px] text-[var(--ct-crit)]">
          {health
            .filter((h) => h.lastResult === 'error')
            .map((h) => (
              <div key={h.entity}>
                Falha ao sincronizar {h.entity}: {h.lastMessage ?? 'sem detalhes'}
              </div>
            ))}
        </div>
      )}

      {partialToday?.dadosAte && (
        <p className="mb-3 text-[12.5px] text-[var(--ct-text-2)]" role="status">
          <span className="mr-2 rounded-full bg-[var(--ct-warn)]/[0.12] px-2 py-0.5 text-[11px] text-[var(--ct-warn)]">hoje parcial</span>
          Gasto do Meta até {timeBr(partialToday.dadosAte)}. As vendas de hoje entram até esse horário para o CPA comparar
          igual com igual
          {partialToday.vendasAposDados > 0
            ? `; ${partialToday.vendasAposDados.toLocaleString('pt-BR')} chegaram depois e entram no próximo pull.`
            : '.'}
        </p>
      )}
      <FunnelKpiCards
        totals={kpiTotals}
        currency={currency}
        sparklines={kpiSparklines}
        lead={
          funnel.resultado === 'lead'
            ? {
                leads: ((frontDays ?? []) as FrontDayRow[]).reduce((sum, row) => sum + Number(row.leads ?? 0), 0),
                linkClicks: totals.linkClicks,
                landingPageViews: totals.landingPageViews,
              }
            : undefined
        }
      />


      {tab === 'frentes' && (
        <FrontsPanel
          fronts={fronts}
          rows={(frontDays ?? []) as FrontDayRow[]}
          taxFactor={totals.investimento > 0 && rows.reduce((t, row) => t + row.spend, 0) > 0 ? totals.investimento / rows.reduce((t, row) => t + row.spend, 0) : 1}
          rulesHref={`/dashboard/clients/${client.slug}/funis-venda/${funnel.slug}/regras`}
          currency={currency}
        />
      )}

      {tab === 'trafego' && (() => {
        // The project scope takes its spend and sales from the project's day; a front only has its
        // own media, carried to "with tax" by the same day's factor the project uses.
        const frontDayRows = (frontDays ?? []) as (FrontDayRow & { data: string })[]
        const selectedFront = fronts.find((front) => front.id === frente) ?? null
        const days = rows.map((row) => {
          const factor = row.spend > 0 ? row.spendComImposto / row.spend : 1
          const ofDay = frontDayRows.filter((front) => front.data === row.data && (!selectedFront || front.front_id === selectedFront.id))
          const add = (key: 'spend' | 'impressions' | 'link_clicks' | 'landing_page_views' | 'initiate_checkout' | 'leads') =>
            ofDay.reduce((total, front) => total + Number(front[key]), 0)
          return selectedFront
            ? { data: row.data, spend: add('spend') * factor, impressions: add('impressions'), linkClicks: add('link_clicks'), landingPageViews: add('landing_page_views'), initiateCheckout: add('initiate_checkout'), leads: add('leads'), vendas: null }
            : { data: row.data, spend: row.spendComImposto, impressions: row.impressions, linkClicks: row.linkClicks, landingPageViews: row.landingPageViews, initiateCheckout: row.initiateCheckout, leads: add('leads'), vendas: row.vendas }
        })
        const traffic = buildTrafficDays(days)
        const costKey = !selectedFront && (traffic.total.vendas ?? 0) > 0 ? 'cpa' : traffic.total.leads > 0 ? 'cpl' : 'cpm'
        // Patterns read only closed days: today is partial and would always look like an outlier.
        const today = saoPauloDay(0)
        const patterns = analyzePatterns(
          traffic.days
            .filter((day) => day.data !== today)
            .map((day) => ({
              data: day.data,
              spend: day.spend,
              cost: day[costKey],
              metrics: {
                cpm: day.cpm,
                ctr: day.ctr,
                connectRate: day.connectRate,
                pvToIc: day.pvToIc,
                // The page's own conversion: sales per visit for the project, leads per visit for a capture.
                conv:
                  day.landingPageViews > 0 && costKey !== 'cpm'
                    ? ((costKey === 'cpa' ? (day.vendas ?? 0) : day.leads) / day.landingPageViews) * 100
                    : null,
              },
            }))
        )
        return (
          <>
            <TrafficPanel
              days={traffic.days}
              total={traffic.total}
              isFront={selectedFront !== null}
              costKey={costKey}
              money={currency}
              scopes={[
                { label: `${funnel.name} inteiro`, href: withParams({ frente: undefined }), active: !selectedFront },
                ...fronts.map((front) => ({ label: `Frente ${front.name}`, href: withParams({ frente: front.id }), active: selectedFront?.id === front.id })),
              ]}
            />
            <PatternsPanel report={patterns} costLabel={costKey === 'cpa' ? 'CPA geral' : costKey === 'cpl' ? 'CPL' : 'CPM'} money={currency} />
          </>
        )
      })()}

      {tab === 'origem' && <SalesOriginPanel origins={salesByOrigin} currency={currency} />}

      {/* Funnel on the left, the three read-outs stacked on the right: the funnel is one tall
          shape and the analyses are short ones, so side by side they fill each other's space. */}
      {/* minmax(0,1fr) on both halves, not plain 1fr: the 24-bar chart has a wide min-content
          and a plain fr column refuses to shrink below it, which squeezed the funnel to a sliver. */}
      {tab === 'visao' && (
      <div className="mb-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <FunnelCone totals={coneTotals} currency={currency} />
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <FunnelPaymentPie breakdown={paymentBreakdown} currency={currency} />

          <div className="card-shadow rounded-2xl border border-[var(--ct-line)] p-5">
            <h2 className="mb-1 font-[family-name:var(--font-sora)] text-base font-semibold">Por produto</h2>
            <p className="mb-4 text-[12px] text-[var(--ct-text-2)]">Onde a receita do funil se concentra · líquida, com ascensão</p>
            {products.length === 0 ? (
              <p className="text-[13px] text-[var(--ct-text-2)]">Nenhuma venda no período.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {products.slice(0, 8).map((p) => {
                  const share = products[0].revenue > 0 ? (p.revenue / products[0].revenue) * 100 : 0
                  return (
                    <div key={p.produto}>
                      <div className="mb-1 flex items-baseline justify-between gap-3 text-[12.5px]">
                        <span className="truncate" title={p.produto}>
                          {p.produto}
                        </span>
                        <span className="flex-shrink-0 font-[family-name:var(--font-geist-mono)] tabular-nums text-[var(--ct-text)]">
                          {currency(p.revenue)}
                          <span className="ml-2 text-[11px] text-[var(--ct-text-2)]">{p.sales_count} vendas</span>
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--ct-surface-2)]">
                        <div className="h-full rounded-full bg-[var(--ct-accent)]" style={{ width: `${Math.max(2, share)}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="card-shadow rounded-2xl border border-[var(--ct-line)] p-5">
            <h2 className="mb-1 font-[family-name:var(--font-sora)] text-base font-semibold">Vendas por horário</h2>
            <p className="mb-4 text-[12px] text-[var(--ct-text-2)]">Hora do dia (horário de Brasília)</p>
            {/* Bare counts, not "N vendas": 24 bars in half a screen leaves no room for a word
                above each one, and the panel title already says these are sales. */}
            <div className="overflow-x-auto">
              <MiniBarChart
                data={salesByHour.map((h) => ({ label: `${String(h.hour).padStart(2, '0')}h`, value: h.sales_count }))}
                barColor="#4ADE9B"
              />
            </div>
          </div>
        </div>
      </div>

      )}

      {tab === 'criativos' && creatives.length > 0 && (
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {[
          { title: isLead ? 'Top 10 por leads' : 'Top 10 por compras', hint: isLead ? 'quem mais trouxe leads no período' : 'quem mais vendeu no período', rows: topBySales(rankable).map((c) => ({ c, value: `${c.sales_count} ${c.sales_count === 1 ? unit.one : unit.many}`, sub: c.spend > 0 && c.sales_count >= MIN_SALES_FOR_CPA ? `${unit.cost} ${currency(c.spend / c.sales_count)}` : `${unit.cost} —` })) },
          { title: `Top 10 por ${unit.cost}`, hint: `menor custo por ${unit.one}, com ${MIN_SALES_FOR_CPA}+ ${unit.many}`, rows: topByCpa(rankable).map((c) => ({ c, value: currency(c.cpa), sub: `${c.sales_count} ${unit.many}` })) },
        ].map((block) => (
          <div key={block.title} className="card-shadow rounded-2xl border border-[var(--ct-line)] p-4">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h3 className="font-[family-name:var(--font-sora)] text-[14px] font-semibold">{block.title}</h3>
              <span className="text-[11.5px] text-[var(--ct-text-2)]">{block.hint}</span>
            </div>
            {block.rows.length === 0 ? (
              <p className="text-[12.5px] text-[var(--ct-text-2)]">Nenhum anúncio com {unit.many} suficientes no período.</p>
            ) : (
              <ol className="flex flex-col gap-1.5">
                {block.rows.map(({ c, value, sub }, index) => (
                  <li key={`${c.ad_name}|${c.adset_name ?? ''}`} className="flex items-center gap-3 text-[13px]">
                    <span className="w-5 flex-none text-right font-[family-name:var(--font-geist-mono)] text-[11px] text-[var(--ct-text-3)]">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate" title={`${c.ad_name}${c.adset_name ? ` · ${c.adset_name}` : ''}`}>{c.ad_name}</span>
                    <span className="flex-none text-right font-[family-name:var(--font-geist-mono)] tabular-nums">
                      {value}
                      <span className="block text-[11px] text-[var(--ct-text-2)]">{sub}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </div>
      )}

      {tab === 'criativos' && (
      <div className="card-shadow mb-6 overflow-hidden rounded-2xl border border-[var(--ct-line)]">
        <div className="flex items-baseline justify-between px-4 pt-4">
          <h2 className="font-[family-name:var(--font-sora)] text-base font-semibold">Por criativo</h2>
          <span className="text-[11.5px] text-[var(--ct-text-2)]">
            {isLead ? 'Gasto com imposto · leads pagos únicos do anúncio' : 'Gasto com imposto · vendas de entrada · receita líquida sem ascensão'}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="mt-3 w-full text-[13.5px]">
            <thead>
              <tr className="border-b border-[var(--ct-line)] text-left text-[var(--ct-text-2)]">
                <th className="p-3">Anúncio</th>
                <th className="p-3">Gasto</th>
                {isLead ? (
                  <>
                    <th className="p-3">Leads</th>
                    <th className="p-3">CPL</th>
                    <th className="p-3">Cliques</th>
                    <th className="p-3">Lead por clique</th>
                  </>
                ) : (
                  <>
                    <th className="p-3">Vendas</th>
                    <th className="p-3">Receita</th>
                    <th className="p-3">ROAS</th>
                    <th className="p-3">CPA</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {creatives.length === 0 ? (
                <tr>
                  <td className="p-3 text-[var(--ct-text-2)]" colSpan={6}>
                    Nenhum criativo com gasto ou {unit.one} no período.
                  </td>
                </tr>
              ) : (
                creatives.map((c) => {
                  const roas = c.spend > 0 ? c.revenue / c.spend : null
                  const cpa = c.sales_count > 0 ? c.spend / c.sales_count : null
                  return (
                    <tr key={`${c.ad_name}|${c.adset_name ?? ''}`} className="border-t border-[var(--ct-line)]">
                      <td className="max-w-[280px] p-3" title={c.ad_name}>
                        <div className="truncate">{c.ad_name}</div>
                        {(c.adset_name || c.ad_count > 1) && (
                          <div className="mt-0.5 truncate text-[11px] text-[var(--ct-text-2)]">
                            {c.adset_name}
                            {c.ad_count > 1 && (
                              <span
                                title="Estes anúncios têm o mesmo nome e o mesmo conjunto. Nada na venda os separa, então a linha soma os dois em vez de creditar um deles no chute."
                                className="ml-1.5 cursor-help rounded-full bg-[var(--ct-warn)]/[0.12] px-1.5 py-0.5 text-[10px] text-[var(--ct-warn)]"
                              >
                                {c.ad_count} anúncios somados
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-3 font-[family-name:var(--font-geist-mono)] tabular-nums">{currency(c.spend)}</td>
                      {isLead ? (
                        <>
                          <td className="p-3 font-[family-name:var(--font-geist-mono)] tabular-nums">{Number(c.leads ?? 0)}</td>
                          <td className="p-3 font-[family-name:var(--font-geist-mono)] tabular-nums">{Number(c.leads) > 0 ? currency(c.spend / Number(c.leads)) : '—'}</td>
                          <td className="p-3 font-[family-name:var(--font-geist-mono)] tabular-nums">{Number(c.link_clicks ?? 0).toLocaleString('pt-BR')}</td>
                          <td className="p-3 font-[family-name:var(--font-geist-mono)] tabular-nums">
                            {Number(c.link_clicks) > 0 ? `${((Number(c.leads ?? 0) / Number(c.link_clicks)) * 100).toFixed(1).replace('.', ',')}%` : '—'}
                          </td>
                        </>
                      ) : (
                        <>
                      <td className="p-3 font-[family-name:var(--font-geist-mono)] tabular-nums">{c.sales_count}</td>
                      <td className="p-3 font-[family-name:var(--font-geist-mono)] tabular-nums">{currency(c.revenue)}</td>
                      <td
                        className={`p-3 font-[family-name:var(--font-geist-mono)] tabular-nums ${
                          roas !== null && roas >= 1 ? 'text-[var(--ct-ok)]' : 'text-[var(--ct-text-2)]'
                        }`}
                      >
                        {roas !== null ? `${roas.toFixed(2)}x` : '—'}
                      </td>
                      <td className="p-3 font-[family-name:var(--font-geist-mono)] tabular-nums">{cpa !== null ? currency(cpa) : '—'}</td>
                        </>
                      )}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      )}

      {tab === 'dias' && (
      <div className="card-shadow overflow-hidden rounded-2xl border border-[var(--ct-line)]">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="text-left text-[var(--ct-text-2)]">
              <th className="p-3">Dia</th>
              <th className="p-3">Investimento</th>
              <th className="p-3">Vendas de entrada</th>
              <th className="p-3">De anúncio</th>
              <th className="p-3">Upsell</th>
              <th className="p-3">Receita líquida</th>
              <th className="p-3">CPA geral</th>
              <th className="p-3">CPA de anúncio</th>
              <th className="p-3">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.data} className="border-t border-[var(--ct-line)]">
                <td className="p-3">
                  {row.data}
                  {row.dadosAte && (
                    <span className="ml-2 rounded-full bg-[var(--ct-warn)]/[0.12] px-2 py-0.5 text-[11px] text-[var(--ct-warn)]">
                      parcial · até {timeBr(row.dadosAte)}
                    </span>
                  )}
                </td>
                <td className="p-3 font-[family-name:var(--font-geist-mono)] tabular-nums">{currency(row.spendComImposto)}</td>
                <td className="p-3 font-[family-name:var(--font-geist-mono)] tabular-nums">{row.vendas}</td>
                <td className="p-3 font-[family-name:var(--font-geist-mono)] tabular-nums">{row.vendasAnuncio}</td>
                <td className="p-3 font-[family-name:var(--font-geist-mono)] tabular-nums">{row.vendasUpsell}</td>
                <td className="p-3 font-[family-name:var(--font-geist-mono)] tabular-nums">{currency(row.receitaLiquida)}</td>
                <td className="p-3 font-[family-name:var(--font-geist-mono)] tabular-nums">{row.cac !== null ? currency(row.cac) : '—'}</td>
                <td className="p-3 font-[family-name:var(--font-geist-mono)] tabular-nums">
                  {row.vendasAnuncio > 0 ? currency(row.spendComImposto / row.vendasAnuncio) : '—'}
                </td>
                <td className="p-3 font-[family-name:var(--font-geist-mono)] tabular-nums">{row.roas !== null ? `${row.roas.toFixed(2)}x` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  )
}
