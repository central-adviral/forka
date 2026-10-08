import type { SupabaseClient } from '@supabase/supabase-js'
import { getConfiguredSecrets } from './client-secrets-repo'
import { PROJECT_RESULTS, readResult } from '@/lib/domain/project-plan'
import { projectSetupStatus, type SetupStatus } from '@/lib/domain/project-setup'
import { qualitySeals, type ProjectQualityRow } from '@/lib/domain/project-quality'

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
    db.from('sales_funnels').select('resultado, starts_on, ends_on').eq('id', projectId).eq('client_id', clientId).maybeSingle(),
  ])
  if (clientError) throw clientError
  if (projectError) throw projectError
  if (!client || !project) return null

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const [secrets, products, rules, watchers, fronts, pages, quality] = await Promise.all([
    getConfiguredSecrets(serviceDb, clientId),
    db.from('project_products').select('produto_nome', { count: 'exact', head: true }).eq('sales_funnel_id', projectId).eq('papel', 'entrada'),
    db.from('naming_rules').select('id, project_fronts!inner(sales_funnel_id)', { count: 'exact', head: true }).eq('project_fronts.sales_funnel_id', projectId).is('project_fronts.archived_at', null),
    db.from('watchers').select('metric, front_id, target').eq('sales_funnel_id', projectId),
    // An archived front is out of the setup: it claims nothing, so it needs no rule or page.
    db.from('project_fronts').select('id, name, source_sales_funnel_id, naming_rules(kind)').eq('sales_funnel_id', projectId).is('archived_at', null),
    db.from('pages').select('front_id').eq('sales_funnel_id', projectId).eq('is_active', true),
    db.rpc('get_project_data_quality', { p_sales_funnel_id: projectId, p_since: monthAgo, p_until: today }),
  ])
  if (products.error) throw products.error
  if (rules.error) throw rules.error
  if (watchers.error) throw watchers.error
  if (fronts.error) throw fronts.error
  if (pages.error) throw pages.error
  const frontRows = (fronts.data ?? []) as { id: string; name: string; source_sales_funnel_id: string | null; naming_rules: { kind: string }[] }[]
  const pageFronts = new Set(((pages.data ?? []) as { front_id: string | null }[]).map((page) => page.front_id))
  // The seals are a check, not a gate: if they cannot be read the step just shows none.
  const qualityRow = quality.error ? null : ((quality.data ?? []) as ProjectQualityRow[])[0]
  const links = { regras: '', produtos: '', edit: '', metas: '' }
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
    startsOn: project.starts_on ?? null,
    endsOn: project.ends_on ?? null,
    activePages: (pages.data ?? []).length,
    frontsWithoutPage: own.filter((front) => !pageFronts.has(front.id)).map((front) => front.name),
    openSeals: qualityRow ? qualitySeals(qualityRow, links).map((seal) => seal.label) : [],
  })
}
