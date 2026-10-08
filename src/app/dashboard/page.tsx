import { Suspense } from 'react'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { SuccessBanner } from '@/components/success-banner'
import { resolvePeriodDateRange } from '@/lib/domain/report-period'
import type { ClientRole } from '@/lib/repo/client-access-repo'
import { isCritical } from '@/lib/domain/page-probe'

interface PageNow {
  client_id: string
  silenced: boolean
  last_ok: boolean | null
  last_redirects: number | null
  prev_ok: boolean | null
}

interface UsageStats {
  total_clients: number
  total_tests: number
  total_click_events: number
}

interface PortfolioRow {
  client_id: string
  /** With tax, from the client's campaigns (0064). */
  spend: number
  spend_today: number
  entry_sales: number
  net_revenue: number
  active_tests: number
  last_sync_at: string | null
  alerts_crit: number
  alerts_warn: number
  responsaveis: string | null
}

const ROLE_LABEL: Record<ClientRole, string> = {
  owner: 'Owner',
  gestor: 'Gestor',
  analista: 'Analista',
  cliente: 'Cliente',
}

const currency = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

// The cron runs hourly: three hours without a good read means the numbers on this row are old.
const STALE_AFTER_MS = 3 * 60 * 60 * 1000

function isStale(iso: string | null): boolean {
  return !iso || Date.now() - new Date(iso).getTime() > STALE_AFTER_MS
}

