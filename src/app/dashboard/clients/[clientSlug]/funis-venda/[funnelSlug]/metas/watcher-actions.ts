'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { assertClientRole } from '@/lib/repo/client-access-repo'
import { getFunnelStages } from '@/lib/repo/funnel-stages-repo'
import { METRICS, watcherSource, type WatcherMetric } from '@/lib/domain/watchers'
import { resultUsesSales, type ProjectResult } from '@/lib/domain/project-plan'
import { effectiveWatcherTarget, type FrontMetas } from '@/lib/domain/targets'
import { back, type MetasContext } from './metas-path'

// The vigias of one funnel (0059, 0106). A watcher looks at the whole funnel, one stage or one front;
// its target and band are its own ("específica") or follow its level and the funnel's faixa padrão.
// Writes run on the user's session: the policies only let a gestor or owner change watchers.

const decimal = z.string().trim().transform((value) => Number(value.replace(/\./g, '').replace(',', '.'))).pipe(z.number().finite())

const numbersSchema = z
  .object({
    target_mode: z.enum(['segue', 'especifica']),
    target: z.string(),
    band_mode: z.enum(['segue', 'propria']),
    warn_pct: z.string(),
    crit_pct: z.string(),
    min_spend: decimal.pipe(z.number().min(0)),
  })
  .transform((value, ctx) => {
    const target = value.target_mode === 'especifica' ? decimal.safeParse(value.target) : null
    if (target && (!target.success || !(target.data > 0))) ctx.addIssue({ code: 'custom', message: 'a meta específica precisa ser maior que zero' })
    const warn = value.band_mode === 'propria' ? decimal.safeParse(value.warn_pct) : null
    const crit = value.band_mode === 'propria' ? decimal.safeParse(value.crit_pct) : null
    if (warn && crit && (!warn.success || !crit.success || warn.data < 0 || crit.data < warn.data)) {
      ctx.addIssue({ code: 'custom', message: 'na faixa própria, o crítico precisa ser maior ou igual à atenção' })
    }
    return {
      target: target?.success ? target.data : null,
      warn_pct: warn?.success ? warn.data : null,
      crit_pct: crit?.success ? crit.data : null,
      min_spend: value.min_spend,
    }
  })

const scopeSchema = z.object({
  scope: z.string().regex(/^(funil|etapa:[0-9a-f-]{36}|frente:[0-9a-f-]{36})$/, 'escolha onde o vigia olha'),
  metric: z.enum(Object.keys(METRICS) as [WatcherMetric, ...WatcherMetric[]]),
})

function readNumbers(formData: FormData) {
  return {
    target_mode: formData.get('target_mode') ?? 'especifica',
    target: String(formData.get('target') ?? ''),
    band_mode: formData.get('band_mode') ?? 'segue',
    warn_pct: String(formData.get('warn_pct') ?? ''),
    crit_pct: String(formData.get('crit_pct') ?? ''),
    min_spend: String(formData.get('min_spend') || '0'),
  }
}

const issues = (error: z.ZodError) => error.issues.map((issue) => issue.message).join('; ')

function readScope(scope: string): { frontId: string | null; stageId: string | null } {
  if (scope.startsWith('frente:')) return { frontId: scope.slice(7), stageId: null }
  if (scope.startsWith('etapa:')) return { frontId: null, stageId: scope.slice(6) }
  return { frontId: null, stageId: null }
}

// The rules of 0071, 0086 and 0106, checked before the database refuses with a less useful message.
async function scopeError(supabase: SupabaseClient, context: MetasContext, level: { frontId: string | null; stageId: string | null }, metric: WatcherMetric): Promise<string | null> {
  if (level.frontId && METRICS[metric].projectOnly) return `${METRICS[metric].label} vale para o funil ou uma etapa: as vendas não são de uma frente.`
  if (level.stageId && metric === 'cpa_anuncio') return 'Numa etapa, use CPA geral: ele conta as vendas da etapa. CPA de anúncio é de uma frente.'
  const { data: funnel } = await supabase.from('sales_funnels').select('resultado, archived_at').eq('id', context.sales_funnel_id).maybeSingle()
  if (funnel?.archived_at) return 'Funil arquivado: restaure o funil para mexer nos vigias dele.'
  if (METRICS[metric].salesOnly && !resultUsesSales(funnel?.resultado)) return `${METRICS[metric].label} precisa de vendas, e o objetivo deste funil não conta vendas.`
  if (level.frontId) {
    const { data: front } = await supabase.from('project_fronts').select('archived_at, sales_funnel_id').eq('id', level.frontId).maybeSingle()
    if (!front || front.sales_funnel_id !== context.sales_funnel_id) return 'Frente não encontrada neste funil.'
    if (front.archived_at) return 'Frente arquivada: restaure a frente para mexer nos vigias dela.'
  }
  if (level.stageId) {
    const { data: stage } = await supabase.from('funnel_stages').select('archived_at, sales_funnel_id').eq('id', level.stageId).maybeSingle()
    if (!stage || stage.sales_funnel_id !== context.sales_funnel_id) return 'Etapa não encontrada neste funil.'
    if (stage.archived_at) return 'Etapa arquivada: restaure a etapa para mexer nos vigias dela.'
  }
  return null
}

