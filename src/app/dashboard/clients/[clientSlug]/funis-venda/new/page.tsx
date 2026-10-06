import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { createSalesFunnel } from '../actions'

const inputClass =
  'w-full rounded-[10px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-3.5 py-2.5 text-sm text-[var(--ct-text)] placeholder:text-[var(--ct-text-2)] outline-none focus:border-[var(--ct-accent)]'

export default async function NewSalesFunnelPage({ params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()

  return (
    <div className="p-8">
      <form
        action={createSalesFunnel.bind(null, { client_id: client.id, client_slug: client.slug })}
        className="max-w-xl space-y-4"
      >
        <h1 className="font-[family-name:var(--font-sora)] text-lg font-semibold">Novo funil de venda</h1>
        <input required name="name" placeholder="Nome (ex: 1K LATAM)" className={inputClass} />
        <input required name="slug" placeholder="Slug (ex: 1k-latam)" className={inputClass} />
        <p className="-mt-2 text-xs text-[var(--ct-text-2)]">
          Vira parte da URL interna do funil — use letras minúsculas e hífen
        </p>
        <div>
          <label className="mb-1 block text-xs text-[var(--ct-text-2)]">IDs de operação (separados por vírgula)</label>
          <input
            name="launchops_operacao_ids"
            placeholder="09066a9d-419c-..., 15e25205-230b-..."
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-[var(--ct-text-2)]">Nomes de produto na Hubla (separados por vírgula)</label>
          <input name="launchops_produto_nomes" placeholder="1K Por Dia Latam" className={inputClass} />
        </div>
        <button type="submit" className="rounded-[10px] bg-[var(--ct-ok)] px-4 py-2.5 text-sm font-semibold text-[var(--ct-on-accent)]">
          Criar funil
        </button>
      </form>
    </div>
  )
}
