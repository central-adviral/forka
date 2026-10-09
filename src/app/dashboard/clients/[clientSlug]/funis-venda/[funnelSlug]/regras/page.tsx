import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { resolvePeriodDateRange } from '@/lib/domain/report-period'
import {
  bracketTags,
  conflictingCampaigns,
  orphanCampaigns,
  reconcileSpend,
  summarizeFronts,
  type ClassifiedCampaign,
} from '@/lib/domain/campaign-rules'
import { pinCampaign, setFrontArchived, unpinCampaign } from './actions'
import { canActAs } from '@/lib/view-as'
import { PageHeader } from '@/components/page-header'
import { saoPauloDay } from '@/lib/repo/today-repo'
import { ApplySincePanel } from '../apply-since-panel'
import { applySince, previewApplySince } from '../apply-since-actions'
import { ArchivedProjectBanner } from '../../archived-project-banner'
import { readResult, type ProjectResult } from '@/lib/domain/project-plan'
import { COLUMNS } from '@/lib/domain/backlog'
import { METRICS, watcherSource, type WatcherMetric } from '@/lib/domain/watchers'
import { resultStage, stageFollowers, watcherReader, type FrontMetas, type MetaReader, type TargetSource, type TetoMedida, type TetoSource } from '@/lib/domain/targets'
import { measureOfMetric } from '@/lib/domain/funnel-stages'
import { campaignNameSuggestion, stageSetupItems } from '@/lib/domain/stage-canvas'
import { getCostCombos, getFunnelStages, getRemovalFacts, getStagePresets } from '@/lib/repo/funnel-stages-repo'
import { frontInUse, isLastOpenStage, stageInUse } from '@/lib/domain/stage-removal'
import type { PageKind } from '@/lib/domain/new-funnel'
import { StagesCanvas } from './stages-canvas'
import type { CanvasStage } from './canvas-types'
import { FunnelHeader } from '../funnel-header'

interface FrontRow {
  id: string
  code: string
  name: string
  position: number
  sales_funnel_id: string
  source_sales_funnel_id: string | null
  janela_inicio: string | null
  janela_fim: string | null
  metrica_principal: ProjectResult | null
  alvo_principal: number | null
  metrica_secundaria: ProjectResult | null
  alvo_secundaria: number | null
  archived_at: string | null
  sales_funnels: { name: string; archived_at: string | null } | null
  naming_rules: { id: string; kind: 'include' | 'exclude'; value: string }[]
}

const PERIODS = [
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
] as const

const currency = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

const ASSIGNMENT_LABEL: Record<NonNullable<ClassifiedCampaign['assignment']>, string> = {
  manual: 'fixada à mão',
  auto: 'fixada pelo nome',
  nome: 'pelo nome · fixa no próximo sync',
}

const mono = 'font-[family-name:var(--font-geist-mono)]'
const fieldClass =
  'rounded-[8px] border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] px-2.5 py-1.5 text-[12.5px] text-[var(--ct-text)] outline-none focus:border-[var(--ct-accent)]'

