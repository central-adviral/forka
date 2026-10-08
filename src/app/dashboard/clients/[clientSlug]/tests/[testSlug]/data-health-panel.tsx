import { readDataHealth, type DataHealthRow, type HealthTone } from '@/lib/domain/data-health'

const TONE: Record<HealthTone, string> = {
  ok: 'text-[var(--ct-ok)]',
  warn: 'text-[var(--ct-warn)]',
  crit: 'text-[var(--ct-crit)]',
  info: 'text-[var(--ct-text)]',
}

export function DataHealthPanel({ row }: { row: DataHealthRow }) {
  const items = readDataHealth(row)
  return (
    <div className="mx-6 mb-6">
      <h2 className="mb-1 mt-8 font-[family-name:var(--font-sora)] text-lg font-semibold">Saúde dos dados</h2>
      <p className="mb-4 max-w-[760px] text-[13px] text-[var(--ct-text-2)]">
        Se as vendas chegam ao teste. A venda conta quando o checkout da Hubla leva o código do clique; o LaunchOps confere e completa o que o webhook perdeu.
        Upsell e order bump não levam o código e ficam fora da receita do teste.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="rounded-2xl border border-[var(--ct-line)] bg-[var(--ct-surface)] px-4 py-3.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ct-text-2)]">{item.label}</span>
            <b className={`mt-1 block font-[family-name:var(--font-geist-mono)] text-[22px] ${TONE[item.tone]}`}>{item.value}</b>
            <span className="mt-1 block text-[12px] text-[var(--ct-text-3)]">{item.detail}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
