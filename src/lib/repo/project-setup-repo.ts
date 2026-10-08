import type { SupabaseClient } from '@supabase/supabase-js'
import { getConfiguredSecrets } from './client-secrets-repo'
import { PROJECT_RESULTS, readResult } from '@/lib/domain/project-plan'
import { projectSetupStatus, type SetupStatus } from '@/lib/domain/project-setup'

/**
 * Reads the five setup facts of a project and grades them. Only reads. `db` is the user's session:
 * a project it cannot see returns null, and only then is `serviceDb` used, for whether the client's
 * secrets are set (never their values), the same way the Integrações page does it.
 */
export async function getProjectSetupStatus(
  db: SupabaseClient,
  serviceDb: SupabaseClient,
  clientId: string,
  projectId: string
): Promise<SetupStatus | null> {
  const [{ data: client, error: clientError }, { data: project, error: projectError }] = await Promise.all([
    db.from('clients').select('funnel_source_url').eq('id', clientId).maybeSingle(),
    db.from('sales_funnels').select('resultado').eq('id', projectId).eq('client_id', clientId).maybeSingle(),
  ])
  if (clientError) throw clientError
  if (projectError) throw projectError
  if (!client || !project) return null

  const [secrets, products, rules, watchers, fronts] = await Promise.all([
    getConfiguredSecrets(serviceDb, clientId),
    db.from('project_products').select('produto_nome', { count: 'exact', head: true }).eq('sales_funnel_id', projectId).eq('papel', 'entrada'),
    db.from('naming_rules').select('id, project_fronts!inner(sales_funnel_id)', { count: 'exact', head: true }).eq('project_fronts.sales_funnel_id', projectId),
    db.from('watchers').select('metric, front_id, target').eq('sales_funnel_id', projectId),
    db.from('project_fronts').select('source_sales_funnel_id, naming_rules(kind)').eq('sales_funnel_id', projectId),
  ])
  if (products.error) throw products.error
  if (rules.error) throw rules.error
  if (watchers.error) throw watchers.error
  if (fronts.error) throw fronts.error
  const frontRows = (fronts.data ?? []) as { source_sales_funnel_id: string | null; naming_rules: { kind: string }[] }[]
  const own = frontRows.filter((front) => front.source_sales_funnel_id === null)

  const resultado = readResult(project.resultado)
  const costMetric = PROJECT_RESULTS[resultado].costMetric
  const isCostWatcher = (row: { metric: string; front_id: string | null }) => row.front_id === null && row.metric === costMetric
  const costWatcher = (watchers.data ?? []).find(isCostWatcher)
  return projectSetupStatus({
    launchopsConnected: Boolean(client.funnel_source_url) && secrets.hasFunnelSourceKey,
    hublaConnected: secrets.hasHublaToken,
    entryProducts: products.count ?? 0,
    namingRules: rules.count ?? 0,
    ownFronts: own.length,
    ownFrontsWithInclude: own.filter((front) => front.naming_rules.some((rule) => rule.kind === 'include')).length,
    mirrorFronts: frontRows.length - own.length,
    resultado: project.resultado ?? null,
    costTarget: costWatcher ? Number(costWatcher.target) : null,
    extraWatchers: (watchers.data ?? []).filter((row) => !isCostWatcher(row)).length,
  })
}
