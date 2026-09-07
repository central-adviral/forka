const COLORS = ['#7C6FF0', '#4F8EF7', '#2DD4A8', '#F5B94D', '#F76C6C']
const LABELS: Record<string, string> = {
  pix: 'Pix',
  credit_card: 'Cartão de crédito',
  bank_slip: 'Boleto',
  desconhecido: 'Desconhecido',
}

export function FunnelPaymentPie({
  breakdown,
  currency,
}: {
  breakdown: { metodo: string; receita: number }[]
  currency: (value: number) => string
}) {
  const total = breakdown.reduce((sum, b) => sum + b.receita, 0)
  if (total <= 0) return null

  const radius = 40
  const circumference = 2 * Math.PI * radius
  const segments = breakdown.reduce<Array<{ metodo: string; receita: number; pct: number; dashArray: string; dashOffset: number; color: string }>>(
    (acc, b, i) => {
      const pct = b.receita / total
      const cumulativePct = acc.reduce((sum, s) => sum + s.pct, 0)
      const dashArray = `${pct * circumference} ${circumference}`
      const dashOffset = -cumulativePct * circumference
      acc.push({ ...b, pct, dashArray, dashOffset, color: COLORS[i % COLORS.length] })
      return acc
    },
    []
  )

  return (
    <div className="card-shadow rounded-2xl border border-white/[0.08] p-5">
      <h2 className="mb-1 font-['Space_Grotesk'] text-base font-semibold">Receita por método</h2>
      <p className="mb-5 text-[12px] text-[#8A90A6]">Como o cliente escolheu pagar</p>
      <div className="flex items-center gap-8">
        <svg width="120" height="120" viewBox="0 0 100 100" className="-rotate-90 flex-shrink-0">
          <circle cx="50" cy="50" r={radius} fill="none" stroke="#1B2036" strokeWidth="16" />
          {segments.map((s) => (
            <circle
              key={s.metodo}
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={s.color}
              strokeWidth="16"
              strokeDasharray={s.dashArray}
              strokeDashoffset={s.dashOffset}
            />
          ))}
        </svg>
        <div className="flex-1 space-y-2.5">
          {segments.map((s) => (
            <div key={s.metodo} className="flex items-center justify-between text-[13px]">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="text-[#8A90A6]">{LABELS[s.metodo] ?? s.metodo}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-['JetBrains_Mono'] text-[#E8EAF2]">{(s.pct * 100).toFixed(0)}%</span>
                <span className="font-['JetBrains_Mono'] text-[#8A90A6]">{currency(s.receita)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
