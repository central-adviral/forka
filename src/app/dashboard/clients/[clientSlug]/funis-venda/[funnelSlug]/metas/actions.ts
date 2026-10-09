'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { archivedProjectError } from '@/lib/repo/project-archive-repo'
import { getFunnelStages, updateCostCombo, updateStage } from '@/lib/repo/funnel-stages-repo'
import { ensureResultWatchers } from '@/lib/repo/result-meta-repo'
import { PROJECT_RESULTS, type ProjectResult } from '@/lib/domain/project-plan'
import { metaFromInput } from '@/lib/domain/stage-canvas'
import { resultStage, watcherCostMeasure } from '@/lib/domain/targets'
import type { StageMeasure } from '@/lib/domain/funnel-stages'
import { back, type MetasContext } from './metas-path'

// Metas e vigias of one funnel (0106). Writes run on the user's session: the policies only let a
// gestor or owner change funnels, stages, fronts and watchers, and every write selects what it
// changed so a refused one is reported. An archived funnel is read-only.

const refused = 'Só gestor ou owner pode mudar as metas do funil.'

async function writer(context: MetasContext) {
  const supabase = await createServerSupabaseClient()
  const archived = await archivedProjectError(supabase, context.sales_funnel_id)
  if (archived) back(context, 'erro', archived)
  return supabase
}

function done(context: MetasContext, message: string): never {
  // Hoje, the Resumo, the canvas, the Quadro and Alertas read these metas too.
  revalidatePath(`/dashboard/clients/${context.client_slug}`, 'layout')
  back(context, 'ok', message)
}

const optionalNumber = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : Number(value.replace(/\./g, '').replace(',', '.'))))
  .refine((value) => value === null || (Number.isFinite(value) && value >= 0), 'use um número')
const results = ['compra', 'lead', 'roas', 'checkout', 'visita', 'alcance'] as const

const resultSchema = z
  .object({
    resultado: z.enum(results),
    cost_target: optionalNumber.refine((value) => value === null || value > 0, 'a meta precisa ser maior que zero'),
    min_spend: optionalNumber,
    daily_target: optionalNumber.refine((value) => value === null || (Number.isInteger(value) && value > 0), 'o volume por dia é um número inteiro maior que zero'),
    metrica_secundaria: z.union([z.literal(''), z.enum(results)]).transform((value) => value || null),
    secondary_target: optionalNumber.refine((value) => value === null || value > 0, 'a meta da secundária precisa ser maior que zero'),
  })
  .refine((value) => value.metrica_secundaria !== value.resultado, 'a métrica secundária precisa ser diferente da principal')

/**
 * Resultado do funil. Its meta is the meta of the funnel's first stage of that measure: the value
 * goes on the stage and the result watcher follows it, so the canvas, Hoje and the alerts read one
 * number. A result no stage carries (checkout, or a measure with no stage yet) keeps its meta on
 * the watcher, specific.
 */
export async function saveResult(context: MetasContext, formData: FormData) {
  const text = (name: string) => String(formData.get(name) ?? '')
  const parsed = resultSchema.safeParse({
    resultado: formData.get('resultado'),
    cost_target: text('cost_target'),
    min_spend: text('min_spend'),
    daily_target: text('daily_target'),
    metrica_secundaria: text('metrica_secundaria'),
    secondary_target: text('secondary_target'),
  })
  if (!parsed.success) back(context, 'erro', parsed.error.issues.map((issue) => issue.message).join('; '))
  const plan = parsed.data
  const supabase = await writer(context)

  const { data: saved, error } = await supabase
    .from('sales_funnels')
    .update({ resultado: plan.resultado, daily_sales_target: plan.daily_target, metrica_secundaria: plan.metrica_secundaria, updated_at: new Date().toISOString() })
    .eq('id', context.sales_funnel_id)
    .select('id')
  if (error || !saved?.length) back(context, 'erro', error?.message ?? refused)

  const stages = await getFunnelStages(supabase, context.sales_funnel_id)
  const roles = [
    { role: 'principal' as const, result: plan.resultado as ProjectResult, target: plan.cost_target },
    { role: 'secundaria' as const, result: plan.metrica_secundaria as ProjectResult | null, target: plan.secondary_target },
  ]
  for (const { role, result, target } of roles) {
    const { data: existing, error: readError } = await supabase
      .from('watchers')
      .select('id')
      .eq('sales_funnel_id', context.sales_funnel_id)
      .is('front_id', null)
      .eq('plan_role', role)
      .maybeSingle()
    if (readError) back(context, 'erro', readError.message)
    if (!result) {
      if (existing) await supabase.from('watchers').delete().eq('id', existing.id)
      continue
    }
    const metric = PROJECT_RESULTS[result].costMetric
    const stage = resultStage(stages, watcherCostMeasure(metric))
    if (stage) {
      try {
        await updateStage(supabase, stage.id, metric === 'roas' ? { metaRoas: target } : { meta: target })
      } catch (err) {
        back(context, 'erro', err instanceof Error ? err.message : String(err))
      }
    }
    // Blank: no result watcher, as before. Else it follows the stage (target null) or, with no stage, has its own.
    if (target === null) {
      if (existing) await supabase.from('watchers').delete().eq('id', existing.id)
      continue
    }
    const values = {
      metric,
      target: stage ? null : target,
      is_active: true,
      ...(role === 'principal' ? { min_spend: plan.min_spend ?? 0 } : {}),
      last_value: null,
      last_status: null,
    }
    const { error: watcherError } = existing
      ? await supabase.from('watchers').update(values).eq('id', existing.id)
      : await supabase.from('watchers').insert({ client_id: context.client_id, sales_funnel_id: context.sales_funnel_id, plan_role: role, is_plan: role === 'principal', ...values })
    if (watcherError) back(context, 'erro', watcherError.message)
  }
  done(context, 'Resultado e meta salvos. A meta vale na etapa e em tudo que segue a etapa.')
}

