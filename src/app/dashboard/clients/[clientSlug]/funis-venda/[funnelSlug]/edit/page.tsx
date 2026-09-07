import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { editSalesFunnel } from '../../actions'

const inputClass =
  'w-full rounded-[10px] border border-white/[0.08] bg-[#1B2036] px-3.5 py-2.5 text-sm text-[#E8EAF2] placeholder:text-[#8A90A6] outline-none focus:border-[#7C6FF0]'

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
    .select('id, name, slug, launchops_operacao_ids, launchops_produto_nomes')
    .eq('client_id', client.id)
    .eq('slug', funnelSlug)
    .maybeSingle()
  if (!funnel) notFound()

  return (
    <div className="p-8">
      <a
        href={`/dashboard/clients/${client.slug}/funis-venda/${funnel.slug}`}
        className="mb-4 flex items-center gap-1 text-xs text-[#8A90A6] hover:text-[#E8EAF2]"
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
        <h1 className="font-['Space_Grotesk'] text-lg font-semibold">Editar funil — {funnel.name}</h1>
        <input required name="name" defaultValue={funnel.name} className={inputClass} />
        <div>
          <label className="mb-1 block text-xs text-[#8A90A6]">IDs de operação (separados por vírgula)</label>
          <input
            name="launchops_operacao_ids"
            defaultValue={(funnel.launchops_operacao_ids ?? []).join(', ')}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-[#8A90A6]">Nomes de produto na Hubla (separados por vírgula)</label>
          <input
            name="launchops_produto_nomes"
            defaultValue={(funnel.launchops_produto_nomes ?? []).join(', ')}
            className={inputClass}
          />
        </div>
        <button type="submit" className="rounded-[10px] bg-[#7C6FF0] px-4 py-2.5 text-sm font-semibold text-[#0B0E1A]">
          Salvar alterações
        </button>
      </form>
    </div>
  )
}
