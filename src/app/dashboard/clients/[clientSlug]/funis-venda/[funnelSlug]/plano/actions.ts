'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { archivedProjectError } from '@/lib/repo/project-archive-repo'
import { PROJECT_RESULTS } from '@/lib/domain/project-plan'

// Writes run on the user's session: the policies of sales_funnels and watchers only let a gestor
// or owner change them, and every write selects what it changed so a refused one is reported.

interface PlanContext {
  client_id: string
  client_slug: string
  funnel_slug: string
  sales_funnel_id: string
}

function back(context: PlanContext, param: 'ok' | 'erro', message: string): never {
  redirect(`/dashboard/clients/${context.client_slug}/funis-venda/${context.funnel_slug}/plano?${param}=${encodeURIComponent(message)}`)
}

const optionalNumber = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : Number(value.replace(/\./g, '').replace(',', '.'))))
  .refine((value) => value === null || (Number.isFinite(value) && value >= 0), 'use um número')

const planSchema = z
  .object({
    resultado: z.enum(['compra', 'lead', 'roas', 'checkout', 'visita', 'alcance']),
    cost_target: optionalNumber.refine((value) => value === null || value > 0, 'o custo-alvo precisa ser maior que zero'),
    warn_pct: optionalNumber,
    crit_pct: optionalNumber,
    min_spend: optionalNumber,
    daily_target: optionalNumber.refine((value) => value === null || (Number.isInteger(value) && value > 0), 'o volume por dia é um número inteiro maior que zero'),
    metrica_secundaria: z.union([z.literal(''), z.enum(['compra', 'lead', 'roas', 'checkout', 'visita', 'alcance'])]).transform((value) => value || null),
    secondary_target: optionalNumber.refine((value) => value === null || value > 0, 'o alvo da secundária precisa ser maior que zero'),
  })
  .refine((value) => (value.crit_pct ?? 40) >= (value.warn_pct ?? 20), 'o crítico precisa ser maior ou igual à atenção')
  .refine((value) => value.metrica_secundaria !== value.resultado, 'a métrica secundária precisa ser diferente da principal')

export async function savePlan(context: PlanContext, formData: FormData) {
  const parsed = planSchema.safeParse({
    resultado: formData.get('resultado'),
    cost_target: String(formData.get('cost_target') ?? ''),
    warn_pct: String(formData.get('warn_pct') ?? ''),
    crit_pct: String(formData.get('crit_pct') ?? ''),
    min_spend: String(formData.get('min_spend') ?? ''),
    daily_target: String(formData.get('daily_target') ?? ''),
    metrica_secundaria: String(formData.get('metrica_secundaria') ?? ''),
    secondary_target: String(formData.get('secondary_target') ?? ''),
  })
  if (!parsed.success) back(context, 'erro', parsed.error.issues.map((issue) => issue.message).join('; '))
  const plan = parsed.data
  const costMetric = PROJECT_RESULTS[plan.resultado].costMetric
  const supabase = await createServerSupabaseClient()
  const archived = await archivedProjectError(supabase, context.sales_funnel_id)
  if (archived) back(context, 'erro', archived)

  const { data: saved, error } = await supabase
    .from('sales_funnels')
    .update({
      resultado: plan.resultado,
      daily_sales_target: plan.daily_target,
      metrica_secundaria: plan.metrica_secundaria,
      updated_at: new Date().toISOString(),
    })
    .eq('id', context.sales_funnel_id)
    .select('id')
  if (error || !saved?.length) back(context, 'erro', error?.message ?? 'Só gestor ou owner pode mudar o plano do projeto.')

  // One project-wide cost watcher: the plan's cost target is that watcher, so the Painel and the
  // Hoje queue judge the same number the plan shows.
  const { data: existing, error: watchersError } = await supabase
    .from('watchers')
    .select('id, metric')
    .eq('sales_funnel_id', context.sales_funnel_id)
    .eq('is_plan', true)
  if (watchersError) back(context, 'erro', watchersError.message)
  const [keep, ...extra] = existing ?? []
  if (extra.length > 0) {
    const { error: extraError } = await supabase.from('watchers').delete().in('id', extra.map((watcher) => watcher.id))
    if (extraError) back(context, 'erro', extraError.message)
  }
  if (plan.cost_target === null) {
    if (keep) {
      const { error: deleteError } = await supabase.from('watchers').delete().eq('id', keep.id)
      if (deleteError) back(context, 'erro', deleteError.message)
    }
  } else {
    const values = {
      metric: costMetric,
      target: plan.cost_target,
      warn_pct: plan.warn_pct ?? 20,
      crit_pct: plan.crit_pct ?? 40,
      min_spend: plan.min_spend ?? 0,
      is_active: true,
    }
    const { error: watcherError } = keep
      ? await supabase.from('watchers').update(values).eq('id', keep.id)
      : await supabase.from('watchers').insert({ client_id: context.client_id, sales_funnel_id: context.sales_funnel_id, is_plan: true, ...values })
    if (watcherError) back(context, 'erro', watcherError.message)
  }

  // The secondary metric (0102): a second project-wide watcher, marked by its role.
  const { data: secondary, error: secondaryError } = await supabase
    .from('watchers')
    .select('id')
    .eq('sales_funnel_id', context.sales_funnel_id)
    .is('front_id', null)
    .eq('plan_role', 'secundaria')
    .maybeSingle()
  if (secondaryError) back(context, 'erro', secondaryError.message)
  if (plan.metrica_secundaria === null || plan.secondary_target === null) {
    if (secondary) {
      const { error: deleteError } = await supabase.from('watchers').delete().eq('id', secondary.id)
      if (deleteError) back(context, 'erro', deleteError.message)
    }
  } else {
    const values = { metric: PROJECT_RESULTS[plan.metrica_secundaria].costMetric, target: plan.secondary_target, is_active: true }
    const { error: watcherError } = secondary
      ? await supabase.from('watchers').update(values).eq('id', secondary.id)
      : await supabase.from('watchers').insert({ client_id: context.client_id, sales_funnel_id: context.sales_funnel_id, plan_role: 'secundaria', ...values })
    if (watcherError) back(context, 'erro', watcherError.message)
  }

  revalidatePath(`/dashboard/clients/${context.client_slug}`, 'layout')
  back(context, 'ok', 'Plano salvo.')
}
