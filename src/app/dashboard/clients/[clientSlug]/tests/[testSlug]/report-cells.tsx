// The small pieces every table of the A/B report is built from: header and cell styles, the help
// text of each metric, and the bar, rate, change and bot cells. Kept apart so the page reads as the
// report itself.

// One count for the whole report (0077): visits are people, conversions are buyers, and sales and
// revenue are every purchase of those buyers, upsell included.
export interface ReportRow {
  variant_id: string
  variant_name: string
  weight_pct: number
  visits: number
  conversions: number
  clicks: number
  sales: number
  revenue_cents: number
}

export const TH_CLASS = 'px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--ct-text-2)]'
export const TD_CLASS = 'relative px-4 py-2.5'
export const TR_CLASS = 'border-b border-[var(--ct-line)] last:border-0 even:bg-[var(--ct-surface-2)] hover:bg-[var(--ct-surface-2)]'

export const METRIC_INFO = {
  cliques: 'Total de vezes que o link foi clicado, incluindo cliques repetidos da mesma pessoa.',
  visitas: 'Número de pessoas diferentes que clicaram, contando cada uma só uma vez mesmo se ela clicar várias vezes.',
  vendas: 'Número de vendas confirmadas atribuídas a essa linha.',
  faturamento: 'Soma do valor de todas as vendas confirmadas dessa linha.',
  rsPorClique: 'Faturamento dividido pelo número de cliques — quanto cada clique rendeu em média.',
  rsPorAcesso: 'Faturamento dividido pelo número de visitas únicas — quanto cada visitante rendeu em média.',
  pessoas: 'Pessoas diferentes que entraram no teste, cada uma contada uma vez, na primeira variante que recebeu.',
  compradores: 'Pessoas que compraram depois de entrar. É o número que decide o teste: a taxa e a chance usam ele.',
  vendasTeste: 'Todas as compras dessas pessoas, incluindo upsell e segunda compra. Por isso pode ser maior que compradores.',
  faturamentoTeste: 'Soma do valor dessas vendas.',
  rsPorPessoa: 'Faturamento dividido pelas pessoas — quanto cada pessoa que entrou rendeu em média. Decide teste de preço e oferta.',
  taxaClique: 'Porcentagem de cliques desta linha que viraram venda. É um recorte por clique: quem decide o teste é a taxa de compradores do resultado.',
  taxa: 'Porcentagem de pessoas que compraram: cada pessoa conta uma vez, mesmo com upsell. Por isso pode diferir da coluna de vendas, que conta cada venda.',
  gasto: 'Total investido em mídia paga nesse anúncio, vindo do Meta Ads.',
  cpm: 'Custo por mil impressões do anúncio no Meta Ads.',
  ctr: 'Porcentagem de impressões do anúncio que viraram clique no link, direto no Meta Ads.',
}

export function InfoTooltip({ text }: { text: string }) {
  return (
    <span tabIndex={0} aria-label={text} className="group relative ml-1 inline-flex cursor-help align-middle outline-none">
      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-[var(--ct-line-2)] text-[9px] font-bold normal-case text-[var(--ct-text-2)]">
        !
      </span>
      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 w-48 -translate-x-1/2 rounded-md border border-[var(--ct-line)] bg-[var(--ct-surface-2)] p-2 text-[11px] font-normal normal-case leading-snug tracking-normal text-[var(--ct-text)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus:opacity-100">
        {text}
      </span>
    </span>
  )
}

export function ThWithInfo({ label, info }: { label: string; info: string }) {
  return (
    <th className={TH_CLASS}>
      <span className="inline-flex items-center">
        {label}
        <InfoTooltip text={info} />
      </span>
    </th>
  )
}

export function BarCell({
  value,
  max,
  format,
  children,
}: {
  value: number
  max: number
  format: string
  children?: React.ReactNode
}) {
  const pct = max > 0 ? Math.max(value > 0 ? 6 : 0, (value / max) * 100) : 0
  return (
    <td className={TD_CLASS}>
      <div className="absolute inset-y-1.5 left-0 rounded-r bg-[var(--ct-accent)]/[0.14]" style={{ width: `${pct}%` }} />
      <span className="relative">{format}</span>
      {children && <div className="relative mt-0.5">{children}</div>}
    </td>
  )
}

export function RateCell({ rate, children }: { rate: string; children?: React.ReactNode }) {
  return (
    <td className={`${TD_CLASS} ${Number(rate) > 0 ? 'text-[var(--ct-ok)]' : 'text-[var(--ct-text-2)]'}`}>
      {rate}%
      {children && <div className="mt-0.5">{children}</div>}
    </td>
  )
}

// Counts and money read as a percentage; a rate reads in percentage points, because a rate that
// moves from 2,1% to 3,4% rose 1,3 p.p., not 62%.
export function Delta({ current, previous, unit }: { current: number; previous: number | null; unit: 'pct' | 'pp' }) {
  if (previous === null) return <span className="text-[11px] text-[var(--ct-text-3)]">—</span>
  const diff = unit === 'pp' ? current - previous : previous === 0 ? null : ((current - previous) / previous) * 100
  if (diff === null) {
    return <span className="text-[11px] text-[var(--ct-text-3)]">novo</span>
  }
  const rounded = unit === 'pp' ? diff.toFixed(1) : Math.round(diff).toString()
  const sign = diff > 0 ? '+' : ''
  const tone = diff > 0 ? 'text-[var(--ct-ok)]' : diff < 0 ? 'text-[var(--ct-crit)]' : 'text-[var(--ct-text-3)]'
  return (
    <span className={`font-[family-name:var(--font-geist-mono)] text-[11px] ${tone}`}>
      {sign}
      {rounded}
      {unit === 'pp' ? ' p.p.' : '%'}
    </span>
  )
}

export function BotTag({ clicks, botClicks }: { clicks: number; botClicks: number }) {
  if (botClicks === 0) return null
  const pct = Math.round((botClicks / (clicks + botClicks)) * 100)
  return (
    <span
      title="Cliques adicionais identificados como bot/crawler (ex.: pré-visualização de link da Meta) — não contam em visitas, vendas ou faturamento."
      className="ml-2 inline-flex cursor-help items-center rounded-full bg-[var(--ct-surface-2)] px-1.5 py-0.5 text-[10px] font-medium normal-case text-[var(--ct-text-2)]"
    >
      {pct}% bot
    </span>
  )
}
