'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { archivedProjectError } from '@/lib/repo/project-archive-repo'
import { getFunnelStages, updateCostCombo, updateStage } from '@/lib/repo/funnel-stages-repo'
import { PROJECT_RESULTS, readResult, type ProjectResult } from '@/lib/domain/project-plan'
import { metaFromInput } from '@/lib/domain/stage-canvas'
import { resultStage, stageMetaFor, watcherCostMeasure } from '@/lib/domain/targets'
import { funnelResultStage } from '@/lib/domain/funnel-stages'
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

const resultSchema = z.object({
  // Only between the costs of a compra result stage: the stage itself is the canvas's (0107).
  julgar: z.union([z.literal(''), z.enum(['compra', 'roas', 'checkout'])]).transform((value) => value || null),
  cost_target: optionalNumber.refine((value) => value === null || value > 0, 'a meta precisa ser maior que zero'),
  min_spend: optionalNumber,
  daily_target: optionalNumber.refine((value) => value === null || (Number.isInteger(value) && value > 0), 'o volume por dia é um número inteiro maior que zero'),
  metrica_secundaria: z.union([z.literal(''), z.enum(results)]).transform((value) => value || null),
  secondary_target: optionalNumber.refine((value) => value === null || value > 0, 'a meta da secundária precisa ser maior que zero'),
})

/**
 * Resultado do funil (0107): the result is the funnel's last sequence stage and its meta is that
 * stage's, edited on the canvas. Here: CPA, ROAS or checkout when that stage is compra, the volume
 * per day, the secondary metric and the minimum spend. A result no stage carries (checkout) keeps
 * its meta on the result watcher, specific.
 */
export async function saveResult(context: MetasContext, formData: FormData) {
  const text = (name: string) => String(formData.get(name) ?? '')
  const parsed = resultSchema.safeParse({
    julgar: text('julgar'),
    cost_target: text('cost_target'),
    min_spend: text('min_spend'),
    daily_target: text('daily_target'),
    metrica_secundaria: text('metrica_secundaria'),
    secondary_target: text('secondary_target'),
  })
  if (!parsed.success) back(context, 'erro', parsed.error.issues.map((issue) => issue.message).join('; '))
  const plan = parsed.data
  const supabase = await writer(context)

  const [{ data: funnel, error: funnelError }, stages] = await Promise.all([
    supabase.from('sales_funnels').select('resultado').eq('id', context.sales_funnel_id).maybeSingle(),
    getFunnelStages(supabase, context.sales_funnel_id),
  ])
  if (funnelError || !funnel) back(context, 'erro', funnelError?.message ?? refused)
  const resultado: ProjectResult = plan.julgar && funnelResultStage(stages)?.measure === 'compra' ? plan.julgar : readResult(funnel.resultado)
  if (plan.metrica_secundaria === resultado) back(context, 'erro', 'a métrica secundária precisa ser diferente da principal')

  const { data: saved, error } = await supabase
    .from('sales_funnels')
    .update({ resultado, daily_sales_target: plan.daily_target, metrica_secundaria: plan.metrica_secundaria, updated_at: new Date().toISOString() })
    .eq('id', context.sales_funnel_id)
    .select('id')
  if (error || !saved?.length) back(context, 'erro', error?.message ?? refused)

  const roles = [
    { role: 'principal' as const, result: resultado as ProjectResult | null },
    { role: 'secundaria' as const, result: plan.metrica_secundaria as ProjectResult | null },
  ]
  for (const { role, result } of roles) {
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
    // The principal's meta is its stage's; the secondary's is typed here, on its stage when one carries it.
    const target = role === 'principal' ? (stage ? stageMetaFor(stage, metric) : plan.cost_target) : plan.secondary_target
    if (role === 'secundaria' && stage) {
      try {
        await updateStage(supabase, stage.id, metric === 'roas' ? { metaRoas: target } : { meta: target })
      } catch (err) {
        back(context, 'erro', err instanceof Error ? err.message : String(err))
      }
    }
    // No meta: no watcher, as before. Else it follows the stage (target null) or, with no stage, has its own.
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
  done(context, 'Resultado salvo. A meta do resultado é a da etapa, no canvas.')
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
