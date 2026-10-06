interface KpiTotals {
  investimento: number
  receitaLiquida: number
  vendas: number
  cpa: number | null
  resultado: number
  roas: number | null
  ticketMedio: number | null
}

interface KpiSparklines {
  receitaLiquida: number[]
  roas: number[]
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null
  const w = 64
  const h = 20
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - ((v - min) / range) * h
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="mt-1.5 block" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function FunnelKpiCards({
  totals,
  currency,
  sparklines,
}: {
  totals: KpiTotals
  currency: (value: number) => string
  sparklines?: KpiSparklines
}) {
  const cards: { label: string; value: string; color?: string; spark?: { values: number[]; color: string } }[] = [
    { label: 'Investimento Total', value: currency(totals.investimento) },
    {
      label: 'Receita Líquida',
      value: currency(totals.receitaLiquida),
      spark: sparklines ? { values: sparklines.receitaLiquida, color: '#8B9BFF' } : undefined,
    },
    { label: 'Vendas', value: totals.vendas.toLocaleString('pt-BR') },
    { label: 'CPA', value: totals.cpa !== null ? currency(totals.cpa) : '—' },
    { label: 'Resultado', value: currency(totals.resultado), color: totals.resultado >= 0 ? '#4ADE9B' : '#FF7A73' },
    {
      label: 'ROAS',
      value: totals.roas !== null ? `${totals.roas.toFixed(2)}x` : '—',
      spark: sparklines ? { values: sparklines.roas, color: '#4ADE9B' } : undefined,
    },
    { label: 'Ticket Médio', value: totals.ticketMedio !== null ? currency(totals.ticketMedio) : '—' },
  ]

  return (
    <div
      // The headline numbers get their own lifted surface with a violet edge, so the band reads
      // as the summary of the page rather than as one more panel among the charts.
      className="mb-6 grid grid-cols-2 divide-y divide-white/[0.06] rounded-2xl border border-[#8B9BFF]/25 bg-[#1A1A1F] sm:grid-cols-4 sm:divide-y-0 lg:grid-cols-7 lg:divide-x"
      style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,.04), 0 10px 30px -18px rgba(124,111,240,.55)' }}
    >
      {cards.map((card) => (
        <div key={card.label} className="p-4">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#A1A1AA]">{card.label}</div>
          <div className="font-['JetBrains_Mono'] text-lg font-semibold" style={{ color: card.color ?? '#EDEDF0' }}>
            {card.value}
          </div>
          {card.spark && <Sparkline values={card.spark.values} color={card.spark.color} />}
        </div>
      ))}
    </div>
  )
}
