import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getClientSecrets } from '@/lib/repo/client-secrets-repo'
import { createLaunchOpsClient } from '@/lib/launchops/client'
import { fetchLaunchOpsProducts, type LaunchOpsProduct } from '@/lib/launchops/products'
import { saoPauloDay } from '@/lib/repo/today-repo'
import { canActAs } from '@/lib/view-as'
import { readResult, type ProjectResult } from '@/lib/domain/project-plan'
import type { ClassifiedCampaign } from '@/lib/domain/campaign-rules'
import type { ExistingPage, PageKind, PreviewCampaign, ProjectModel, SourceProject } from '@/lib/domain/project-wizard'
import type { ProductRole } from '@/lib/domain/product-roles'
import { PageHeader } from '@/components/page-header'
import { ProjectWizard } from './project-wizard'

const LOOKBACK_DAYS = 30

interface FrontRow {
  id: string
  sales_funnel_id: string
  code: string
  name: string
  source_sales_funnel_id: string | null
  metrica_principal: ProjectResult | null
  alvo_principal: number | null
  metrica_secundaria: ProjectResult | null
  alvo_secundaria: number | null
  archived_at: string | null
  naming_rules: { kind: string; value: string }[]
}

export default async function NewProjectPage({ params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, slug, funnel_source_url').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()
  if (!(await canActAs(supabase, client.id, 'gestor'))) {
    return <p className="px-4 pt-12 text-[13px] text-[var(--ct-text-2)] md:px-14">Só gestor ou owner cria projetos.</p>
  }

  const [projects, fronts, watchers, products, pages, campaigns] = await Promise.all([
    supabase.from('sales_funnels').select('id, name, slug, modelo, resultado, metrica_secundaria, archived_at').eq('client_id', client.id).order('name'),
    supabase
      .from('project_fronts')
      .select('id, sales_funnel_id, code, name, source_sales_funnel_id, metrica_principal, alvo_principal, metrica_secundaria, alvo_secundaria, archived_at, sales_funnels!project_fronts_sales_funnel_id_fkey!inner(client_id), naming_rules(kind, value)')
      .eq('sales_funnels.client_id', client.id)
      .order('position'),
    supabase.from('watchers').select('sales_funnel_id, target, plan_role').eq('client_id', client.id).is('front_id', null).not('plan_role', 'is', null),
    supabase.from('project_products').select('sales_funnel_id, produto_nome, papel, sales_funnels!inner(client_id)').eq('sales_funnels.client_id', client.id),
    supabase.from('pages').select('url, tipo, is_active, front_id, sales_funnel_id').eq('client_id', client.id),
    supabase.rpc('get_client_campaigns', { p_client_id: client.id, p_since: saoPauloDay(-LOOKBACK_DAYS), p_until: saoPauloDay(1) }),
  ])
  for (const result of [projects, fronts, watchers, products, pages, campaigns]) if (result.error) throw result.error

  const projectRows = (projects.data ?? []) as { id: string; name: string; slug: string; modelo: ProjectModel | null; resultado: string; metrica_secundaria: ProjectResult | null; archived_at: string | null }[]
  const frontRows = (fronts.data ?? []) as unknown as FrontRow[]
  const projectName = new Map(projectRows.map((project) => [project.id, project.name]))
  const frontById = new Map(frontRows.map((front) => [front.id, front]))
  const pageRows = (pages.data ?? []) as { url: string; tipo: PageKind | null; is_active: boolean; front_id: string | null; sales_funnel_id: string | null }[]

  const previewCampaigns: PreviewCampaign[] = ((campaigns.data ?? []) as ClassifiedCampaign[]).map((campaign) => {
    const owner = campaign.front_ids[0] ? frontById.get(campaign.front_ids[0]) : undefined
    return { campaign_name: campaign.campaign_name, spend: Number(campaign.spend), owner_project: owner ? (projectName.get(owner.sales_funnel_id) ?? 'outro projeto') : null }
  })
  const existingPages: ExistingPage[] = pageRows.map((page) => {
    const front = page.front_id ? frontById.get(page.front_id) : undefined
    const project = page.sales_funnel_id ? projectName.get(page.sales_funnel_id) : undefined
    return { url: page.url, where: [project ?? 'sem projeto', front?.name].filter(Boolean).join(' · ') }
  })
  const targets = (watchers.data ?? []) as { sales_funnel_id: string; target: number; plan_role: 'principal' | 'secundaria' }[]
  const productRows = (products.data ?? []) as unknown as { sales_funnel_id: string; produto_nome: string; papel: ProductRole }[]
  const sources: SourceProject[] = projectRows
    .filter((project) => !project.archived_at)
    .map((project) => ({
      id: project.id,
      name: project.name,
      modelo: project.modelo,
      resultado: readResult(project.resultado),
      metricaSecundaria: project.metrica_secundaria,
      primaryTarget: targets.find((row) => row.sales_funnel_id === project.id && row.plan_role === 'principal')?.target ?? null,
      secondaryTarget: targets.find((row) => row.sales_funnel_id === project.id && row.plan_role === 'secundaria')?.target ?? null,
      fronts: frontRows
        .filter((front) => front.sales_funnel_id === project.id && !front.archived_at)
        .map((front) => ({
          code: front.code,
          name: front.name,
          sourceProjectId: front.source_sales_funnel_id,
          includes: front.naming_rules.filter((rule) => rule.kind === 'include').map((rule) => rule.value),
          primary: front.metrica_principal,
          primaryTarget: front.alvo_principal,
          secondary: front.metrica_secundaria,
          secondaryTarget: front.alvo_secundaria,
          pages: pageRows.filter((page) => page.front_id === front.id).map((page) => ({ url: page.url, tipo: page.tipo })),
        })),
      products: productRows.filter((row) => row.sales_funnel_id === project.id).map((row) => ({ produto_nome: row.produto_nome, papel: row.papel })),
    }))

  // The LaunchOps key is read with the service role, so only a gestor gets here; RLS proved the client.
  let catalog: LaunchOpsProduct[] = []
  let catalogError: string | null = null
  const { funnelSourceServiceRoleKey } = await getClientSecrets(createServiceRoleClient(), client.id)
  if (!client.funnel_source_url || !funnelSourceServiceRoleKey) {
    catalogError = 'Configure a fonte de dados do funil em Integrações para ver os produtos do LaunchOps.'
  } else {
    try {
      catalog = await fetchLaunchOpsProducts(createLaunchOpsClient({ url: client.funnel_source_url, serviceRoleKey: funnelSourceServiceRoleKey }), LOOKBACK_DAYS)
    } catch (err) {
      catalogError = `Não foi possível ler os produtos do LaunchOps: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  return (
    <div className="flex max-w-[1240px] flex-col gap-6 px-4 pb-24 pt-12 md:px-14">
      <PageHeader title="Novo projeto" note="Quatro passos: o projeto, as frentes (de onde vem o gasto e para onde vão as pessoas), os produtos e a conferência." />
      <ProjectWizard
        context={{ client_id: client.id, client_slug: client.slug }}
        campaigns={previewCampaigns}
        existingPages={existingPages}
        activePages={pageRows.filter((page) => page.is_active).length}
        takenSlugs={projectRows.map((project) => project.slug)}
        sources={sources}
        catalog={catalog}
        catalogError={catalogError}
      />
    </div>
  )
}
