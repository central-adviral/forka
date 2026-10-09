import Link from 'next/link'
import { MEASURES, comboValue, stageCost, stageResult, stageRoas, sumTotals, withMirroredLeads, type CostCombo, type Stage, type StageTotals } from '@/lib/domain/funnel-stages'
import { MEASURE_COLOR, metaText, metaTone, passageRate, type Tone } from '@/lib/domain/stage-canvas'
import type { StageDayRow, StageOrigin } from '@/lib/repo/funnel-stages-repo'

const mono = 'font-[family-name:var(--font-geist-mono)]'
const TONE: Record<Tone, string> = { ok: 'text-[var(--ct-ok)]', warn: 'text-[var(--ct-warn)]', crit: 'text-[var(--ct-crit)]' }
const pct = (value: number | null) => (value === null ? '—' : `${(value * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)
const roasText = (value: number | null) => (value === null ? '—' : `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`)

/** Each stage's totals over the period, from get_funnel_stage_daily; a mirror lead stage's leads are its buyers. */
export function stageTotals(rows: StageDayRow[], stages: Pick<Stage, 'id' | 'measure' | 'mirror'>[]): Map<string, StageTotals> {
  const byStage = new Map<string, StageDayRow[]>()
  for (const row of rows) byStage.set(row.stageId, [...(byStage.get(row.stageId) ?? []), row])
  return new Map(
    [...byStage].map(([id, days]) => {
      const stage = stages.find((candidate) => candidate.id === id)
      const totals = sumTotals(days)
      return [id, stage ? withMirroredLeads(stage, totals) : totals]
    })
  )
}

/** "Etapas e frentes" on Desempenho: one card per stage, its own spend and its own cost against its meta. */
export function StagesPanel({
  stages,
  totals,
  origins,
  rulesHref,
  currency,
}: {
  stages: Stage[]
  totals: Map<string, StageTotals>
  origins: StageOrigin[]
  rulesHref: string
  currency: (value: number) => string
}) {
  const open = stages.filter((stage) => !stage.archivedAt)
  if (open.length === 0) return null
  const ordered = [...open.filter((stage) => stage.parallel), ...open.filter((stage) => !stage.parallel)]
  const sequence = open.filter((stage) => !stage.parallel)
  const of = (id: string) => totals.get(id) ?? sumTotals([])
  const entrySales = open.filter((stage) => stage.measure === 'compra').reduce((sum, stage) => sum + of(stage.id).vendas, 0)
  const name = (id: string | null) => (id ? (open.find((stage) => stage.id === id)?.name ?? 'etapa arquivada') : 'sem campanha do funil')

  return (
    <section aria-label="Etapas" className="mb-6 flex flex-col gap-3">
      <p className="text-[12.5px] text-[var(--ct-text-3)]">
        Cada etapa usa só o gasto das campanhas das frentes dela. Para somar etapas, use um custo combinado em{' '}
        <Link href={rulesHref} className="text-[var(--ct-accent)]">
          Etapas e frentes
        </Link>
        .
      </p>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {ordered.map((stage) => {
          const info = MEASURES[stage.measure]
          const own = of(stage.id)
          const cost = stageCost(stage.measure, own, entrySales)
          const tone = metaTone(stage.measure, cost, stage.meta)
          const result = stageResult(stage.measure, own)
          const next = stage.parallel ? undefined : sequence[sequence.indexOf(stage) + 1]
          const passage = next ? passageRate({ measure: stage.measure, totals: own }, { measure: next.measure, totals: of(next.id) }) : null
          const roas = stage.measure === 'compra' ? stageRoas(own) : null
          const roasTone = roas !== null && stage.metaRoas ? (roas >= stage.metaRoas ? 'ok' : roas >= stage.metaRoas * 0.8 ? 'warn' : 'crit') : null
          const cameFrom = stage.measure === 'compra' ? origins.filter((origin) => origin.stageId === stage.id && origin.vendas > 0) : []
          const cells: [string, string, Tone | null][] = [
            ['Gasto', currency(own.spendComImposto), null],
            [
              stage.measure === 'alcance' ? 'Mil impressões' : info.result[0].toUpperCase() + info.result.slice(1),
              result.toLocaleString('pt-BR', { maximumFractionDigits: stage.measure === 'alcance' ? 1 : 0 }),
              null,
            ],
            [info.cost[0].toUpperCase() + info.cost.slice(1), cost === null ? '—' : info.format === 'pct' ? pct(cost) : currency(cost), tone],
            ...(roas !== null || stage.measure === 'compra' ? [['ROAS', roasText(roas), roasTone] as [string, string, Tone | null]] : []),
            ...(next ? [[`Passagem para ${next.name}`, pct(passage), null] as [string, string, Tone | null]] : []),
          ]
          return (
            <div key={stage.id} className="card-shadow flex flex-col gap-1.5 rounded-[18px] border border-[var(--ct-line)] px-6 py-5" style={{ borderTop: `2px solid ${MEASURE_COLOR[stage.measure]}` }}>
              <div className="flex items-baseline justify-between gap-3">
                <b className="text-[15px] font-semibold">{stage.name}</b>
                <span className={`${mono} text-[11.5px] text-[var(--ct-text-3)]`}>{stage.parallel ? 'paralela' : `${sequence.indexOf(stage) + 1}º`}</span>
              </div>
              <span className="text-xs text-[var(--ct-text-3)]">
                {stage.meta === null ? (
                  <span className="text-[var(--ct-warn)]">sem meta</span>
                ) : (
                  `meta ${info.cost} ${info.direction === 'max' ? '≤' : '≥'} ${metaText(stage.measure, stage.meta)}`
                )}
                {stage.measure === 'compra' && stage.metaRoas ? ` · ROAS ≥ ${stage.metaRoas.toLocaleString('pt-BR')}` : ''}
              </span>
              <div className="mt-3 grid gap-x-5 gap-y-4 border-t border-[var(--ct-line)] pt-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,8.5rem),1fr))]">
                {cells.map(([label, value, cellTone]) => (
                  <div key={label} className="min-w-0">
                    <small className="block text-[11px] text-[var(--ct-text-3)]">{label}</small>
                    <b className={`${mono} block text-[14px] font-medium tabular-nums [overflow-wrap:anywhere] ${cellTone ? TONE[cellTone] : ''}`}>{value}</b>
                  </div>
                ))}
              </div>
              {stage.mirror && (
                <p className="mt-2 text-[11.5px] text-[var(--ct-text-3)]">
                  <span className="mr-1.5 rounded-full border border-[var(--ct-line-2)] px-2 py-px text-[10.5px] font-medium text-[var(--ct-text-2)]">espelho</span>
                  {own.vendasEspelho.toLocaleString('pt-BR')} {own.vendasEspelho === 1 ? 'venda' : 'vendas'} de {stage.mirror.funnelName}, sem somar no total do funil
                </p>
              )}
              {cameFrom.length > 0 && (
                <p className="mt-2 text-[11.5px] text-[var(--ct-text-3)]">
                  Vendas vindas de: {cameFrom.map((origin) => `${name(origin.originStageId)} ${origin.vendas.toLocaleString('pt-BR')}`).join(' · ')}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** The combos switched on, as small KPI cards on "Resumo do funil". */
export function ComboCards({
  combos,
  stages,
  totals,
  revenue,
  currency,
}: {
  combos: CostCombo[]
  stages: Stage[]
  totals: Map<string, StageTotals>
  revenue: number
  currency: (value: number) => string
}) {
  const shown = combos.filter((combo) => combo.enabled)
  if (shown.length === 0) return null
  return (
    <div aria-label="Custos combinados" className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {shown.map((combo) => {
        const { kind, value } = comboValue(combo, stages, totals, revenue)
        const tone: Tone | null =
          value === null || !combo.meta ? null : kind === 'roas' ? (value >= combo.meta ? 'ok' : 'crit') : value <= combo.meta ? 'ok' : 'crit'
        return (
          <div key={combo.id} className="flex flex-col gap-1 rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface)] px-5 py-4">
            <span className="text-xs text-[var(--ct-text-3)]">{combo.name}</span>
            <span className={`${mono} text-[20px] font-medium tracking-[-0.03em] ${tone ? TONE[tone] : ''}`}>
              {value === null ? '—' : kind === 'roas' ? roasText(value) : currency(value)}
            </span>
            <span className="text-[11.5px] text-[var(--ct-text-3)]">
              custo combinado{combo.meta ? ` · meta ${kind === 'roas' ? `≥ ${roasText(combo.meta)}` : `≤ ${currency(combo.meta)}`}` : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}
