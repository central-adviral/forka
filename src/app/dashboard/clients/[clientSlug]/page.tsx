import { Suspense } from 'react'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { SuccessBanner } from '@/components/success-banner'
import { ConfirmDeleteButton } from '@/components/confirm-delete-button'
import { deleteClient } from '../actions'
import { deleteTest } from './actions'
import { TestStatusToggle } from './test-status-toggle'

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

  const { data: accessCounts, error: accessCountsError } = await supabase.rpc('get_client_test_access_counts', {
    p_client_id: client.id,
  })
  if (accessCountsError) {
    console.error('[client-access-counts-failed]', { clientId: client.id }, accessCountsError)
  }
  const accessesByTestId = new Map(
    ((accessCounts as { test_id: string; total_accesses: number }[]) ?? []).map((row) => [
      row.test_id,
      row.total_accesses,
    ])
  )

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
              <div className="flex flex-col items-end">
                <span className="font-['JetBrains_Mono'] text-[15px] font-medium">
                  {accessCountsError ? '—' : (accessesByTestId.get(test.id) ?? 0)}
                </span>
                <span className="text-[11px] text-[#8A90A6]">acessos totais</span>
              </div>
              <span className="rounded-full border border-white/[0.08] px-2.5 py-1 text-xs font-medium text-[#8A90A6]">
                {test.test_type === 'checkout' ? 'Checkout' : 'Página'}
              </span>
            </a>
            <TestStatusToggle testId={test.id} clientSlug={client.slug} status={test.status} />
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
