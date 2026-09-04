import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getDailyFunnel, getFunnelSyncHealth, getPaymentMethodBreakdown } from '@/lib/repo/funnel-repo'
import { FunnelCone } from './funnel-cone'
import { FunnelKpiCards } from './funnel-kpi-cards'
import { FunnelPaymentPie } from './funnel-payment-pie'

function defaultDateRange() {
  // `until` is an exclusive upper bound in funnel-repo's query, so it must be tomorrow
  // to include all of today's data.
  const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return { since, until }
}

export default async function FunnelPage({ params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, name, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()

  const { since, until } = defaultDateRange()
  const [rows, health, paymentBreakdown] = await Promise.all([
    getDailyFunnel(supabase, client.id, since, until),
    getFunnelSyncHealth(supabase, client.id),
    getPaymentMethodBreakdown(supabase, client.id, since, until),
  ])

  const currency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  const totals = rows.reduce(
    (acc, row) => ({
      investimento: acc.investimento + row.spend,
      receitaBruta: acc.receitaBruta + row.receitaBruta,
      vendas: acc.vendas + row.vendas,
    }),
    { investimento: 0, receitaBruta: 0, vendas: 0 }
  )
  const kpiTotals = {
    investimento: totals.investimento,
    receitaBruta: totals.receitaBruta,
    resultado: totals.receitaBruta - totals.investimento,
    roas: totals.investimento > 0 ? totals.receitaBruta / totals.investimento : null,
    ticketMedio: totals.vendas > 0 ? totals.receitaBruta / totals.vendas : null,
  }

  return (
    <div className="p-8">
      <h1 className="mb-6 font-['Space_Grotesk'] text-xl font-semibold">Funil de Vendas — {client.name}</h1>

      <div className="mb-6 rounded-2xl border border-white/[0.08] p-4 text-[13.5px] text-[#8A90A6]">
        Spend pode estar subestimado — parte do gasto do Meta Ads ainda não está atribuída a esta operação na fonte.
        {health.map((h) => (
          <div key={h.entity}>
            {h.entity}: {h.lastResult === 'error' ? `erro na última sincronização (${h.lastMessage ?? 'sem detalhes'})` : `ok, última execução ${h.lastRunAt ?? 'nunca'}`}
          </div>
        ))}
      </div>

      <FunnelKpiCards totals={kpiTotals} currency={currency} />

      <FunnelCone days={rows} />

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
