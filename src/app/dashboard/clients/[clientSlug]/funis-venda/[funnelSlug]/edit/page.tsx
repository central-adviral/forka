import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { editSalesFunnel } from '../../actions'

const inputClass =
  'w-full rounded-[10px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-3.5 py-2.5 text-sm text-[var(--ct-text)] placeholder:text-[var(--ct-text-2)] outline-none focus:border-[var(--ct-accent)]'

export default async function EditSalesFunnelPage({
  params,
}: {
  params: Promise<{ clientSlug: string; funnelSlug: string }>
}) {
  const { clientSlug, funnelSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()

  const { data: funnel } = await supabase
    .from('sales_funnels')
    .select('id, name, slug, launchops_operacao_ids, starts_on, ends_on')
    .eq('client_id', client.id)
    .eq('slug', funnelSlug)
    .maybeSingle()
  if (!funnel) notFound()

  return (
    <div className="p-8">
      <a
        href={`/dashboard/clients/${client.slug}/funis-venda/${funnel.slug}`}
        className="mb-4 flex items-center gap-1 text-xs text-[var(--ct-text-2)] hover:text-[var(--ct-text)]"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M6.5 2L3 5L6.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {funnel.name}
      </a>
      <form
        action={editSalesFunnel.bind(null, {
          sales_funnel_id: funnel.id,
          client_id: client.id,
          client_slug: client.slug,
          funnel_slug: funnel.slug,
        })}
        className="max-w-xl space-y-4"
      >
        <h1 className="font-[family-name:var(--font-sora)] text-lg font-semibold">Editar funil — {funnel.name}</h1>
        <input required name="name" defaultValue={funnel.name} className={inputClass} />
        <div>
          <label className="mb-1 block text-xs text-[var(--ct-text-2)]">IDs de operação (separados por vírgula)</label>
          <input
            name="launchops_operacao_ids"
            defaultValue={(funnel.launchops_operacao_ids ?? []).join(', ')}
            className={inputClass}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-[var(--ct-text-2)]">
            Janela · início
            <input type="date" name="starts_on" defaultValue={funnel.starts_on ?? ''} className={`${inputClass} mt-1`} />
          </label>
          <label className="block text-xs text-[var(--ct-text-2)]">
            Janela · fim
            <input type="date" name="ends_on" defaultValue={funnel.ends_on ?? ''} className={`${inputClass} mt-1`} />
          </label>
        </div>
        <p className="text-xs text-[var(--ct-text-2)]">
          Opcional. Uma frente que lê outro projeto (ex.: a Captação Paga do lançamento lendo o perpétuo) só conta os dias
          dentro desta janela. Vazio = sem limite.
        </p>
        <button type="submit" className="rounded-[10px] bg-[var(--ct-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--ct-on-accent)]">
          Salvar alterações
        </button>
      </form>
    </div>
  )
}
