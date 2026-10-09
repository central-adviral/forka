import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getDailyFunnel } from '@/lib/repo/funnel-repo'
import { saoPauloDay } from '@/lib/repo/today-repo'
import { canActAs } from '@/lib/view-as'
import { getCostCombos, getFunnelStages } from '@/lib/repo/funnel-stages-repo'
import { getWatchers, type Watcher } from '@/lib/repo/watchers-repo'
import { PROJECT_RESULTS, readResult, resultUsesSales, suggestedCost, suggestedVolume, type ProjectResult } from '@/lib/domain/project-plan'
import { MEASURES, funnelResultStage, measureOfMetric, type StageMeasure } from '@/lib/domain/funnel-stages'
import { funnelResultLine, metaToInput } from '@/lib/domain/stage-canvas'
import { METRICS, decimalInput, formatMetric, thresholds, watcherScope, watcherSource, type WatcherMetric } from '@/lib/domain/watchers'
import {
  followersLine,
  frontPrincipalMeta,
  resultStage,
  sourceLabel,
  stageFollowers,
  watcherCostMeasure,
  watcherReader,
  type FrontMetas,
  type MetaReader,
  type TetoSource,
} from '@/lib/domain/targets'
import { WatcherStatusPill } from '@/components/watcher-status'
import { ConfirmDeleteButton } from '@/components/confirm-delete-button'
import { PageHeader } from '@/components/page-header'
import { headerAction } from '@/components/header-actions'
import { ArchivedProjectBanner } from '../../archived-project-banner'
import { saveBand, saveComboMeta, saveResult } from './actions'
import { FunnelHeader } from '../funnel-header'
import { createWatcher, deleteWatcher, evaluateNow, toggleWatcher, updateWatcher } from './watcher-actions'
import { ScopeMetricFields } from './scope-metric-fields'

const LOOKBACK_DAYS = 30
const mono = 'font-[family-name:var(--font-geist-mono)]'
const field =
  'rounded-[10px] border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] px-3 py-2 text-[13px] text-[var(--ct-text)] outline-none focus:border-[var(--ct-accent)] disabled:opacity-60'
const card = 'card-shadow flex flex-col gap-4 rounded-[18px] border border-[var(--ct-line)] px-6 py-5'
const primary = 'self-start rounded-full bg-[var(--ct-accent)] px-4 py-2 text-[13px] font-semibold text-[var(--ct-on-accent)]'
const small = 'rounded-full border border-[var(--ct-line-2)] px-3 py-1 text-[12px] font-semibold text-[var(--ct-text-2)] hover:text-[var(--ct-text)]'
const currency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const formGrid = 'grid gap-4 md:grid-cols-3 xl:grid-cols-7'

function stageMetaText(measure: StageMeasure, value: number | null): string {
  if (value === null) return 'sem meta'
  return MEASURES[measure].format === 'pct' ? `${metaToInput(measure, value)}%` : currency(value)
}

function Pill({ source, text }: { source: 'especifica' | 'segue' | 'sem'; text: string }) {
  const tone =
    source === 'especifica'
      ? 'bg-[var(--ct-accent-soft)] text-[var(--ct-accent)]'
      : source === 'segue'
        ? 'bg-[var(--ct-ok-soft)] text-[var(--ct-ok)]'
        : 'bg-[var(--ct-surface-3)] text-[var(--ct-text-3)]'
  return <span className={`rounded-full px-2 py-0.5 text-[11px] ${tone}`}>{text}</span>
}

