import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getDailyFunnel, getFunnelSyncHealth, getPaymentMethodBreakdown } from '@/lib/repo/funnel-repo'
import { REPORT_PERIODS, resolvePeriodDateRange, formatBr } from '@/lib/domain/report-period'
import { FunnelCone } from './funnel-cone'
import { FunnelKpiCards } from './funnel-kpi-cards'
import { FunnelPaymentPie } from './funnel-payment-pie'
import { SyncFunnelButton } from './sync-funnel-button'
import { SyncStatus } from '@/components/sync-status'
import { MiniBarChart } from '@/components/mini-bar-chart'

export default async function SalesFunnelPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string; funnelSlug: string }>
  searchParams: Promise<{ periodo?: string; desde?: string; ate?: string }>
}) {
  const { clientSlug, funnelSlug } = await params
  const { periodo, desde, ate } = await searchParams
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, name, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()

  const { data: funnel } = await supabase
    .from('sales_funnels')
    .select('id, name, slug')
    .eq('client_id', client.id)
    .eq('slug', funnelSlug)
    .maybeSingle()
  if (!funnel) notFound()

  const { since, until } = resolvePeriodDateRange(periodo, desde, ate)
  const [rows, health, paymentBreakdown, creativeResult, productResult, hourResult] = await Promise.all([
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
  ])
  if (creativeResult.error) {
    console.error('[funnel-creative-report-failed]', { salesFunnelId: funnel.id }, creativeResult.error)
  }
  const creatives = (creativeResult.data ?? []) as {
    ad_name: string
    spend: number
    impressions: number
    link_clicks: number
    sales_count: number
    revenue: number
  }[]
  if (productResult.error) console.error('[funnel-product-report-failed]', { salesFunnelId: funnel.id }, productResult.error)
  if (hourResult.error) console.error('[funnel-hour-report-failed]', { salesFunnelId: funnel.id }, hourResult.error)
  const products = (productResult.data ?? []) as { produto: string; sales_count: number; revenue: number }[]
  const salesByHour = (hourResult.data ?? []) as { hour: number; sales_count: number; revenue: number }[]

  const currency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  const totals = rows.reduce(
    (acc, row) => ({
      investimento: acc.investimento + row.spend,
      receitaBruta: acc.receitaBruta + row.receitaBruta,
      receitaLiquida: acc.receitaLiquida + row.receitaLiquida,
      vendas: acc.vendas + row.vendas,
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
      impressions: 0,
      reach: 0,
      linkClicks: 0,
      landingPageViews: 0,
      initiateCheckout: 0,
    }
  )
  const kpiTotals = {
    investimento: totals.investimento,
    receitaLiquida: totals.receitaLiquida,
    vendas: totals.vendas,
    cpa: totals.vendas > 0 ? totals.investimento / totals.vendas : null,
    resultado: totals.receitaLiquida - totals.investimento,
    roas: totals.investimento > 0 ? totals.receitaLiquida / totals.investimento : null,
    ticketMedio: totals.vendas > 0 ? totals.receitaLiquida / totals.vendas : null,
  }
  const coneTotals = {
    spend: totals.investimento,
    impressions: totals.impressions,
    reach: totals.reach,
    linkClicks: totals.linkClicks,
    landingPageViews: totals.landingPageViews,
    initiateCheckout: totals.initiateCheckout,
    vendas: totals.vendas,
  }
  const kpiSparklines = {
    receitaLiquida: rows.map((row) => row.receitaLiquida),
    roas: rows.map((row) => (row.spend > 0 ? row.receitaLiquida / row.spend : 0)),
  }
  const lastSyncAt = health.find((h) => h.lastRunAt)?.lastRunAt ?? null
  const hasSyncError = health.some((h) => h.lastResult === 'error')

  return (
    <div className="p-8">
      <a
        href={`/dashboard/clients/${client.slug}/funis-venda`}
        className="mb-1 flex items-center gap-1 text-xs text-[#8A90A6] hover:text-[#E8EAF2]"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M6.5 2L3 5L6.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Funis de Venda
      </a>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-['Space_Grotesk'] text-xl font-semibold">{funnel.name}</h1>
        <div className="flex items-center gap-3">
          <SyncStatus lastRunAt={lastSyncAt} hasError={hasSyncError} />
          <SyncFunnelButton salesFunnelId={funnel.id} clientSlug={client.slug} funnelSlug={funnel.slug} />
          <a
            href={`/dashboard/clients/${client.slug}/funis-venda/${funnel.slug}/edit`}
            className="rounded-[9px] border border-white/[0.08] px-4 py-2.5 text-[13.5px] font-medium text-[#8A90A6]"
          >
            Editar
          </a>
        </div>
      </div>

      <div className="mb-6 flex gap-1.5">
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

      {/* Only speaks up when a sync actually failed. The healthy case is already covered by the
          pulse in the header, and printing "ok, última execução ..." on every load was noise. */}
      {hasSyncError && (
        <div className="mb-6 rounded-2xl border border-[#F76C6C]/35 bg-[#F76C6C]/10 p-4 text-[13px] text-[#F76C6C]">
          {health
            .filter((h) => h.lastResult === 'error')
            .map((h) => (
              <div key={h.entity}>
                Falha ao sincronizar {h.entity}: {h.lastMessage ?? 'sem detalhes'}
              </div>
            ))}
        </div>
      )}

      <FunnelKpiCards totals={kpiTotals} currency={currency} sparklines={kpiSparklines} />

      {/* Funnel on the left, the three read-outs stacked on the right: the funnel is one tall
          shape and the analyses are short ones, so side by side they fill each other's space. */}
      <div className="mb-6 grid items-start gap-5 lg:grid-cols-[1.1fr_1fr]">
        <FunnelCone totals={coneTotals} currency={currency} />

        <div className="flex flex-col gap-5">
          <FunnelPaymentPie breakdown={paymentBreakdown} currency={currency} />

          <div className="card-shadow rounded-2xl border border-white/[0.08] p-5">
            <h2 className="mb-1 font-['Space_Grotesk'] text-base font-semibold">Por produto</h2>
            <p className="mb-4 text-[12px] text-[#8A90A6]">Onde a receita do funil se concentra</p>
            {products.length === 0 ? (
              <p className="text-[13px] text-[#8A90A6]">Nenhuma venda no período.</p>
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
                        <span className="flex-shrink-0 font-['JetBrains_Mono'] tabular-nums text-[#E8EAF2]">
                          {currency(p.revenue)}
                          <span className="ml-2 text-[11px] text-[#8A90A6]">{p.sales_count} vendas</span>
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-[#1B2036]">
                        <div className="h-full rounded-full bg-[#7C6FF0]" style={{ width: `${Math.max(2, share)}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="card-shadow rounded-2xl border border-white/[0.08] p-5">
            <h2 className="mb-1 font-['Space_Grotesk'] text-base font-semibold">Vendas por horário</h2>
            <p className="mb-4 text-[12px] text-[#8A90A6]">Hora do dia (horário de Brasília)</p>
            <MiniBarChart
              data={salesByHour.map((h) => ({ label: `${String(h.hour).padStart(2, '0')}h`, value: h.sales_count }))}
              valueFormat={(value) => `${value} vendas`}
              barColor="#2DD4A8"
            />
          </div>
        </div>
      </div>

      <div className="card-shadow mb-6 overflow-hidden rounded-2xl border border-white/[0.08]">
        <div className="flex items-baseline justify-between px-4 pt-4">
          <h2 className="font-['Space_Grotesk'] text-base font-semibold">Por criativo</h2>
          <span className="text-[11.5px] text-[#8A90A6]">
            Cruza o gasto do anúncio com a venda que ele gerou
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="mt-3 w-full text-[13.5px]">
            <thead>
              <tr className="border-b border-white/[0.08] text-left text-[#8A90A6]">
                <th className="p-3">Anúncio</th>
                <th className="p-3">Gasto</th>
                <th className="p-3">Vendas</th>
                <th className="p-3">Receita</th>
                <th className="p-3">ROAS</th>
                <th className="p-3">CPA</th>
              </tr>
            </thead>
            <tbody>
              {creatives.length === 0 ? (
                <tr>
                  <td className="p-3 text-[#8A90A6]" colSpan={6}>
                    Nenhum criativo com gasto ou venda no período.
                  </td>
                </tr>
              ) : (
                creatives.map((c) => {
                  const roas = c.spend > 0 ? c.revenue / c.spend : null
                  const cpa = c.sales_count > 0 ? c.spend / c.sales_count : null
                  return (
                    <tr key={c.ad_name} className="border-t border-white/[0.06]">
                      <td className="max-w-[280px] truncate p-3" title={c.ad_name}>
                        {c.ad_name}
                      </td>
                      <td className="p-3 font-['JetBrains_Mono'] tabular-nums">{currency(c.spend)}</td>
                      <td className="p-3 font-['JetBrains_Mono'] tabular-nums">{c.sales_count}</td>
                      <td className="p-3 font-['JetBrains_Mono'] tabular-nums">{currency(c.revenue)}</td>
                      <td
                        className={`p-3 font-['JetBrains_Mono'] tabular-nums ${
                          roas !== null && roas >= 1 ? 'text-[#2DD4A8]' : 'text-[#8A90A6]'
                        }`}
                      >
                        {roas !== null ? `${roas.toFixed(2)}x` : '—'}
                      </td>
                      <td className="p-3 font-['JetBrains_Mono'] tabular-nums">{cpa !== null ? currency(cpa) : '—'}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card-shadow overflow-hidden rounded-2xl border border-white/[0.08]">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="text-left text-[#8A90A6]">
              <th className="p-3">Dia</th>
              <th className="p-3">Vendas</th>
              <th className="p-3">Receita bruta</th>
              <th className="p-3">Spend</th>
              <th className="p-3">ROAS</th>
              <th className="p-3">CAC</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.data} className="border-t border-white/[0.08]">
                <td className="p-3">{row.data}</td>
                <td className="p-3">{row.vendas}</td>
                <td className="p-3">{currency(row.receitaBruta)}</td>
                <td className="p-3">{currency(row.spend)}</td>
                <td className="p-3">{row.roas !== null ? row.roas.toFixed(2) : '—'}</td>
                <td className="p-3">{row.cac !== null ? currency(row.cac) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
