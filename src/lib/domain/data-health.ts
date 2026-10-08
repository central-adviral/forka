// "Saúde dos dados" of an A/B test (0088): whether the sales reach it, before trusting its result.

export interface DataHealthRow {
  traceable_sales: number
  counted_sales: number
  recovered: number
  refunds: number
  median_delay_seconds: number | null
  clicks: number
  bot_clicks: number
  rate_limited_clicks: number
  buyers: number
  buyers_in_other_tests: number
  client_untracked_payments: number
}

export type HealthTone = 'ok' | 'warn' | 'crit' | 'info'

export interface HealthItem {
  label: string
  value: string
  detail: string
  tone: HealthTone
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0)

function delay(seconds: number): string {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} s`
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`
  return `${Math.round(seconds / 3600)} h`
}

export function readDataHealth(row: DataHealthRow): HealthItem[] {
  const coverage = pct(row.counted_sales, row.traceable_sales)
  const humans = row.clicks - row.bot_clicks
  return [
    row.traceable_sales === 0
      ? { label: 'Vendas chegando ao teste', value: '—', detail: 'Nenhuma venda com o código deste link no LaunchOps ainda.', tone: 'info' }
      : {
          label: 'Vendas chegando ao teste',
          value: `${coverage}%`,
          detail: `${row.counted_sales} de ${row.traceable_sales} vendas com o código deste link estão no teste.`,
          tone: coverage >= 95 ? 'ok' : coverage >= 80 ? 'warn' : 'crit',
        },
    {
      label: 'Recuperadas pelo LaunchOps',
      value: String(row.recovered),
      detail: 'Vendas que o webhook da Hubla não entregou e o sync trouxe pelo número da fatura.',
      tone: 'info',
    },
    {
      label: 'Reembolsos descontados',
      value: String(row.refunds),
      detail: 'Saem do resultado, pelo webhook ou pelo LaunchOps.',
      tone: 'info',
    },
    row.median_delay_seconds === null
      ? { label: 'Atraso do webhook', value: '—', detail: 'Sem venda pelo webhook ainda.', tone: 'info' }
      : {
          label: 'Atraso do webhook',
          value: delay(row.median_delay_seconds),
          detail: 'Mediana entre a compra e o aviso da Hubla.',
          tone: row.median_delay_seconds <= 3600 ? 'ok' : 'warn',
        },
    {
      label: 'Robôs e cliques em excesso',
      value: `${pct(row.bot_clicks, row.clicks)}% · ${pct(row.rate_limited_clicks, humans)}%`,
      detail: 'Robôs ficam fora do resultado. Cliques em excesso do mesmo IP ainda contam.',
      tone: pct(row.rate_limited_clicks, humans) > 5 ? 'warn' : 'ok',
    },
    {
      label: 'Compradores em outro teste',
      value: `${pct(row.buyers_in_other_tests, row.buyers)}%`,
      detail: 'Passaram também por outro link do funil: a venda conta nos dois testes.',
      tone: pct(row.buyers_in_other_tests, row.buyers) > 20 ? 'warn' : 'ok',
    },
    {
      label: 'Vendas da Hubla sem código',
      value: String(row.client_untracked_payments),
      detail: 'Do cliente todo, no período: a página ou o upsell não levou o código ao checkout. Não entram em nenhum teste.',
      tone: 'info',
    },
  ]
}
