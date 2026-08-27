import { Suspense } from 'react'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { SuccessBanner } from '@/components/success-banner'
import { ConfirmDeleteButton } from '@/components/confirm-delete-button'
import { deleteClient } from '../actions'
import { deleteTest } from './actions'

export default async function ClientPage({ params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase
    .from('clients')
    .select('id, name, slug')
    .eq('slug', clientSlug)
    .maybeSingle()

  if (!client) notFound()

  const { data: tests } = await supabase
    .from('tests')
    .select('id, name, slug, status, test_type')
    .eq('client_id', client.id)
    .order('name')

  return (
    <div className="p-8">
      <Suspense fallback={null}>
        <SuccessBanner param="created" message="Teste criado com sucesso." />
      </Suspense>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-['Space_Grotesk'] text-xl font-semibold">Testes — {client.name}</h1>
        <div className="flex items-center gap-4">
          <ConfirmDeleteButton action={deleteClient.bind(null, client.id)} label="Excluir cliente" />
          <a
            href={`/dashboard/clients/${client.slug}/integrations`}
            className="rounded-[9px] border border-white/[0.08] px-4 py-2.5 text-[13.5px] font-medium text-[#8A90A6]"
          >
            Integrações
          </a>
          <a
            href={`/dashboard/clients/${client.slug}/tests/new`}
            className="rounded-[9px] bg-[#7C6FF0] px-4 py-2.5 text-[13.5px] font-semibold text-[#0B0E1A]"
          >
            Novo teste
          </a>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/[0.08]">
        {(tests ?? []).map((test, index) => (
          <div
            key={test.id}
            className={`flex items-center gap-5 bg-[#141829] px-6 py-5 hover:bg-[#1B2036] ${
              index < (tests?.length ?? 0) - 1 ? 'border-b border-white/[0.08]' : ''
            } ${test.status === 'paused' ? 'opacity-70' : ''}`}
          >
            <a href={`/dashboard/clients/${client.slug}/tests/${test.slug}`} className="flex min-w-0 flex-1 items-center gap-5">
              <div className="min-w-0 flex-1">
                <div className="font-['Space_Grotesk'] text-[15px] font-semibold">{test.name}</div>
                <div className="font-['JetBrains_Mono'] text-xs text-[#8A90A6]">/{test.slug}</div>
              </div>
              <span
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                  test.status === 'active' ? 'border-[#2DD4A8]/35 text-[#2DD4A8]' : 'border-[#F76C6C]/35 text-[#F76C6C]'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${test.status === 'active' ? 'bg-[#2DD4A8]' : 'bg-[#F76C6C]'}`} />
                {test.status === 'active' ? 'Ativo' : 'Pausado'}
              </span>
              <span className="rounded-full border border-white/[0.08] px-2.5 py-1 text-xs font-medium text-[#8A90A6]">
                {test.test_type === 'checkout' ? 'Checkout' : 'Página'}
              </span>
            </a>
            <ConfirmDeleteButton
              action={deleteTest.bind(null, test.id, client.slug)}
              warning={
                test.test_type === 'checkout'
                  ? 'Isso vai quebrar o botão de comprar da página de vendas. Confirmar?'
                  : undefined
              }
            />
          </div>
        ))}
        {(tests ?? []).length === 0 && <div className="px-6 py-8 text-sm text-[#8A90A6]">Nenhum teste ainda.</div>}
      </div>
    </div>
  )
}