// Target, band and minimum spend of a watcher: each with "segue" or its own value.
function NumberFields({ watcher, managed = false }: { watcher?: Watcher; managed?: boolean }) {
  const ownTarget = watcher ? watcher.ownTarget !== null : true
  return (
    <>
      {!managed && (
        <fieldset className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)] xl:col-span-2">
          <legend className="mb-1.5">Meta</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="target_mode" value="segue" defaultChecked={!ownTarget} />
            segue a etapa ou a frente
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="target_mode" value="especifica" defaultChecked={ownTarget} />
            específica
            <input name="target" inputMode="decimal" placeholder="55,00 ou 75" defaultValue={watcher?.ownTarget !== null && watcher?.ownTarget !== undefined ? decimalInput(watcher.ownTarget) : ''} className={`${field} ${mono} w-28 py-1`} aria-label="Meta específica" />
          </label>
        </fieldset>
      )}
      {managed && <input type="hidden" name="target_mode" value="segue" />}
      <fieldset className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)] xl:col-span-2">
        <legend className="mb-1.5">Atenção / crítico (%)</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="band_mode" value="segue" defaultChecked={!watcher?.ownBand} />
          segue a faixa padrão do funil
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="band_mode" value="propria" defaultChecked={Boolean(watcher?.ownBand)} />
          própria
          <input name="warn_pct" inputMode="decimal" placeholder="20" defaultValue={watcher?.ownBand ? decimalInput(watcher.warnPct) : ''} className={`${field} ${mono} w-16 py-1`} aria-label="Atenção a partir de, em %" />
          <input name="crit_pct" inputMode="decimal" placeholder="40" defaultValue={watcher?.ownBand ? decimalInput(watcher.critPct) : ''} className={`${field} ${mono} w-16 py-1`} aria-label="Crítico a partir de, em %" />
        </label>
      </fieldset>
      <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
        Gasto mínimo no dia
        <input name="min_spend" inputMode="decimal" placeholder="300" defaultValue={watcher ? decimalInput(watcher.minSpend) : ''} className={`${field} ${mono}`} />
      </label>
    </>
  )
}

