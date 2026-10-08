import { buildCreativeMatrix, METRIC_KEYS, THIN_CELL_VISITORS, type MetricKey } from '@/lib/domain/creative-matrix'
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
  score >= 85 ? 'var(--ct-ok)' : score >= 65 ? 'var(--ct-an)' : score >= 40 ? 'var(--ct-warn)' : 'var(--ct-crit)'

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
    <div className="mb-8 overflow-x-auto rounded-2xl border border-[var(--ct-line)]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <h2 className="font-[family-name:var(--font-sora)] text-lg font-semibold">Score de Criativos</h2>
        <span className="rounded-full border border-dashed border-[var(--ct-warn)]/50 bg-[var(--ct-warn)]/[0.08] px-2.5 py-1 font-[family-name:var(--font-geist-mono)] text-[10px] text-[var(--ct-warn)]">
          Rascunho — critério em definição
        </span>
      </div>
      <p className="max-w-[72ch] px-5 pb-4 pt-2 text-[12px] leading-relaxed text-[var(--ct-text-2)]">
        {ordered.length} criativos, ordenados por score.
        {missingSpend ? (
          <span className="text-[var(--ct-warn)]">
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
          <summary className="flex cursor-pointer list-none items-center justify-center gap-2 rounded-lg border border-[var(--ct-line)] p-3 text-[12px] font-semibold text-[var(--ct-text-2)] transition-colors hover:bg-[var(--ct-surface-2)] hover:text-[var(--ct-text)]">
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
    <div className="overflow-hidden rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--ct-line)] px-4 py-3">
        <span className="shrink-0 font-[family-name:var(--font-geist-mono)] text-[10.5px] text-[var(--ct-text-2)]">#{rank}</span>
        <span className="min-w-[160px] flex-1 truncate text-[13px] font-semibold" title={row.adName}>
          {row.adName}
        </span>
        {score?.hasThinData && (
          <span
            title="Poucos acessos ainda: o score deste criativo puxa para a média do teste até haver volume suficiente para confiar nos números dele."
            className="shrink-0 cursor-help rounded-full bg-[var(--ct-surface-2)] px-2 py-0.5 text-[9.5px] text-[var(--ct-text-2)]"
          >
            amostra pequena
          </span>
        )}
        {score?.score !== null && score !== undefined && (
          <span className="flex shrink-0 items-center gap-2">
            <span className="font-[family-name:var(--font-geist-mono)] text-[9.5px] uppercase tracking-wider text-[var(--ct-text-2)]">
              Score
            </span>
            <span className="h-[5px] w-[46px] overflow-hidden rounded-full bg-[var(--ct-surface-2)]">
              <span
                className="block h-full rounded-full"
                style={{ width: `${score.score}%`, backgroundColor: scoreColor(score.score) }}
              />
            </span>
            <span
              className="min-w-[26px] text-right font-[family-name:var(--font-geist-mono)] text-[14px] font-bold tabular-nums"
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
        <HeadCell className="border-l border-[var(--ct-line)] bg-[var(--ct-surface-2)]">Total</HeadCell>

        {METRICS.map((metric, mi) => {
          const last = mi === METRICS.length - 1
          const border = last ? '' : 'border-b border-[var(--ct-line)]'
          return (
            <div key={metric.key} className="contents">
              <div className={`px-4 py-2 text-[11.5px] text-[var(--ct-text-2)] ${border}`}>{metric.label}</div>
              {variants.map((v) => {
                const value = row.byVariantId[v.id]?.[metric.key] ?? null
                const isWinner = row.winners[metric.key] === v.id
                return (
                  <div key={v.id} className={`px-4 py-2 ${border}`}>
                    <div
                      className={`rounded-md text-right font-[family-name:var(--font-geist-mono)] text-[13px] tabular-nums ${
                        isWinner
                          ? 'bg-[var(--ct-ok)]/10 px-2 font-bold text-[var(--ct-ok)] shadow-[inset_0_0_0_1px_rgba(45,212,168,0.32)]'
                          : 'text-[var(--ct-text-2)]'
                      }`}
                    >
                      {value === null ? '—' : metric.format(value)}
                    </div>
                  </div>
                )
              })}
              <div className={`border-l border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-4 py-2 ${border}`}>
                <div className="text-right font-[family-name:var(--font-geist-mono)] text-[13px] font-semibold tabular-nums text-[var(--ct-text)]">
                  {row.totals[metric.key] === null ? '—' : metric.format(row.totals[metric.key]!)}
                </div>
              </div>
            </div>
          )
        })}

        {/* Per cell, the chance of being the best page for this creative, with thin cells
            called out: many small cells make a lucky 5% on 120 people look like a winner. */}
        <div className="border-t border-[var(--ct-line)] px-4 py-2 text-[11.5px] text-[var(--ct-text-2)]">Chance de ser a melhor</div>
        {variants.map((v) => {
          const chance = row.chanceBest[v.id]
          const thin = row.thin[v.id]
          return (
            <div key={v.id} className="border-t border-[var(--ct-line)] px-4 py-2">
              <div
                title={thin ? `Menos de ${THIN_CELL_VISITORS} pessoas deste criativo nesta ${assetLabel.toLowerCase()}: o número ainda é muito sorte.` : undefined}
                className={`rounded-md text-right font-[family-name:var(--font-geist-mono)] text-[13px] tabular-nums ${
                  thin
                    ? 'border border-dashed border-[var(--ct-warn)]/55 px-2 text-[var(--ct-text-3)]'
                    : chance !== null && chance >= 95
                      ? 'bg-[var(--ct-ok)]/10 px-2 font-bold text-[var(--ct-ok)]'
                      : 'text-[var(--ct-text-2)]'
                }`}
              >
                {chance === null ? '—' : `${chance}%`}
                {thin && <span className="block text-[10px] text-[var(--ct-warn)]">amostra pequena</span>}
              </div>
            </div>
          )
        })}
        <div className="border-l border-t border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-4 py-2" />
      </div>
    </div>
  )
}

function HeadCell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`border-b border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-4 py-2 text-right font-[family-name:var(--font-geist-mono)] text-[9.5px] uppercase tracking-wider text-[var(--ct-text-2)] ${className}`}
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
      <span className="shrink-0 rounded-full bg-[var(--ct-surface-2)] px-3 py-1 text-[11px] text-[var(--ct-text-2)]">
        Sem venda atribuída ainda
      </span>
    )
  }

  const unanimous = METRIC_KEYS.every((key) => row.winners[key] === revenueWinner)
  if (unanimous) {
    return (
      <span className="shrink-0 rounded-full bg-[var(--ct-ok)]/[0.13] px-3 py-1 text-[11px] font-semibold text-[var(--ct-ok)]">
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
      className="shrink-0 rounded-full bg-[var(--ct-warn)]/[0.12] px-3 py-1 text-[11px] text-[var(--ct-warn)]"
    >
      {label}
    </span>
  )
}
