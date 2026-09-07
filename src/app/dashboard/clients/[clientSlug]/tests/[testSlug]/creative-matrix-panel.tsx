import { buildCreativeMatrix, METRIC_KEYS, type MetricKey } from '@/lib/domain/creative-matrix'
import { scoreCreatives } from '@/lib/domain/creative-score'

interface PanelAdRow {
  variant_id: string
  ad_name: string
  clicks: number
  visitors: number
  conversions: number
  revenue_cents: number
  ad_spend: number | null
}

interface Props {
  adRows: PanelAdRow[]
  variants: { id: string; name: string }[]
  /** "Página" or "Checkout" -- the report calls the split by the test's own noun. */
  assetLabel: string
}

const VISIBLE_BLOCKS = 5

const money = (cents: number) => `R$ ${(cents / 100).toFixed(2)}`

const METRICS: { key: MetricKey; label: string; format: (value: number) => string }[] = [
  { key: 'conversionRate', label: 'Taxa de conversão', format: (v) => `${v.toFixed(1)}%` },
  { key: 'revenueCents', label: 'Faturamento', format: money },
  { key: 'revenuePerClick', label: 'R$ por clique', format: money },
  { key: 'revenuePerVisitor', label: 'R$ por visita única', format: money },
]

const scoreColor = (score: number) =>
  score >= 85 ? '#2DD4A8' : score >= 65 ? '#4F8EF7' : score >= 40 ? '#F5B94D' : '#F76C6C'