export default async function FunnelMetasPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string; funnelSlug: string }>
  searchParams: Promise<{ ok?: string; erro?: string; editar?: string }>
}) {
  const { clientSlug, funnelSlug } = await params
  const { ok, erro, editar } = await searchParams
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()
  // Configuration is internal to the agency: the client never reads it, even by typing the address.
  if (!(await canActAs(supabase, client.id, 'analista'))) notFound()
  const { data: funnel } = await supabase
    .from('sales_funnels')
    .select('id, name, slug, resultado, daily_sales_target, metrica_secundaria, archived_at, warn_pct, crit_pct')
    .eq('client_id', client.id)
    .eq('slug', funnelSlug)
    .maybeSingle()
  if (!funnel) notFound()

  // The last closed days, today left out: a partial day would drag every median down.
  const since = saoPauloDay(-LOOKBACK_DAYS)
  const until = saoPauloDay(0)
  const [days, frontDaily, canEditClient, stageRows, combos, watchers, { data: frontRows, error: frontsError }, { data: testRows, error: testsError }] = await Promise.all([
    getDailyFunnel(supabase, funnel.id, since, until),
    supabase.rpc('get_project_front_daily', { p_sales_funnel_id: funnel.id, p_since: since, p_until: until }),
    canActAs(supabase, client.id, 'gestor'),
    getFunnelStages(supabase, funnel.id),
    getCostCombos(supabase, funnel.id),
    getWatchers(supabase, client.id, funnel.id),
    supabase
      .from('project_fronts')
      .select('id, code, name, stage_id, metrica_principal, alvo_principal, metrica_secundaria, alvo_secundaria, archived_at')
      .eq('sales_funnel_id', funnel.id)
      .order('position'),
    supabase.from('backlog_items').select('funnel_stage_id, status, effective_teto_source').eq('sales_funnel_id', funnel.id).neq('status', 'decided'),
  ])
  if (frontDaily.error) throw frontDaily.error
  if (frontsError) throw frontsError
  if (testsError) throw testsError
  const canEdit = canEditClient && !funnel.archived_at
  const context = { client_id: client.id as string, client_slug: client.slug as string, funnel_slug: funnel.slug as string, sales_funnel_id: funnel.id as string }
  const base = `/dashboard/clients/${client.slug}/funis-venda/${funnel.slug}`
  const resultado = readResult(funnel.resultado)
  const band = { warnPct: Number(funnel.warn_pct), critPct: Number(funnel.crit_pct) }

  // 1. Resultado: what the result looked like in the last closed days, for the suggestions.
  const leadsByDay = new Map<string, number>()
  for (const row of (frontDaily.data ?? []) as { data: string; leads: number }[]) leadsByDay.set(row.data, (leadsByDay.get(row.data) ?? 0) + Number(row.leads ?? 0))
  const series: Record<ProjectResult, { spend: number; results: number }[]> = {
    compra: days.map((day) => ({ spend: day.spendComImposto, results: day.vendas })),
    lead: days.map((day) => ({ spend: day.spendComImposto, results: leadsByDay.get(day.data) ?? 0 })),
    roas: days.map((day) => ({ spend: day.spendComImposto, results: day.receitaLiquida })),
    checkout: days.map((day) => ({ spend: day.spendComImposto, results: day.initiateCheckout })),
    visita: days.map((day) => ({ spend: day.spendComImposto, results: day.landingPageViews })),
    alcance: days.map((day) => ({ spend: day.spendComImposto, results: day.impressions / 1000 })),
  }
  // The suggestions under the result's inputs, from the last closed days.
  const current = {
    suggestedCost: suggestedCost(series[resultado], PROJECT_RESULTS[resultado].higherIsBetter),
    suggestedVolume: suggestedVolume(resultado === 'roas' ? series.compra : series[resultado]),
  }

  const stages = stageRows.filter((stage) => !stage.archivedAt)
  const resultStageRow = funnelResultStage(stages)
  const resultLine = funnelResultLine(stages, resultado)
  const stageName = new Map(stageRows.map((stage) => [stage.id, stage.name]))
  const fronts = ((frontRows ?? []) as { id: string; code: string; name: string; stage_id: string; metrica_principal: ProjectResult | null; alvo_principal: number | null; metrica_secundaria: ProjectResult | null; alvo_secundaria: number | null; archived_at: string | null }[]).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    archived: Boolean(row.archived_at),
    stageId: row.stage_id,
    metricaPrincipal: row.metrica_principal,
    alvoPrincipal: row.alvo_principal === null ? null : Number(row.alvo_principal),
    metricaSecundaria: row.metrica_secundaria,
    alvoSecundaria: row.alvo_secundaria === null ? null : Number(row.alvo_secundaria),
  }))
  const frontMap = new Map<string, FrontMetas>(fronts.map((front) => [front.id, front]))
  const planWatcher = (role: 'principal' | 'secundaria') => watchers.find((watcher) => watcher.planRole === role && !watcher.frontId)
  const resultMeta = (result: ProjectResult | null, role: 'principal' | 'secundaria') => {
    if (!result) return null
    const metric = PROJECT_RESULTS[result].costMetric
    const stage = resultStage(stages, watcherCostMeasure(metric))
    const watcher = planWatcher(role)
    const stageValue = stage ? (metric === 'roas' ? stage.metaRoas : stage.meta) : null
    return { metric, stage, watcher, value: stage ? stageValue : (watcher?.ownTarget ?? null), specificDiffers: Boolean(stage && watcher?.ownTarget !== null && watcher?.ownTarget !== undefined && watcher.ownTarget !== stageValue) }
  }
  const principal = resultMeta(resultado, 'principal')!
  const secondary = resultMeta(funnel.metrica_secundaria ? readResult(funnel.metrica_secundaria) : null, 'secundaria')

  // 2. Who reads each stage meta, for the impact line before a change.
  const readers: MetaReader[] = [
    ...fronts.filter((front) => !front.archived).map((front) => ({ stageId: front.stageId, follows: !(front.metricaPrincipal && front.alvoPrincipal !== null) })),
    ...watchers.flatMap((watcher) => {
      const reader = watcherReader({ metric: watcher.metric, target: watcher.ownTarget, frontId: watcher.frontId, stageId: watcher.stageId }, stageRows, frontMap)
      return reader ? [reader] : []
    }),
    ...((testRows ?? []) as { funnel_stage_id: string | null; status: string; effective_teto_source: TetoSource | null }[]).map((test) => ({
      stageId: test.funnel_stage_id ?? resultStage(stageRows, measureOfMetric(resultado))?.id ?? null,
      follows: test.effective_teto_source === 'etapa',
    })),
  ]

  // 5. Vigias: the result and front ones keep their metric and meta where they are set.
  const visibleWatchers = watchers.filter((watcher) => !watcher.archived)
  const archivedWatchers = watchers.filter((watcher) => watcher.archived)
  const scopes = [
    { value: 'funil', label: 'o funil inteiro' },
    ...stages.map((stage) => ({ value: `etapa:${stage.id}`, label: `etapa ${stage.name}` })),
    ...fronts.filter((front) => !front.archived).map((front) => ({ value: `frente:${front.id}`, label: `frente ${front.name} (${stageName.get(front.stageId) ?? ''})` })),
  ]
  const metricOptions = (Object.keys(METRICS) as WatcherMetric[]).map((metric) => ({ value: metric, label: METRICS[metric].label, projectOnly: METRICS[metric].projectOnly, salesOnly: METRICS[metric].salesOnly }))
  const scopeOf = (watcher: Watcher) => (watcher.frontId ? `frente:${watcher.frontId}` : watcher.stageId ? `etapa:${watcher.stageId}` : 'funil')
  const targetPill = (watcher: Watcher) => {
    if (watcher.targetSource === 'especifica') return <Pill source="especifica" text="específica" />
    if (watcher.targetSource) return <Pill source="segue" text={sourceLabel(watcher.targetSource, watcher.targetStageId ? stageName.get(watcher.targetStageId) : undefined)} />
    return <Pill source="sem" text="sem meta" />
  }
  const metasHref = `${base}/metas`

  return (
    <div className="flex max-w-[1240px] flex-col gap-8 px-4 md:px-14 pb-24 pt-12">
      <PageHeader
        title="Metas e vigias"
        note={
          <>
            As metas de {funnel.name} valem de cima para baixo: o funil, cada etapa, cada frente, os vigias e os testes. A meta de cada etapa fica no{' '}
            <Link href={`${base}/regras`} className="text-[var(--ct-accent)]">canvas de Etapas e frentes</Link>; aqui ficam a faixa, os vigias extras e os custos combinados.
          </>
        }
        actions={
          canEdit && (
            <form action={evaluateNow.bind(null, context)}>
              <button type="submit" className={headerAction}>
                Avaliar agora
              </button>
            </form>
          )
        }
      />

      {funnel.archived_at && <ArchivedProjectBanner salesFunnelId={funnel.id} archivedAt={funnel.archived_at} canRestore={canEditClient} note="As metas ficam só para leitura." />}
      <FunnelHeader client={client} salesFunnelId={funnel.id} canEdit={canEdit} regrasHref={`${base}/regras`} />
      {ok && <p role="status" className="rounded-[10px] bg-[var(--ct-ok-soft)] px-4 py-3 text-[13px] text-[var(--ct-ok)]">{ok}</p>}
      {erro && <p role="alert" className="rounded-[10px] bg-[var(--ct-crit-soft)] px-4 py-3 text-[13px] text-[var(--ct-crit)]">{erro}</p>}
      {!canEditClient && <p className="text-[12.5px] text-[var(--ct-text-3)]">Só gestor ou owner muda as metas; aqui você vê o que vale.</p>}

      <form action={saveResult.bind(null, context)}>
        <fieldset disabled={!canEdit} className={card}>
          <legend className="sr-only">Resultado do funil</legend>
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-[16px] font-semibold">1 · Resultado do funil</h2>
            <span className="text-[12px] text-[var(--ct-text-3)]">Automático: a última etapa da sequência, fora a ascensão.</span>
          </div>
          {resultLine && resultStageRow ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px]">
              <b className="font-semibold">{resultLine.cost}</b>
              {resultLine.meta ? <span className={mono}>{resultLine.meta}</span> : <span className="text-[var(--ct-warn)]">sem meta</span>}
              <span className="text-[var(--ct-text-3)]">· etapa {resultLine.stageName}</span>
              <Link href={`${base}/regras?etapa=${resultStageRow.id}`} className="text-[13px] font-medium text-[var(--ct-accent)] hover:underline">
                Editar no canvas
              </Link>
            </p>
          ) : (
            <p className="text-[13px] text-[var(--ct-warn)]">
              Nenhuma etapa na sequência ainda. Monte a jornada em <Link href={`${base}/regras`} className="text-[var(--ct-accent)]">Etapas e frentes</Link>.
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {resultStageRow?.measure === 'compra' && (
              <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
                Na etapa de compra, julgar por
                <select name="julgar" defaultValue={resultado} className={field}>
                  {(['compra', 'roas', 'checkout'] as const).map((option) => (
                    <option key={option} value={option}>
                      {PROJECT_RESULTS[option].cost}
                    </option>
                  ))}
                </select>
                <span className="text-[11px]">CPA e ROAS usam a meta da etapa. Custo por checkout tem meta própria, no vigia do resultado.</span>
              </label>
            )}
            {resultado === 'checkout' && (
              <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
                Meta do resultado · custo por checkout
                <input
                  name="cost_target"
                  inputMode="decimal"
                  defaultValue={principal.value !== null ? decimalInput(principal.value) : ''}
                  placeholder={current.suggestedCost !== null ? `sugestão ${current.suggestedCost.toFixed(2).replace('.', ',')}` : 'você define'}
                  className={`${field} ${mono}`}
                />
              </label>
            )}
            <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
              Volume por dia ({PROJECT_RESULTS[resultado].perDay})
              <input name="daily_target" inputMode="numeric" defaultValue={funnel.daily_sales_target ?? ''} placeholder={current.suggestedVolume !== null ? `sugestão ${current.suggestedVolume}` : 'ex.: 80'} className={`${field} ${mono}`} />
              <span className="text-[11px]">A aba Hoje projeta o dia contra este número.</span>
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
              Gasto mínimo no dia para julgar o resultado
              <input name="min_spend" inputMode="decimal" defaultValue={principal.watcher ? decimalInput(principal.watcher.minSpend) : ''} placeholder="300" className={`${field} ${mono}`} />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
              Métrica secundária
              <select name="metrica_secundaria" defaultValue={funnel.metrica_secundaria ?? ''} className={field}>
                <option value="">nenhuma</option>
                {(Object.keys(PROJECT_RESULTS) as ProjectResult[]).map((option) => (
                  <option key={option} value={option} disabled={option === resultado}>
                    {PROJECT_RESULTS[option].cost}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
              Meta da secundária
              <input name="secondary_target" inputMode="decimal" defaultValue={secondary?.value != null ? decimalInput(secondary.value) : ''} placeholder="ex.: 4,00" className={`${field} ${mono}`} />
              <span className="text-[11px]">{secondary?.stage ? `É a meta da etapa ${secondary.stage.name} nesse custo.` : 'Vira um segundo vigia do funil. Em branco, sem vigia.'}</span>
            </label>
          </div>
          {canEdit && (
            <button type="submit" className={primary}>
              Salvar resultado
            </button>
          )}
        </fieldset>
      </form>

      <section className={card} aria-labelledby="metas-etapas">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 id="metas-etapas" className="text-[16px] font-semibold">2 · Metas por etapa</h2>
          <span className="text-[12px] text-[var(--ct-text-3)]">Editadas no canvas. Frentes, vigias e testes seguem a etapa, a não ser que tenham meta específica.</span>
        </div>
        {stages.length === 0 && <p className="text-[13px] text-[var(--ct-text-2)]">Nenhuma etapa ainda. Monte a jornada em <Link href={`${base}/regras`} className="text-[var(--ct-accent)]">Etapas e frentes</Link>.</p>}
        <ul className="flex flex-col gap-2.5">
          {stages.map((stage) => {
            const info = MEASURES[stage.measure]
            const stageFronts = fronts.filter((front) => front.stageId === stage.id && !front.archived)
            const hasMeta = stage.meta !== null || (stage.measure === 'compra' && stage.metaRoas !== null)
            return (
              <li key={stage.id} className="flex flex-col gap-2 rounded-[14px] border border-[var(--ct-line)] px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <b className="text-[14px]">{stage.name}</b>
                  <span className={`${mono} text-[13px] ${hasMeta ? '' : 'text-[var(--ct-warn)]'}`}>
                    {info.cost} {stage.meta === null ? (stage.measure === 'compra' && stage.metaRoas !== null ? '' : 'sem meta') : `${info.direction === 'max' ? '≤' : '≥'} ${stageMetaText(stage.measure, stage.meta)}`}
                    {stage.measure === 'compra' && stage.metaRoas !== null ? ` · ROAS ≥ ${decimalInput(stage.metaRoas)}x` : ''}
                  </span>
                  {resultStageRow?.id === stage.id && <Pill source="segue" text="resultado do funil" />}
                  {stage.parallel && <Pill source="sem" text="paralela" />}
                  <Link href={`${base}/regras?etapa=${stage.id}`} className={`ml-auto ${small}`}>
                    Editar no canvas
                  </Link>
                </div>
                <p className="text-[12px] text-[var(--ct-text-3)]">{followersLine(stageFollowers(stage.id, readers))}</p>
                {stageFronts.length > 0 && (
                  <ul className="flex flex-col gap-1 border-t border-[var(--ct-line)] pt-2">
                    {stageFronts.map((front) => {
                      const meta = frontPrincipalMeta(front, stage)
                      return (
                        <li key={front.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                          <span className={`${mono} rounded-full bg-[var(--ct-surface-3)] px-2 py-0.5 text-[11px]`}>{front.code}</span>
                          <span className="min-w-[120px]">{front.name}</span>
                          <Pill source={meta.source === 'especifica' ? 'especifica' : 'segue'} text={meta.source === 'especifica' ? 'específica' : 'segue a etapa'} />
                          <span className={mono}>
                            {meta.source === 'especifica' && front.metricaPrincipal && front.metricaPrincipal !== stage.measure ? `${PROJECT_RESULTS[front.metricaPrincipal].cost} ` : ''}
                            {meta.source === 'especifica' && front.metricaPrincipal === 'roas' && meta.value !== null ? `${decimalInput(meta.value)}x` : stageMetaText(stage.measure, meta.value)}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <form action={saveBand.bind(null, context)}>
        <fieldset disabled={!canEdit} className={card}>
          <legend className="sr-only">Faixa padrão</legend>
          <h2 className="text-[16px] font-semibold">3 · Faixa padrão do funil</h2>
          <p className="text-[12.5px] text-[var(--ct-text-3)]">
            Quanto um número pode passar da meta antes de virar atenção e crítico. Vale em todo vigia do funil que não tem faixa própria.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-[var(--ct-text-3)]">
              Atenção a partir de (%)
              <input name="warn_pct" inputMode="decimal" defaultValue={decimalInput(band.warnPct)} className={`${field} ${mono} w-28`} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--ct-text-3)]">
              Crítico a partir de (%)
              <input name="crit_pct" inputMode="decimal" defaultValue={decimalInput(band.critPct)} className={`${field} ${mono} w-28`} />
            </label>
            {canEdit && (
              <button type="submit" className={small}>
                Salvar faixa
              </button>
            )}
          </div>
          <p className="text-[12px] text-[var(--ct-text-3)]">
            {visibleWatchers.filter((watcher) => !watcher.ownBand).length} vigias seguem a faixa padrão; {visibleWatchers.filter((watcher) => watcher.ownBand).length} têm faixa própria.
          </p>
        </fieldset>
      </form>

      <section className={card} aria-labelledby="metas-combos">
        <h2 id="metas-combos" className="text-[16px] font-semibold">4 · Custos combinados</h2>
        <p className="text-[12.5px] text-[var(--ct-text-3)]">
          O gasto de várias etapas sobre a receita ou sobre o resultado de uma etapa. Monte e mude as etapas somadas em{' '}
          <Link href={`${base}/regras`} className="text-[var(--ct-accent)]">Etapas e frentes</Link>; a meta, aqui ou lá.
        </p>
        {combos.length === 0 && <p className="text-[13px] text-[var(--ct-text-2)]">Nenhum custo combinado.</p>}
        {combos.map((combo) => (
          <form key={combo.id} action={saveComboMeta.bind(null, { ...context, combo_id: combo.id })} className="flex flex-wrap items-end gap-3 border-t border-[var(--ct-line)] pt-3 first-of-type:border-t-0 first-of-type:pt-0">
            <div className="mr-auto min-w-[200px] text-[13px]">
              <b>{combo.name}</b>
              <span className="block text-[12px] text-[var(--ct-text-3)]">
                gasto de {combo.stageIds.map((id) => stageName.get(id) ?? '?').join(' + ')} ÷ {combo.over === 'receita' ? 'receita (ROAS)' : `resultado de ${stageName.get(combo.overStageId ?? '') ?? '?'}`}
                {combo.enabled ? '' : ' · desligado'}
              </span>
            </div>
            <label className="flex flex-col gap-1 text-xs text-[var(--ct-text-3)]">
              Meta {combo.over === 'receita' ? '· ROAS ≥' : '· custo ≤'}
              <input name="meta" inputMode="decimal" disabled={!canEdit} defaultValue={combo.meta !== null ? decimalInput(combo.meta) : ''} className={`${field} ${mono} w-28`} />
            </label>
            {canEdit && (
              <button type="submit" className={small}>
                Salvar meta
              </button>
            )}
          </form>
        ))}
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="metas-vigias">
        <div>
          <h2 id="metas-vigias" className="text-[16px] font-semibold">5 · Vigias</h2>
          <p className="mt-1 text-[12.5px] text-[var(--ct-text-3)]">
            Cada vigia olha uma métrica no funil, numa etapa ou numa frente, todo último dia fechado, e abre um alerta em{' '}
            <Link href={`/dashboard/clients/${client.slug}/painel#vigias`} className="text-[var(--ct-accent)]">Alertas</Link> quando sai da faixa. O do resultado e os das
            frentes têm a meta no canvas.
          </p>
        </div>
        <div className="card-shadow overflow-x-auto rounded-[18px] border border-[var(--ct-line)]">
          <table className="w-full text-[13px]">
            <thead>
              <tr className={`${mono} text-left text-[10.5px] uppercase tracking-[0.06em] text-[var(--ct-text-3)]`}>
                {['Métrica', 'Olha', 'Meta', 'Faixa', 'Gasto mínimo', 'Último dia fechado', ''].map((head, i) => (
                  <th key={head + i} className={`px-5 py-3 font-medium ${i >= 2 && i <= 5 ? 'text-right' : ''}`}>{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleWatchers.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-5 text-[var(--ct-text-2)]">Nenhum vigia ainda. Crie o primeiro abaixo, por exemplo o CPM da etapa de captação.</td>
                </tr>
              )}
              {visibleWatchers.map((watcher) => {
                const source = watcherSource(watcher)
                const managed = source !== 'livre'
                const limits = watcher.target === null ? null : thresholds(watcher.metric, watcher.target, watcher.warnPct, watcher.critPct)
                if (canEdit && editar === watcher.id) {
                  return (
                    <tr key={watcher.id} className="border-t border-[var(--ct-line)] bg-[var(--ct-surface-2)]">
                      <td colSpan={7} className="px-5 py-4">
                        <form action={updateWatcher.bind(null, { ...context, watcher_id: watcher.id })} aria-label={`Editar vigia de ${METRICS[watcher.metric].label}`} className={formGrid}>
                          {managed ? (
                            <p className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)] md:col-span-3 xl:col-span-2">
                              Métrica
                              <span className="text-[13px] text-[var(--ct-text)]">
                                {METRICS[watcher.metric].label} · {watcherScope(watcher)}
                              </span>
                              <span className="text-[11px]">{source === 'plano' ? 'A meta é a da etapa do resultado, no canvas.' : 'A meta é a da frente, no canvas.'}</span>
                            </p>
                          ) : (
                            <ScopeMetricFields fieldClass={field} scopes={scopes} metrics={metricOptions} sales={resultUsesSales(funnel.resultado)} initial={{ scope: scopeOf(watcher), metric: watcher.metric }} />
                          )}
                          <NumberFields watcher={watcher} managed={managed} />
                          <div className="flex items-center justify-end gap-4 md:col-span-3 xl:col-span-7">
                            <p className="mr-auto max-w-[70ch] text-xs text-[var(--ct-text-3)]">Ao salvar, o vigia é julgado de novo no último dia fechado; um alerta que deixou de valer fecha.</p>
                            <Link href={metasHref} className="text-xs text-[var(--ct-text-2)] hover:text-[var(--ct-text)]">
                              cancelar
                            </Link>
                            <button type="submit" className={primary}>
                              Salvar vigia
                            </button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )
                }
                return (
                  <tr key={watcher.id} className={`border-t border-[var(--ct-line)] ${watcher.isActive ? '' : 'opacity-50'}`}>
                    <td className="px-5 py-3">
                      <b className="font-semibold">{METRICS[watcher.metric].label}</b>
                      <span className="block text-[11.5px] text-[var(--ct-text-3)]">{source === 'plano' ? 'vigia do resultado' : source === 'frente' ? 'vigia da frente' : METRICS[watcher.metric].hint}</span>
                    </td>
                    <td className="px-5 py-3">{watcher.frontId || watcher.stageId ? watcherScope(watcher) : 'o funil inteiro'}</td>
                    <td className="px-5 py-3 text-right">
                      <span className="flex flex-wrap items-center justify-end gap-2">
                        {targetPill(watcher)}
                        <span className={mono}>{formatMetric(watcher.metric, watcher.target)}</span>
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="flex flex-wrap items-center justify-end gap-2">
                        <Pill source={watcher.ownBand ? 'especifica' : 'segue'} text={watcher.ownBand ? 'própria' : 'segue o funil'} />
                        <span className={`${mono} text-[12px]`} title={limits ? `atenção ${formatMetric(watcher.metric, limits.warn)} · crítico ${formatMetric(watcher.metric, limits.crit)}` : undefined}>
                          {decimalInput(watcher.warnPct)}% / {decimalInput(watcher.critPct)}%
                        </span>
                      </span>
                    </td>
                    <td className={`${mono} px-5 py-3 text-right`}>{watcher.minSpend > 0 ? formatMetric('investimento', watcher.minSpend) : '—'}</td>
                    <td className="px-5 py-3 text-right">
                      {watcher.lastStatus ? (
                        <span className="flex items-center justify-end gap-2">
                          <span className={mono}>{formatMetric(watcher.metric, watcher.lastValue)}</span>
                          <WatcherStatusPill status={watcher.lastStatus} />
                        </span>
                      ) : (
                        <span className="text-[var(--ct-text-3)]">ainda não avaliado</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {canEdit && (
                        <span className="flex items-center justify-end gap-3">
                          <Link href={`${metasHref}?editar=${watcher.id}#metas-vigias`} className="text-xs text-[var(--ct-text-2)] hover:text-[var(--ct-text)]" aria-label={`Editar vigia de ${METRICS[watcher.metric].label}`}>
                            editar
                          </Link>
                          <form action={toggleWatcher.bind(null, { ...context, watcher_id: watcher.id, is_active: !watcher.isActive })}>
                            <button type="submit" className="text-xs text-[var(--ct-text-2)] hover:text-[var(--ct-text)]">
                              {watcher.isActive ? 'pausar' : 'ligar'}
                            </button>
                          </form>
                          <ConfirmDeleteButton action={deleteWatcher.bind(null, { ...context, watcher_id: watcher.id })} label="remover" warning="Remover o vigia e os alertas?" />
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {archivedWatchers.length > 0 && (
          <details>
            <summary className="cursor-pointer text-[12.5px] font-medium text-[var(--ct-text-2)] hover:text-[var(--ct-text)]">Vigias de etapas ou frentes arquivadas ({archivedWatchers.length})</summary>
            <ul className="mt-2 flex flex-col gap-1.5">
              {archivedWatchers.map((watcher) => (
                <li key={watcher.id} className="flex flex-wrap items-baseline gap-x-3 text-[12.5px] text-[var(--ct-text-2)]">
                  <b className="font-semibold text-[var(--ct-text)]">{METRICS[watcher.metric].label}</b>
                  <span>{watcherScope(watcher)}</span>
                  <span className={mono}>meta {formatMetric(watcher.metric, watcher.target)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {canEdit && (
          <form action={createWatcher.bind(null, context)} className={`card-shadow ${formGrid} rounded-[18px] border border-dashed border-[var(--ct-line-2)] px-6 py-5`}>
            <ScopeMetricFields fieldClass={field} scopes={scopes} metrics={metricOptions} sales={resultUsesSales(funnel.resultado)} />
            <NumberFields />
            <div className="flex items-end md:col-span-3 xl:col-span-7">
              <p className="mr-auto max-w-[70ch] text-xs text-[var(--ct-text-3)]">
                “Segue” usa a meta da frente ou da etapa no mesmo custo (CPA, ROAS, CPL, CPM, custo por visita); CTR, frequência e as outras pedem meta específica. Abaixo do
                gasto mínimo o número balança sozinho e o vigia fica calado.
              </p>
              <button type="submit" className={primary}>
                + Novo vigia
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}
