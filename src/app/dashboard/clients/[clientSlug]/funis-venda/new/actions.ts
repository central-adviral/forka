'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { canActAs } from '@/lib/view-as'
import { readResult } from '@/lib/domain/project-plan'
import { STAGE_MEASURES, type StageMeasure } from '@/lib/domain/funnel-stages'
import { firstFrontCode, orderPlanned, plannedStagesIssues, resultadoOf, uniqueSlug, type PlannedStage } from '@/lib/domain/new-funnel'
import { copyStages, createStages, getFunnelStages } from '@/lib/repo/funnel-stages-repo'

// "Novo funil" in one screen (0107). Writes run on the user's session: the policies of sales_funnels,
// funnel_stages, project_fronts, naming_rules, watchers and project_products only let a gestor or
// owner of the client write them. A funnel that fails halfway is removed: it has no history yet.

export interface NewFunnelState {
  error: string | null
}

const tag = (max: number) =>
  z
    .string()
    .max(max, `a etiqueta tem até ${max} letras`)
    .transform((value) => value.toUpperCase().replace(/\s+/g, '') || null)

const plannedStage = z.object({
  name: z.string().trim().max(60, 'o nome da etapa tem até 60 letras'),
  tag: tag(24),
  measure: z.enum(STAGE_MEASURES as [StageMeasure, ...StageMeasure[]]),
  parallel: z.boolean(),
})

// The stage list as the form edited it, in a hidden field: the stages to create, in the order shown.
const stageList = z
  .string()
  .transform((value, ctx) => {
    try {
      return JSON.parse(value || '[]') as unknown
    } catch {
      ctx.addIssue({ code: 'custom', message: 'lista de etapas inválida' })
      return z.NEVER
    }
  })
  .pipe(z.array(plannedStage))

const newFunnelSchema = z
  .object({
    name: z.string().trim().min(1, 'dê um nome para o funil').max(80, 'o nome tem até 80 letras'),
    tag: tag(24),
    stages: stageList,
    duplicate_from: z.union([z.literal(''), z.uuid()]).transform((value) => value || null),
  })
  .superRefine((value, ctx) => {
    // A duplicate copies the real stages of its source; the list is only read for a funnel built here.
    if (value.duplicate_from) return
    for (const message of plannedStagesIssues(value.stages)) ctx.addIssue({ code: 'custom', message })
  })

export async function createFunnel(context: { client_id: string; client_slug: string }, _previous: NewFunnelState, formData: FormData): Promise<NewFunnelState> {
  const parsed = newFunnelSchema.safeParse({
    name: formData.get('name') ?? '',
    tag: formData.get('tag') ?? '',
    stages: formData.get('stages') ?? '',
    duplicate_from: formData.get('duplicate_from') ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues.map((issue) => issue.message).join('; ') }
  const input = parsed.data
  const supabase = await createServerSupabaseClient()
  if (!(await canActAs(supabase, context.client_id, 'gestor'))) return { error: 'Só gestor ou owner cria funis.' }

  const { data: taken, error: takenError } = await supabase.from('sales_funnels').select('slug').eq('client_id', context.client_id)
  if (takenError) return { error: takenError.message }
  const slug = uniqueSlug(input.name, (taken ?? []).map((row) => row.slug as string))

  const source = input.duplicate_from ? await readSource(supabase, context.client_id, input.duplicate_from) : null
  if (input.duplicate_from && !source) return { error: 'Funil de origem não encontrado.' }
  const planned = source ? null : orderPlanned(input.stages)

  // Born with the resultado its stages give, so its history starts right (0104, 0107).
  const { data: funnel, error } = await supabase
    .from('sales_funnels')
    .insert({
      client_id: context.client_id,
      name: input.name,
      slug,
      tag: input.tag,
      status: 'rascunho',
      resultado: source ? source.resultado : resultadoOf(planned!),
      ...(source ? source.plan : {}),
    })
    .select('id')
    .single()
  if (error) return { error: error.code === '23505' ? `Outro funil deste cliente já usa a etiqueta ${input.tag ?? ''}.` : error.message }

  let failure: string | null
  try {
    failure = source ? await fillFromSource(supabase, source.id, funnel.id) : await fillFromModel(supabase, funnel.id, planned!)
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err)
  }
  if (failure) {
    await supabase.from('sales_funnels').delete().eq('id', funnel.id)
    return { error: failure }
  }
  revalidatePath('/dashboard', 'layout')
  redirect(`/dashboard/clients/${context.client_slug}/funis-venda/${slug}/regras`)
}

