import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_STAGE_PRESETS, type CostCombo, type Stage, type StageMeasure, type StageMirror, type StagePreset } from '@/lib/domain/funnel-stages'
import type { ProductRole } from '@/lib/domain/product-roles'
import type { RemovalFacts } from '@/lib/domain/stage-removal'

// Etapas no funil (0105). Reads run on the user's session (RLS: cliente reads); writes go through the
// same policies as fronts, so only a gestor or owner of the client (or staff admin) writes them.

const STAGE_COLUMNS = 'id, sales_funnel_id, name, tag, measure, position, parallel, janela_inicio, janela_fim, meta, meta_roas, archived_at, mirror_funnel_id, mirror_papeis, mirror_products'
// Reads only: an embed in an insert's returning loses the order the rows were given in (createStages).
const STAGE_READ_COLUMNS = `${STAGE_COLUMNS}, mirror_funnel:sales_funnels!funnel_stages_mirror_funnel_id_fkey(name)`

interface StageRow {
  id: string
  sales_funnel_id: string
  name: string
  tag: string | null
  measure: StageMeasure
  position: number
  parallel: boolean
  janela_inicio: string | null
  janela_fim: string | null
  meta: number | null
  meta_roas: number | null
  archived_at: string | null
  mirror_funnel_id: string | null
  mirror_papeis: ProductRole[] | null
  mirror_products: string[] | null
  mirror_funnel?: { name: string } | null
}

const toStage = (row: StageRow): Stage => ({
  id: row.id,
  salesFunnelId: row.sales_funnel_id,
  name: row.name,
  tag: row.tag,
  measure: row.measure,
  position: row.position,
  parallel: row.parallel,
  janelaInicio: row.janela_inicio,
  janelaFim: row.janela_fim,
  meta: row.meta === null ? null : Number(row.meta),
  metaRoas: row.meta_roas === null ? null : Number(row.meta_roas),
  archivedAt: row.archived_at,
  mirror: row.mirror_funnel_id
    ? { funnelId: row.mirror_funnel_id, funnelName: row.mirror_funnel?.name ?? 'outro funil', papeis: row.mirror_papeis ?? ['entrada'], products: row.mirror_products }
    : null,
})

export interface StageFront {
  id: string
  code: string
  name: string
  position: number
  sourceSalesFunnelId: string | null
  archivedAt: string | null
  rules: { id: string; kind: 'include' | 'exclude'; value: string }[]
}

export interface StageWithFronts extends Stage {
  fronts: StageFront[]
}

/** The project's stages in order, archived ones included, each with its fronts and their naming rules. */
export async function getFunnelStages(db: SupabaseClient, salesFunnelId: string): Promise<StageWithFronts[]> {
  const { data, error } = await db
    .from('funnel_stages')
    .select(`${STAGE_READ_COLUMNS}, project_fronts(id, code, name, position, source_sales_funnel_id, archived_at, naming_rules(id, kind, value))`)
    .eq('sales_funnel_id', salesFunnelId)
    .order('position')
    .order('created_at')
  if (error) throw error
  return ((data ?? []) as unknown as (StageRow & {
    project_fronts: { id: string; code: string; name: string; position: number; source_sales_funnel_id: string | null; archived_at: string | null; naming_rules: StageFront['rules'] }[]
  })[]).map((row) => ({
    ...toStage(row),
    fronts: row.project_fronts
      .map((front) => ({
        id: front.id,
        code: front.code,
        name: front.name,
        position: front.position,
        sourceSalesFunnelId: front.source_sales_funnel_id,
        archivedAt: front.archived_at,
        rules: front.naming_rules,
      }))
      .sort((a, b) => a.position - b.position),
  }))
}

export interface StageDayRow {
  stageId: string
  data: string
  spend: number
  /** With the client's Meta tax for the day (0055): the base of every stage cost. */
  spendComImposto: number
  impressions: number
  reach: number
  clicks: number
  linkClicks: number
  landingPageViews: number
  leads: number
  initiateCheckout: number
  /** Entry sales in a compra stage, ascension sales in an ascensao stage, on the day they were made. */
  vendas: number
  /** Those sales refunded on this day, whatever day they were made. */
  reembolsos: number
  /** Net of this day's refunds, like get_funnel_daily. */
  receitaLiquida: number
  receitaReembolsadaLiquida: number
  /** How many of the vendas are another funnel's, mirrored into the stage (0108). */
  vendasEspelho: number
}

