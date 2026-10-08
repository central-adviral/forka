import { createServerSupabaseClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/page-header'
import { notFound } from 'next/navigation'
import { ConfirmDeleteButton } from '@/components/confirm-delete-button'
import { deleteSalesFunnel } from './actions'
import { SalesFunnelStatusToggle } from './sales-funnel-status-toggle'
import { getFunnelSyncHealth } from '@/lib/repo/funnel-repo'
import { SyncStatus } from '@/components/sync-status'

export default async function SalesFunnelsListPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>
}) {
  const { clientSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, name, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()

  const { data: funnels } = await supabase
    .from('sales_funnels')
    .select('id, name, slug, is_active, launchops_operacao_ids, launchops_produto_nomes')
    .eq('client_id', client.id)
    .order('name')

  const summaries = await Promise.all(
    (funnels ?? []).map(async (funnel) => {
      const health = await getFunnelSyncHealth(supabase, funnel.id)
      return {
        ...funnel,
        lastSync: health.find((h) => h.lastRunAt)?.lastRunAt ?? null,
        hasSyncError: health.some((h) => h.lastResult === 'error'),
      }
    })
  )

  return (
    <div className="flex max-w-[1240px] flex-col gap-9 px-4 md:px-14 pb-24 pt-12">
      <PageHeader
        tool="an"
        eyebrow={client.name}
        title="Análises"
        description="Os projetos do cliente. Cada um lê as próprias campanhas, produtos e alvos."
        actions={
          <a
            href={`/dashboard/clients/${client.slug}/funis-venda/new`}
            className="rounded-full bg-[var(--ct-accent)] px-4 py-2 text-[13px] font-semibold text-[var(--ct-on-accent)] hover:brightness-110"
          >
            + Novo projeto
          </a>
        }
      />

      <div className="card-shadow overflow-hidden rounded-2xl border border-[var(--ct-line)]">
        {summaries.map((funnel, index) => (
          <div
            key={funnel.id}
            className={`flex flex-wrap items-center gap-x-5 gap-y-3 bg-[var(--ct-surface)] px-4 py-5 sm:flex-nowrap sm:px-6 hover:bg-[var(--ct-surface-2)] ${
              index < summaries.length - 1 ? 'border-b border-[var(--ct-line)]' : ''
            } ${!funnel.is_active ? 'opacity-70' : ''}`}
          >
            <a
              href={`/dashboard/clients/${client.slug}/funis-venda/${funnel.slug}`}
              className="flex min-w-0 flex-1 basis-full flex-wrap items-center gap-x-5 gap-y-1 sm:basis-auto sm:flex-nowrap"
            >
              <div className="min-w-0 flex-1">
                <div className="font-[family-name:var(--font-sora)] text-[15px] font-semibold">{funnel.name}</div>
                <div className="font-[family-name:var(--font-geist-mono)] text-xs text-[var(--ct-text-2)]">
                  {(funnel.launchops_operacao_ids ?? []).length} operações, {(funnel.launchops_produto_nomes ?? []).length} produtos
                </div>
              </div>
              <SyncStatus lastRunAt={funnel.lastSync} hasError={funnel.hasSyncError} />
            </a>
            <SalesFunnelStatusToggle salesFunnelId={funnel.id} clientSlug={client.slug} isActive={funnel.is_active} />
            <ConfirmDeleteButton action={deleteSalesFunnel.bind(null, funnel.id, client.slug)} />
          </div>
        ))}
        {summaries.length === 0 && <div className="px-6 py-8 text-sm text-[var(--ct-text-2)]">Nenhum funil de venda ainda.</div>}
      </div>
    </div>
  )
}
