import { Suspense } from 'react'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { SuccessBanner } from '@/components/success-banner'
import { ConfirmDeleteButton } from '@/components/confirm-delete-button'
import { deleteTest } from '../actions'
import { TestStatusToggle } from '../test-status-toggle'

export default async function TestsListPage({ params }: { params: Promise<{ clientSlug: string }> }) {
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
        <div>
          <a
            href={`/dashboard/clients/${client.slug}`}
            className="mb-1 flex items-center gap-1 text-xs text-[var(--ct-text-2)] hover:text-[var(--ct-text)]"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M6.5 2L3 5L6.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {client.name}
          </a>
          <h1 className="font-[family-name:var(--font-sora)] text-xl font-semibold">Funis de Teste</h1>
        </div>
        <a
          href={`/dashboard/clients/${client.slug}/tests/new`}
          className="rounded-[9px] bg-[var(--ct-accent)] px-4 py-2.5 text-[13.5px] font-semibold text-[var(--ct-on-accent)]"
        >
          Novo teste
        </a>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[var(--ct-line)]">
        {(tests ?? []).map((test, index) => (
          <div
            key={test.id}
            className={`flex items-center gap-5 bg-[var(--ct-surface)] px-6 py-5 hover:bg-[var(--ct-surface-2)] ${
              index < (tests?.length ?? 0) - 1 ? 'border-b border-[var(--ct-line)]' : ''
            } ${test.status === 'paused' ? 'opacity-70' : ''}`}
          >
            <a href={`/dashboard/clients/${client.slug}/tests/${test.slug}`} className="flex min-w-0 flex-1 items-center gap-5">
              <div className="min-w-0 flex-1">
                <div className="font-[family-name:var(--font-sora)] text-[15px] font-semibold">{test.name}</div>
                <div className="font-[family-name:var(--font-geist-mono)] text-xs text-[var(--ct-text-2)]">/{test.slug}</div>
              </div>
              <div className="flex flex-col items-end">
                <span className="font-[family-name:var(--font-geist-mono)] text-[15px] font-medium">
                  {accessCountsError ? '—' : (accessesByTestId.get(test.id) ?? 0)}
                </span>
                <span className="text-[11px] text-[var(--ct-text-2)]">acessos totais</span>
              </div>
              <span className="rounded-full border border-[var(--ct-line)] px-2.5 py-1 text-xs font-medium text-[var(--ct-text-2)]">
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
        {(tests ?? []).length === 0 && <div className="px-6 py-8 text-sm text-[var(--ct-text-2)]">Nenhum teste ainda.</div>}
      </div>
    </div>
  )
}