async function readSource(supabase: SupabaseClient, clientId: string, sourceId: string) {
  const { data, error } = await supabase
    .from('sales_funnels')
    .select('id, resultado, metrica_secundaria, daily_sales_target, warn_pct, crit_pct, test_rules, modelo')
    .eq('id', sourceId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    id: data.id as string,
    resultado: readResult(data.resultado),
    plan: {
      metrica_secundaria: data.metrica_secundaria,
      daily_sales_target: data.daily_sales_target,
      warn_pct: data.warn_pct,
      crit_pct: data.crit_pct,
      test_rules: data.test_rules,
      modelo: data.modelo,
    },
  }
}

/** The edited stages in one insert, each with one front of its own to receive the campaign tags. */
async function fillFromModel(supabase: SupabaseClient, funnelId: string, planned: PlannedStage[]): Promise<string | null> {
  const stages = await createStages(
    supabase,
    funnelId,
    planned.map((stage) => ({ ...stage, janelaInicio: null, janelaFim: null, meta: null, metaRoas: null }))
  )
  const codes: string[] = []
  const fronts = stages.map((stage, position) => {
    const code = firstFrontCode(stage, codes)
    codes.push(code)
    return { sales_funnel_id: funnelId, stage_id: stage.id, code, name: stage.name, position }
  })
  const { error } = await supabase.from('project_fronts').insert(fronts)
  return error ? error.message : null
}

/**
 * "Duplicar um funil anterior": its open stages and combos (copyStages), its open fronts with their
 * tags and metas in the same stages, its products and its result watchers. Windows and pages stay
 * with the old funnel: the dates are its own and a page lives in one front.
 */
async function fillFromSource(supabase: SupabaseClient, sourceId: string, funnelId: string): Promise<string | null> {
  const stageByCode = await copyStages(supabase, sourceId, funnelId)
  const [{ data: fronts, error: frontsError }, { data: products, error: productsError }, { data: plan, error: planError }] = await Promise.all([
    supabase
      .from('project_fronts')
      .select('code, name, position, source_sales_funnel_id, metrica_principal, alvo_principal, metrica_secundaria, alvo_secundaria, naming_rules(kind, value)')
      .eq('sales_funnel_id', sourceId)
      .is('archived_at', null)
      .order('position'),
    supabase.from('project_products').select('produto_nome, papel').eq('sales_funnel_id', sourceId),
    supabase.from('watchers').select('metric, target, min_spend, warn_pct, crit_pct, plan_role, is_plan, client_id').eq('sales_funnel_id', sourceId).is('front_id', null).not('plan_role', 'is', null),
  ])
  if (frontsError || productsError || planError) return (frontsError ?? productsError ?? planError)!.message

  const rows = (fronts ?? []) as {
    code: string
    name: string
    position: number
    source_sales_funnel_id: string | null
    metrica_principal: string | null
    alvo_principal: number | null
    metrica_secundaria: string | null
    alvo_secundaria: number | null
    naming_rules: { kind: string; value: string }[]
  }[]
  if (stageByCode.size === 0 && rows.length > 0) return 'O funil de origem não tem etapas abertas.'
  const copyable = rows.filter((front) => stageByCode.has(front.code.toUpperCase()))
  if (copyable.length) {
    // The front's own metas become its watchers through the 0102 trigger.
    const { data: saved, error } = await supabase
      .from('project_fronts')
      .insert(
        copyable.map((front) => ({
          sales_funnel_id: funnelId,
          stage_id: stageByCode.get(front.code.toUpperCase()),
          code: front.code,
          name: front.name,
          position: front.position,
          source_sales_funnel_id: front.source_sales_funnel_id,
          metrica_principal: front.metrica_principal,
          alvo_principal: front.alvo_principal,
          metrica_secundaria: front.metrica_secundaria,
          alvo_secundaria: front.alvo_secundaria,
        }))
      )
      .select('id, code')
    if (error) return error.message
    const idByCode = new Map((saved ?? []).map((row) => [row.code as string, row.id as string]))
    const rules = copyable.flatMap((front) => (front.source_sales_funnel_id ? [] : front.naming_rules.map((rule) => ({ front_id: idByCode.get(front.code), kind: rule.kind, value: rule.value }))))
    if (rules.length) {
      const { error: rulesError } = await supabase.from('naming_rules').insert(rules)
      if (rulesError) return rulesError.message
    }
  }

  if (products?.length) {
    const { error } = await supabase.from('project_products').insert(products.map((product) => ({ ...product, sales_funnel_id: funnelId })))
    if (error) return error.message
  }
  if (plan?.length) {
    const { error } = await supabase.from('watchers').insert(plan.map((watcher) => ({ ...watcher, sales_funnel_id: funnelId })))
    if (error) return error.message
  }
  return (await getFunnelStages(supabase, funnelId)).length ? null : 'O funil de origem não tem etapas abertas.'
}