export function CreativeMatrixPanel({ adRows, variants, assetLabel }: Props) {
  const variantIds = variants.map((v) => v.id)
  const nameById = new Map(variants.map((v) => [v.id, v.name]))

  const matrix = buildCreativeMatrix(
    adRows.map((row) => ({
      adName: row.ad_name,
      variantId: row.variant_id,
      clicks: row.clicks,
      visitors: row.visitors,
      conversions: row.conversions,
      revenueCents: row.revenue_cents,
    })),
    variantIds
  )
  if (matrix.length === 0) return null

  // The report repeats each ad's total spend on every variant row it appears in, and it arrives
  // in reais while the score works in cents. Summing would bill the ad once per variant.
  const spendCentsByAdName = new Map<string, number>()
  for (const row of adRows) {
    if (row.ad_spend !== null) spendCentsByAdName.set(row.ad_name, Math.round(row.ad_spend * 100))
  }

  const scores = scoreCreatives(
    matrix.map((row) => ({
      adName: row.adName,
      spendCents: spendCentsByAdName.get(row.adName) ?? 0,
      revenueCents: row.totals.revenueCents,
      conversions: adRows
        .filter((r) => r.ad_name === row.adName)
        .reduce((sum, r) => sum + r.conversions, 0),
      visitors: adRows
        .filter((r) => r.ad_name === row.adName)
        .reduce((sum, r) => sum + r.visitors, 0),
    }))
  )
  const scoreByAdName = new Map(scores.map((s) => [s.adName, s]))

  const ordered = [...matrix].sort(
    (a, b) => (scoreByAdName.get(b.adName)?.score ?? -1) - (scoreByAdName.get(a.adName)?.score ?? -1)
  )
  // Every ROAS being null means no creative has spend attached, so 60% of the score's
  // weight silently drops out and the ranking is conversion rate alone. Say so.
  const missingSpend = scores.every((s) => s.roas === null)
  const hidden = ordered.length - VISIBLE_BLOCKS

  return (
    <div className="mb-8 overflow-hidden rounded-2xl border border-white/[0.08]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <h2 className="font-['Space_Grotesk'] text-lg font-semibold">Score de Criativos</h2>
        <span className="rounded-full border border-dashed border-[#F5B94D]/50 bg-[#F5B94D]/[0.08] px-2.5 py-1 font-['JetBrains_Mono'] text-[10px] text-[#F5B94D]">
          Rascunho — critério em definição
        </span>
      </div>
      <p className="max-w-[72ch] px-5 pb-4 pt-2 text-[12px] leading-relaxed text-[#8A90A6]">
        {ordered.length} criativos, ordenados por score.
        {missingSpend ? (
          <span className="text-[#F5B94D]">
            {' '}
            Sem gasto de anúncio vinculado: o score usa só a taxa de conversão.
          </span>
        ) : null}
      </p>

      <div className="flex flex-col gap-3 px-5 pb-5">
        {ordered.slice(0, VISIBLE_BLOCKS).map((row, i) => (
          <CreativeBlock
            key={row.adName}
            row={row}
            rank={i + 1}
            score={scoreByAdName.get(row.adName)}
            variants={variants}
            nameById={nameById}
            assetLabel={assetLabel}
          />
        ))}
      </div>

      {hidden > 0 && (
        <details className="group px-5 pb-5">
          <summary className="flex cursor-pointer list-none items-center justify-center gap-2 rounded-lg border border-white/[0.08] p-3 text-[12px] font-semibold text-[#8A90A6] transition-colors hover:bg-white/[0.03] hover:text-[#E8EAF2]">
            <svg
              className="transition-transform group-open:rotate-180"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="group-open:hidden">Ver os outros {hidden} criativos</span>
            <span className="hidden group-open:inline">Recolher</span>
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            {ordered.slice(VISIBLE_BLOCKS).map((row, i) => (
              <CreativeBlock
                key={row.adName}
                row={row}
                rank={VISIBLE_BLOCKS + i + 1}
                score={scoreByAdName.get(row.adName)}
                variants={variants}
                nameById={nameById}
                assetLabel={assetLabel}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function CreativeBlock({
  row,
  rank,
  score,
  variants,
  nameById,
  assetLabel,
}: {
  row: ReturnType<typeof buildCreativeMatrix>[number]
  rank: number
  score: ReturnType<typeof scoreCreatives>[number] | undefined
  variants: { id: string; name: string }[]
  nameById: Map<string, string>
  assetLabel: string
}) {
  const columns = `minmax(110px, 158px) repeat(${variants.length}, minmax(0, 1fr)) 116px`

  return (
    <div className="overflow-hidden rounded-[14px] border border-white/[0.08] bg-white/[0.02]">
      <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.08] px-4 py-3">
        <span className="shrink-0 font-['JetBrains_Mono'] text-[10.5px] text-[#8A90A6]">#{rank}</span>
        <span className="min-w-[160px] flex-1 truncate text-[13px] font-semibold" title={row.adName}>
          {row.adName}
        </span>
        {score?.hasThinData && (
          <span
            title="Poucos acessos ainda: o score deste criativo puxa para a média do teste até haver volume suficiente para confiar nos números dele."
            className="shrink-0 cursor-help rounded-full bg-white/[0.06] px-2 py-0.5 text-[9.5px] text-[#8A90A6]"
          >
            amostra pequena
          </span>
        )}
        {score?.score !== null && score !== undefined && (
          <span className="flex shrink-0 items-center gap-2">
            <span className="font-['JetBrains_Mono'] text-[9.5px] uppercase tracking-wider text-[#8A90A6]">
              Score
            </span>
            <span className="h-[5px] w-[46px] overflow-hidden rounded-full bg-white/[0.08]">
              <span
                className="block h-full rounded-full"
                style={{ width: `${score.score}%`, backgroundColor: scoreColor(score.score) }}
              />
            </span>
            <span
              className="min-w-[26px] text-right font-['JetBrains_Mono'] text-[14px] font-bold tabular-nums"
              style={{ color: scoreColor(score.score) }}
            >
              {score.score}
            </span>
          </span>
        )}
        <Verdict row={row} nameById={nameById} assetLabel={assetLabel} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: columns }}>
        <HeadCell className="text-left">Métrica</HeadCell>
        {variants.map((v) => (
          <HeadCell key={v.id}>{v.name}</HeadCell>
        ))}
        <HeadCell className="border-l border-white/[0.08] bg-white/[0.015]">Total</HeadCell>

        {METRICS.map((metric, mi) => {
          const last = mi === METRICS.length - 1
          const border = last ? '' : 'border-b border-white/[0.06]'
          return (
            <div key={metric.key} className="contents">
              <div className={`px-4 py-2 text-[11.5px] text-[#8A90A6] ${border}`}>{metric.label}</div>
              {variants.map((v) => {
                const value = row.byVariantId[v.id]?.[metric.key] ?? null
                const isWinner = row.winners[metric.key] === v.id
                return (
                  <div key={v.id} className={`px-4 py-2 ${border}`}>
                    <div
                      className={`rounded-md text-right font-['JetBrains_Mono'] text-[13px] tabular-nums ${
                        isWinner
                          ? 'bg-[#2DD4A8]/10 px-2 font-bold text-[#2DD4A8] shadow-[inset_0_0_0_1px_rgba(45,212,168,0.32)]'
                          : 'text-[#8A90A6]'
                      }`}
                    >
                      {value === null ? '—' : metric.format(value)}
                    </div>
                  </div>
                )
              })}
              <div className={`border-l border-white/[0.08] bg-white/[0.015] px-4 py-2 ${border}`}>
                <div className="text-right font-['JetBrains_Mono'] text-[13px] font-semibold tabular-nums text-[#E8EAF2]">
                  {row.totals[metric.key] === null ? '—' : metric.format(row.totals[metric.key]!)}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function HeadCell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`border-b border-white/[0.08] bg-white/[0.02] px-4 py-2 text-right font-['JetBrains_Mono'] text-[9.5px] uppercase tracking-wider text-[#8A90A6] ${className}`}
    >
      {children}
    </div>
  )
}

// The page that converts best is often not the page that bills most. Naming both beats
// picking one and hiding the disagreement.
function Verdict({
  row,
  nameById,
  assetLabel,
}: {
  row: ReturnType<typeof buildCreativeMatrix>[number]
  nameById: Map<string, string>
  assetLabel: string
}) {
  const revenueWinner = row.winners.revenueCents
  const rateWinner = row.winners.conversionRate
  if (!revenueWinner) {
    return (
      <span className="shrink-0 rounded-full bg-white/[0.06] px-3 py-1 text-[11px] text-[#8A90A6]">
        Sem venda atribuída ainda
      </span>
    )
  }

  const unanimous = METRIC_KEYS.every((key) => row.winners[key] === revenueWinner)
  if (unanimous) {
    return (
      <span className="shrink-0 rounded-full bg-[#2DD4A8]/[0.13] px-3 py-1 text-[11px] font-semibold text-[#2DD4A8]">
        Melhor: {nameById.get(revenueWinner)}
      </span>
    )
  }

  const label =
    rateWinner && rateWinner !== revenueWinner
      ? `${nameById.get(revenueWinner)} fatura mais · ${nameById.get(rateWinner)} converte mais`
      : `${nameById.get(revenueWinner)} fatura mais · outras métricas divergem`

  return (
    <span
      title={`As métricas apontam ${assetLabel.toLowerCase()}s diferentes para este criativo.`}
      className="shrink-0 rounded-full bg-[#F5B94D]/[0.12] px-3 py-1 text-[11px] text-[#F5B94D]"
    >
      {label}
    </span>
  )
}
