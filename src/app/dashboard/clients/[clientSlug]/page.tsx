import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { ConfirmDeleteButton } from '@/components/confirm-delete-button'
import { deleteClient } from '../actions'
import { getClientHubKpis } from '@/lib/repo/client-hub-repo'
import { resolvePeriodDateRange } from '@/lib/domain/report-period'

function KpiCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card-shadow flex-1 rounded-[12px] border border-[var(--ct-line)] bg-[var(--ct-surface)] p-4">
      <div className="font-[family-name:var(--font-geist-mono)] text-[10px] uppercase tracking-wider text-[var(--ct-text-2)]">{label}</div>
      <div className="mt-1 font-[family-name:var(--font-geist-mono)] text-[21px] font-semibold">{value}</div>
      <div className="mt-1 truncate text-[11.5px] text-[var(--ct-text-2)]" title={hint}>
        {hint}
      </div>
    </div>
  )
}

export default async function ClientHubPage({ params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, name, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()

  const { since, until } = resolvePeriodDateRange('30d', undefined, undefined)
  const [testsResult, funnelsResult, kpis] = await Promise.all([
    supabase.from('tests').select('id', { count: 'exact', head: true }).eq('client_id', client.id),
    supabase.from('sales_funnels').select('id', { count: 'exact', head: true }).eq('client_id', client.id),
    getClientHubKpis(supabase, client.id, since, until).catch((error) => {
      console.error('[client-hub-kpis-failed]', { clientId: client.id }, error)
      return null
    }),
  ])
  if (testsResult.error) console.error('[client-hub-tests-count-failed]', { clientId: client.id }, testsResult.error)
  if (funnelsResult.error) console.error('[client-hub-funnels-count-failed]', { clientId: client.id }, funnelsResult.error)
  const testsCount = testsResult.count ?? 0
  const funnelsCount = funnelsResult.count ?? 0

  const currency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <div className="text-xs text-[var(--ct-text-2)]">CLIENTE</div>
          <h1 className="font-[family-name:var(--font-sora)] text-xl font-semibold">{client.name}</h1>
        </div>
        <div className="flex items-center gap-4">
          <ConfirmDeleteButton action={deleteClient.bind(null, client.id)} label="Excluir cliente" />
          <a
            href={`/dashboard/clients/${client.slug}/integrations`}
            className="rounded-[9px] border border-[var(--ct-line)] px-4 py-2.5 text-[13.5px] font-medium text-[var(--ct-text-2)]"
          >
            Integrações
          </a>
        </div>
      </div>

      {kpis && (
        <div className="mb-6 flex gap-3.5">
          <KpiCard label="Receita — 30d" value={currency(kpis.revenue)} hint="Receita líquida dos funis de venda" />
          <KpiCard
            label="ROAS médio"
            value={kpis.roas !== null ? `${kpis.roas.toFixed(2)}x` : '—'}
            hint={kpis.roas !== null ? 'Receita ÷ investimento nos últimos 30d' : 'Sem gasto de mídia registrado'}
          />
          <KpiCard
            label="Testes ativos"
            value={String(kpis.activeTests)}
            hint={`de ${testsCount} ${testsCount === 1 ? 'funil de teste' : 'funis de teste'}`}
          />
          <KpiCard
            label="Melhor variante"
            value={kpis.bestVariant ? `${kpis.bestVariant.liftPct > 0 ? '+' : ''}${kpis.bestVariant.liftPct.toFixed(0)}%` : '—'}
            hint={
              kpis.bestVariant
                ? `${kpis.bestVariant.variantName} — ${kpis.bestVariant.testName}`
                : 'Sem teste ativo com dados suficientes'
            }
          />
        </div>
      )}

      <div className="flex gap-5">
        <a
          href={`/dashboard/clients/${client.slug}/tests`}
          className="card-shadow hover-lift flex-1 rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface)] p-7 hover:border-[var(--ct-accent)]/40"
        >
          <div className="mb-4 flex h-[52px] w-[52px] items-center justify-center rounded-xl bg-[var(--ct-accent)]/15">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#8B9BFF" strokeWidth="2">
              <path d="M4 12h6M14 12h6M10 6l4 6-4 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="mb-1.5 font-[family-name:var(--font-sora)] text-[17px] font-semibold">Funis de Teste</div>
          <p className="text-[13px] leading-relaxed text-[var(--ct-text-2)]">
            Testes A/B de página e checkout — clique, variante, conversão.
          </p>
          <div className="mt-4 font-[family-name:var(--font-geist-mono)] text-xs text-[var(--ct-text-2)]">{testsCount} funis de teste</div>
        </a>

        <a
          href={`/dashboard/clients/${client.slug}/funis-venda`}
          className="card-shadow hover-lift flex-1 rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface)] p-7 hover:border-[var(--ct-ok)]/40"
        >
          <div className="mb-4 flex h-[52px] w-[52px] items-center justify-center rounded-xl bg-[var(--ct-ok)]/15">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#4ADE9B" strokeWidth="2">
              <path d="M4 4h16l-6 8v6l-4 2v-8L4 4z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="mb-1.5 font-[family-name:var(--font-sora)] text-[17px] font-semibold">Funis de Venda</div>
          <p className="text-[13px] leading-relaxed text-[var(--ct-text-2)]">
            Receita, gasto de anúncio, ROAS e CAC por operação/produto.
          </p>
          <div className="mt-4 font-[family-name:var(--font-geist-mono)] text-xs text-[var(--ct-text-2)]">{funnelsCount} funis configurados</div>
        </a>
      </div>
    </div>
  )
}
