import type { SupabaseClient } from '@supabase/supabase-js'
import { getConfiguredSecrets } from './client-secrets-repo'
import type { StageMeasure } from '@/lib/domain/funnel-stages'
import { projectSetupStatus, type SetupStatus } from '@/lib/domain/project-setup'
import { qualitySeals, type ProjectQualityRow } from '@/lib/domain/project-quality'

/**
 * Reads the setup facts of a funnel and grades them. Only reads. `db` is the user's session: a funnel
 * it cannot see returns null, and only then is `serviceDb` used, for whether the client's secrets are
 * set (never their values), the same way the Integrações page does it.
 */
export async function getProjectSetupStatus(
  db: SupabaseClient,
  serviceDb: SupabaseClient,
  clientId: string,
  projectId: string
): Promise<SetupStatus | null> {
  const [{ data: client, error: clientError }, { data: project, error: projectError }] = await Promise.all([
    db.from('clients').select('funnel_source_url').eq('id', clientId).maybeSingle(),
    db.from('sales_funnels').select('warn_pct, crit_pct').eq('id', projectId).eq('client_id', clientId).maybeSingle(),
  ])
  if (clientError) throw clientError
  if (projectError) throw projectError
  if (!client || !project) return null

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const [secrets, products, stages, fronts, pages, quality] = await Promise.all([
    getConfiguredSecrets(serviceDb, clientId),
    db.from('project_products').select('papel').eq('sales_funnel_id', projectId),
    db.from('funnel_stages').select('id, name, tag, measure, meta, meta_roas').eq('sales_funnel_id', projectId).is('archived_at', null).order('position'),
    // An archived front is out of the setup: it claims nothing, so it needs no rule or page.
    db.from('project_fronts').select('id, name, stage_id, source_sales_funnel_id, naming_rules(kind, value)').eq('sales_funnel_id', projectId).is('archived_at', null),
    db.from('pages').select('front_id').eq('sales_funnel_id', projectId).eq('is_active', true),
    db.rpc('get_project_data_quality', { p_sales_funnel_id: projectId, p_since: monthAgo, p_until: today }),
  ])
  for (const result of [products, stages, fronts, pages]) if (result.error) throw result.error
  const stageRows = (stages.data ?? []) as { id: string; name: string; tag: string | null; measure: StageMeasure; meta: number | null; meta_roas: number | null }[]
  const frontRows = (fronts.data ?? []) as { id: string; name: string; stage_id: string; source_sales_funnel_id: string | null; naming_rules: { kind: string; value: string }[] }[]
  const stageName = new Map(stageRows.map((stage) => [stage.id, stage.name]))
  const pageFronts = new Set(((pages.data ?? []) as { front_id: string | null }[]).map((page) => page.front_id))
  const roles = ((products.data ?? []) as { papel: string }[]).map((product) => product.papel)
  // The seals are a check, not a gate: if they cannot be read the step just shows none.
  const qualityRow = quality.error ? null : ((quality.data ?? []) as ProjectQualityRow[])[0]
  const links = { regras: '', produtos: '', metas: '' }
  // Fronts of archived stages are not set up here: the stage is out of the journey.
  const open = frontRows.filter((front) => stageName.has(front.stage_id))

  return projectSetupStatus({
    launchopsConnected: Boolean(client.funnel_source_url) && secrets.hasFunnelSourceKey,
    hublaConnected: secrets.hasHublaToken,
    stages: stageRows.map((stage) => ({ name: stage.name, tag: stage.tag, measure: stage.measure, hasMeta: stage.meta !== null || (stage.measure === 'compra' && stage.meta_roas !== null) })),
    fronts: open.map((front) => ({
      name: front.name,
      stageName: stageName.get(front.stage_id) ?? '',
      mirror: front.source_sales_funnel_id !== null,
      includes: front.naming_rules.filter((rule) => rule.kind === 'include').map((rule) => rule.value),
    })),
    frontsWithoutPage: open.filter((front) => front.source_sales_funnel_id === null && !pageFronts.has(front.id)).length,
    entryProducts: roles.filter((role) => role === 'entrada').length,
    ascensionProducts: roles.filter((role) => role === 'ascensao').length,
    band: { warnPct: Number(project.warn_pct ?? 20), critPct: Number(project.crit_pct ?? 40) },
    openSeals: qualityRow ? qualitySeals(qualityRow, links).map((seal) => seal.label) : [],
  })
}
