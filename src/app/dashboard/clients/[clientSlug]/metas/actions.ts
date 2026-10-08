'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { assertClientRole } from '@/lib/repo/client-access-repo'
import type { SupabaseClient } from '@supabase/supabase-js'
import { METRICS, watcherSource, type WatcherMetric } from '@/lib/domain/watchers'
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

const numbersShape = {
  target: decimal.pipe(z.number().positive('a meta precisa ser maior que zero')),
  warn_pct: decimal.pipe(z.number().min(0)),
  crit_pct: decimal.pipe(z.number().min(0)),
  min_spend: decimal.pipe(z.number().min(0)),
}
const scopeShape = {
  scope: z.string().regex(/^[0-9a-f-]{36}\|([0-9a-f-]{36})?$/, 'escolha o funil ou a frente'),
  metric: z.enum(Object.keys(METRICS) as [WatcherMetric, ...WatcherMetric[]]),
}
const critAboveWarn = (value: { warn_pct: number; crit_pct: number }) => value.crit_pct >= value.warn_pct
const critMessage = 'o crítico precisa ser maior ou igual à atenção'
const watcherSchema = z.object({ ...scopeShape, ...numbersShape }).refine(critAboveWarn, critMessage)
const numbersSchema = z.object(numbersShape).refine(critAboveWarn, critMessage)
const scopeSchema = z.object(scopeShape)

function readNumbers(formData: FormData) {
  return {
    target: formData.get('target') ?? '',
    warn_pct: formData.get('warn_pct') || '20',
    crit_pct: formData.get('crit_pct') || '40',
    min_spend: formData.get('min_spend') || '0',
  }
}

function issues(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join('; ')
}

// A watcher of an archived project or front is not evaluated (0100), so it is read-only.
async function archivedScopeError(supabase: SupabaseClient, funnelId: string, frontId: string | null): Promise<string | null> {
  const { data: funnel } = await supabase.from('sales_funnels').select('archived_at').eq('id', funnelId).maybeSingle()
  if (funnel?.archived_at) return 'Funil arquivado: restaure o funil para mexer nos vigias dele.'
  if (!frontId) return null
  const { data: front } = await supabase.from('project_fronts').select('archived_at').eq('id', frontId).maybeSingle()
  return front?.archived_at ? 'Frente arquivada: restaure a frente para mexer nos vigias dela.' : null
}

// The rules of 0086 and 0071, checked before the database refuses with a less useful message.
async function scopeError(supabase: SupabaseClient, scope: string, metric: WatcherMetric): Promise<string | null> {
  const [funnelId, frontId] = scope.split('|')
  if (frontId && METRICS[metric].projectOnly) return `${METRICS[metric].label} vale para todas as frentes do funil: as vendas não são de uma frente.`
  const archived = await archivedScopeError(supabase, funnelId, frontId || null)
  if (archived) return archived
  if (METRICS[metric].salesOnly) {
    const { data: funnel } = await supabase.from('sales_funnels').select('resultado').eq('id', funnelId).maybeSingle()
    if (!resultUsesSales(funnel?.resultado)) return `${METRICS[metric].label} precisa de vendas, e o objetivo deste funil não conta vendas.`
  }
  return null
}

export async function createWatcher(context: MetasContext, formData: FormData) {
  const result = watcherSchema.safeParse({ scope: formData.get('scope'), metric: formData.get('metric'), ...readNumbers(formData) })
  if (!result.success) back(context, 'erro', issues(result.error))
  const supabase = await createServerSupabaseClient()
  const refused = await scopeError(supabase, result.data.scope, result.data.metric)
  if (refused) back(context, 'erro', refused)
  const [funnelId, frontId] = result.data.scope.split('|')
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

const editRefused = 'Só gestor ou owner pode editar vigias.'

// A watcher of the Plano or of a front's metrics keeps that metric: the source names it. Its target
// is edited here all the same, in the place that owns it: the plan watcher row is what the Plano
// reads, while a front's target lives on the front and the 0102 trigger copies it to the watcher.
export async function updateWatcher(context: MetasContext & { watcher_id: string }, formData: FormData) {
  const numbers = numbersSchema.safeParse(readNumbers(formData))
  if (!numbers.success) back(context, 'erro', issues(numbers.error))
  const supabase = await createServerSupabaseClient()
  const { data: watcher } = await supabase.from('watchers').select('id, sales_funnel_id, front_id, plan_role').eq('id', context.watcher_id).maybeSingle()
  if (!watcher) back(context, 'erro', 'Vigia não encontrado.')
  const archived = await archivedScopeError(supabase, watcher.sales_funnel_id, watcher.front_id)
  if (archived) back(context, 'erro', archived)
  const { target, warn_pct, crit_pct, min_spend } = numbers.data
  // The last verdict was against the old band; it is cleared and judged again below.
  const values: Record<string, unknown> = { warn_pct, crit_pct, min_spend, last_value: null, last_status: null }
  const source = watcherSource({ planRole: watcher.plan_role, frontId: watcher.front_id })

  if (source === 'livre') {
    const scoped = scopeSchema.safeParse({ scope: formData.get('scope'), metric: formData.get('metric') })
    if (!scoped.success) back(context, 'erro', issues(scoped.error))
    const refused = await scopeError(supabase, scoped.data.scope, scoped.data.metric)
    if (refused) back(context, 'erro', refused)
    const [funnelId, frontId] = scoped.data.scope.split('|')
    Object.assign(values, { sales_funnel_id: funnelId, front_id: frontId || null, metric: scoped.data.metric, target })
  } else if (source === 'plano') {
    values.target = target
  } else {
    const column = watcher.plan_role === 'principal' ? 'alvo_principal' : 'alvo_secundaria'
    const { data: front, error } = await supabase.from('project_fronts').update({ [column]: target }).eq('id', watcher.front_id).select('id')
    if (error || !front?.length) back(context, 'erro', error && error.code !== '42501' ? error.message : editRefused)
  }

  const { data, error } = await supabase.from('watchers').update(values).eq('id', watcher.id).select('id')
  if (error || !data?.length) back(context, 'erro', error && error.code !== '42501' ? error.message : editRefused)
  const judged = await reevaluate(supabase, context.client_id)
  // The Plano, the project page and the Painel show these targets too.
  revalidatePath(`/dashboard/clients/${context.client_slug}`, 'layout')
  back(context, 'ok', judged ? 'Vigia salvo e reavaliado no último dia fechado.' : 'Vigia salvo. Ele é reavaliado na próxima sincronização.')
}

// The evaluation writes alerts, which only the service role may do; the role is checked first.
async function reevaluate(supabase: SupabaseClient, clientId: string): Promise<boolean> {
  await assertClientRole(supabase, clientId, 'gestor')
  const { error } = await createServiceRoleClient().rpc('evaluate_watchers', { p_client_id: clientId })
  return !error
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