export default async function StagesAndFrontsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string; funnelSlug: string }>
  searchParams: Promise<{ periodo?: string; ok?: string; erro?: string; mudou?: string; etapa?: string }>
}) {
  const { clientSlug, funnelSlug } = await params
  const { periodo: periodParam, ok, erro, mudou, etapa } = await searchParams
  const periodo = periodParam === '30d' ? '30d' : '7d'
  const supabase = await createServerSupabaseClient()

  const { data: client } = await supabase.from('clients').select('id, name, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()
  // Configuration is internal to the agency: the client never reads it, even by typing the address.
  if (!(await canActAs(supabase, client.id, 'analista'))) notFound()
  const { data: funnel } = await supabase
    .from('sales_funnels')
    .select('id, name, slug, tag, archived_at, starts_on, ends_on, resultado')
    .eq('client_id', client.id)
    .eq('slug', funnelSlug)
    .maybeSingle()
  if (!funnel) notFound()

  const { since, until } = resolvePeriodDateRange(periodo, undefined, undefined)
  const [
    canEditClient,
    { data: frontRows, error: frontsError },
    { data: campaignRows },
    { data: lastSync },
    { data: otherFunnels },
    stageRows,
    combos,
    presets,
    { data: watcherRows, error: watchersError },
    { data: testRows, error: testsError },
    { data: pageRows, error: pagesError },
    removalFacts,
  ] = await Promise.all([
    canActAs(supabase, client.id, 'gestor'),
    supabase
      .from('project_fronts')
      .select('id, code, name, position, sales_funnel_id, source_sales_funnel_id, janela_inicio, janela_fim, metrica_principal, alvo_principal, metrica_secundaria, alvo_secundaria, archived_at, sales_funnels!project_fronts_sales_funnel_id_fkey!inner(name, client_id, archived_at), naming_rules(id, kind, value)')
      .eq('sales_funnels.client_id', client.id)
      .order('position'),
    supabase.rpc('get_client_campaigns', { p_client_id: client.id, p_since: since, p_until: until }),
    supabase.from('campaign_daily').select('synced_at').eq('client_id', client.id).order('synced_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('sales_funnels').select('id, name, archived_at').eq('client_id', client.id).neq('id', funnel.id).order('name'),
    getFunnelStages(supabase, funnel.id),
    getCostCombos(supabase, funnel.id),
    getStagePresets(supabase, client.id),
    supabase
      .from('watchers')
      .select('id, metric, target, effective_target, target_source, target_stage_id, warn_pct, effective_warn_pct, effective_crit_pct, front_id, stage_id, plan_role')
      .eq('sales_funnel_id', funnel.id)
      .eq('is_active', true),
    supabase
      .from('backlog_items')
      .select('id, code, title, status, method, funnel_stage_id, teto, teto_inicial, teto_medida, effective_teto, effective_teto_source, effective_teto_medida')
      .eq('sales_funnel_id', funnel.id)
      .order('code'),
    supabase.from('pages').select('id, url, tipo, front_id, is_active').eq('sales_funnel_id', funnel.id).not('front_id', 'is', null).order('created_at'),
    getRemovalFacts(supabase, funnel.id),
  ])

  if (frontsError) throw frontsError
  if (watchersError) throw watchersError
  if (testsError) throw testsError
  if (pagesError) throw pagesError
  const pagesOfFront = (frontId: string) =>
    ((pageRows ?? []) as { id: string; url: string; tipo: PageKind | null; front_id: string; is_active: boolean }[])
      .filter((page) => page.front_id === frontId)
      .map((page) => ({ id: page.id, url: page.url, tipo: page.tipo, isActive: page.is_active }))
  const allFronts = (frontRows ?? []) as unknown as FrontRow[]
  // An archived project opens read-only; its archived fronts are listed apart, to restore.
  const canEdit = canEditClient && !funnel.archived_at
  const fronts = allFronts.filter((front) => front.sales_funnel_id === funnel.id && !front.archived_at)
  const archivedFronts = allFronts.filter((front) => front.sales_funnel_id === funnel.id && front.archived_at)
  const frontById = new Map(allFronts.map((front) => [front.id, front]))
  const funnelNameById = new Map((otherFunnels ?? []).map((other) => [other.id as string, other.name as string]))
  // Only fronts with campaigns of their own can own one; a front that reads another project cannot.
  const ownerFronts = allFronts.filter((front) => !front.source_sales_funnel_id && !front.archived_at && !front.sales_funnels?.archived_at)
  const campaigns = (campaignRows ?? []) as ClassifiedCampaign[]
  const summary = summarizeFronts(campaigns, fronts.map((front) => front.id))
  // Archived fronts still own their campaigns: the project's spend keeps them.
  const projectFrontIds = new Set([...fronts, ...archivedFronts].map((front) => front.id))
  const conflicts = conflictingCampaigns(campaigns, projectFrontIds)
  const orphans = orphanCampaigns(campaigns)
  const unclassifiedSpend = campaigns
    .filter((campaign) => campaign.front_ids.length === 0)
    .reduce((sum, campaign) => sum + Number(campaign.spend), 0)
  const orphanSpend = orphans.reduce((sum, campaign) => sum + Number(campaign.spend), 0)
  const projectSpend = campaigns
    .filter((campaign) => campaign.front_ids.some((id) => projectFrontIds.has(id)))
    .reduce((sum, campaign) => sum + Number(campaign.spend), 0)
  const tags = bracketTags(campaigns)

  // The stages with their open fronts, the watchers that read them and the tests the Quadro put in
  // them, each with the meta it follows or its own (0106).
  const watchers = (watcherRows ?? []) as {
    id: string
    metric: WatcherMetric
    target: number | null
    effective_target: number | null
    target_source: TargetSource | null
    target_stage_id: string | null
    warn_pct: number | null
    effective_warn_pct: number
    effective_crit_pct: number
    front_id: string | null
    stage_id: string | null
    plan_role: 'principal' | 'secundaria' | null
  }[]
  const tests = (testRows ?? []) as {
    id: string
    code: string
    title: string
    status: string
    method: string
    funnel_stage_id: string | null
    teto: number | null
    teto_inicial: number | null
    teto_medida: TetoMedida | null
    effective_teto: number | null
    effective_teto_source: TetoSource | null
    effective_teto_medida: TetoMedida | null
  }[]
  const num = (value: number | null) => (value === null ? null : Number(value))
  const stageOfFront = new Map(stageRows.flatMap((stage) => stage.fronts.map((front) => [front.id, stage] as const)))
  const frontMetas = new Map<string, FrontMetas>(
    allFronts
      .filter((front) => front.sales_funnel_id === funnel.id)
      .flatMap((front) => {
        const stage = stageOfFront.get(front.id)
        return stage
          ? [[front.id, { stageId: stage.id, metricaPrincipal: front.metrica_principal, alvoPrincipal: num(front.alvo_principal), metricaSecundaria: front.metrica_secundaria, alvoSecundaria: num(front.alvo_secundaria) }] as const]
          : []
      })
  )
  const resultStageId = resultStage(stageRows, measureOfMetric(readResult(funnel.resultado)))?.id ?? null
  const testStage = (test: (typeof tests)[number]) => test.funnel_stage_id ?? resultStageId
  // Each watcher shows on the stage whose meta it reads, or that it looks at.
  const watcherStage = new Map(
    watchers.map((watcher) => {
      const reader = watcherReader({ metric: watcher.metric, target: num(watcher.target), frontId: watcher.front_id, stageId: watcher.stage_id }, stageRows, frontMetas)
      return [watcher.id, watcher.front_id ? stageOfFront.get(watcher.front_id)?.id : (watcher.stage_id ?? reader?.stageId ?? null)] as const
    })
  )
  const readers: MetaReader[] = [
    ...fronts.map((front) => ({ stageId: stageOfFront.get(front.id)?.id ?? null, follows: !(front.metrica_principal && front.alvo_principal !== null) })),
    ...watchers.flatMap((watcher) => {
      const reader = watcherReader({ metric: watcher.metric, target: num(watcher.target), frontId: watcher.front_id, stageId: watcher.stage_id }, stageRows, frontMetas)
      return reader ? [reader] : []
    }),
    ...tests.filter((test) => test.status !== 'decided').map((test) => ({ stageId: testStage(test), follows: test.effective_teto_source === 'etapa' })),
  ]
  const stageNameById = new Map(stageRows.map((stage) => [stage.id, stage.name]))
  const stages: CanvasStage[] = stageRows
    .filter((stage) => !stage.archivedAt)
    .map((stage) => {
      const open = stage.fronts.filter((front) => !front.archivedAt)
      return {
        ...stage,
        followers: stageFollowers(stage.id, readers),
        inUse: stageInUse(stage.id, removalFacts),
        lastOpen: isLastOpenStage(stage.id, removalFacts),
        fronts: open.map((front) => {
          const row = frontById.get(front.id)
          const stats = summary.get(front.id)
          return {
            id: front.id,
            code: front.code,
            name: front.name,
            sourceName: front.sourceSalesFunnelId ? (funnelNameById.get(front.sourceSalesFunnelId) ?? 'outro funil') : null,
            rules: front.rules,
            metricaPrincipal: row?.metrica_principal ?? null,
            alvoPrincipal: row?.alvo_principal === null || row?.alvo_principal === undefined ? null : Number(row.alvo_principal),
            metricaSecundaria: row?.metrica_secundaria ?? null,
            alvoSecundaria: row?.alvo_secundaria === null || row?.alvo_secundaria === undefined ? null : Number(row.alvo_secundaria),
            janelaInicio: row?.janela_inicio ?? funnel.starts_on,
            janelaFim: row?.janela_fim ?? funnel.ends_on,
            campaigns: stats?.campaigns ?? 0,
            spend: stats?.spend ?? 0,
            pages: pagesOfFront(front.id),
            inUse: frontInUse(front.id, removalFacts),
          }
        }),
        watchers: watchers
          .filter((watcher) => watcherStage.get(watcher.id) === stage.id && (!watcher.front_id || !frontById.get(watcher.front_id)?.archived_at))
          .map((watcher) => ({
            id: watcher.id,
            metric: watcher.metric,
            label: METRICS[watcher.metric]?.label ?? watcher.metric,
            scope: watcher.front_id ? `frente ${frontById.get(watcher.front_id)?.code ?? ''}` : watcher.stage_id ? 'da etapa' : 'do funil',
            source: watcherSource({ planRole: watcher.plan_role, frontId: watcher.front_id }),
            target: num(watcher.effective_target),
            ownTarget: num(watcher.target),
            targetSource: watcher.target_source,
            targetStageName: watcher.target_stage_id ? (stageNameById.get(watcher.target_stage_id) ?? null) : null,
            warnPct: Number(watcher.effective_warn_pct),
            critPct: Number(watcher.effective_crit_pct),
            ownBand: watcher.warn_pct !== null,
          })),
        tests: tests
          .filter((test) => testStage(test) === stage.id)
          .map((test) => ({
            id: test.id,
            code: test.code,
            title: test.title,
            status: COLUMNS.find((column) => column.status === test.status)?.label ?? test.status,
            running: test.status === 'running',
            meta: test.method === 'meta',
            teto: num(test.teto),
            tetoInicial: num(test.teto_inicial),
            tetoMedida: test.teto_medida,
            tetoNow: { value: num(test.effective_teto), source: test.effective_teto_source, medida: test.effective_teto_medida },
          })),
      }
    })
  const ordered = [...stages.filter((stage) => stage.parallel), ...stages.filter((stage) => !stage.parallel)]
  const missing = stageSetupItems(
    stages.map((stage) => ({
      ...stage,
      fronts: stage.fronts.map((front) => ({ name: front.name, mirror: front.sourceName !== null, includes: front.rules.filter((rule) => rule.kind === 'include').length })),
    }))
  )

  const base = `/dashboard/clients/${client.slug}/funis-venda/${funnel.slug}`
  const context = { client_slug: client.slug, funnel_slug: funnel.slug, sales_funnel_id: funnel.id }
  const pinContext = { ...context, client_id: client.id as string }
  const applyContext = { sales_funnel_id: funnel.id, path: `${base}/regras` }

  function frontLabel(frontId: string): { text: string; own: boolean } {
    const front = frontById.get(frontId)
    if (!front) return { text: '?', own: false }
    const own = front.sales_funnel_id === funnel!.id
    const stage = own ? stageOfFront.get(frontId) : undefined
    const text = own ? `${stage ? `${stage.name} › ` : ''}${front.code}` : `${front.sales_funnels?.name ?? 'outro funil'} · ${front.code}`
    return { text: front.archived_at ? `${text} (arquivada)` : text, own }
  }

  const naming = (
    <section className="card-shadow grid min-w-0 gap-3.5 rounded-[22px] border border-[var(--ct-line)] bg-[var(--ct-surface)] px-6 py-[22px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 className="text-[17px] font-semibold">Nomenclatura das campanhas</h2>
        <p className={`${mono} text-[12.5px] text-[var(--ct-text-3)]`}>{'{funil} | {etapa} | {frente} | criativo'}</p>
      </div>
      <p className="text-[12.5px] text-[var(--ct-text-3)]">A etiqueta do funil, a da etapa e a da frente precisam estar no nome; a ordem e o resto são livres.</p>
      <div className={`${mono} grid gap-1.5 overflow-x-auto text-[12.5px]`}>
        {ordered.flatMap((stage) => {
          const own = stage.fronts.filter((front) => !front.sourceName)
          if (own.length === 0) {
            return [
              <div key={stage.id} className="flex gap-3">
                <span className="min-w-[160px] font-[family-name:var(--font-body)] text-[var(--ct-text-3)]">{stage.name}</span>
                <span className="text-[var(--ct-text-3)]">crie uma frente para esta etapa</span>
              </div>,
            ]
          }
          return own.map((front) => (
            <div key={front.id} className="flex gap-3">
              <span className="min-w-[160px] font-[family-name:var(--font-body)] text-[var(--ct-text-3)]">
                {stage.name} › {front.name}
              </span>
              <span className="whitespace-nowrap">{campaignNameSuggestion(funnel!.tag, stage.tag, front.rules.find((rule) => rule.kind === 'include')?.value ?? front.code)}</span>
            </div>
          ))
        })}
        {ordered.length === 0 && <span className="font-[family-name:var(--font-body)] text-[var(--ct-text-3)]">Sem etapas ainda.</span>}
      </div>
    </section>
  )

  return (
    <div className="flex max-w-[1500px] flex-col gap-[22px] px-4 md:px-14 pb-24 pt-12">
      <PageHeader
        title="Etapas e frentes"
        note={
          canEdit
            ? 'Monte a jornada arrastando etapas. Cada etapa mede o próprio custo, só com o gasto das campanhas dela; clique numa etapa para editar meta, etiqueta, frentes, páginas, vigias e testes.'
            : 'Somente leitura: só gestor ou owner muda etapas e frentes.'
        }
        actions={
          <div className="flex items-center gap-1 rounded-[10px] border border-[var(--ct-line)] bg-[var(--ct-surface)] p-[3px]" role="group" aria-label="Período das campanhas">
            {PERIODS.map((period) => (
              <Link
                key={period.value}
                href={`${base}/regras?periodo=${period.value}`}
                aria-current={periodo === period.value ? 'page' : undefined}
                className={`rounded-[7px] px-3 py-1 text-[12.5px] font-medium ${
                  periodo === period.value ? 'bg-[var(--ct-surface-3)] text-[var(--ct-text)]' : 'text-[var(--ct-text-3)]'
                }`}
              >
                {period.label}
              </Link>
            ))}
          </div>
        }
      />

      {funnel.archived_at && <ArchivedProjectBanner salesFunnelId={funnel.id} archivedAt={funnel.archived_at} canRestore={canEditClient} />}

      <FunnelHeader client={client} salesFunnelId={funnel.id} canEdit={canEdit} regrasHref={`${base}/regras`} />

      {ok && (
        <p role="status" className="rounded-[10px] bg-[var(--ct-an-soft)] px-4 py-3 text-[13px] text-[var(--ct-an)]">
          {ok}
        </p>
      )}
      {erro && (
        <p role="alert" className="rounded-[10px] bg-[var(--ct-crit-soft)] px-4 py-3 text-[13px] text-[var(--ct-crit)]">
          {erro}
        </p>
      )}

      {canEdit && mudou && (
        <ApplySincePanel
          previewAction={previewApplySince.bind(null, applyContext)}
          applyAction={applySince.bind(null, applyContext)}
          today={saoPauloDay()}
          fieldClass={fieldClass}
        />
      )}

      <div
        role="status"
        className={`flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-[14px] border px-4 py-2.5 text-[13px] ${
          missing.length
            ? 'border-[color-mix(in_srgb,var(--ct-warn)_30%,transparent)] bg-[color-mix(in_srgb,var(--ct-warn)_8%,transparent)]'
            : 'border-[color-mix(in_srgb,var(--ct-ok)_30%,transparent)] bg-[color-mix(in_srgb,var(--ct-ok)_8%,transparent)]'
        }`}
      >
        {missing.length ? (
          <>
            <b className="font-semibold">Falta {missing.length === 1 ? '1 item' : `${missing.length} itens`} para os números deste funil serem confiáveis:</b>
            <ul className="flex flex-wrap gap-x-3.5 gap-y-1 text-[var(--ct-text-2)]">
              {missing.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <span className="h-[7px] w-[7px] rounded-full bg-[var(--ct-ok)]" />
            <b className="font-semibold">Nada faltando nas etapas.</b>
          </>
        )}
      </div>

      <StagesCanvas
        stages={stages}
        archivedStages={stageRows.filter((stage) => stage.archivedAt).map((stage) => ({ id: stage.id, name: stage.name }))}
        combos={combos}
        presets={presets}
        ownPresets={presets.some((preset) => preset.id !== null)}
        canEdit={canEdit}
        context={pinContext}
        otherFunnels={(otherFunnels ?? []).filter((other) => !other.archived_at).map((other) => ({ id: other.id as string, name: other.name as string }))}
        metasHref={`/dashboard/clients/${client.slug}/funis-venda/${funnel.slug}/metas`}
        boardHref={`/dashboard/clients/${client.slug}/backlog?projeto=${funnel.slug}`}
        initialStageId={etapa ?? null}
        naming={naming}
      />

      <h2 className="mt-4 text-[16px] font-semibold">Campanhas</h2>
      <div className="grid grid-cols-2 gap-[18px] lg:grid-cols-4">
        {[
          { label: 'Gasto do funil', value: currency(projectSpend), foot: `campanhas nas frentes · ${periodo === '7d' ? '7' : '30'} dias` },
          { label: 'Frentes', value: String(fronts.length), foot: `em ${stages.length} ${stages.length === 1 ? 'etapa' : 'etapas'}` },
          { label: 'Não classificado', value: currency(unclassifiedSpend), foot: 'sem dono · aparece em todos os totais' },
          {
            label: 'Última leitura',
            value: lastSync?.synced_at
              ? new Date(lastSync.synced_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
              : 'nunca',
            foot: 'campanhas do LaunchOps',
          },
        ].map((kpi) => (
          <div key={kpi.label} className="flex flex-col gap-1.5 rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface)] px-[22px] py-5">
            <span className="text-xs text-[var(--ct-text-3)]">{kpi.label}</span>
            <span className={`${mono} text-2xl font-medium tracking-[-0.04em]`}>{kpi.value}</span>
            <span className="text-xs text-[var(--ct-text-3)]">{kpi.foot}</span>
          </div>
        ))}
      </div>

      {campaigns.length > 0 && (() => {
        const check = reconcileSpend(campaigns)
        const balanced = check.doubleCounted < 0.01
        return (
          <div
            role={balanced ? 'status' : 'alert'}
            className={`flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[14px] px-5 py-4 text-[13px] ${
              balanced ? 'bg-[var(--ct-ok-soft)] text-[var(--ct-ok)]' : 'bg-[var(--ct-crit-soft)] text-[var(--ct-crit)]'
            }`}
          >
            <b className="font-semibold">{balanced ? 'Conferência ok' : 'Conferência não fecha'}</b>
            <span className={mono}>
              gasto do Meta Ads {currency(check.total)} = frentes {currency(check.classified)} + não classificado {currency(check.unclassified)}
            </span>
            {!balanced && (
              <span>
                {currency(check.doubleCounted)} contados duas vezes: campanha com mais de um dono. Fixe o dono na tabela abaixo.
              </span>
            )}
          </div>
        )
      })()}

      {campaigns.length === 0 && (
        <p className="rounded-[14px] border border-dashed border-[var(--ct-line-2)] p-6 text-sm text-[var(--ct-text-2)]">
          Nenhuma campanha com gasto chegou do LaunchOps neste período. Use “Atualizar agora” no funil para fazer a
          primeira leitura — ela traz os últimos 60 dias.
        </p>
      )}

      {(conflicts.length > 0 || orphans.length > 0) && (
        <div className="flex flex-col gap-3">
          {conflicts.length > 0 && (
            <div className="rounded-[12px] bg-[var(--ct-crit-soft)] px-5 py-4 text-[13px] text-[var(--ct-text-2)]">
              <b className="block text-[var(--ct-crit)]">
                {conflicts.length} {conflicts.length === 1 ? 'campanha está' : 'campanhas estão'} em mais de uma frente
              </b>
              O nome bate com mais de uma frente, então nenhuma conta o gasto até alguém escolher. Fixe o dono na tabela
              abaixo ou ajuste as etiquetas.
              <ul className="mt-2 flex flex-col gap-1">
                {conflicts.slice(0, 8).map((campaign) => (
                  <li key={campaign.campaign_id} className={`${mono} text-[12px]`}>
                    {campaign.campaign_name} → {campaign.suggested_front_ids.map((id) => frontLabel(id).text).join(' ou ')}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {orphans.length > 0 && (
            <div className="rounded-[12px] bg-[var(--ct-warn-soft)] px-5 py-4 text-[13px] text-[var(--ct-text-2)]">
              <b className="block text-[var(--ct-warn)]">
                {orphans.length} campanhas com gasto e sem frente somam {currency(orphanSpend)}
              </b>
              Elas aparecem como Não classificado em todos os totais, até ganharem uma etiqueta ou um dono fixado. As maiores:
              <ul className="mt-2 flex flex-col gap-1">
                {orphans.slice(0, 6).map((campaign) => (
                  <li key={campaign.campaign_id} className={`${mono} text-[12px]`}>
                    {currency(Number(campaign.spend))} · {campaign.campaign_name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {archivedFronts.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[12.5px] font-medium text-[var(--ct-text-2)] hover:text-[var(--ct-text)]">
            Frentes arquivadas ({archivedFronts.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {archivedFronts.map((front) => (
              <li key={front.id} className="flex items-center gap-3 text-[12.5px] text-[var(--ct-text-2)]">
                <span className={`${mono} rounded-full bg-[var(--ct-surface-3)] px-2 py-0.5 text-[11px]`}>{front.code}</span>
                {front.name}
                {stageOfFront.get(front.id) && <span className="text-[var(--ct-text-3)]">· {stageOfFront.get(front.id)!.name}</span>}
                {canEdit && (
                  <form action={setFrontArchived.bind(null, { ...context, front_id: front.id, code: front.code }, false)}>
                    <button type="submit" className="text-xs font-semibold text-[var(--ct-accent)] hover:underline">
                      Restaurar
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {tags.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[16px] font-semibold">Etiquetas encontradas nos nomes</h2>
          <p className="text-[12.5px] text-[var(--ct-text-3)]">
            As etiquetas entre colchetes das campanhas com gasto no período, da que carrega mais verba para a que carrega
            menos. Bons pontos de partida para as etiquetas.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span key={tag.tag} className={`${mono} rounded-full border border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-2.5 py-1 text-[11.5px] text-[var(--ct-text-2)]`}>
                {tag.tag} <span className="text-[var(--ct-text-3)]">· {currency(tag.spend)} · {tag.campaigns}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {campaigns.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[16px] font-semibold">Campanhas com gasto ({campaigns.length})</h2>
          <div className="overflow-x-auto rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface)]">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className={`${mono} text-left text-[10.5px] uppercase tracking-[0.06em] text-[var(--ct-text-3)]`}>
                  <th className="px-5 py-3 font-medium">Campanha</th>
                  <th className="px-5 py-3 font-medium">Etapa e frente</th>
                  <th className="px-5 py-3 font-medium">Dono</th>
                  <th className="px-5 py-3 text-right font-medium">Gasto</th>
                  <th className="px-5 py-3 text-right font-medium">Leads</th>
                  <th className="px-5 py-3 text-right font-medium">Último dia</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.campaign_id} className="border-t border-[var(--ct-line)]">
                    <td className={`${mono} max-w-[560px] px-5 py-2.5 text-[12px] text-[var(--ct-text-2)]`}>{campaign.campaign_name}</td>
                    <td className="px-5 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {campaign.front_ids.length === 0 && (
                          <span className="text-[11.5px] text-[var(--ct-warn)]">
                            {campaign.suggested_front_ids.length > 1 ? 'em conflito' : 'não classificado'}
                          </span>
                        )}
                        {campaign.front_ids.map((id) => {
                          const label = frontLabel(id)
                          return (
                            <span
                              key={id}
                              className={`${mono} rounded-full px-2 py-0.5 text-[11px] ${
                                label.own
                                    ? 'bg-[var(--ct-an-soft)] text-[var(--ct-an)]'
                                    : 'bg-[var(--ct-surface-3)] text-[var(--ct-text-3)]'
                              }`}
                            >
                              {label.text}
                            </span>
                          )
                        })}
                      </div>
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11.5px] text-[var(--ct-text-3)]">
                          {campaign.assignment ? ASSIGNMENT_LABEL[campaign.assignment] : 'sem dono'}
                        </span>
                        {canEdit && (
                          <form action={pinCampaign.bind(null, pinContext)} className="flex items-center gap-1">
                            <input type="hidden" name="campaign_id" value={campaign.campaign_id} />
                            <select name="front_id" defaultValue={campaign.front_ids[0] ?? ''} aria-label={`Dono de ${campaign.campaign_name}`} className={`${fieldClass} py-1 text-[11.5px]`}>
                              <option value="" disabled>escolher</option>
                              {ownerFronts.map((front) => (
                                <option key={front.id} value={front.id}>
                                  {frontLabel(front.id).text}
                                </option>
                              ))}
                            </select>
                            <button type="submit" className="text-[11.5px] font-medium text-[var(--ct-accent)] hover:underline">
                              fixar
                            </button>
                          </form>
                        )}
                        {canEdit && campaign.assignment === 'manual' && (
                          <form action={unpinCampaign.bind(null, { ...pinContext, campaign_id: campaign.campaign_id })}>
                            <button type="submit" className="text-[11.5px] text-[var(--ct-text-3)] hover:underline">
                              soltar
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                    <td className={`${mono} px-5 py-2.5 text-right`}>{currency(Number(campaign.spend))}</td>
                    <td className={`${mono} px-5 py-2.5 text-right`}>{Number(campaign.leads).toLocaleString('pt-BR')}</td>
                    <td className={`${mono} px-5 py-2.5 text-right text-[var(--ct-text-3)]`}>
                      {campaign.last_day.slice(8, 10)}/{campaign.last_day.slice(5, 7)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