export async function getStageDaily(db: SupabaseClient, salesFunnelId: string, since: string, until: string): Promise<StageDayRow[]> {
  const { data, error } = await db.rpc('get_funnel_stage_daily', { p_funnel_id: salesFunnelId, p_from: since, p_to: until })
  if (error) throw error
  return ((data ?? []) as Record<string, string | number>[]).map((row) => ({
    stageId: String(row.stage_id),
    data: String(row.data),
    spend: Number(row.spend),
    spendComImposto: Number(row.spend_com_imposto),
    impressions: Number(row.impressions),
    reach: Number(row.reach),
    clicks: Number(row.clicks),
    linkClicks: Number(row.link_clicks),
    landingPageViews: Number(row.landing_page_views),
    leads: Number(row.leads),
    initiateCheckout: Number(row.initiate_checkout),
    vendas: Number(row.vendas),
    reembolsos: Number(row.reembolsos),
    receitaLiquida: Number(row.receita_liquida),
    receitaReembolsadaLiquida: Number(row.receita_reembolsada_liquida),
    vendasEspelho: Number(row.vendas_espelho),
  }))
}

export interface StageOrigin {
  /** The stage that counts the sale; null when the project has no compra stage for its day. */
  stageId: string | null
  /** The stage whose campaign brought it; null when no campaign of the project carries it. */
  originStageId: string | null
  vendas: number
}

export async function getStageOrigin(db: SupabaseClient, salesFunnelId: string, since: string, until: string): Promise<StageOrigin[]> {
  const { data, error } = await db.rpc('get_funnel_stage_origin', { p_funnel_id: salesFunnelId, p_from: since, p_to: until })
  if (error) throw error
  return ((data ?? []) as { stage_id: string | null; origin_stage_id: string | null; vendas: number }[]).map((row) => ({
    stageId: row.stage_id,
    originStageId: row.origin_stage_id,
    vendas: Number(row.vendas),
  }))
}

interface ComboRow {
  id: string
  sales_funnel_id: string
  name: string
  stage_ids: string[]
  over: 'receita' | 'stage'
  over_stage_id: string | null
  enabled: boolean
  meta: number | null
  position: number
}

const toCombo = (row: ComboRow): CostCombo => ({
  id: row.id,
  salesFunnelId: row.sales_funnel_id,
  name: row.name,
  stageIds: row.stage_ids,
  over: row.over,
  overStageId: row.over_stage_id,
  enabled: row.enabled,
  meta: row.meta === null ? null : Number(row.meta),
  position: row.position,
})

export async function getCostCombos(db: SupabaseClient, salesFunnelId: string): Promise<CostCombo[]> {
  const { data, error } = await db.from('funnel_cost_combos').select('*').eq('sales_funnel_id', salesFunnelId).order('position').order('created_at')
  if (error) throw error
  return ((data ?? []) as ComboRow[]).map(toCombo)
}

export interface ClientStagePreset extends StagePreset {
  /** Null for the built-in defaults: the client has not saved a list of its own. */
  id: string | null
}

/** The client's ready stages, or the built-in defaults when it has none. */
export async function getStagePresets(db: SupabaseClient, clientId: string): Promise<ClientStagePreset[]> {
  const { data, error } = await db.from('client_stage_presets').select('id, name, tag, measure, parallel, position').eq('client_id', clientId).order('position').order('created_at')
  if (error) throw error
  const rows = (data ?? []) as ClientStagePreset[]
  return rows.length ? rows : DEFAULT_STAGE_PRESETS.map((preset) => ({ ...preset, id: null }))
}

// Writes -------------------------------------------------------------------------------------------

