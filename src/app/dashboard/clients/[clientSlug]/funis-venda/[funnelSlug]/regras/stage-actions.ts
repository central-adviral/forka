'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { canActAs } from '@/lib/view-as'
import { archivedProjectError } from '@/lib/repo/project-archive-repo'
import { DEFAULT_STAGE_PRESETS, STAGE_MEASURES, type StageMeasure } from '@/lib/domain/funnel-stages'
import { metaFromInput } from '@/lib/domain/stage-canvas'
import {
  createCostCombo,
  createStage,
  createStagePreset,
  deleteCostCombo,
  deleteStagePreset,
  moveFrontToStage,
  reorderStages,
  setStageArchived,
  updateCostCombo,
  updateStage,
} from '@/lib/repo/funnel-stages-repo'

// The canvas calls these directly and keeps its optimistic state, so they answer { error } instead of
// redirecting. Writes run on the user's session (0105 policies); the role and the archived project
// are asked first so the refusal reads in the screen's words.

interface StageContext {
  client_id: string
  client_slug: string
  funnel_slug: string
  sales_funnel_id: string
}

export interface StageActionResult {
  error: string | null
}

const issues = (error: z.ZodError) => error.issues.map((issue) => issue.message).join('; ')
const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

async function writer(context: StageContext) {
  const supabase = await createServerSupabaseClient()
  if (!(await canActAs(supabase, context.client_id, 'gestor'))) return { error: 'Só gestor ou owner pode mudar as etapas.' }
  const archived = await archivedProjectError(supabase, context.sales_funnel_id)
  if (archived) return { error: archived }
  return { supabase }
}

function refresh(context: StageContext) {
  // The analysis and the board read the stages too.
  revalidatePath(`/dashboard/clients/${context.client_slug}/funis-venda/${context.funnel_slug}`, 'layout')
}

const measure = z.enum(STAGE_MEASURES as [StageMeasure, ...StageMeasure[]])
const tag = z
  .string()
  .max(24, 'a etiqueta tem até 24 letras')
  .transform((value) => value.toUpperCase().replace(/\s+/g, '') || null)
const name = z.string().trim().min(1, 'dê um nome para a etapa').max(60)
const order = z.array(z.uuid()).max(40)
const day = z.union([z.literal(''), z.iso.date()]).transform((value) => value || null)

export async function addStage(
  context: StageContext,
  input: { name: string; tag: string; measure: StageMeasure; parallel: boolean; order: string[] }
): Promise<StageActionResult & { id?: string }> {
  // order lists the lane as dropped, with 'new' where the stage goes.
  const parsed = z
    .object({ name, tag, measure, parallel: z.boolean(), order: z.array(z.union([z.uuid(), z.literal('new')])).max(40) })
    .safeParse(input)
  if (!parsed.success) return { error: issues(parsed.error) }
  const access = await writer(context)
  if ('error' in access) return { error: access.error! }
  let created
  try {
    created = await createStage(access.supabase, context.sales_funnel_id, {
      name: parsed.data.name,
      tag: parsed.data.tag,
      measure: parsed.data.measure,
      position: Math.max(0, parsed.data.order.indexOf('new')),
      parallel: parsed.data.parallel,
      janelaInicio: null,
      janelaFim: null,
      meta: null,
      metaRoas: null,
    })
    await reorderStages(access.supabase, context.sales_funnel_id, parsed.data.order.map((id) => (id === 'new' ? created!.id : id)))
  } catch (err) {
    return { error: message(err) }
  }
  refresh(context)
  return { error: null, id: created.id }
}

const stageSchema = z
  .object({
    name,
    tag,
    measure,
    meta: z.string(),
    metaRoas: z.string(),
    janelaInicio: day,
    janelaFim: day,
  })
  .transform((value, ctx) => {
    const meta = metaFromInput(value.measure, value.meta)
    const metaRoas = value.measure === 'compra' ? metaFromInput('lead', value.metaRoas) : null
    if (meta !== null && !(meta > 0)) ctx.addIssue({ code: 'custom', message: 'a meta é um número maior que zero' })
    if (metaRoas !== null && !(metaRoas > 0)) ctx.addIssue({ code: 'custom', message: 'o ROAS mínimo é um número maior que zero' })
    if (value.janelaInicio && value.janelaFim && value.janelaFim < value.janelaInicio) ctx.addIssue({ code: 'custom', message: 'o fim da janela vem antes do início' })
    return { ...value, meta, metaRoas }
  })

export type StageFields = z.input<typeof stageSchema>

/** A tag change freezes the campaigns the names give today first (0105), like a rule change. */
export async function saveStage(context: StageContext, stageId: string, input: StageFields): Promise<StageActionResult> {
  const id = z.uuid().safeParse(stageId)
  const parsed = stageSchema.safeParse(input)
  if (!id.success || !parsed.success) return { error: parsed.success ? 'Etapa inválida.' : issues(parsed.error) }
  const access = await writer(context)
  if ('error' in access) return { error: access.error! }
  try {
    await updateStage(access.supabase, id.data, parsed.data)
  } catch (err) {
    return { error: message(err) }
  }
  refresh(context)
  return { error: null }
}

/** A drop or a "Antes / Depois / Tornar paralela": the lane of the stage, then the whole order. */
export async function placeStageAction(context: StageContext, stageId: string, parallel: boolean, stageIds: string[]): Promise<StageActionResult> {
  const parsed = z.object({ stageId: z.uuid(), parallel: z.boolean(), stageIds: order }).safeParse({ stageId, parallel, stageIds })
  if (!parsed.success) return { error: issues(parsed.error) }
  const access = await writer(context)
  if ('error' in access) return { error: access.error! }
  try {
    await updateStage(access.supabase, parsed.data.stageId, { parallel: parsed.data.parallel })
    await reorderStages(access.supabase, context.sales_funnel_id, parsed.data.stageIds)
  } catch (err) {
    return { error: message(err) }
  }
  refresh(context)
  return { error: null }
}

