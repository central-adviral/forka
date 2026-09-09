import { createServerSupabaseClient } from '@/lib/supabase/server'
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
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <a
            href={`/dashboard/clients/${client.slug}`}
            className="mb-1 flex items-center gap-1 text-xs text-[#8A90A6] hover:text-[#E8EAF2]"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M6.5 2L3 5L6.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {client.name}
          </a>
          <h1 className="font-['Space_Grotesk'] text-xl font-semibold">Funis de Venda</h1>
        </div>
        <a
          href={`/dashboard/clients/${client.slug}/funis-venda/new`}
          className="rounded-[9px] bg-[#2DD4A8] px-4 py-2.5 text-[13.5px] font-semibold text-[#0B0E1A]"
        >
          + Novo funil
        </a>
      </div>

      <div className="card-shadow overflow-hidden rounded-2xl border border-white/[0.08]">
        {summaries.map((funnel, index) => (
          <div
            key={funnel.id}
            className={`flex items-center gap-5 bg-[#141829] px-6 py-5 hover:bg-[#1B2036] ${
              index < summaries.length - 1 ? 'border-b border-white/[0.08]' : ''
            } ${!funnel.is_active ? 'opacity-70' : ''}`}
          >
            <a
              href={`/dashboard/clients/${client.slug}/funis-venda/${funnel.slug}`}
              className="flex min-w-0 flex-1 items-center gap-5"
            >
              <div className="min-w-0 flex-1">
                <div className="font-['Space_Grotesk'] text-[15px] font-semibold">{funnel.name}</div>
                <div className="font-['JetBrains_Mono'] text-xs text-[#8A90A6]">
                  {(funnel.launchops_operacao_ids ?? []).length} operações, {(funnel.launchops_produto_nomes ?? []).length} produtos
                </div>
              </div>
              <SyncStatus lastRunAt={funnel.lastSync} hasError={funnel.hasSyncError} />
            </a>
            <SalesFunnelStatusToggle salesFunnelId={funnel.id} clientSlug={client.slug} isActive={funnel.is_active} />
            <ConfirmDeleteButton action={deleteSalesFunnel.bind(null, funnel.id, client.slug)} />
          </div>
        ))}
        {summaries.length === 0 && <div className="px-6 py-8 text-sm text-[#8A90A6]">Nenhum funil de venda ainda.</div>}
      </div>
    </div>
  )
}