/** A stage's meta (and ROAS for compra), from the "metas por etapa" list. Same write as the canvas drawer. */
export async function saveStageMeta(context: MetasContext & { stage_id: string; measure: StageMeasure }, formData: FormData) {
  const meta = metaFromInput(context.measure, String(formData.get('meta') ?? ''))
  const metaRoas = context.measure === 'compra' ? metaFromInput('lead', String(formData.get('meta_roas') ?? '')) : null
  if ((meta !== null && !(meta > 0)) || (metaRoas !== null && !(metaRoas > 0))) back(context, 'erro', 'A meta é um número maior que zero.')
  const supabase = await writer(context)
  try {
    await updateStage(supabase, context.stage_id, context.measure === 'compra' ? { meta, metaRoas } : { meta })
    await ensureResultWatchers(supabase, context.client_id, context.sales_funnel_id)
  } catch (err) {
    back(context, 'erro', err instanceof Error ? err.message : String(err))
  }
  done(context, 'Meta da etapa salva. Testes que já rodam seguem com o teto com que começaram.')
}

const frontMetaSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('segue') }),
  z.object({ mode: z.literal('especifica'), alvo: optionalNumber.refine((value) => value !== null && value > 0, 'a meta específica da frente precisa ser maior que zero') }),
])

/**
 * A front follows its stage (no meta of its own) or has its own meta, in its metric or else the
 * stage's cost, which gives it its own watcher (0102). Its secondary metric is left as it is.
 */
export async function saveFrontMeta(context: MetasContext & { front_id: string; metric: ProjectResult }, formData: FormData) {
  const parsed = frontMetaSchema.safeParse({ mode: formData.get('mode'), alvo: String(formData.get('alvo') ?? '') })
  if (!parsed.success) back(context, 'erro', parsed.error.issues.map((issue) => issue.message).join('; '))
  const supabase = await writer(context)
  const values = parsed.data.mode === 'segue' ? { alvo_principal: null } : { metrica_principal: context.metric, alvo_principal: parsed.data.alvo }
  const { data, error } = await supabase.from('project_fronts').update(values).eq('id', context.front_id).select('id')
  if (error || !data?.length) back(context, 'erro', error?.message ?? refused)
  done(context, parsed.data.mode === 'segue' ? 'A frente segue a meta da etapa.' : 'A frente tem meta específica e um vigia próprio.')
}

const bandSchema = z
  .object({ warn_pct: optionalNumber, crit_pct: optionalNumber })
  .refine((value) => value.warn_pct !== null && value.crit_pct !== null, 'preencha atenção e crítico')
  .refine((value) => (value.crit_pct ?? 0) >= (value.warn_pct ?? 0), 'o crítico precisa ser maior ou igual à atenção')

/** Faixa padrão: the band every watcher of the funnel without one of its own judges with. */
export async function saveBand(context: MetasContext, formData: FormData) {
  const parsed = bandSchema.safeParse({ warn_pct: String(formData.get('warn_pct') ?? ''), crit_pct: String(formData.get('crit_pct') ?? '') })
  if (!parsed.success) back(context, 'erro', parsed.error.issues.map((issue) => issue.message).join('; '))
  const supabase = await writer(context)
  const { data, error } = await supabase
    .from('sales_funnels')
    .update({ warn_pct: parsed.data.warn_pct, crit_pct: parsed.data.crit_pct })
    .eq('id', context.sales_funnel_id)
    .select('id')
  if (error || !data?.length) back(context, 'erro', error?.message ?? refused)
  done(context, 'Faixa padrão salva. Vale nos vigias que seguem o funil a partir da próxima avaliação.')
}

export async function saveComboMeta(context: MetasContext & { combo_id: string }, formData: FormData) {
  const meta = metaFromInput('lead', String(formData.get('meta') ?? ''))
  if (meta !== null && !(meta > 0)) back(context, 'erro', 'A meta é um número maior que zero.')
  const supabase = await writer(context)
  try {
    await updateCostCombo(supabase, context.combo_id, { meta })
  } catch (err) {
    back(context, 'erro', err instanceof Error ? err.message : String(err))
  }
  done(context, 'Meta do custo combinado salva.')
}
