import { createServerSupabaseClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/page-header'
import { notFound } from 'next/navigation'
import { ConfirmDeleteButton } from '@/components/confirm-delete-button'
import { setSalesFunnelArchived } from './actions'
import { ProjectStatusActions } from './project-status'
import { canActAs } from '@/lib/view-as'
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
    .select('id, name, slug, status, archived_at, launchops_operacao_ids, launchops_produto_nomes')
    .eq('client_id', client.id)
    .order('name')

  const canEdit = await canActAs(supabase, client.id, 'gestor')
  const archived = (funnels ?? []).filter((funnel) => funnel.archived_at)
  const summaries = await Promise.all(
    (funnels ?? []).filter((funnel) => !funnel.archived_at).map(async (funnel) => {
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
        note={client.name}
        title="Desempenho"
        description="Os funis do cliente. Cada um lê as próprias campanhas, produtos e metas."
        actions={
          <a
            href={`/dashboard/clients/${client.slug}/funis-venda/new`}
            className="rounded-full bg-[var(--ct-accent)] px-4 py-2 text-[13px] font-semibold text-[var(--ct-on-accent)] hover:brightness-110"
          >
            + Novo funil
          </a>
        }
      />

      <div className="card-shadow overflow-hidden rounded-2xl border border-[var(--ct-line)]">
        {summaries.map((funnel, index) => (
          <div
            key={funnel.id}
            className={`flex flex-wrap items-center gap-x-5 gap-y-3 bg-[var(--ct-surface)] px-4 py-5 sm:flex-nowrap sm:px-6 hover:bg-[var(--ct-surface-2)] ${
              index < summaries.length - 1 ? 'border-b border-[var(--ct-line)]' : ''
            } ${funnel.status === 'encerrado' ? 'opacity-70' : ''}`}
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
            <ProjectStatusActions salesFunnelId={funnel.id} status={funnel.status} canEdit={canEdit} />
            <ConfirmDeleteButton
              action={setSalesFunnelArchived.bind(null, funnel.id, true)}
              label="Arquivar"
              warning="Arquivar? Os números ficam, vendas novas não entram."
            />
          </div>
        ))}
        {summaries.length === 0 && <div className="px-6 py-8 text-sm text-[var(--ct-text-2)]">Nenhum funil ainda.</div>}
      </div>

      {archived.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-[13px] font-medium text-[var(--ct-text-2)] hover:text-[var(--ct-text)]">
            Arquivados ({archived.length})
          </summary>
          <ul className="mt-3 flex flex-col overflow-hidden rounded-2xl border border-[var(--ct-line)]">
            {archived.map((funnel) => (
              <li key={funnel.id} className="flex items-center gap-4 border-b border-[var(--ct-line)] bg-[var(--ct-surface)] px-4 py-3 last:border-b-0 sm:px-6">
                <a href={`/dashboard/clients/${client.slug}/funis-venda/${funnel.slug}`} className="min-w-0 flex-1 text-[14px] text-[var(--ct-text-2)] hover:text-[var(--ct-text)]">
                  {funnel.name}
                  <span className="ml-2 text-xs text-[var(--ct-text-3)]">arquivado em {new Date(funnel.archived_at!).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })}</span>
                </a>
                <form action={setSalesFunnelArchived.bind(null, funnel.id, false)}>
                  <button type="submit" className="text-xs font-semibold text-[var(--ct-accent)] hover:underline">
                    Restaurar
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