/** The database refuses a stage that still has active fronts; the message says what to do. */
export async function archiveStage(context: StageContext, stageId: string, archived: boolean): Promise<StageActionResult> {
  const id = z.uuid().safeParse(stageId)
  if (!id.success) return { error: 'Etapa inválida.' }
  const access = await writer(context)
  if ('error' in access) return { error: access.error! }
  try {
    await setStageArchived(access.supabase, id.data, archived)
  } catch (err) {
    return { error: message(err) }
  }
  refresh(context)
  return { error: null }
}

export async function moveFront(context: StageContext, frontId: string, stageId: string): Promise<StageActionResult> {
  const parsed = z.object({ frontId: z.uuid(), stageId: z.uuid() }).safeParse({ frontId, stageId })
  if (!parsed.success) return { error: 'Frente ou etapa inválida.' }
  const access = await writer(context)
  if ('error' in access) return { error: access.error! }
  try {
    await moveFrontToStage(access.supabase, parsed.data.frontId, parsed.data.stageId)
  } catch (err) {
    return { error: message(err) }
  }
  refresh(context)
  return { error: null }
}

const comboSchema = z
  .object({
    name: z.string().trim().min(1, 'dê um nome para o custo combinado').max(80),
    enabled: z.boolean(),
    stageIds: z.array(z.uuid()).min(1, 'escolha ao menos uma etapa para somar').max(40),
    over: z.enum(['receita', 'stage']),
    overStageId: z.uuid().nullable(),
    meta: z.string(),
  })
  .transform((value, ctx) => {
    const meta = metaFromInput('lead', value.meta)
    if (meta !== null && !(meta > 0)) ctx.addIssue({ code: 'custom', message: 'a meta é um número maior que zero' })
    if (value.over === 'stage' && !value.overStageId) ctx.addIssue({ code: 'custom', message: 'escolha a etapa que divide o gasto' })
    return { ...value, overStageId: value.over === 'stage' ? value.overStageId : null, meta }
  })

export type ComboFields = z.input<typeof comboSchema>

export async function saveCombo(context: StageContext, comboId: string | null, input: ComboFields, position: number): Promise<StageActionResult> {
  const parsed = comboSchema.safeParse(input)
  if (!parsed.success) return { error: issues(parsed.error) }
  if (comboId !== null && !z.uuid().safeParse(comboId).success) return { error: 'Custo combinado inválido.' }
  const access = await writer(context)
  if ('error' in access) return { error: access.error! }
  try {
    if (comboId) await updateCostCombo(access.supabase, comboId, parsed.data)
    else await createCostCombo(access.supabase, context.sales_funnel_id, { ...parsed.data, position })
  } catch (err) {
    return { error: message(err) }
  }
  refresh(context)
  return { error: null }
}

export async function removeCombo(context: StageContext, comboId: string): Promise<StageActionResult> {
  if (!z.uuid().safeParse(comboId).success) return { error: 'Custo combinado inválido.' }
  const access = await writer(context)
  if ('error' in access) return { error: access.error! }
  try {
    await deleteCostCombo(access.supabase, comboId)
  } catch (err) {
    return { error: message(err) }
  }
  refresh(context)
  return { error: null }
}

/**
 * A client with no list of its own reads the built-in defaults: its first change writes them as its
 * own list first, so saving one stage or removing one default keeps the rest of the palette.
 */
async function ownPresets(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, clientId: string): Promise<void> {
  const { count, error } = await supabase.from('client_stage_presets').select('id', { count: 'exact', head: true }).eq('client_id', clientId)
  if (error) throw error
  if (count) return
  for (const preset of DEFAULT_STAGE_PRESETS) await createStagePreset(supabase, clientId, preset)
}

export async function savePreset(
  context: StageContext,
  input: { name: string; tag: string | null; measure: StageMeasure; parallel: boolean }
): Promise<StageActionResult> {
  const parsed = z.object({ name, tag: z.string().nullable(), measure, parallel: z.boolean() }).safeParse(input)
  if (!parsed.success) return { error: issues(parsed.error) }
  const access = await writer(context)
  if ('error' in access) return { error: access.error! }
  try {
    await ownPresets(access.supabase, context.client_id)
    const { count } = await access.supabase.from('client_stage_presets').select('id', { count: 'exact', head: true }).eq('client_id', context.client_id)
    await createStagePreset(access.supabase, context.client_id, { ...parsed.data, position: count ?? 0 })
  } catch (err) {
    return { error: message(err) }
  }
  refresh(context)
  return { error: null }
}

/** presetId null removes a built-in default (by its name) after the defaults become the client's list. */
export async function removePreset(context: StageContext, presetId: string | null, presetName: string): Promise<StageActionResult> {
  if (presetId !== null && !z.uuid().safeParse(presetId).success) return { error: 'Etapa pronta inválida.' }
  const access = await writer(context)
  if ('error' in access) return { error: access.error! }
  try {
    let id = presetId
    if (!id) {
      await ownPresets(access.supabase, context.client_id)
      const { data, error } = await access.supabase.from('client_stage_presets').select('id').eq('client_id', context.client_id).eq('name', presetName).limit(1).maybeSingle()
      if (error) throw error
      id = data?.id ?? null
    }
    if (id) await deleteStagePreset(access.supabase, id)
  } catch (err) {
    return { error: message(err) }
  }
  refresh(context)
  return { error: null }
}
