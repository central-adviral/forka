import type { SupabaseClient } from '@supabase/supabase-js'
import { PROJECT_RESULTS, readResult } from '@/lib/domain/project-plan'
import { resultStage, stageMetaFor, watcherCostMeasure } from '@/lib/domain/targets'
import { getFunnelStages } from './funnel-stages-repo'

/**
 * The funnel result's meta is the meta of its stage (0106): the result watchers follow it. A meta
 * saved on the result stage (in Metas e vigias or in the canvas) gives the funnel its result watcher
 * when it had none, as saving the result meta always did. Runs on the user's session.
 */
export async function ensureResultWatchers(db: SupabaseClient, clientId: string, salesFunnelId: string): Promise<void> {
  const [{ data: funnel, error: funnelError }, stages, { data: plan, error: planError }] = await Promise.all([
    db.from('sales_funnels').select('resultado, metrica_secundaria').eq('id', salesFunnelId).maybeSingle(),
    getFunnelStages(db, salesFunnelId),
    db.from('watchers').select('plan_role').eq('sales_funnel_id', salesFunnelId).is('front_id', null).not('plan_role', 'is', null),
  ])
  if (funnelError) throw funnelError
  if (planError) throw planError
  if (!funnel) return
  const roles = [
    { role: 'principal', result: readResult(funnel.resultado) },
    { role: 'secundaria', result: funnel.metrica_secundaria ? readResult(funnel.metrica_secundaria) : null },
  ] as const
  for (const { role, result } of roles) {
    if (!result || (plan ?? []).some((row) => row.plan_role === role)) continue
    const metric = PROJECT_RESULTS[result].costMetric
    if (stageMetaFor(resultStage(stages, watcherCostMeasure(metric)), metric) === null) continue
    const { error } = await db
      .from('watchers')
      .insert({ client_id: clientId, sales_funnel_id: salesFunnelId, metric, target: null, plan_role: role, is_plan: role === 'principal' })
    if (error) throw error
  }
}
