import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getProjectSetupStatus } from '@/lib/repo/project-setup-repo'
import { canActAs } from '@/lib/view-as'
import { PageHeader } from '@/components/page-header'
import type { SetupStepId } from '@/lib/domain/project-setup'

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
  const { data: funnel } = await supabase.from('sales_funnels').select('id, name, slug').eq('client_id', client.id).eq('slug', funnelSlug).maybeSingle()
  if (!funnel) notFound()

  const [status, isOwner] = await Promise.all([
    getProjectSetupStatus(supabase, createServiceRoleClient(), client.id, funnel.id),
    canActAs(supabase, client.id, 'owner'),
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
    </div>
  )
}