function syncLabel(iso: string | null): string {
  if (!iso) return 'nunca'
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ alertas?: string }> }) {
  const onlyWithAlerts = (await searchParams).alertas === '1'
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { since } = resolvePeriodDateRange('7d', undefined, undefined)
  const [{ data: clients }, { data: summary, error: summaryError }, { data: memberships }, { data: funnels }, { data: usage }, { data: staffRow }, { data: pagesNow, error: pagesError }] = await Promise.all([
    supabase.from('clients').select('id, name, slug').order('name'),
    supabase.rpc('get_portfolio_summary', { p_since: since }) as unknown as Promise<{ data: PortfolioRow[] | null; error: unknown }>,
    supabase.from('memberships').select('client_id, role').eq('user_id', user?.id ?? ''),
    supabase.from('sales_funnels').select('client_id'),
    supabase.rpc('get_usage_stats').single() as unknown as Promise<{ data: UsageStats | null }>,
    supabase.from('staff').select('role').eq('user_id', user?.id ?? '').maybeSingle(),
    supabase.rpc('get_pages_now') as unknown as Promise<{ data: PageNow[] | null; error: unknown }>,
  ])
  // Without the summary every client would read R$ 0 and 0 sales. The list stays, the numbers show a
  // dash and a banner says why: better than hiding every client behind one failed read.
  const summaryFailed = Boolean(summaryError)
  if (summaryError) console.error('[portfolio-summary-failed]', summaryError)
  const summaryByClient = new Map((summary ?? []).map((row) => [row.client_id, row]))
  const roleByClient = new Map<string, ClientRole>((memberships ?? []).map((row) => [row.client_id, row.role]))
  const projectsByClient = new Map<string, number>()
  for (const row of funnels ?? []) projectsByClient.set(row.client_id, (projectsByClient.get(row.client_id) ?? 0) + 1)

  // Pages down for real (0089) count as critical here too, unless silenced for maintenance.
  if (pagesError) console.error('[portfolio-pages-failed]', pagesError)
  const pagesDownByClient = new Map<string, number>()
  for (const page of pagesNow ?? []) {
    if (page.silenced || page.last_ok === null) continue
    const checks = [{ ok: page.last_ok, redirects: page.last_redirects ?? 0 }, ...(page.prev_ok === null ? [] : [{ ok: page.prev_ok, redirects: 0 }])]
    if (isCritical(checks)) pagesDownByClient.set(page.client_id, (pagesDownByClient.get(page.client_id) ?? 0) + 1)
  }
  const crit = (row: { id: string; summary?: PortfolioRow }) => Number(row.summary?.alerts_crit ?? 0) + (pagesDownByClient.get(row.id) ?? 0)
  const warn = (row: { summary?: PortfolioRow }) => Number(row.summary?.alerts_warn ?? 0)
  // Whoever needs attention comes first: critical alerts, then attention, then the biggest spend.
  const allRows = (clients ?? [])
    .map((client) => ({ ...client, summary: summaryByClient.get(client.id) }))
    .sort((a, b) => crit(b) - crit(a) || warn(b) - warn(a) || Number(b.summary?.spend ?? 0) - Number(a.summary?.spend ?? 0) || a.name.localeCompare(b.name, 'pt-BR'))
  const rows = onlyWithAlerts ? allRows.filter((row) => crit(row) + warn(row) > 0) : allRows
  const money = (value: number | undefined) => (summaryFailed ? '—' : currency(Number(value ?? 0)))
  const totalSpend = rows.reduce((sum, row) => sum + Number(row.summary?.spend ?? 0), 0)
  const totalToday = rows.reduce((sum, row) => sum + Number(row.summary?.spend_today ?? 0), 0)
  const totalSales = rows.reduce((sum, row) => sum + Number(row.summary?.entry_sales ?? 0), 0)
  const totalCrit = rows.reduce((sum, row) => sum + crit(row), 0)
  const totalWarn = rows.reduce((sum, row) => sum + Number(row.summary?.alerts_warn ?? 0), 0)

  return (
    <div className="flex max-w-[1320px] flex-col gap-10 px-4 md:px-14 pb-24 pt-12">
      <Suspense fallback={null}>
        <SuccessBanner param="created" message="Cliente criado com sucesso." />
      </Suspense>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <span className="font-[family-name:var(--font-geist-mono)] text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--ct-text-3)]">
            Agência
          </span>
          <h1 className="mt-2.5 text-[30px] font-semibold tracking-[-0.04em]">Carteira</h1>
          <p className="mt-2 text-sm text-[var(--ct-text-2)]">
            Os clientes que você acompanha. Cada linha abre a Central daquele cliente.
          </p>
        </div>
        <Link
          href="/dashboard/clients/new"
          className="ml-auto rounded-[10px] bg-[var(--ct-accent)] px-3.5 py-2 text-[12.5px] font-medium text-[var(--ct-on-accent)] hover:brightness-110"
        >
          + Novo cliente
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-[18px] lg:grid-cols-5">
        {[
          { label: 'Clientes', value: String(allRows.length), foot: 'que você acessa' },
          { label: 'Investido hoje', value: money(totalToday), foot: 'com imposto · parcial' },
          { label: 'Investido', value: money(totalSpend), foot: 'últimos 7 dias · com imposto' },
          { label: 'Vendas de entrada', value: summaryFailed ? '—' : totalSales.toLocaleString('pt-BR'), foot: 'últimos 7 dias' },
          { label: 'Alertas abertos', value: summaryFailed ? '—' : String(totalCrit + totalWarn), foot: totalCrit > 0 ? `${totalCrit} críticos` : 'nenhum crítico' },
        ].map((kpi) => (
          <div key={kpi.label} className="flex flex-col gap-1.5 rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface)] px-[22px] py-5">
            <span className="text-xs text-[var(--ct-text-3)]">{kpi.label}</span>
            <span className="font-[family-name:var(--font-geist-mono)] text-2xl font-medium tracking-[-0.04em]">{kpi.value}</span>
            <span className="text-xs text-[var(--ct-text-3)]">{kpi.foot}</span>
          </div>
        ))}
      </div>

      {summaryFailed && (
        <div role="alert" className="rounded-[14px] border border-[var(--ct-crit)]/40 bg-[var(--ct-crit-soft)] px-5 py-3.5 text-[13px] text-[var(--ct-crit)]">
          Não foi possível ler os números da carteira agora. A lista de clientes está abaixo; tente recarregar em instantes.
        </div>
      )}

      {allRows.length > 0 && (
        <div className="-mb-6 flex items-center gap-2 text-[12.5px]">
          <Link
            href="/dashboard"
            aria-current={!onlyWithAlerts ? 'page' : undefined}
            className={`rounded-full px-3 py-1.5 font-medium ${!onlyWithAlerts ? 'bg-[var(--ct-accent-soft)] text-[var(--ct-text)]' : 'text-[var(--ct-text-2)] hover:text-[var(--ct-text)]'}`}
          >
            Todos
          </Link>
          <Link
            href="/dashboard?alertas=1"
            aria-current={onlyWithAlerts ? 'page' : undefined}
            className={`rounded-full px-3 py-1.5 font-medium ${onlyWithAlerts ? 'bg-[var(--ct-accent-soft)] text-[var(--ct-text)]' : 'text-[var(--ct-text-2)] hover:text-[var(--ct-text)]'}`}
          >
            Só com alerta
          </Link>
          <span className="ml-auto text-[var(--ct-text-3)]">Ordem: críticos, atenção, maior gasto</span>
        </div>
      )}

      {allRows.length > 0 && rows.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-[var(--ct-line-2)] p-10 text-center text-sm text-[var(--ct-text-2)]">
          Nenhum cliente com alerta aberto.
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-[var(--ct-line-2)] p-10 text-center">
          <p className="text-sm text-[var(--ct-text-2)]">Você ainda não acompanha nenhum cliente.</p>
          <Link href="/dashboard/clients/new" className="mt-3 inline-block text-sm font-medium text-[var(--ct-accent)]">
            + Criar o primeiro cliente
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface)]">
          <table className="w-full border-collapse text-[13px]">
            <caption className="sr-only">Clientes da carteira, com alertas, investimento, vendas e última leitura</caption>
            <thead>
              <tr className="text-left font-[family-name:var(--font-geist-mono)] text-[10.5px] uppercase tracking-[0.06em] text-[var(--ct-text-3)]">
                <th scope="col" className="px-5 py-3.5 font-medium">Cliente</th>
                <th scope="col" className="px-5 py-3.5 font-medium">Responsável</th>
                <th scope="col" className="px-5 py-3.5 font-medium">Alertas</th>
                <th scope="col" className="px-5 py-3.5 text-right font-medium">Investido hoje</th>
                <th scope="col" className="px-5 py-3.5 text-right font-medium">Investido 7d</th>
                <th scope="col" className="px-5 py-3.5 text-right font-medium">Vendas 7d</th>
                <th scope="col" className="px-5 py-3.5 text-right font-medium">Receita líq. 7d</th>
                <th scope="col" className="px-5 py-3.5 text-right font-medium">Projetos · testes</th>
                <th scope="col" className="px-5 py-3.5 text-right font-medium">Última sync</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const role = roleByClient.get(row.id)
                return (
                  <tr key={row.id} className="relative border-t border-[var(--ct-line)] hover:bg-[var(--ct-surface-2)]">
                    <td className="px-5 py-3.5">
                      {/* The link's overlay covers the whole row, so any cell opens the client. */}
                      <Link href={`/dashboard/clients/${row.slug}`} className="block after:absolute after:inset-0 after:content-['']">
                        <b className="font-semibold">{row.name}</b>
                        <span className="block text-[11.5px] text-[var(--ct-text-3)]">{row.slug}</span>
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-[var(--ct-text-2)]">
                      {row.summary?.responsaveis ?? '—'}
                      <span className="block text-[11.5px] text-[var(--ct-text-3)]">você: {role ? ROLE_LABEL[role] : 'Staff'}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      {crit(row) + warn(row) === 0 ? (
                        <span className="text-[var(--ct-text-3)]">—</span>
                      ) : (
                        <span className="relative z-10 flex flex-wrap gap-1.5">
                          {(pagesDownByClient.get(row.id) ?? 0) > 0 && (
                            <Link href={`/dashboard/clients/${row.slug}/paginas`} className="rounded-full bg-[var(--ct-crit-soft)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--ct-crit)]">
                              {pagesDownByClient.get(row.id) === 1 ? '1 página fora do ar' : `${pagesDownByClient.get(row.id)} páginas fora do ar`}
                            </Link>
                          )}
                          <Link href={`/dashboard/clients/${row.slug}/painel`} className="flex flex-wrap gap-1.5">
                          {Number(row.summary?.alerts_crit ?? 0) > 0 && (
                            <span className="rounded-full bg-[var(--ct-crit-soft)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--ct-crit)]">
                              {row.summary?.alerts_crit} crítico{Number(row.summary?.alerts_crit) > 1 ? 's' : ''}
                            </span>
                          )}
                          {Number(row.summary?.alerts_warn ?? 0) > 0 && (
                            <span className="rounded-full bg-[var(--ct-warn-soft)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--ct-warn)]">
                              {row.summary?.alerts_warn} atenção
                            </span>
                          )}
                          </Link>
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right font-[family-name:var(--font-geist-mono)]">{money(row.summary?.spend_today)}</td>
                    <td className="px-5 py-3.5 text-right font-[family-name:var(--font-geist-mono)]">{money(row.summary?.spend)}</td>
                    <td className="px-5 py-3.5 text-right font-[family-name:var(--font-geist-mono)]">
                      {summaryFailed ? '—' : Number(row.summary?.entry_sales ?? 0).toLocaleString('pt-BR')}
                    </td>
                    <td className="px-5 py-3.5 text-right font-[family-name:var(--font-geist-mono)]">{money(row.summary?.net_revenue)}</td>
                    <td className="px-5 py-3.5 text-right font-[family-name:var(--font-geist-mono)]">
                      {projectsByClient.get(row.id) ?? 0} · {summaryFailed ? '—' : row.summary?.active_tests ?? 0}
                    </td>
                    <td className="px-5 py-3.5 text-right font-[family-name:var(--font-geist-mono)] text-[var(--ct-text-2)]">
                      {syncLabel(row.summary?.last_sync_at ?? null)}
                      {!summaryFailed && isStale(row.summary?.last_sync_at ?? null) && (
                        <span className="ml-2 rounded-full bg-[var(--ct-warn-soft)] px-2 py-0.5 font-[family-name:var(--font-manrope)] text-[11px] font-semibold text-[var(--ct-warn)]">
                          defasado
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {usage && staffRow && (
        <p className="font-[family-name:var(--font-geist-mono)] text-[11px] text-[var(--ct-text-3)]">
          {usage.total_clients} clientes · {usage.total_tests} testes · {usage.total_click_events} cliques registrados
          (Supabase free tier: 500MB de banco — fique de olho se isso crescer muito rápido)
        </p>
      )}
    </div>
  )
}
