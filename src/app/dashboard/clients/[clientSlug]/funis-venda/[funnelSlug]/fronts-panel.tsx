import { Fragment } from 'react'
import Link from 'next/link'

export interface FrontDayRow {
  front_id: string
  spend: number
  impressions: number
  link_clicks: number
  landing_page_views: number
  leads: number
  initiate_checkout: number
}

export interface FrontInfo {
  id: string
  code: string
  name: string
  sourceName: string | null
}

const FRONT_COLORS = ['var(--ct-painel)', 'var(--ct-an)', 'var(--ct-ab)', 'var(--ct-ok)', 'var(--ct-warn)']
const mono = 'font-[family-name:var(--font-geist-mono)]'

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null
}

// The prototype's "frentes lado a lado": one card per front with its share of the investment, then
// every media number of every front in one table so they can be compared down a column.
export function FrontsPanel({
  fronts,
  rows,
  taxFactor,
  rulesHref,
  currency,
  sales,
  stageOf,
}: {
  fronts: FrontInfo[]
  /** Each front's stage name, the fronts already in stage order: the table gets a row per stage. */
  stageOf?: Map<string, string>
  rows: FrontDayRow[]
  /** Entry sales and net revenue per own front (0095); null when the objective counts no sales. */
  sales: Map<string, { vendas: number; receita: number }> | null
  /** Investment with tax ÷ without, over the period: the front numbers come without tax. */
  taxFactor: number
  rulesHref: string
  currency: (value: number) => string
}) {
  if (fronts.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-[var(--ct-line-2)] p-6 text-sm text-[var(--ct-text-2)]">
        Este funil ainda não tem frentes. Crie em <Link href={rulesHref} className="text-[var(--ct-accent)]">Etapas e frentes</Link>.
      </p>
    )
  }
  const totals = fronts.map((front, i) => {
    const own = rows.filter((row) => row.front_id === front.id)
    const add = (key: keyof Omit<FrontDayRow, 'front_id'>) => own.reduce((total, row) => total + Number(row[key]), 0)
    return {
      front,
      color: FRONT_COLORS[i % FRONT_COLORS.length],
      spend: add('spend') * taxFactor,
      impressions: add('impressions'),
      linkClicks: add('link_clicks'),
      lpv: add('landing_page_views'),
      leads: add('leads'),
      ic: add('initiate_checkout'),
      // A mirror front only reads spend: its sales belong to the project it reads.
      sold: sales && !front.sourceName ? (sales.get(front.id) ?? { vendas: 0, receita: 0 }) : null,
    }
  })
  const projectSpend = totals.reduce((total, front) => total + front.spend, 0)
  const pct = (value: number | null) => (value === null ? '—' : `${(value * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)
  const money = (value: number | null) => (value === null ? '—' : currency(value))

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {totals.map((front) => (
          <div key={front.front.id} className="card-shadow flex flex-col gap-1.5 rounded-[18px] border border-[var(--ct-line)] px-6 py-5" style={{ borderTop: `2px solid ${front.color}` }}>
            <div className="flex items-baseline justify-between gap-3">
              <b className="text-[15px] font-semibold">{front.front.name}</b>
              <span className={`${mono} text-[22px]`} style={{ color: front.color }}>
                {pct(ratio(front.spend, projectSpend))}
              </span>
            </div>
            <span className="text-xs text-[var(--ct-text-3)]">
              do investimento{front.front.sourceName ? ` · espelho de ${front.front.sourceName}: só gasto, na janela` : ''}
            </span>
            <div className="mt-3 grid grid-cols-3 gap-x-3.5 gap-y-4 border-t border-[var(--ct-line)] pt-4">
              {[
                ['Investimento', currency(front.spend)],
                ['CPM', money(ratio(front.spend, front.impressions / 1000))],
                ['CTR', pct(ratio(front.linkClicks, front.impressions))],
                ['Connect', pct(ratio(front.lpv, front.linkClicks))],
                ...(front.sold
                  ? [
                      ['Vendas de anúncio', front.sold.vendas.toLocaleString('pt-BR')],
                      ['CPA de anúncio', money(ratio(front.spend, front.sold.vendas))],
                      ['ROAS', front.spend > 0 ? `${(front.sold.receita / front.spend).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x` : '—'],
                    ]
                  : [
                      ['Leads', front.leads.toLocaleString('pt-BR')],
                      ['CPL', money(ratio(front.spend, front.leads))],
                    ]),
              ].map(([label, value]) => (
                <div key={label}>
                  <small className="block text-[11px] text-[var(--ct-text-3)]">{label}</small>
                  <b className={`${mono} text-[14px] font-medium`}>{value}</b>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="card-shadow overflow-x-auto rounded-2xl border border-[var(--ct-line)]">
        <table className="w-full text-[13px]">
          <thead>
            <tr className={`${mono} text-left text-[10.5px] uppercase tracking-[0.06em] text-[var(--ct-text-3)]`}>
              <th className="px-5 py-3 font-medium">Frente</th>
              {['Investimento', 'Impressões', 'CPM', 'Cliques no link', 'CTR', 'View page', 'Connect', 'Initiate checkout', 'Leads', 'CPL', ...(sales ? ['Vendas de anúncio', 'CPA de anúncio', 'ROAS'] : [])].map((head) => (
                <th key={head} className="px-5 py-3 text-right font-medium">{head}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {totals.map((front, index) => (
              <Fragment key={front.front.id}>
              {stageOf && stageOf.get(front.front.id) !== stageOf.get(totals[index - 1]?.front.id ?? '') && (
                <tr className="border-t border-[var(--ct-line)] bg-[var(--ct-surface-2)]">
                  <td colSpan={sales ? 14 : 11} className={`${mono} px-5 py-2 text-[10.5px] uppercase tracking-[0.06em] text-[var(--ct-text-3)]`}>
                    Etapa {stageOf.get(front.front.id) ?? 'sem etapa'}
                  </td>
                </tr>
              )}
              <tr className="border-t border-[var(--ct-line)]">
                <td className="whitespace-nowrap px-5 py-3">
                  <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: front.color }} />
                  {front.front.name}
                </td>
                {[
                  currency(front.spend),
                  front.impressions.toLocaleString('pt-BR'),
                  money(ratio(front.spend, front.impressions / 1000)),
                  front.linkClicks.toLocaleString('pt-BR'),
                  pct(ratio(front.linkClicks, front.impressions)),
                  front.lpv.toLocaleString('pt-BR'),
                  pct(ratio(front.lpv, front.linkClicks)),
                  front.ic.toLocaleString('pt-BR'),
                  front.leads.toLocaleString('pt-BR'),
                  money(ratio(front.spend, front.leads)),
                  ...(sales
                    ? front.sold
                      ? [
                          front.sold.vendas.toLocaleString('pt-BR'),
                          money(ratio(front.spend, front.sold.vendas)),
                          front.spend > 0 ? `${(front.sold.receita / front.spend).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x` : '—',
                        ]
                      : ['só gasto', '—', '—']
                    : []),
                ].map((value, i) => (
                  <td key={i} className={`${mono} whitespace-nowrap px-5 py-3 text-right tabular-nums`}>{value}</td>
                ))}
              </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
        <p className="border-t border-[var(--ct-line)] px-5 py-3 text-[11.5px] text-[var(--ct-text-3)]">
          Investimento com o imposto do cliente. Vendas de anúncio da frente: as que trazem na UTM o id de uma campanha dela (ou de um anúncio dela). Gasto sem dono fica fora das frentes, em Não classificado:{' '}
          <Link href={rulesHref} className="text-[var(--ct-accent)]">ver em Etapas e frentes</Link>.
        </p>
      </div>
    </div>
  )
}