/** "Segue" needs something above with a meta for this metric; the screen says what it would follow. */
async function nothingToFollow(supabase: SupabaseClient, context: MetasContext, level: { frontId: string | null; stageId: string | null }, metric: WatcherMetric): Promise<boolean> {
  const [stages, { data: fronts }] = await Promise.all([
    getFunnelStages(supabase, context.sales_funnel_id),
    supabase.from('project_fronts').select('id, stage_id, metrica_principal, alvo_principal, metrica_secundaria, alvo_secundaria').eq('sales_funnel_id', context.sales_funnel_id),
  ])
  const frontMap = new Map<string, FrontMetas>(
    ((fronts ?? []) as { id: string; stage_id: string; metrica_principal: ProjectResult | null; alvo_principal: number | null; metrica_secundaria: ProjectResult | null; alvo_secundaria: number | null }[]).map((front) => [
      front.id,
      {
        stageId: front.stage_id,
        metricaPrincipal: front.metrica_principal,
        alvoPrincipal: front.alvo_principal === null ? null : Number(front.alvo_principal),
        metricaSecundaria: front.metrica_secundaria,
        alvoSecundaria: front.alvo_secundaria === null ? null : Number(front.alvo_secundaria),
      },
    ])
  )
  return effectiveWatcherTarget({ metric, target: null, ...level }, stages, frontMap).value === null
}

const noFollow = 'Não há meta acima para seguir nesta métrica: digite uma meta específica ou defina a meta da etapa.'

export async function createWatcher(context: MetasContext, formData: FormData) {
  const scoped = scopeSchema.safeParse({ scope: formData.get('scope'), metric: formData.get('metric') })
  if (!scoped.success) back(context, 'erro', issues(scoped.error))
  const numbers = numbersSchema.safeParse(readNumbers(formData))
  if (!numbers.success) back(context, 'erro', issues(numbers.error))
  const supabase = await createServerSupabaseClient()
  const level = readScope(scoped.data.scope)
  const refusal = await scopeError(supabase, context, level, scoped.data.metric)
  if (refusal) back(context, 'erro', refusal)
  if (numbers.data.target === null && (await nothingToFollow(supabase, context, level, scoped.data.metric))) back(context, 'erro', noFollow)
  const { error } = await supabase.from('watchers').insert({
    client_id: context.client_id,
    sales_funnel_id: context.sales_funnel_id,
    front_id: level.frontId,
    stage_id: level.stageId,
    metric: scoped.data.metric,
    ...numbers.data,
  })
  if (error) back(context, 'erro', error.code === '42501' ? 'Só gestor ou owner pode criar vigias.' : error.message)
  revalidatePath(`/dashboard/clients/${context.client_slug}`, 'layout')
  back(context, 'ok', `Vigia de ${METRICS[scoped.data.metric].label} criado. Ele avalia o último dia fechado a cada sincronização.`)
}

const editRefused = 'Só gestor ou owner pode editar vigias.'

/**
 * A free watcher changes everything. A result or front watcher keeps its metric and its meta, which
 * live in Resultado do funil and on the front; here only its band and minimum spend change.
 */
export async function updateWatcher(context: MetasContext & { watcher_id: string }, formData: FormData) {
  const numbers = numbersSchema.safeParse(readNumbers(formData))
  if (!numbers.success) back(context, 'erro', issues(numbers.error))
  const supabase = await createServerSupabaseClient()
  const { data: watcher } = await supabase.from('watchers').select('id, metric, front_id, stage_id, plan_role').eq('id', context.watcher_id).eq('sales_funnel_id', context.sales_funnel_id).maybeSingle()
  if (!watcher) back(context, 'erro', 'Vigia não encontrado neste funil.')
  const { warn_pct, crit_pct, min_spend, target } = numbers.data
  // The last verdict was against the old values; it is cleared and judged again below.
  const values: Record<string, unknown> = { warn_pct, crit_pct, min_spend, last_value: null, last_status: null }

  if (watcherSource({ planRole: watcher.plan_role, frontId: watcher.front_id }) === 'livre') {
    const scoped = scopeSchema.safeParse({ scope: formData.get('scope'), metric: formData.get('metric') })
    if (!scoped.success) back(context, 'erro', issues(scoped.error))
    const level = readScope(scoped.data.scope)
    const refusal = await scopeError(supabase, context, level, scoped.data.metric)
    if (refusal) back(context, 'erro', refusal)
    if (target === null && (await nothingToFollow(supabase, context, level, scoped.data.metric))) back(context, 'erro', noFollow)
    Object.assign(values, { front_id: level.frontId, stage_id: level.stageId, metric: scoped.data.metric, target })
  } else {
    const refusal = await scopeError(supabase, context, { frontId: watcher.front_id, stageId: watcher.stage_id }, watcher.metric)
    if (refusal) back(context, 'erro', refusal)
  }

  const { data, error } = await supabase.from('watchers').update(values).eq('id', watcher.id).select('id')
  if (error || !data?.length) back(context, 'erro', error && error.code !== '42501' ? error.message : editRefused)
  const judged = await reevaluate(supabase, context.client_id)
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
  revalidatePath(`/dashboard/clients/${context.client_slug}`, 'layout')
  back(context, 'ok', context.is_active ? 'Vigia ligado.' : 'Vigia pausado.')
}

export async function deleteWatcher(context: MetasContext & { watcher_id: string }) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.from('watchers').delete().eq('id', context.watcher_id).select('id')
  if (error || !data?.length) back(context, 'erro', 'Só gestor ou owner pode remover vigias.')
  revalidatePath(`/dashboard/clients/${context.client_slug}`, 'layout')
  back(context, 'ok', 'Vigia removido, com o histórico de alertas dele.')
}

export async function evaluateNow(context: MetasContext) {
  const supabase = await createServerSupabaseClient()
  await assertClientRole(supabase, context.client_id, 'gestor')
  const { data, error } = await createServiceRoleClient().rpc('evaluate_watchers', { p_client_id: context.client_id })
  if (error) back(context, 'erro', error.message)
  revalidatePath(`/dashboard/clients/${context.client_slug}`, 'layout')
  back(context, 'ok', `${Number(data ?? 0)} vigias do cliente avaliados no último dia fechado.`)
}