/** The database refusals of 0105 in the screen's words; anything else keeps its own message. */
export function stageWriteError(error: { code?: string; message: string }): string {
  if (error.message.includes('still has active fronts')) return 'A etapa ainda tem frentes ativas: mova ou arquive as frentes antes.'
  if (error.message.includes('is archived')) return 'Etapa arquivada: restaure a etapa antes de colocar frente nela.'
  if (error.message.includes('combo stages')) return 'O custo combinado só soma etapas deste funil.'
  if (error.message.includes('mirror its own funnel')) return 'A etapa não pode espelhar o próprio funil.'
  if (error.message.includes('mirror funnel must be of the same client')) return 'Só dá para espelhar um funil do mesmo cliente.'
  if (error.message.includes('funnel_stages_mirror_measure')) return 'Só etapas de lead, compra ou ascensão espelham vendas.'
  if (error.code === '23503') return 'A etapa ainda é usada (frentes ou custo combinado).'
  return error.message
}

export interface StageInput {
  name: string
  tag: string | null
  measure: StageMeasure
  position: number
  parallel: boolean
  janelaInicio: string | null
  janelaFim: string | null
  meta: number | null
  metaRoas: number | null
}

const stageColumns = (input: Partial<StageInput>) => {
  const columns: Record<string, unknown> = {}
  if (input.name !== undefined) columns.name = input.name.trim()
  if (input.tag !== undefined) columns.tag = input.tag?.trim() || null
  if (input.measure !== undefined) columns.measure = input.measure
  if (input.position !== undefined) columns.position = input.position
  if (input.parallel !== undefined) columns.parallel = input.parallel
  if (input.janelaInicio !== undefined) columns.janela_inicio = input.janelaInicio
  if (input.janelaFim !== undefined) columns.janela_fim = input.janelaFim
  if (input.meta !== undefined) columns.meta = input.meta
  if (input.metaRoas !== undefined) columns.meta_roas = input.metaRoas
  return columns
}

export async function createStage(db: SupabaseClient, salesFunnelId: string, input: StageInput): Promise<Stage> {
  const { data, error } = await db.from('funnel_stages').insert({ sales_funnel_id: salesFunnelId, ...stageColumns(input) }).select(STAGE_COLUMNS).single()
  if (error) throw new Error(stageWriteError(error))
  return toStage(data as unknown as StageRow)
}

/**
 * Several stages in one insert, returned in the order given. One statement, so the funnel's resultado
 * (0107) is derived once, from all of them, instead of passing through each half-built journey.
 */
export async function createStages(db: SupabaseClient, salesFunnelId: string, inputs: StageInput[]): Promise<Stage[]> {
  if (inputs.length === 0) return []
  const { data, error } = await db.from('funnel_stages').insert(inputs.map((input) => ({ sales_funnel_id: salesFunnelId, ...stageColumns(input) }))).select(STAGE_COLUMNS)
  if (error) throw new Error(stageWriteError(error))
  return (data as unknown as StageRow[]).map(toStage)
}

/** A tag change freezes the campaigns the names give today first (0105), like a rule change. */
export async function updateStage(db: SupabaseClient, stageId: string, input: Partial<StageInput>): Promise<void> {
  const { data, error } = await db.from('funnel_stages').update(stageColumns(input)).eq('id', stageId).select('id')
  if (error) throw new Error(stageWriteError(error))
  if (!data?.length) throw new Error('Só gestor ou owner pode mudar a etapa.')
}

/** Sets or clears (null) the stage's sales mirror (0108); the database checks the source is of the same client. */
export async function updateStageMirror(db: SupabaseClient, stageId: string, mirror: Omit<StageMirror, 'funnelName'> | null): Promise<void> {
  const { data, error } = await db
    .from('funnel_stages')
    .update({ mirror_funnel_id: mirror?.funnelId ?? null, mirror_papeis: mirror?.papeis ?? null, mirror_products: mirror?.products ?? null })
    .eq('id', stageId)
    .select('id')
  if (error) throw new Error(stageWriteError(error))
  if (!data?.length) throw new Error('Só gestor ou owner pode mudar a etapa.')
}

export async function reorderStages(db: SupabaseClient, salesFunnelId: string, stageIds: string[]): Promise<void> {
  const { error } = await db.rpc('reorder_funnel_stages', { p_funnel_id: salesFunnelId, p_stage_ids: stageIds })
  if (error) throw new Error(stageWriteError(error))
}

