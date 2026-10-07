'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { PROJECT_RESULTS } from '@/lib/domain/project-plan'
import { readRules } from '@/lib/domain/backlog'

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
    resultado: z.enum(['compra', 'lead']),
    cost_target: optionalNumber.refine((value) => value === null || value > 0, 'o custo-alvo precisa ser maior que zero'),
    warn_pct: optionalNumber,
    crit_pct: optionalNumber,
    min_spend: optionalNumber,
    daily_target: optionalNumber.refine((value) => value === null || (Number.isInteger(value) && value > 0), 'o volume por dia é um número inteiro maior que zero'),
    teto_from_cost: z.boolean(),
  })
  .refine((value) => (value.crit_pct ?? 40) >= (value.warn_pct ?? 20), 'o crítico precisa ser maior ou igual à atenção')

export async function savePlan(context: PlanContext, formData: FormData) {
  const parsed = planSchema.safeParse({
    resultado: formData.get('resultado'),
    cost_target: String(formData.get('cost_target') ?? ''),
    warn_pct: String(formData.get('warn_pct') ?? ''),
    crit_pct: String(formData.get('crit_pct') ?? ''),
    min_spend: String(formData.get('min_spend') ?? ''),
    daily_target: String(formData.get('daily_target') ?? ''),
    teto_from_cost: formData.get('teto_from_cost') === 'on',
  })
  if (!parsed.success) back(context, 'erro', parsed.error.issues.map((issue) => issue.message).join('; '))
  const plan = parsed.data
  const costMetric = PROJECT_RESULTS[plan.resultado].costMetric
  const supabase = await createServerSupabaseClient()

  const { data: funnel, error: readError } = await supabase.from('sales_funnels').select('test_rules').eq('id', context.sales_funnel_id).maybeSingle()
  if (readError || !funnel) back(context, 'erro', 'Projeto não encontrado.')
  // The test ceiling is a CPA: it follows the cost target only on a purchase project.
  const followsTeto = plan.teto_from_cost && plan.resultado === 'compra' && plan.cost_target !== null
  const { data: saved, error } = await supabase
    .from('sales_funnels')
    .update({
      resultado: plan.resultado,
      daily_sales_target: plan.daily_target,
      ...(followsTeto ? { test_rules: { ...readRules(funnel.test_rules), teto: plan.cost_target } } : {}),
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
    .is('front_id', null)
    .in('metric', ['cpa_geral', 'cpl'])
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
      : await supabase.from('watchers').insert({ client_id: context.client_id, sales_funnel_id: context.sales_funnel_id, ...values })
    if (watcherError) back(context, 'erro', watcherError.message)
  }

  revalidatePath(`/dashboard/clients/${context.client_slug}`, 'layout')
  back(context, 'ok', followsTeto ? 'Plano salvo. O teto dos testes acompanha o CPA-alvo.' : 'Plano salvo.')
}
