import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getProjectSetupStatus } from '@/lib/repo/project-setup-repo'
import { canActAs } from '@/lib/view-as'
import { PageHeader } from '@/components/page-header'
import type { SetupStepId } from '@/lib/domain/project-setup'
import type { ProjectQualityRow } from '@/lib/domain/project-quality'
import { saoPauloDay } from '@/lib/repo/today-repo'
import { ProjectMap, type MapFront } from './project-map'

// Projeto › Visão geral: the five setup steps as cards, in order. Read-only; each card links to the
// screen that already edits that step.

const mono = 'font-[family-name:var(--font-geist-mono)]'

export default async function ProjectSetupPage({ params }: { params: Promise<{ clientSlug: string; funnelSlug: string }> }) {
  const { clientSlug, funnelSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()
  // Configuration is internal to the agency, like the screens these cards lead to.
  if (!(await canActAs(supabase, client.id, 'analista'))) notFound()
  const { data: funnel } = await supabase.from('sales_funnels').select('id, name, slug, resultado').eq('client_id', client.id).eq('slug', funnelSlug).maybeSingle()
  if (!funnel) notFound()

  const window = { p_sales_funnel_id: funnel.id, p_since: saoPauloDay(-30), p_until: saoPauloDay(1) }
  const [status, isOwner, { data: fronts }, { data: frontDays }, { data: products }, { data: productSales }, { data: qualityRows }] = await Promise.all([
    getProjectSetupStatus(supabase, createServiceRoleClient(), client.id, funnel.id),
    canActAs(supabase, client.id, 'owner'),
    supabase.from('project_fronts').select('id, code, name, source:sales_funnels!project_fronts_source_sales_funnel_id_fkey(name)').eq('sales_funnel_id', funnel.id).order('position'),
    supabase.rpc('get_project_front_daily', window),
    supabase.from('project_products').select('produto_nome, papel').eq('sales_funnel_id', funnel.id),
    supabase.rpc('get_funnel_sales_by_product', window),
    supabase.rpc('get_project_data_quality', window),
  ])
  if (!status) notFound()

  const base = `/dashboard/clients/${client.slug}`
  const stepHref: Record<SetupStepId, string | null> = {
    // Integrações is owner-only; other roles see the step but not a link to it.
    integracoes: isOwner ? `${base}/integrations` : null,
    produtos: `${base}/funis-venda/${funnel.slug}/produtos`,
    regras: `${base}/funis-venda/${funnel.slug}/regras`,
    plano: `${base}/funis-venda/${funnel.slug}/plano`,
    metas: `${base}/metas`,
  }
  const spendByFront = new Map<string, number>()
  for (const day of (frontDays ?? []) as { front_id: string; spend: number }[]) spendByFront.set(day.front_id, (spendByFront.get(day.front_id) ?? 0) + Number(day.spend))
  const mapFronts: MapFront[] = ((fronts ?? []) as unknown as { id: string; code: string; name: string; source: { name: string } | null }[]).map((front) => ({
    name: front.name,
    code: front.code,
    mirrorOf: front.source?.name ?? null,
    spend: spendByFront.get(front.id) ?? 0,
  }))
  const salesByProduct = new Map(((productSales ?? []) as { produto: string; sales_count: number }[]).map((row) => [row.produto, Number(row.sales_count)]))
  const mapProducts = ((products ?? []) as { produto_nome: string; papel: string }[]).map((product) => ({
    name: product.produto_nome,
    role: product.papel,
    sales: salesByProduct.get(product.produto_nome) ?? 0,
  }))
  const next = status.steps.find((step) => !step.done)
  const missing = status.steps.length - status.done

  return (
    <div className="flex max-w-[1180px] flex-col gap-8 px-4 pb-24 pt-12 md:px-14">
      <PageHeader
        note={
          missing === 0
            ? `${funnel.name} está pronto: os cinco passos estão configurados.`
            : `${funnel.name}: ${status.done} de ${status.steps.length} passos prontos. ${missing === 1 ? 'Falta 1 passo' : `Faltam ${missing} passos`} para os números do projeto ficarem confiáveis.`
        }
        actions={
          next && stepHref[next.id] ? (
            <Link href={stepHref[next.id]!} className="rounded-[10px] bg-[var(--ct-accent)] px-4 py-2 text-[13px] font-semibold text-[var(--ct-on-accent)] hover:brightness-110">
              Continuar: {next.label}
            </Link>
          ) : undefined
        }
      />

      <ol className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]">
        {status.steps.map((step, index) => {
          const href = stepHref[step.id]
          const current = step.id === next?.id
          return (
            <li
              key={step.id}
              className={`flex flex-col gap-2.5 rounded-[16px] bg-[var(--ct-surface)] px-5 py-[18px] ${
                current ? 'border-2 border-[var(--ct-accent)] shadow-[0_0_0_4px_var(--ct-accent-soft)]' : 'border border-[var(--ct-line)]'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`${mono} grid h-7 w-7 flex-none place-items-center rounded-full text-[12px] font-semibold ${
                    step.done ? 'bg-[var(--ct-ok-soft)] text-[var(--ct-ok)]' : current ? 'bg-[var(--ct-accent)] text-[var(--ct-on-accent)]' : 'bg-[var(--ct-surface-3)] text-[var(--ct-text-2)]'
                  }`}
                  aria-hidden="true"
                >
                  {step.done ? '✓' : index + 1}
                </span>
                <b className="text-[15px] font-semibold">{step.label}</b>
                <span className="sr-only">{step.done ? 'configurado' : 'falta configurar'}</span>
              </div>
              <p className="text-[13.5px] text-[var(--ct-text-2)]">{step.text}</p>
              {href ? (
                <Link
                  href={href}
                  className={`mt-auto self-start rounded-[9px] px-3.5 py-1.5 text-[13px] font-semibold ${
                    step.done ? 'border border-[var(--ct-line-2)] text-[var(--ct-text)] hover:bg-[var(--ct-surface-2)]' : 'bg-[var(--ct-accent)] text-[var(--ct-on-accent)] hover:brightness-110'
                  }`}
                >
                  {step.done ? 'Revisar' : 'Configurar agora'}
                </Link>
              ) : (
                <span className="mt-auto text-[12px] text-[var(--ct-text-3)]">Só o owner do cliente configura as integrações.</span>
              )}
            </li>
          )
        })}
      </ol>

      <ProjectMap fronts={mapFronts} products={mapProducts} quality={((qualityRows ?? []) as ProjectQualityRow[])[0] ?? null} resultado={funnel.resultado ?? 'compra'} />
    </div>
  )
}