/** Archiving asks the stage's fronts to be moved or archived first; the database refuses otherwise. */
export async function setStageArchived(db: SupabaseClient, stageId: string, archived: boolean): Promise<void> {
  const { data, error } = await db.from('funnel_stages').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', stageId).select('id')
  if (error) throw new Error(stageWriteError(error))
  if (!data?.length) throw new Error('Só gestor ou owner pode arquivar a etapa.')
}

/** What the funnel's stages and fronts have taken so far, to tell what can be removed for good. */
export async function getRemovalFacts(db: SupabaseClient, salesFunnelId: string): Promise<RemovalFacts> {
  const [stages, combos] = await Promise.all([getFunnelStages(db, salesFunnelId), getCostCombos(db, salesFunnelId)])
  const frontIds = stages.flatMap((stage) => stage.fronts.map((front) => front.id))
  const none = { data: [], error: null }
  const [campaigns, pages, watchers, tests] = await Promise.all([
    frontIds.length ? db.from('campaign_fronts').select('front_id').in('front_id', frontIds) : none,
    frontIds.length ? db.from('pages').select('front_id').in('front_id', frontIds) : none,
    db.from('watchers').select('front_id, stage_id').eq('sales_funnel_id', salesFunnelId),
    db.from('backlog_items').select('funnel_stage_id').eq('sales_funnel_id', salesFunnelId).not('funnel_stage_id', 'is', null),
  ])
  const failed = campaigns.error ?? pages.error ?? watchers.error ?? tests.error
  if (failed) throw failed
  return {
    stages: stages.map((stage) => ({ id: stage.id, archivedAt: stage.archivedAt, fronts: stage.fronts.map((front) => ({ id: front.id, rules: front.rules.length })) })),
    campaignFrontIds: ((campaigns.data ?? []) as { front_id: string }[]).map((row) => row.front_id),
    pageFrontIds: ((pages.data ?? []) as { front_id: string }[]).map((row) => row.front_id),
    watchers: ((watchers.data ?? []) as { front_id: string | null; stage_id: string | null }[]).map((row) => ({ frontId: row.front_id, stageId: row.stage_id })),
    testStageIds: ((tests.data ?? []) as { funnel_stage_id: string }[]).map((row) => row.funnel_stage_id),
    combos: combos.map((combo) => ({ stageIds: combo.stageIds, overStageId: combo.overStageId })),
  }
}

/** Deletes an unused stage with its fronts; the caller checks it is unused (stageInUse) right before. */
export async function deleteStage(db: SupabaseClient, salesFunnelId: string, stageId: string): Promise<void> {
  const { error: frontsError } = await db.from('project_fronts').delete().eq('sales_funnel_id', salesFunnelId).eq('stage_id', stageId)
  if (frontsError) throw new Error(stageWriteError(frontsError))
  const { data, error } = await db.from('funnel_stages').delete().eq('sales_funnel_id', salesFunnelId).eq('id', stageId).select('id')
  if (error) throw new Error(stageWriteError(error))
  if (!data?.length) throw new Error('Só gestor ou owner pode remover a etapa.')
}

/** Deletes an unused front; the caller checks it is unused (frontInUse) right before. */
export async function deleteFront(db: SupabaseClient, salesFunnelId: string, frontId: string): Promise<void> {
  const { data, error } = await db.from('project_fronts').delete().eq('sales_funnel_id', salesFunnelId).eq('id', frontId).select('id')
  if (error) throw new Error(stageWriteError(error))
  if (!data?.length) throw new Error('Só gestor ou owner pode remover a frente.')
}

/** The stage must be of the front's own project and open; the owners freeze first if the tag changes. */
export async function moveFrontToStage(db: SupabaseClient, frontId: string, stageId: string): Promise<void> {
  const { data, error } = await db.from('project_fronts').update({ stage_id: stageId }).eq('id', frontId).select('id')
  if (error) throw new Error(stageWriteError(error))
  if (!data?.length) throw new Error('Só gestor ou owner pode mover a frente.')
}

export interface ComboInput {
  name: string
  stageIds: string[]
  over: 'receita' | 'stage'
  overStageId: string | null
  enabled: boolean
  meta: number | null
  position: number
}

