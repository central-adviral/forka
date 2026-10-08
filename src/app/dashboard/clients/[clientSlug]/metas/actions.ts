'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { assertClientRole } from '@/lib/repo/client-access-repo'
import { METRICS, type WatcherMetric } from '@/lib/domain/watchers'
import { resultUsesSales } from '@/lib/domain/project-plan'

// Writes run on the user's session: the 0059 policies only let a gestor or owner change watchers.

interface MetasContext {
  client_id: string
  client_slug: string
}

function metasPath(context: MetasContext): string {
  return `/dashboard/clients/${context.client_slug}/metas`
}

function back(context: MetasContext, param: 'ok' | 'erro', message: string): never {
  redirect(`${metasPath(context)}?${param}=${encodeURIComponent(message)}`)
}

const decimal = z.string().trim().transform((value) => Number(value.replace(/\./g, '').replace(',', '.'))).pipe(z.number().finite())

const watcherSchema = z
  .object({
    scope: z.string().regex(/^[0-9a-f-]{36}\|([0-9a-f-]{36})?$/, 'escolha o projeto ou a frente'),
    metric: z.enum(Object.keys(METRICS) as [WatcherMetric, ...WatcherMetric[]]),
    target: decimal.pipe(z.number().positive('o alvo precisa ser maior que zero')),
    warn_pct: decimal.pipe(z.number().min(0)),
    crit_pct: decimal.pipe(z.number().min(0)),
    min_spend: decimal.pipe(z.number().min(0)),
  })
  .refine((value) => value.crit_pct >= value.warn_pct, 'o crítico precisa ser maior ou igual à atenção')

export async function createWatcher(context: MetasContext, formData: FormData) {
  const result = watcherSchema.safeParse({
    scope: formData.get('scope'),
    metric: formData.get('metric'),
    target: formData.get('target') ?? '',
    warn_pct: formData.get('warn_pct') || '20',
    crit_pct: formData.get('crit_pct') || '40',
    min_spend: formData.get('min_spend') || '0',
  })
  if (!result.success) back(context, 'erro', result.error.issues.map((issue) => issue.message).join('; '))
  const [funnelId, frontId] = result.data.scope.split('|')
  if (frontId && METRICS[result.data.metric].projectOnly)
    back(context, 'erro', `${METRICS[result.data.metric].label} vale para todas as frentes do projeto: as vendas não são de uma frente.`)
  const supabase = await createServerSupabaseClient()
  if (METRICS[result.data.metric].salesOnly) {
    const { data: funnel } = await supabase.from('sales_funnels').select('resultado').eq('id', funnelId).maybeSingle()
    if (!resultUsesSales(funnel?.resultado)) back(context, 'erro', `${METRICS[result.data.metric].label} precisa de vendas, e o objetivo deste projeto não conta vendas.`)
  }
  const { error } = await supabase.from('watchers').insert({
    client_id: context.client_id,
    sales_funnel_id: funnelId,
    front_id: frontId || null,
    metric: result.data.metric,
    target: result.data.target,
    warn_pct: result.data.warn_pct,
    crit_pct: result.data.crit_pct,
    min_spend: result.data.min_spend,
  })
  if (error) back(context, 'erro', error.code === '42501' ? 'Só gestor ou owner pode criar vigias.' : error.message)
  revalidatePath(metasPath(context))
  back(context, 'ok', `Vigia de ${METRICS[result.data.metric].label} criado. Ele avalia o último dia fechado a cada sincronização.`)
}

export async function toggleWatcher(context: MetasContext & { watcher_id: string; is_active: boolean }) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.from('watchers').update({ is_active: context.is_active }).eq('id', context.watcher_id).select('id')
  if (error || !data?.length) back(context, 'erro', 'Só gestor ou owner pode pausar vigias.')
  revalidatePath(metasPath(context))
  back(context, 'ok', context.is_active ? 'Vigia ligado.' : 'Vigia pausado.')
}

export async function deleteWatcher(context: MetasContext & { watcher_id: string }) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.from('watchers').delete().eq('id', context.watcher_id).select('id')
  if (error || !data?.length) back(context, 'erro', 'Só gestor ou owner pode remover vigias.')
  revalidatePath(metasPath(context))
  back(context, 'ok', 'Vigia removido, com o histórico de alertas dele.')
}

// The evaluation writes alerts, which only the service role may do; the role is checked first.
export async function evaluateNow(context: MetasContext) {
  const supabase = await createServerSupabaseClient()
  await assertClientRole(supabase, context.client_id, 'gestor')
  const { data, error } = await createServiceRoleClient().rpc('evaluate_watchers', { p_client_id: context.client_id })
  if (error) back(context, 'erro', error.message)
  revalidatePath(metasPath(context))
  revalidatePath(`/dashboard/clients/${context.client_slug}/painel`)
  back(context, 'ok', `${Number(data ?? 0)} vigias avaliados no último dia fechado.`)
}
