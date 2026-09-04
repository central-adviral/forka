import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getDailyFunnel, getFunnelSyncHealth, getPaymentMethodBreakdown } from '@/lib/repo/funnel-repo'
import { REPORT_PERIODS, resolvePeriodDateRange, formatBr } from '@/lib/domain/report-period'
import { FunnelCone } from './funnel-cone'
import { FunnelKpiCards } from './funnel-kpi-cards'
import { FunnelPaymentPie } from './funnel-payment-pie'
import { SyncFunnelButton } from './sync-funnel-button'

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
  const [rows, health, paymentBreakdown] = await Promise.all([
    getDailyFunnel(supabase, funnel.id, since, until),
    getFunnelSyncHealth(supabase, funnel.id),
    getPaymentMethodBreakdown(supabase, funnel.id, since, until),
  ])

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
        <div className="flex items-center gap-2">
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

      <div className="mb-6 rounded-2xl border border-white/[0.08] p-4 text-[13.5px] text-[#8A90A6]">
        Spend pode estar subestimado — parte do gasto do Meta Ads ainda não está atribuída a esta operação na fonte.
        {health.map((h) => (
          <div key={h.entity}>
            {h.entity}: {h.lastResult === 'error' ? `erro na última sincronização (${h.lastMessage ?? 'sem detalhes'})` : `ok, última execução ${h.lastRunAt ?? 'nunca'}`}
          </div>
        ))}
      </div>

      <FunnelKpiCards totals={kpiTotals} currency={currency} />

      <FunnelCone totals={coneTotals} currency={currency} />

      <FunnelPaymentPie breakdown={paymentBreakdown} currency={currency} />

      <div className="overflow-hidden rounded-2xl border border-white/[0.08]">
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
