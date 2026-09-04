import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { ConfirmDeleteButton } from '@/components/confirm-delete-button'
import { deleteClient } from '../actions'

export default async function ClientHubPage({ params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, name, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()

  const [testsResult, funnelsResult] = await Promise.all([
    supabase.from('tests').select('id', { count: 'exact', head: true }).eq('client_id', client.id),
    supabase.from('sales_funnels').select('id', { count: 'exact', head: true }).eq('client_id', client.id),
  ])
  if (testsResult.error) console.error('[client-hub-tests-count-failed]', { clientId: client.id }, testsResult.error)
  if (funnelsResult.error) console.error('[client-hub-funnels-count-failed]', { clientId: client.id }, funnelsResult.error)
  const testsCount = testsResult.count ?? 0
  const funnelsCount = funnelsResult.count ?? 0

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <div className="text-xs text-[#8A90A6]">CLIENTE</div>
          <h1 className="font-['Space_Grotesk'] text-xl font-semibold">{client.name}</h1>
        </div>
        <div className="flex items-center gap-4">
          <ConfirmDeleteButton action={deleteClient.bind(null, client.id)} label="Excluir cliente" />
          <a
            href={`/dashboard/clients/${client.slug}/integrations`}
            className="rounded-[9px] border border-white/[0.08] px-4 py-2.5 text-[13.5px] font-medium text-[#8A90A6]"
          >
            Integrações
          </a>
        </div>
      </div>

      <div className="flex gap-5">
        <a
          href={`/dashboard/clients/${client.slug}/tests`}
          className="flex-1 rounded-[14px] border border-white/[0.08] bg-[#141829] p-7 hover:border-[#7C6FF0]/40"
        >
          <div className="mb-4 flex h-[52px] w-[52px] items-center justify-center rounded-xl bg-[#7C6FF0]/15">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#7C6FF0" strokeWidth="2">
              <path d="M4 12h6M14 12h6M10 6l4 6-4 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="mb-1.5 font-['Space_Grotesk'] text-[17px] font-semibold">Funis de Teste</div>
          <p className="text-[13px] leading-relaxed text-[#8A90A6]">
            Testes A/B de página e checkout — clique, variante, conversão.
          </p>
          <div className="mt-4 font-['JetBrains_Mono'] text-xs text-[#8A90A6]">{testsCount} funis ativos</div>
        </a>

        <a
          href={`/dashboard/clients/${client.slug}/funis-venda`}
          className="flex-1 rounded-[14px] border border-white/[0.08] bg-[#141829] p-7 hover:border-[#2DD4A8]/40"
        >
          <div className="mb-4 flex h-[52px] w-[52px] items-center justify-center rounded-xl bg-[#2DD4A8]/15">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#2DD4A8" strokeWidth="2">
              <path d="M4 4h16l-6 8v6l-4 2v-8L4 4z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="mb-1.5 font-['Space_Grotesk'] text-[17px] font-semibold">Funis de Venda</div>
          <p className="text-[13px] leading-relaxed text-[#8A90A6]">
            Receita, gasto de anúncio, ROAS e CAC por operação/produto.
          </p>
          <div className="mt-4 font-['JetBrains_Mono'] text-xs text-[#8A90A6]">{funnelsCount} funis configurados</div>
        </a>
      </div>
    </div>
  )
}
