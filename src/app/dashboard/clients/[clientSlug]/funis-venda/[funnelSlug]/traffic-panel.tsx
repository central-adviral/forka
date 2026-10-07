import type { TrafficDay } from '@/lib/domain/traffic-days'

export type CostKey = 'cpa' | 'cpl' | 'cpm'

const COST_LABEL: Record<CostKey, string> = { cpa: 'CPA geral', cpl: 'CPL', cpm: 'CPM' }
const mono = 'font-[family-name:var(--font-geist-mono)]'

const int = (value: number | null) => (value === null ? '—' : Math.round(value).toLocaleString('pt-BR'))
const pct = (value: number | null) => (value === null ? '—' : `${value.toFixed(2).replace('.', ',')}%`)
const dayLabel = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

// Bars are the investment, the line is the cost: a day where the line jumps while the bar stays put
// is a day the traffic got worse, not one where more was spent.
function InvestmentCostChart({ days, costKey, money }: { days: TrafficDay[]; costKey: CostKey; money: (value: number) => string }) {
  if (days.length < 2) return <p className="text-[12.5px] text-[var(--ct-text-2)]">Escolha um período com pelo menos dois dias.</p>
  const W = 960
  const H = 240
  const L = 64
  const R = 64
  const T = 16
  const B = 30
  const iw = W - L - R
  const ih = H - T - B
  const band = iw / days.length
  const maxSpend = Math.max(...days.map((day) => day.spend), 1) * 1.1
  const costs = days.map((day) => day[costKey])
  const knownCosts = costs.filter((value): value is number => value !== null)
  const maxCost = Math.max(...knownCosts, 1) * 1.1
  const x = (i: number) => L + i * band + band / 2
  const yCost = (value: number) => T + ih - (value / maxCost) * ih
  let path = ''
  let open = false
  costs.forEach((value, i) => {
    if (value === null) {
      open = false
      return
    }
    path += `${open ? 'L' : 'M'}${x(i).toFixed(1)} ${yCost(value).toFixed(1)} `
    open = true
  })
  const labelEvery = Math.max(1, Math.ceil(days.length / 12))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Investimento e ${COST_LABEL[costKey]} por dia`}>
      {[0, 1, 2, 3].map((step) => {
        const y = T + (ih * step) / 3
        return (
          <g key={step}>
            <line x1={L} x2={W - R} y1={y} y2={y} style={{ stroke: 'var(--ct-line)' }} />
            <text x={L - 8} y={y} textAnchor="end" dominantBaseline="middle" fontSize={10} style={{ fill: 'var(--ct-an)' }}>
              {money((maxSpend * (3 - step)) / 3)}
            </text>
            {knownCosts.length > 0 && (
              <text x={W - R + 8} y={y} dominantBaseline="middle" fontSize={10} style={{ fill: 'var(--ct-warn)' }}>
                {money((maxCost * (3 - step)) / 3)}
              </text>
            )}
          </g>
        )
      })}
      {days.map((day, i) => {
        const h = (day.spend / maxSpend) * ih
        const cost = day[costKey]
        return (
          <g key={day.data}>
            <rect x={L + i * band + band * 0.18} y={T + ih - h} width={band * 0.64} height={h} rx={3} style={{ fill: 'var(--ct-an)', opacity: 0.55 }}>
              <title>{`${dayLabel(day.data)} · ${money(day.spend)} · ${COST_LABEL[costKey]} ${cost === null ? '—' : money(cost)}`}</title>
            </rect>
            {(i % labelEvery === 0 || i === days.length - 1) && (
              <text x={x(i)} y={H - 10} textAnchor="middle" fontSize={10} style={{ fill: 'var(--ct-text-3)' }}>
                {dayLabel(day.data)}
              </text>
            )}
          </g>
        )
      })}
      <path d={path} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: 'var(--ct-warn)' }} />
      {costs.map((value, i) => (value === null ? null : <circle key={i} cx={x(i)} cy={yCost(value)} r={2.5} style={{ fill: 'var(--ct-warn)' }} />))}
    </svg>
  )
}

export function TrafficPanel({
  days,
  total,
  scopes,
  costKey,
  isFront,
  money,
}: {
  days: TrafficDay[]
  total: TrafficDay
  scopes: { label: string; href: string; active: boolean }[]
  costKey: CostKey
  isFront: boolean
  money: (value: number) => string
}) {
  const moneyOrDash = (value: number | null) => (value === null ? '—' : money(value))
  const groups: { title: string; rows: { label: string; value: (day: TrafficDay) => string; strong?: boolean }[] }[] = [
    {
      title: 'Mídia',
      rows: [
        { label: 'Investimento c/ imposto', value: (day) => money(day.spend), strong: true },
        { label: 'Impressões', value: (day) => int(day.impressions) },
        { label: 'CPM', value: (day) => moneyOrDash(day.cpm) },
        { label: 'Cliques no link', value: (day) => int(day.linkClicks) },
        { label: 'CTR', value: (day) => pct(day.ctr) },
        { label: 'View page', value: (day) => int(day.landingPageViews) },
        { label: 'Connect rate', value: (day) => pct(day.connectRate) },
        { label: 'Initiate checkout', value: (day) => int(day.initiateCheckout) },
        { label: '% PV → IC', value: (day) => pct(day.pvToIc) },
      ],
    },
    {
      title: 'Leads',
      rows: [
        { label: 'Leads pagos', value: (day) => int(day.leads) },
        { label: 'CPL', value: (day) => moneyOrDash(day.cpl) },
      ],
    },
  ]
  if (!isFront) {
    groups.push({
      title: 'Vendas',
      rows: [
        { label: 'Vendas de entrada', value: (day) => int(day.vendas), strong: true },
        { label: 'CPA geral', value: (day) => moneyOrDash(day.cpa), strong: true },
      ],
    })
  }

  return (
    <div className="mb-6 flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-[var(--ct-text-2)]">Ver:</span>
        {scopes.map((scope) => (
          <a
            key={scope.href}
            href={scope.href}
            aria-current={scope.active ? 'page' : undefined}
            className={`rounded-full border px-3 py-1 text-[12.5px] font-medium ${
              scope.active
                ? 'border-[var(--ct-accent)] bg-[var(--ct-accent-soft)] text-[var(--ct-text)]'
                : 'border-[var(--ct-line)] text-[var(--ct-text-2)] hover:text-[var(--ct-text)]'
            }`}
          >
            {scope.label}
          </a>
        ))}
        {isFront && <span className="text-[11.5px] text-[var(--ct-text-3)]">frente = só mídia; as vendas são do projeto inteiro</span>}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { label: 'Investimento c/ imposto', value: money(total.spend) },
          { label: 'CPM', value: moneyOrDash(total.cpm) },
          { label: 'CTR', value: pct(total.ctr) },
          { label: 'Connect rate', value: pct(total.connectRate) },
          costKey === 'cpm'
            ? { label: '% PV → IC', value: pct(total.pvToIc) }
            : { label: COST_LABEL[costKey], value: moneyOrDash(total[costKey]) },
        ].map((kpi) => (
          <div key={kpi.label} className="card-shadow rounded-2xl border border-[var(--ct-line)] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ct-text-2)]">{kpi.label}</div>
            <div className={`${mono} mt-1 text-lg font-semibold`}>{kpi.value}</div>
          </div>
        ))}
      </div>

      <div className="card-shadow rounded-2xl border border-[var(--ct-line)] p-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-[family-name:var(--font-sora)] text-base font-semibold">Investimento × {COST_LABEL[costKey]} por dia</h2>
          <span className="text-[11.5px] text-[var(--ct-text-2)]">barras = investimento com imposto (eixo esquerdo) · linha = {COST_LABEL[costKey]} (eixo direito)</span>
        </div>
        <InvestmentCostChart days={days} costKey={costKey} money={money} />
      </div>

      <div className="card-shadow overflow-hidden rounded-2xl border border-[var(--ct-line)]">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
          <h2 className="font-[family-name:var(--font-sora)] text-base font-semibold">Visão diária</h2>
          <span className="text-[11.5px] text-[var(--ct-text-2)]">dias em coluna, métricas em linha · role para o lado para ver todos os dias</span>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[var(--ct-text-2)]">
                <th className="sticky left-0 z-10 bg-[var(--ct-surface)] p-2.5 pl-4">Métrica</th>
                <th className="p-2.5 text-right">Total</th>
                {days.map((day) => (
                  <th key={day.data} className="p-2.5 text-right font-medium">
                    {dayLabel(day.data)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => [
                <tr key={group.title} className="border-t border-[var(--ct-line)] bg-[var(--ct-surface-2)]">
                  <td colSpan={days.length + 2} className="p-2 pl-4 text-[11px] font-semibold uppercase tracking-wide text-[var(--ct-text-2)]">
                    {group.title}
                  </td>
                </tr>,
                ...group.rows.map((row) => (
                  <tr key={`${group.title}-${row.label}`} className={`border-t border-[var(--ct-line)] ${row.strong ? 'font-semibold' : ''}`}>
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-[var(--ct-surface)] p-2.5 pl-4">{row.label}</td>
                    <td className={`${mono} whitespace-nowrap p-2.5 text-right tabular-nums`}>{row.value(total)}</td>
                    {days.map((day) => (
                      <td key={day.data} className={`${mono} whitespace-nowrap p-2.5 text-right tabular-nums text-[var(--ct-text-2)]`}>
                        {row.value(day)}
                      </td>
                    ))}
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-3 text-[11px] text-[var(--ct-text-3)]">Gasto com imposto · leads pagos do LaunchOps, sem duplicata · &quot;—&quot; = dia sem dado para a conta.</p>
      </div>
    </div>
  )
}
