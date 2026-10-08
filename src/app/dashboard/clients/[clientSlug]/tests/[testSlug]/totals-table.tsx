import { BarCell, Delta, METRIC_INFO, RateCell, TD_CLASS, TH_CLASS, TR_CLASS, ThWithInfo, type ReportRow } from './report-cells'

// "Total por página": every variant's people, buyers, rate, sales and money, with the previous
// period beside each number when comparing. On a phone each row becomes a card.

export function TotalsTable({ rows, previousByVariant, assetLabel }: { rows: ReportRow[]; previousByVariant: Map<string, ReportRow>; assetLabel: string }) {
  const maxClicks = Math.max(1, ...rows.map((r) => Number(r.clicks)))
  const maxRevenue = Math.max(1, ...rows.map((r) => Number(r.revenue_cents)))
  const perPerson = (row: ReportRow) => (row.visits > 0 ? Number(row.revenue_cents) / row.visits / 100 : 0)
  const buyerRate = (row: ReportRow) => (row.visits > 0 ? (row.conversions / row.visits) * 100 : 0)
  return (
    <>
    {/* Below 640px each row is a card with the numbers that decide; nothing gets cut. */}
    <div className="flex flex-col gap-2 sm:hidden">
      {rows.map((row) => (
        <div key={row.variant_id} className="grid grid-cols-3 gap-2 rounded-2xl border border-[var(--ct-line)] bg-[var(--ct-surface)] px-4 py-3">
          <b className="col-span-3 text-[14px]">{row.variant_name}</b>
          {[
            ['pessoas', row.visits.toLocaleString('pt-BR')],
            ['compradores', row.conversions.toLocaleString('pt-BR')],
            ['taxa', `${buyerRate(row).toFixed(1)}%`],
            ['vendas', Number(row.sales).toLocaleString('pt-BR')],
            ['faturamento', `R$ ${(Number(row.revenue_cents) / 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`],
            ['R$/pessoa', `R$ ${perPerson(row).toFixed(2)}`],
          ].map(([label, value]) => (
            <span key={label} className="flex flex-col">
              <span className="font-[family-name:var(--font-geist-mono)] text-[13px]">{value}</span>
              <span className="text-[11px] text-[var(--ct-text-3)]">{label}</span>
            </span>
          ))}
        </div>
      ))}
    </div>
    <div className="hidden overflow-x-auto rounded-2xl border border-[var(--ct-line)] sm:block">
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
    </>
  )
}
