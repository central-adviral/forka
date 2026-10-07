import { MIN_PATTERN_DAYS, PATTERN_METRICS, type PatternMetric, type PatternReport } from '@/lib/domain/patterns'

const mono = 'font-[family-name:var(--font-geist-mono)]'
const dayLabel = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const signed = (value: number) => (Math.abs(value) < 0.5 ? '0%' : `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(0)}%`)

function rateLabel(metric: PatternMetric, value: number, money: (value: number) => string): string {
  return metric === 'cpm' ? money(value) : `${value.toFixed(2).replace('.', ',')}%`
}

export function PatternsPanel({
  report,
  costLabel,
  money,
}: {
  report: PatternReport | null
  costLabel: string
  money: (value: number) => string
}) {
  if (!report) {
    return (
      <div className="card-shadow mb-6 rounded-2xl border border-[var(--ct-line)] p-5 text-[13px] text-[var(--ct-text-2)]">
        <h2 className="mb-1 font-[family-name:var(--font-sora)] text-base font-semibold text-[var(--ct-text)]">Padrões ao longo dos dias</h2>
        Escolha um período com pelo menos {MIN_PATTERN_DAYS} dias fechados com {costLabel} para ver o que separa os dias bons dos ruins.
      </div>
    )
  }
  const separator = report.separator ? report.goodVsBad.find((row) => row.metric === report.separator) : null
  return (
    <div className="mb-6 flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-[family-name:var(--font-sora)] text-base font-semibold">Padrões ao longo dos dias</h2>
        <span className="text-[11.5px] text-[var(--ct-text-2)]">
          {report.days} dias fechados · dia bom = {costLabel} até a mediana ({money(report.medianCost)}) · hoje fica de fora
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="card-shadow rounded-2xl border border-[var(--ct-line)] p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ct-text-2)]">Melhor dia · {dayLabel(report.best.data)}</div>
          <div className={`${mono} mt-1 text-lg font-semibold text-[var(--ct-ok)]`}>{money(report.best.cost)}</div>
          <div className="text-[11.5px] text-[var(--ct-text-2)]">{costLabel} · investimento {money(report.best.spend)}</div>
        </div>
        <div className="card-shadow rounded-2xl border border-[var(--ct-line)] p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ct-text-2)]">Pior dia · {dayLabel(report.worst.data)}</div>
          <div className={`${mono} mt-1 text-lg font-semibold text-[var(--ct-crit)]`}>{money(report.worst.cost)}</div>
          <div className="text-[11.5px] text-[var(--ct-text-2)]">{costLabel} · investimento {money(report.worst.spend)}</div>
        </div>
        <div className="card-shadow rounded-2xl border border-[var(--ct-line)] p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ct-text-2)]">O que mais separa bons de ruins</div>
          {separator ? (
            <>
              <div className="mt-1 text-lg font-semibold">{PATTERN_METRICS[separator.metric].label}</div>
              <div className="text-[11.5px] text-[var(--ct-text-2)]">{signed(separator.changePct)} nos dias ruins</div>
            </>
          ) : (
            <div className="mt-1 text-[13px] text-[var(--ct-text-2)]">Nenhuma métrica de mídia piora nos dias ruins: olhe volume e oferta.</div>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card-shadow overflow-hidden rounded-2xl border border-[var(--ct-line)]">
          <h3 className="px-4 pt-4 text-[14px] font-semibold">Dias bons × dias ruins</h3>
          <table className="mt-2 w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[var(--ct-text-2)]">
                <th className="p-2.5 pl-4">Métrica</th>
                <th className="p-2.5 text-right">Bons</th>
                <th className="p-2.5 text-right">Ruins</th>
                <th className="p-2.5 pr-4 text-right">Ruins vs bons</th>
              </tr>
            </thead>
            <tbody>
              {report.goodVsBad.map((row) => (
                <tr key={row.metric} className={`border-t border-[var(--ct-line)] ${row.metric === report.separator ? 'font-semibold' : ''}`}>
                  <td className="p-2.5 pl-4">{PATTERN_METRICS[row.metric].label}</td>
                  <td className={`${mono} p-2.5 text-right`}>{rateLabel(row.metric, row.good, money)}</td>
                  <td className={`${mono} p-2.5 text-right`}>{rateLabel(row.metric, row.bad, money)}</td>
                  <td className={`${mono} p-2.5 pr-4 text-right ${row.worse && Math.abs(row.changePct) >= 10 ? 'text-[var(--ct-crit)]' : 'text-[var(--ct-text-2)]'}`}>
                    {signed(row.changePct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card-shadow rounded-2xl border border-[var(--ct-line)] p-4">
          <h3 className="text-[14px] font-semibold">O que anda junto com o {costLabel}</h3>
          <p className="mb-3 text-[11.5px] text-[var(--ct-text-2)]">correlação dia a dia · à direita: quando sobe, o custo sobe · à esquerda: quando sobe, o custo cai</p>
          <div className="flex flex-col gap-2">
            {report.correlation.map((row) => (
              <div key={row.metric} className="grid grid-cols-[140px_minmax(0,1fr)_48px] items-center gap-3 text-[12.5px]">
                <span>{PATTERN_METRICS[row.metric].label}</span>
                <div className="relative h-2 rounded-full bg-[var(--ct-surface-2)]">
                  <span className="absolute left-1/2 top-[-3px] h-[14px] w-px bg-[var(--ct-line-2)]" />
                  <span
                    className="absolute top-0 h-2 rounded-full"
                    style={{
                      left: row.r < 0 ? `${50 - Math.abs(row.r) * 50}%` : '50%',
                      width: `${Math.abs(row.r) * 50}%`,
                      background: row.r > 0 ? 'var(--ct-crit)' : 'var(--ct-ok)',
                      opacity: 0.75,
                    }}
                  />
                </div>
                <span className={`${mono} text-right text-[var(--ct-text-2)]`}>{row.r.toFixed(2).replace('.', ',')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {report.suggestions.length > 0 && (
        <div className="grid gap-3 md:grid-cols-3">
          {report.suggestions.map((suggestion) => (
            <div key={suggestion.metric} className="card-shadow rounded-2xl border border-[var(--ct-line)] p-4">
              <b className="text-[13.5px]">
                {PATTERN_METRICS[suggestion.metric].label} {signed(suggestion.changePct)} nos dias ruins
              </b>
              <p className="mt-1 text-[12.5px] text-[var(--ct-text-2)]">{suggestion.text}</p>
            </div>
          ))}
        </div>
      )}

      <div className="card-shadow overflow-hidden rounded-2xl border border-[var(--ct-line)]">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
          <h3 className="text-[14px] font-semibold">Dia a dia · o que puxou o {costLabel}</h3>
          <span className="text-[11.5px] text-[var(--ct-text-2)]">variação contra a mediana · só o que mudou 10% ou mais</span>
        </div>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[var(--ct-text-2)]">
                <th className="p-2.5 pl-4">Dia</th>
                <th className="p-2.5 text-right">Investimento</th>
                <th className="p-2.5 text-right">{costLabel}</th>
                <th className="p-2.5 text-right">vs mediana</th>
                <th className="p-2.5 pr-4">O que mudou</th>
              </tr>
            </thead>
            <tbody>
              {report.drivers.map((row) => (
                <tr key={row.data} className="border-t border-[var(--ct-line)]">
                  <td className="p-2.5 pl-4">{dayLabel(row.data)}</td>
                  <td className={`${mono} p-2.5 text-right`}>{money(row.spend)}</td>
                  <td className={`${mono} p-2.5 text-right`}>{money(row.cost)}</td>
                  <td className={`${mono} p-2.5 text-right ${row.vsMedianPct > 10 ? 'text-[var(--ct-crit)]' : row.vsMedianPct < -10 ? 'text-[var(--ct-ok)]' : 'text-[var(--ct-text-2)]'}`}>
                    {signed(row.vsMedianPct)}
                  </td>
                  <td className="p-2.5 pr-4">
                    {row.moved.length === 0 ? (
                      <span className="text-[var(--ct-text-3)]">—</span>
                    ) : (
                      <span className="flex flex-wrap gap-1.5">
                        {row.moved.map((move) => (
                          <span
                            key={move.metric}
                            className={`rounded-full px-2 py-0.5 text-[11px] ${move.worse ? 'bg-[var(--ct-crit-soft)] text-[var(--ct-crit)]' : 'bg-[var(--ct-ok-soft)] text-[var(--ct-ok)]'}`}
                          >
                            {PATTERN_METRICS[move.metric].label} {signed(move.changePct)}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-[var(--ct-text-3)]">Regra de bolso a partir dos números do período: confirme com o time antes de mexer na campanha.</p>
    </div>
  )
}