const comboColumns = (input: Partial<ComboInput>) => {
  const columns: Record<string, unknown> = {}
  if (input.name !== undefined) columns.name = input.name.trim()
  if (input.stageIds !== undefined) columns.stage_ids = input.stageIds
  if (input.over !== undefined) columns.over = input.over
  if (input.overStageId !== undefined) columns.over_stage_id = input.overStageId
  if (input.enabled !== undefined) columns.enabled = input.enabled
  if (input.meta !== undefined) columns.meta = input.meta
  if (input.position !== undefined) columns.position = input.position
  return columns
}

export async function createCostCombo(db: SupabaseClient, salesFunnelId: string, input: ComboInput): Promise<CostCombo> {
  const { data, error } = await db.from('funnel_cost_combos').insert({ sales_funnel_id: salesFunnelId, ...comboColumns(input) }).select('*').single()
  if (error) throw new Error(stageWriteError(error))
  return toCombo(data as ComboRow)
}

export async function updateCostCombo(db: SupabaseClient, comboId: string, input: Partial<ComboInput>): Promise<void> {
  const { data, error } = await db.from('funnel_cost_combos').update(comboColumns(input)).eq('id', comboId).select('id')
  if (error) throw new Error(stageWriteError(error))
  if (!data?.length) throw new Error('Só gestor ou owner pode mudar o custo combinado.')
}

export async function deleteCostCombo(db: SupabaseClient, comboId: string): Promise<void> {
  const { data, error } = await db.from('funnel_cost_combos').delete().eq('id', comboId).select('id')
  if (error) throw new Error(stageWriteError(error))
  if (!data?.length) throw new Error('Só gestor ou owner pode apagar o custo combinado.')
}

const presetColumns = (input: Partial<StagePreset>) => {
  const columns: Record<string, unknown> = {}
  if (input.name !== undefined) columns.name = input.name.trim()
  if (input.tag !== undefined) columns.tag = input.tag?.trim() || null
  if (input.measure !== undefined) columns.measure = input.measure
  if (input.parallel !== undefined) columns.parallel = input.parallel
  if (input.position !== undefined) columns.position = input.position
  return columns
}

export async function createStagePreset(db: SupabaseClient, clientId: string, input: StagePreset): Promise<string> {
  const { data, error } = await db.from('client_stage_presets').insert({ client_id: clientId, ...presetColumns(input) }).select('id').single()
  if (error) throw error
  return data.id as string
}

export async function updateStagePreset(db: SupabaseClient, presetId: string, input: Partial<StagePreset>): Promise<void> {
  const { data, error } = await db.from('client_stage_presets').update(presetColumns(input)).eq('id', presetId).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Só gestor ou owner pode mudar as etapas prontas.')
}

export async function deleteStagePreset(db: SupabaseClient, presetId: string): Promise<void> {
  const { data, error } = await db.from('client_stage_presets').delete().eq('id', presetId).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Só gestor ou owner pode apagar etapas prontas.')
}

/**
 * "Duplicar de um funil anterior": the source's open stages and combos into a new project. Returns
 * the new stage of each source front code, so the copied fronts land where their originals were.
 * The window is not copied: the old dates belong to the old project.
 */
export async function copyStages(db: SupabaseClient, fromFunnelId: string, toFunnelId: string): Promise<Map<string, string>> {
  const stages = (await getFunnelStages(db, fromFunnelId)).filter((stage) => !stage.archivedAt)
  const newIds = new Map<string, string>()
  const byCode = new Map<string, string>()
  const created = await createStages(db, toFunnelId, stages.map((stage) => ({ ...stage, janelaInicio: null, janelaFim: null })))
  stages.forEach((stage, index) => {
    newIds.set(stage.id, created[index].id)
    for (const front of stage.fronts) byCode.set(front.code.toUpperCase(), created[index].id)
  })
  for (const combo of await getCostCombos(db, fromFunnelId)) {
    const stageIds = combo.stageIds.flatMap((id) => newIds.get(id) ?? [])
    const overStageId = combo.overStageId ? newIds.get(combo.overStageId) : null
    if (!stageIds.length || overStageId === undefined) continue
    await createCostCombo(db, toFunnelId, { ...combo, stageIds, overStageId })
  }
  return byCode
}
