import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { ConfirmDeleteButton } from '@/components/confirm-delete-button'
import { deleteSalesFunnel } from './actions'
import { SalesFunnelStatusToggle } from './sales-funnel-status-toggle'
import { getDailyFunnel, getFunnelSyncHealth } from '@/lib/repo/funnel-repo'
import { REPORT_PERIODS, resolvePeriodDateRange, formatBr } from '@/lib/domain/report-period'
import { SyncStatus } from '@/components/sync-status'

export default async function SalesFunnelsListPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>
  searchParams: Promise<{ periodo?: string; desde?: string; ate?: string }>
}) {
  const { clientSlug } = await params
  const { periodo, desde, ate } = await searchParams
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, name, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()

  const { data: funnels } = await supabase
    .from('sales_funnels')
    .select('id, name, slug, is_active, launchops_operacao_ids, launchops_produto_nomes')
    .eq('client_id', client.id)
    .order('name')

  const { since, until } = resolvePeriodDateRange(periodo, desde, ate)
  const currency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  const summaries = await Promise.all(
    (funnels ?? []).map(async (funnel) => {
      const [rows, health] = await Promise.all([
        getDailyFunnel(supabase, funnel.id, since, until),
        getFunnelSyncHealth(supabase, funnel.id),
      ])
      const totals = rows.reduce(
        (acc, row) => ({ receita: acc.receita + row.receitaBruta, spend: acc.spend + row.spend }),
        { receita: 0, spend: 0 }
      )
      const lastSync = health.find((h) => h.lastRunAt)?.lastRunAt ?? null
      const hasSyncError = health.some((h) => h.lastResult === 'error')
      return {
        ...funnel,
        receita: totals.receita,
        roas: totals.spend > 0 ? totals.receita / totals.spend : null,
        lastSync,
        hasSyncError,
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

      <div className="mb-6 flex gap-1.5">
        {REPORT_PERIODS.map((option) => {
          const isActive = (periodo ?? 'all') === option.value
          return (
            <a
              key={option.value}
              href={option.value === 'all' ? `?` : `?periodo=${option.value}`}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                isActive
                  ? 'border-[#7C6FF0] bg-[#7C6FF0]/15 text-[#7C6FF0]'
                  : 'border-white/[0.08] text-[#8A90A6] hover:text-[#E8EAF2]'
              }`}
            >
              {option.label}
            </a>
          )
        })}
        <details className="relative" open={periodo === 'custom' || undefined}>
          <summary
            className={`cursor-pointer list-none rounded-full border px-3 py-1.5 text-xs font-medium ${
              periodo === 'custom'
                ? 'border-[#7C6FF0] bg-[#7C6FF0]/15 text-[#7C6FF0]'
                : 'border-white/[0.08] text-[#8A90A6] hover:text-[#E8EAF2]'
            }`}
          >
            {periodo === 'custom' && desde && ate ? `${formatBr(desde)} - ${formatBr(ate)}` : 'Personalizado'}
          </summary>
          <form
            method="get"
            className="absolute left-0 top-[calc(100%+6px)] z-10 flex flex-col gap-2 rounded-[10px] border border-white/[0.08] bg-[#141829] p-3 shadow-lg"
          >
            <input type="hidden" name="periodo" value="custom" />
            <label className="flex flex-col gap-1 text-[11px] text-[#8A90A6]">
              De
              <input
                type="date"
                name="desde"
                defaultValue={desde ?? ''}
                required
                className="rounded-[8px] border border-white/[0.08] bg-[#1B2036] px-2 py-1 text-xs text-[#E8EAF2]"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[#8A90A6]">
              Até
              <input
                type="date"
                name="ate"
                defaultValue={ate ?? ''}
                required
                className="rounded-[8px] border border-white/[0.08] bg-[#1B2036] px-2 py-1 text-xs text-[#E8EAF2]"
              />
            </label>
            <button type="submit" className="rounded-[8px] bg-[#7C6FF0] px-3 py-1.5 text-xs font-semibold text-[#0B0E1A]">
              Aplicar
            </button>
          </form>
        </details>
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
              <div className="flex flex-col items-end">
                <span className="font-['JetBrains_Mono'] text-[15px] font-medium">{currency(funnel.receita)}</span>
                <span className="text-[11px] text-[#8A90A6]">receita</span>
              </div>
              <div className="flex flex-col items-end">
                <span className="font-['JetBrains_Mono'] text-[15px] font-medium">
                  {funnel.roas !== null ? `${funnel.roas.toFixed(1)}x` : '—'}
                </span>
                <span className="text-[11px] text-[#8A90A6]">ROAS</span>
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
