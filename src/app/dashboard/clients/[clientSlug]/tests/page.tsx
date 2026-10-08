import { Suspense } from 'react'
import { PageHeader } from '@/components/page-header'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { SuccessBanner } from '@/components/success-banner'
import { ConfirmDeleteButton } from '@/components/confirm-delete-button'
import { archiveTest } from '../actions'
import { TestStatusToggle } from '../test-status-toggle'
import { testLeader, type VariantResult } from '@/lib/domain/test-leader'
import { daysRunningSince } from '@/lib/domain/report-period'
import { canActAs } from '@/lib/view-as'

export default async function TestsListPage({ params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase
    .from('clients')
    .select('id, name, slug')
    .eq('slug', clientSlug)
    .maybeSingle()

  if (!client) notFound()
  const canEdit = await canActAs(supabase, client.id, 'gestor')

  const { data: tests } = await supabase
    .from('tests')
    .select('id, name, slug, status, test_type, created_at')
    .eq('client_id', client.id)
    .is('archived_at', null)
    .order('name')

  // Leader and confidence per test, from the same report and math the test page uses, over the
  // whole life of the test. One report per test: a client runs a handful at a time.
  const testIds = (tests ?? []).map((test) => test.id)
  const [{ data: variants }, reports] = await Promise.all([
    testIds.length > 0 ? supabase.from('variants').select('id, test_id, is_control').in('test_id', testIds) : Promise.resolve({ data: [] }),
    Promise.all(testIds.map((id) => supabase.rpc('get_test_report', { p_test_id: id, p_since: null, p_until: null }))),
  ])
  const leaderByTestId = new Map(
    testIds.map((id, index) => {
      const controlId = (variants ?? []).find((variant) => variant.test_id === id && variant.is_control)?.id
      const rows = (reports[index].data ?? []) as VariantResult[]
      return [id, testLeader(rows, controlId)]
    })
  )

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
    <div className="flex max-w-[1240px] flex-col px-4 md:px-14 pb-24 pt-12">
      <Suspense fallback={null}>
        <SuccessBanner param="created" message="Teste criado com sucesso." />
      </Suspense>
      <div className="mb-9">
        <PageHeader
          note={client.name}
          title="A/B de link"
          description="Cada teste divide o tráfego de um link /r entre as variantes e mede por pessoa quem compra mais."
          actions={
            canEdit && <a
              href={`/dashboard/clients/${client.slug}/tests/new`}
              className="rounded-full bg-[var(--ct-accent)] px-4 py-2 text-[13px] font-semibold text-[var(--ct-on-accent)] hover:brightness-110"
            >
              Novo teste
            </a>
          }
        />
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
              <div className="flex min-w-[150px] flex-col items-end">
                {(() => {
                  const leader = leaderByTestId.get(test.id)
                  return leader ? (
                    <>
                      <span className="max-w-[180px] truncate text-[13px] font-semibold" title={leader.name}>{leader.name}</span>
                      <span className={`text-[11px] ${leader.confidencePct >= 95 ? 'text-[var(--ct-ok)]' : 'text-[var(--ct-text-2)]'}`}>
                        lidera · {leader.confidencePct}% de confiança
                      </span>
                    </>
                  ) : (
                    <span className="text-[11px] text-[var(--ct-text-2)]">sem líder ainda</span>
                  )
                })()}
              </div>
              <div className="flex flex-col items-end">
                <span className="font-[family-name:var(--font-geist-mono)] text-[15px] font-medium">{daysRunningSince(test.created_at)}</span>
                <span className="text-[11px] text-[var(--ct-text-2)]">dias</span>
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
            {canEdit && <TestStatusToggle testId={test.id} clientSlug={client.slug} status={test.status} />}
            {canEdit && <ConfirmDeleteButton
              action={archiveTest.bind(null, test.id, client.slug)}
              label="Arquivar"
              warning="Sai da lista e o link manda todos para o controle. Os dados ficam. Confirmar?"
            />}
          </div>
        ))}
        {(tests ?? []).length === 0 && <div className="px-6 py-8 text-sm text-[var(--ct-text-2)]">Nenhum teste ainda.</div>}
      </div>
    </div>
  )
}
