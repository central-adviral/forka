interface KpiTotals {
  investimento: number
  receitaLiquida: number
  vendas: number
  cpa: number | null
  resultado: number
  roas: number | null
  ticketMedio: number | null
}

export function FunnelKpiCards({ totals, currency }: { totals: KpiTotals; currency: (value: number) => string }) {
  const cards: { label: string; value: string; color?: string }[] = [
    { label: 'Investimento Total', value: currency(totals.investimento) },
    { label: 'Receita Líquida', value: currency(totals.receitaLiquida) },
    { label: 'Vendas', value: totals.vendas.toLocaleString('pt-BR') },
    { label: 'CPA', value: totals.cpa !== null ? currency(totals.cpa) : '—' },
    { label: 'Resultado', value: currency(totals.resultado), color: totals.resultado >= 0 ? '#2DD4A8' : '#F76C6C' },
    { label: 'ROAS', value: totals.roas !== null ? `${totals.roas.toFixed(2)}x` : '—' },
    { label: 'Ticket Médio', value: totals.ticketMedio !== null ? currency(totals.ticketMedio) : '—' },
  ]

  return (
    <div className="mb-6 grid grid-cols-2 divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] sm:grid-cols-4 sm:divide-y-0 lg:grid-cols-7 lg:divide-x">
      {cards.map((card) => (
        <div key={card.label} className="p-4">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#8A90A6]">{card.label}</div>
          <div className="font-['JetBrains_Mono'] text-lg font-semibold" style={{ color: card.color ?? '#E8EAF2' }}>
            {card.value}
          </div>
        </div>
      ))}
    </div>
  )
}
